(function ($, window, document) {
	'use strict';

	var config = window.InmovFtthMapRoutes;
	if (!$ || !config || !config.endpoint || !document) return;

	var sourceId = 'inmov-ftth-routes-source';
	var layerId = 'inmov-ftth-routes-line';
	var hitLayerId = 'inmov-ftth-routes-hit';
	var highlightLayerId = 'inmov-ftth-routes-highlight';
	var routeData = null;
	var requestPromise = null;
	var requestRetryTimer = null;
	var requestRetryDelay = 1000;
	var mapRecords = new WeakMap();
	var trackedContainers = new Set();
	var scanTimer = null;
	var stopped = false;
	var nativeInitAttempts = new WeakSet();
	var controlsAdded = new WeakSet();
	var pointClickHandlers = new WeakSet();
	var pointRecords = {};
	var selectedPointElement = null;
	var selectedPointElementZIndex = '';
	var selectedPointContainer = null;
	var selectedPointContainerZIndex = '';
	var selectedRouteRecord = null;
	var selectedRouteId = null;
	var defaultMapStyle = 'mapbox://styles/mapbox/outdoors-v12';
	// streets-v12 is a standard street style; satellite-streets-v12 is the
	// Mapbox style that actually provides satellite imagery.
	var alternateMapStyle = 'mapbox://styles/mapbox/satellite-streets-v12';
	var darkMapStyle = 'mapbox://styles/mapbox/dark-v11';

	var pointVisuals = {
		pop: { label: 'POP', glyph: '▣', color: '#7c3aed' },
		olt: { label: 'OLT', glyph: '◉', color: '#2563eb' },
		cto: { label: 'CTO', glyph: '▦', color: '#f59e0b' },
		poste: { label: 'Poste', glyph: '│', color: '#64748b' },
		caixa_emenda: { label: 'Caixa de emenda', glyph: '✣', color: '#06b6d4' },
		splitter: { label: 'Splitter', glyph: '◇', color: '#10b981' },
		loja: { label: 'Loja / sede', glyph: '⌂', color: '#db2777' },
		outro: { label: 'Outro', glyph: '•', color: '#475569' }
	};

	function normalizePointType(value) {
		var raw = String(value || '').toLowerCase().trim();
		if (raw.normalize) raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		raw = raw.replace(/[\s-]+/g, '_');
		if (raw === 'cep') return 'cto';
		if (raw === 'ceo') return 'caixa_emenda';
		if (raw === 'caixa_de_emenda' || raw === 'caixa_emenda') return 'caixa_emenda';
		return pointVisuals[raw] ? raw : 'outro';
	}

	function localityClusterInfo(value) {
		var raw = String(value || '').trim().replace(/\s+/g, ' ');
		if (!raw) return { key: '__unknown__', label: 'Sem localidade' };
		// Imports frequently append the state to the city ("Jaguaquara - BA").
		// Keep the city only so records from the same place are counted together.
		raw = raw.replace(/\s*(?:[-–—,\/]\s*|\s+)(?:ba|bahia)\s*$/i, '').trim();
		var words = raw.split(/\s+/).filter(Boolean);
		var label = words.length > 2 ? words.slice(0, 2).join(' ') : raw;
		var key = raw.toLowerCase();
		if (key.normalize) key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		key = key.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ') || '__unknown__';
		return { key: key, label: label };
	}

	function pointVisual(point) {
		var key = normalizePointType(point && (point.type || point.ponto_tipo || point.pointType));
		return { key: key, data: pointVisuals[key] || pointVisuals.outro };
	}

	function clearPointSelection() {
		if (selectedPointElement) {
			if (selectedPointElement.classList) selectedPointElement.classList.remove('inmov-ftth-point-marker--selected');
			if (selectedPointElement.style) selectedPointElement.style.zIndex = selectedPointElementZIndex;
		}
		if (selectedPointContainer) {
			if (selectedPointContainer.classList) selectedPointContainer.classList.remove('inmov-ftth-map-marker--selected-container');
			if (selectedPointContainer !== selectedPointElement && selectedPointContainer.style) selectedPointContainer.style.zIndex = selectedPointContainerZIndex;
		}
		selectedPointElement = null;
		selectedPointElementZIndex = '';
		selectedPointContainer = null;
		selectedPointContainerZIndex = '';
	}

	function selectPointMarker(marker) {
		clearPointSelection();
		if (!marker || !marker.getElement) return;
		selectedPointElement = marker.getElement();
		if (selectedPointElement && selectedPointElement.classList) selectedPointElement.classList.add('inmov-ftth-point-marker--selected');
		selectedPointContainer = selectedPointElement;
		if (selectedPointElement && selectedPointElement.closest) {
			var mapboxContainer = selectedPointElement.closest('.mapboxgl-marker');
			if (mapboxContainer) selectedPointContainer = mapboxContainer;
		}
		if (selectedPointElement && selectedPointElement.style) {
			selectedPointElementZIndex = selectedPointElement.style.zIndex || '';
			selectedPointElement.style.zIndex = '10000';
		}
		if (selectedPointContainer) {
			selectedPointContainerZIndex = selectedPointContainer.style ? selectedPointContainer.style.zIndex || '' : '';
			if (selectedPointContainer.classList) selectedPointContainer.classList.add('inmov-ftth-map-marker--selected-container');
			if (selectedPointContainer.style) selectedPointContainer.style.zIndex = '10000';
		}
	}

	function decoratePointMarker(marker, point) {
		if (!marker || !marker.getElement) return;
		var element = marker.getElement();
		if (!element || !element.classList) return;
		var visual = pointVisual(point || {});
		element.classList.add('inmov-ftth-point-marker', 'inmov-ftth-point-marker--' + visual.key);
		element.style.setProperty('--inmov-point-color', visual.data.color);
		element.setAttribute('data-point-type', visual.key);
		element.setAttribute('aria-label', (point && (point.name || point.code)) || visual.data.label);
		var icon = element.querySelector('.jet-map-marker-default');
		if (icon) {
			icon.setAttribute('data-glyph', visual.data.glyph);
			icon.style.setProperty('--inmov-point-color', visual.data.color);
		}
		var oldLabel = element.querySelector('.inmov-ftth-point-marker__label');
		if (oldLabel) oldLabel.remove();
		if (visual.key === 'cto') {
			var label = document.createElement('span');
			label.className = 'inmov-ftth-point-marker__label';
			label.textContent = (point && (point.name || point.code)) || 'CTO';
			element.appendChild(label);
		}
	}

	function decorateAllPointMarkers(map) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups) return;
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (marker && marker._map === map) decoratePointMarker(marker, pointRecords[id] || {});
			});
		});
		updateMarkerVisibility(map);
	}

	function updateMarkerVisibility(map, options) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups || !map || typeof map.getBounds !== 'function') return;
		var bounds;
		try { bounds = map.getBounds(); } catch (error) { return; }
		var southWest = bounds.getSouthWest ? bounds.getSouthWest() : null;
		var northEast = bounds.getNorthEast ? bounds.getNorthEast() : null;
		var latMargin = southWest && northEast ? Math.max(0.002, (northEast.lat - southWest.lat) * 1.5) : 0.01;
		var lngMargin = southWest && northEast ? Math.max(0.002, (northEast.lng - southWest.lng) * 1.5) : 0.01;
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (!marker || marker._map !== map || !marker.getElement || typeof marker.getLngLat !== 'function') return;
				var element = marker.getElement();
				var visible = false;
				try {
					var position = marker.getLngLat();
					visible = southWest && northEast
						? position.lat >= southWest.lat - latMargin && position.lat <= northEast.lat + latMargin && position.lng >= southWest.lng - lngMargin && position.lng <= northEast.lng + lngMargin
						: bounds.contains(position);
				} catch (error) {}
				if (element && element.classList) element.classList.toggle('inmov-ftth-point-marker--offscreen', !visible);
			});
		});
		if (!options || !options.lightweight) applyOverlapOffsets(map);
		if (!options || !options.lightweight || options.refreshClusters) updatePointClusters(map);
	}

	function scheduleMarkerVisibility(map) {
		if (!map || map.__inmovMarkerVisibilityPending) return;
		map.__inmovMarkerVisibilityPending = true;
		var isMobile = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
		var interval = isMobile ? 110 : 55;
		var clusterInterval = isMobile ? 300 : 140;
		var now = Date.now();
		var elapsed = now - (map.__inmovMarkerVisibilityLast || 0);
		var wait = Math.max(0, interval - elapsed);
		var refresh = function () {
			map.__inmovMarkerVisibilityPending = false;
			var timestamp = Date.now();
			var refreshClusters = timestamp - (map.__inmovMarkerClusterLast || 0) >= clusterInterval;
			map.__inmovMarkerVisibilityLast = timestamp;
			if (refreshClusters) map.__inmovMarkerClusterLast = timestamp;
			updateMarkerVisibility(map, { lightweight: true, refreshClusters: refreshClusters });
		};
		if (wait > 0) window.setTimeout(refresh, wait);
		else if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(refresh);
		else window.setTimeout(refresh, 60);
	}

	function updatePointClusters(map) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups || !map || typeof map.getZoom !== 'function' || typeof map.project !== 'function') return;
		var container = typeof map.getContainer === 'function' ? map.getContainer() : null;
		if (!container) return;
		var overlay = container.querySelector('.inmov-ftth-point-clusters');
		var zoom = map.getZoom();
		var clusteredMode = zoom < 13;
		var markerItems = [];
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (!marker || marker._map !== map || !marker.getElement || typeof marker.getLngLat !== 'function') return;
				var element = marker.getElement();
				if (!element) return;
				if (!clusteredMode) {
					element.classList.remove('inmov-ftth-point-marker--clustered');
					return;
				}
				if (element.classList.contains('inmov-ftth-point-marker--offscreen')) return;
				try { markerItems.push({ id: id, marker: marker, element: element, point: map.project(marker.getLngLat()) }); } catch (error) {}
			});
		});
		if (!clusteredMode) {
			if (overlay) overlay.innerHTML = '';
			return;
		}
		if (!overlay) {
			overlay = document.createElement('div');
			overlay.className = 'inmov-ftth-point-clusters';
			container.appendChild(overlay);
		}
		overlay.innerHTML = '';
		var globalClusterMode = zoom < 4.5;
		var bucketSize = zoom < 11 ? Infinity : 100;
		var clusters = [];
		markerItems.forEach(function (item) {
			var cluster;
			if (bucketSize === Infinity) {
				if (globalClusterMode) {
					cluster = clusters[0];
				} else {
					var point = pointRecords[item.id] || {};
					var localityInfo = localityClusterInfo(point.locality || point.cidade || point.city || point.municipio);
					cluster = clusters.find(function (candidate) { return candidate.key === 'city:' + localityInfo.key; });
					if (!cluster) {
						cluster = { key: 'city:' + localityInfo.key, label: localityInfo.label, items: [] };
						clusters.push(cluster);
					}
				}
			} else {
				var key = Math.floor(item.point.x / bucketSize) + ':' + Math.floor(item.point.y / bucketSize);
				cluster = clusters.find(function (candidate) { return candidate.key === key; });
				if (!cluster) { cluster = { key: key, items: [] }; clusters.push(cluster); }
			}
			if (!cluster) { cluster = { key: 'all', items: [] }; clusters.push(cluster); }
			cluster.items.push(item);
		});
		clusters.forEach(function (cluster) {
			if (!cluster.items.length) return;
			var x = cluster.items.reduce(function (sum, item) { return sum + item.point.x; }, 0) / cluster.items.length;
			var y = cluster.items.reduce(function (sum, item) { return sum + item.point.y; }, 0) / cluster.items.length;
			cluster.items.forEach(function (item) { item.element.classList.add('inmov-ftth-point-marker--clustered'); item.element.style.setProperty('--inmov-overlap-x', '0px'); item.element.style.setProperty('--inmov-overlap-y', '0px'); });
			var bubble = document.createElement('button');
			bubble.type = 'button'; bubble.className = 'inmov-ftth-point-cluster';
			var clusterLabel = cluster.label ? cluster.label + ' · ' + cluster.items.length : String(cluster.items.length);
			bubble.textContent = clusterLabel;
			bubble.setAttribute('aria-label', clusterLabel + ' pontos');
			bubble.style.left = Math.round(x) + 'px'; bubble.style.top = Math.round(y) + 'px';
			bubble.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var center = map.unproject ? map.unproject([x, y]) : null;
				if (center && typeof map.flyTo === 'function') map.flyTo({ center: [center.lng, center.lat], zoom: 13, essential: true });
			});
			overlay.appendChild(bubble);
		});
	}

	function applyOverlapOffsets(map) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups || !map || typeof map.project !== 'function') return;
		if (typeof map.getZoom === 'function' && map.getZoom() < 13) {
			Object.keys(groups).forEach(function (id) { (groups[id] || []).forEach(function (entry) { var marker = entry && entry.marker; if (marker && marker.getElement) { marker.getElement().style.setProperty('--inmov-overlap-x', '0px'); marker.getElement().style.setProperty('--inmov-overlap-y', '0px'); } }); });
			return;
		}
		var visible = [];
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (!marker || marker._map !== map || !marker.getElement || typeof marker.getLngLat !== 'function') return;
				var element = marker.getElement();
				if (!element || element.classList.contains('inmov-ftth-point-marker--offscreen')) return;
				try { var point = map.project(marker.getLngLat()); visible.push({ element: element, point: point }); } catch (error) {}
			});
		});
		var buckets = {};
		visible.forEach(function (item) {
			var key = Math.floor(item.point.x / 36) + ':' + Math.floor(item.point.y / 36);
			if (!buckets[key]) buckets[key] = [];
			buckets[key].push(item);
		});
		Object.keys(buckets).forEach(function (key) {
			var cluster = buckets[key];
			cluster.forEach(function (item) {
				item.element.style.setProperty('--inmov-overlap-x', '0px');
				item.element.style.setProperty('--inmov-overlap-y', '0px');
			});
			if (cluster.length < 2) return;
			var radius = Math.min(42, 24 + (cluster.length * 2));
			cluster.forEach(function (item, index) {
				var angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / cluster.length);
				item.element.style.setProperty('--inmov-overlap-x', Math.round(Math.cos(angle) * radius) + 'px');
				item.element.style.setProperty('--inmov-overlap-y', Math.round(Math.sin(angle) * radius) + 'px');
			});
		});
	}

	function clearRouteSelection() {
		if (selectedRouteRecord && selectedRouteRecord.map && typeof selectedRouteRecord.map.getLayer === 'function' && selectedRouteRecord.map.getLayer(highlightLayerId)) {
			try { selectedRouteRecord.map.setFilter(highlightLayerId, ['==', ['id'], '__none__']); } catch (error) {}
		}
		selectedRouteRecord = null;
		selectedRouteId = null;
	}

	function selectRoute(record, feature) {
		if (!record || !record.map || !feature) return;
		clearPointSelection();
		clearRouteSelection();
		var id = feature.id;
		if (id === undefined || id === null || id === '') {
			var props = feature.properties || {};
			id = props.ftthRouteId || props._ID || props.id || props.code;
		}
		if (id === undefined || id === null || id === '') return;
		selectedRouteRecord = record;
		selectedRouteId = String(id);
		try {
			if (record.map.getLayer(highlightLayerId)) record.map.setFilter(highlightLayerId, ['==', ['id'], selectedRouteId]);
		} catch (error) {}
	}

	function resetMapShellScroll(map) {
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		var node = container && container.parentElement;
		while (node) {
			if (node.classList && node.classList.contains('inmov-ftth-map-shell')) {
				if (node.scrollTop) node.scrollTop = 0;
				return node;
			}
			node = node.parentElement;
		}
		return null;
	}

	/* When bottom sheets are stacked (for example, a detail sheet opened from
	 * an inventory selection), only the sheet visually in front may affect the
	 * map's usable viewport. Looking for the first `.is-open` element is not
	 * enough because the inventory can remain open behind the detail sheet.
	 * Select the visible panel with the greatest z-index, falling back to DOM
	 * order when two panels intentionally share the same layer. */
	function getActiveMapPanel() {
		if (!document || !document.querySelectorAll) return null;
		var panels = document.querySelectorAll('.inmov-ftth-map-sheet.is-open, .inmov-ftth-map-style-panel.is-open, .inmov-ftth-map-inventory-panel.is-open');
		var active = null;
		var activeZ = -Infinity;
		var activeIndex = -1;
		Array.prototype.forEach.call(panels, function (panel, index) {
			if (!panel || panel.getAttribute('aria-hidden') === 'true') return;
			var rect = panel.getBoundingClientRect ? panel.getBoundingClientRect() : null;
			if (!rect || rect.width <= 0 || rect.height <= 0) return;
			var style = window.getComputedStyle ? window.getComputedStyle(panel) : null;
			/* Keep a panel that is entering with a CSS opacity transition: the
			 * `.is-open` state and z-index already identify it as the foreground
			 * panel, while its opacity may still be near zero for a frame. */
			if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
			var zIndex = style ? parseFloat(style.zIndex) : 0;
			if (!Number.isFinite(zIndex)) zIndex = 0;
			if (zIndex > activeZ || (zIndex === activeZ && index > activeIndex)) {
				active = panel;
				activeZ = zIndex;
				activeIndex = index;
			}
		});
		return active;
	}

	/* Returns the part of the map that remains visible after the desktop side
	 * drawer or mobile bottom sheet is opened. Side drawers consume horizontal
	 * space; bottom sheets consume vertical space. Keeping that distinction in
	 * one helper prevents each centering path from inventing its own offset. */
	function getMapVisibleArea(map) {
		resetMapShellScroll(map);
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		if (!container || !container.getBoundingClientRect) return null;
		var mapRect = container.getBoundingClientRect();
		if (!mapRect || mapRect.width <= 0 || mapRect.height <= 0) return null;
		var panel = getActiveMapPanel();
		var panelRect = panel && panel.getBoundingClientRect ? panel.getBoundingClientRect() : null;
		var isDesktopViewport = window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
		var isMobileViewport = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
		var sidePanel = isDesktopViewport && !isMobileViewport && panelRect && panelRect.width > 0 && panelRect.width < mapRect.width * 0.8;
		var visibleLeft = 8;
		var visibleRight = mapRect.width - 8;
		var visibleTop = 8;
		var visibleBottom = mapRect.height - 8;
		if (sidePanel) {
			var panelLeft = panelRect.left - mapRect.left;
			var panelRight = panelRect.right - mapRect.left;
			var panelCenter = (panelLeft + panelRight) / 2;
			if (panelCenter <= mapRect.width / 2) visibleLeft = Math.max(8, panelRight + 8);
			else visibleRight = Math.min(mapRect.width - 8, panelLeft - 8);
		} else {
			var search = document.querySelector('.inmov-ftth-point-search');
			var searchBottom = search && search.getBoundingClientRect ? search.getBoundingClientRect().bottom - mapRect.top : 0;
			visibleTop = Math.max(8, searchBottom + 8);
			if (panelRect) visibleBottom = Math.min(mapRect.height - 8, panelRect.top - mapRect.top - 8);
		}
		return { mapRect: mapRect, visibleLeft: visibleLeft, visibleRight: visibleRight, visibleTop: visibleTop, visibleBottom: visibleBottom, sidePanel: sidePanel };
	}

	function getMapVisibleOffset(map) {
		var area = getMapVisibleArea(map);
		if (!area || area.visibleBottom <= area.visibleTop || area.visibleRight <= area.visibleLeft) return [0, 0];
		return [((area.visibleLeft + area.visibleRight) / 2) - (area.mapRect.width / 2), ((area.visibleTop + area.visibleBottom) / 2) - (area.mapRect.height / 2)];
	}

	function getSheetOffset(map) {
		var area = getMapVisibleArea(map);
		if (!area || area.visibleBottom <= area.visibleTop || area.visibleRight <= area.visibleLeft) return [0, -Math.min(120, (area && area.mapRect ? area.mapRect.height : 600) * 0.2)];
		return getMapVisibleOffset(map);
	}

	/* Centraliza um item na área realmente disponível do mapa. O painel inferior
	 * usa uma transição, então o offset calculado no mesmo frame em que ele abre
	 * ainda pode considerar o painel fora da tela. Fazemos uma correção depois
	 * do moveend usando a projeção real do ponto. */
	function focusMapCoordinate(map, center, zoom, options) {
		if (!map || !Array.isArray(center) || center.length < 2 || typeof map.flyTo !== 'function') return;
		options = options || {};
		var target = [Number(center[0]), Number(center[1])];
		if (!Number.isFinite(target[0]) || !Number.isFinite(target[1])) return;
		var previous = map.__inmovFtthFocusState;
		if (previous && Array.isArray(previous.timers) && typeof window !== 'undefined' && typeof window.clearTimeout === 'function') previous.timers.forEach(function (timer) { window.clearTimeout(timer); });
		var focusState = { token: (previous && previous.token || 0) + 1, timers: [] };
		map.__inmovFtthFocusState = focusState;
		/* Cancel a still-running overview/geolocation animation before starting
		 * the user-requested focus. Otherwise its later moveend can pull the map
		 * away after the selected item was already in the right place. */
		try { if (typeof map.stop === 'function') map.stop(); } catch (error) {}
		var startFocus = function () {
			if (map.__inmovFtthFocusState !== focusState) return;
			resetMapShellScroll(map);
			var container = typeof map.getContainer === 'function' ? map.getContainer() : null;
			var offset = getMapVisibleOffset(map);
			var activePanel = getActiveMapPanel();
			var inventoryOpen = !!(activePanel && activePanel.classList && activePanel.classList.contains('inmov-ftth-map-inventory-panel'));
			/* Inventory selections are already made with the sheet open. Do not start
			 * another animated flight here: the sheet transition and the previous city
			 * fit can otherwise compete for moveend and leave the item under search. */
			/* fitBounds() stores its camera padding on the Mapbox transform. Clear it
			 * before every item focus; otherwise a city selected in the inventory can
			 * keep an invisible bottom padding and pull the next point upward. */
			var flyOptions = { center: target, zoom: zoom, offset: inventoryOpen ? [0, 0] : offset, padding: 0, duration: options.duration !== undefined ? options.duration : 450, essential: options.essential !== false };
			if (inventoryOpen && typeof map.jumpTo === 'function' && typeof map.project === 'function' && typeof map.panBy === 'function') {
				try {
					/* Inventory centering uses an immediate jump followed by a precise
					 * vertical correction. Avoid restarting that pair when the same item
					 * is tapped again while it is already at the visible midpoint; doing
					 * so creates the small screen tremor users perceive as a second jump. */
					var activeInventoryPanel = getActiveMapPanel();
					var currentMapRect = container && container.getBoundingClientRect ? container.getBoundingClientRect() : null;
					if (activeInventoryPanel && currentMapRect && currentMapRect.width > 0 && currentMapRect.height > 0) {
						var currentArea = getMapVisibleArea(map);
						if (currentArea && currentArea.visibleBottom > currentArea.visibleTop && currentArea.visibleRight > currentArea.visibleLeft) {
							var currentPoint = map.project({ lng: target[0], lat: target[1] });
							var desiredX = (currentArea.visibleLeft + currentArea.visibleRight) / 2;
							var desiredY = (currentArea.visibleTop + currentArea.visibleBottom) / 2;
							var currentZoom = typeof map.getZoom === 'function' ? Number(map.getZoom()) : Number(zoom);
							var zoomMatches = !Number.isFinite(currentZoom) || Math.abs(currentZoom - Number(zoom)) < 0.02;
							if (zoomMatches && Math.abs(currentPoint.x - desiredX) < 6 && Math.abs(currentPoint.y - desiredY) < 6) return;
						}
					}
					map.jumpTo({ center: target, zoom: zoom, padding: 0, essential: options.essential !== false });
					var correctInventoryPosition = function () {
						if (map.__inmovFtthFocusState !== focusState || !container || !container.getBoundingClientRect) return;
						var panel = getActiveMapPanel();
						if (!panel || !panel.classList || !panel.classList.contains('inmov-ftth-map-inventory-panel')) return;
						var mapRect = container.getBoundingClientRect();
						var area = getMapVisibleArea(map);
						if (!area || area.visibleBottom <= area.visibleTop || area.visibleRight <= area.visibleLeft) return;
						var point = map.project({ lng: target[0], lat: target[1] });
						var desiredX = (area.visibleLeft + area.visibleRight) / 2;
						var desiredY = (area.visibleTop + area.visibleBottom) / 2;
						var deltaX = desiredX - point.x;
						var deltaY = desiredY - point.y;
						if ((Math.abs(deltaX) < 3 && Math.abs(deltaY) < 3) || Math.abs(deltaX) > mapRect.width * 0.9 || Math.abs(deltaY) > mapRect.height * 0.9) return;
						/* Mapbox moves the map canvas in the requested direction, so the
						 * feature moves by the opposite amount. Invert the correction to
						 * place the item at the calculated midpoint. */
						try { map.panBy([-deltaX, -deltaY], { duration: 0, essential: true }); } catch (error) { try { map.panBy([-deltaX, -deltaY], { duration: 0 }); } catch (ignored) {} }
					};
					if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(correctInventoryPosition);
					else if (typeof window.setTimeout === 'function') window.setTimeout(correctInventoryPosition, 0);
					else correctInventoryPosition();
					return;
				} catch (error) {}
			}
			try { map.flyTo(flyOptions); } catch (error) {}
		};
		/* Wait for the bottom sheet's 220ms entrance transition, then include its
		 * final bounds in flyTo's offset. This avoids the visible second jump from
		 * a post-animation pan correction. */
		if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
			var focusPanel = getActiveMapPanel();
			var focusDelay = focusPanel && focusPanel.classList && focusPanel.classList.contains('inmov-ftth-map-inventory-panel') ? 0 : 240;
			focusState.timers.push(window.setTimeout(startFocus, focusDelay));
		} else {
			startFocus();
		}
	}

	function getDetailZoom(map, latitude) {
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		var height = container && container.clientHeight ? Math.max(240, Math.min(container.clientHeight, 900)) : 600;
		var cos = Math.max(0.2, Math.cos((Number(latitude) || 0) * Math.PI / 180));
		// Target approximately 500 m across the visible map height.
		var zoom = Math.log((cos * 40075016 * height) / (512 * 500)) / Math.LN2;
		return Math.max(16, Math.min(20, zoom));
	}

	function updatePageLoading(state) {
		var overlay = document.getElementById && document.getElementById('inmov-ftth-page-loading');
		if (!overlay || !state) return;
		var pending = [];
		if (state.map) pending.push('mapa');
		if (state.routes) pending.push('rotas');
		if (state.points) pending.push('pontos');
		var text = overlay.querySelector ? overlay.querySelector('.inmov-ftth-page-loading__text') : null;
		if (text) text.textContent = state.error || (pending.length ? 'Carregando ' + pending.join(' e ') + '…' : 'Tudo pronto');
		var hidden = !pending.length && !state.error;
		if (overlay.classList) overlay.classList.toggle('is-hidden', hidden);
		/* The bootstrap uses inline styles so it appears before CSS loads. Keep
		 * the close state inline as well; otherwise inline visibility would win
		 * over the .is-hidden stylesheet rule. */
		if (overlay.style) {
			overlay.style.opacity = hidden ? '0' : '1';
			overlay.style.visibility = hidden ? 'hidden' : 'visible';
			overlay.style.pointerEvents = hidden ? 'none' : 'auto';
		}
	}

	function updateMapLoading(container, map, patch) {
		if (!container || !map) return;
		var state = map.__inmovFtthLoadingState || {
			map: true,
			routes: true,
			points: !!config.pointsEndpoint,
			error: ''
		};
		Object.keys(patch || {}).forEach(function (key) { state[key] = patch[key]; });
		map.__inmovFtthLoadingState = state;
		updatePageLoading(state);
		var host = container.parentNode || container;
		if (!map.__inmovFtthLoadingOverlay && host && host.querySelector) map.__inmovFtthLoadingOverlay = host.querySelector('.inmov-ftth-map-loading');
		if (!map.__inmovFtthLoadingOverlay && host && host.appendChild && document.createElement) {
			var overlay = document.createElement('div');
			overlay.className = 'inmov-ftth-map-loading';
			overlay.setAttribute('role', 'status');
			overlay.setAttribute('aria-live', 'polite');
			overlay.innerHTML = '<span class="inmov-ftth-map-loading__spinner" aria-hidden="true"></span><span class="inmov-ftth-map-loading__text"></span>';
			host.appendChild(overlay);
			map.__inmovFtthLoadingOverlay = overlay;
		}
		var loading = !!(state.map || state.routes || state.points);
		var overlay = map.__inmovFtthLoadingOverlay;
		if (!overlay || !overlay.classList) return;
		overlay.classList.toggle('is-visible', loading || !!state.error);
		var text = overlay.querySelector ? overlay.querySelector('.inmov-ftth-map-loading__text') : null;
		if (!text) return;
		if (state.error) {
			text.textContent = state.error;
			return;
		}
		var pending = [];
		if (state.map) pending.push('mapa');
		if (state.routes) pending.push('rotas');
		if (state.points) pending.push('pontos');
		text.textContent = pending.length ? 'Carregando ' + pending.join(' e ') + '…' : '';
	}

	function clearMapLoadingError(container, map) {
		if (!map) return;
		updateMapLoading(container, map, { error: '' });
	}

	function orientationHeading(event) {
		if (!event) return null;
		var iosHeading = Number(event.webkitCompassHeading);
		if (Number.isFinite(iosHeading)) return (iosHeading + 360) % 360;
		var compassHeading = Number(event.compassHeading ?? event.heading);
		if (Number.isFinite(compassHeading) && compassHeading >= 0) return (compassHeading + 360) % 360;
		var alpha = Number(event.alpha);
		if (!Number.isFinite(alpha)) return null;
		var screenAngle = 0;
		try {
			if (window.screen && window.screen.orientation && Number.isFinite(Number(window.screen.orientation.angle))) screenAngle = Number(window.screen.orientation.angle);
			else if (Number.isFinite(Number(window.orientation))) screenAngle = Number(window.orientation);
		} catch (error) {}
		// DeviceOrientation alpha grows counter-clockwise from the device's
		// top edge. Invert it to obtain a compass heading and compensate for
		// portrait/landscape screen rotation when the browser exposes it.
		return (360 - alpha + screenAngle + 360) % 360;
	}

	function attachDeviceOrientation(map) {
		if (!map || map.__inmovFtthOrientationAttached || !window.addEventListener) return;
		map.__inmovFtthOrientationAttached = true;
		var lastHeading = null;
		var handler = function (event) {
			if (!map.__inmovFtthOrientationEnabled || typeof map.rotateTo !== 'function') return;
			var heading = orientationHeading(event);
			if (!Number.isFinite(heading)) return;
			if (lastHeading === null) lastHeading = heading;
			var delta = ((heading - lastHeading + 540) % 360) - 180;
			lastHeading = (lastHeading + delta * 0.22 + 360) % 360;
			try { map.rotateTo(lastHeading, { duration: 0 }); } catch (error) {}
		};
		window.addEventListener('deviceorientationabsolute', handler, true);
		window.addEventListener('deviceorientation', handler, true);
		window.addEventListener('deviceorientationrelative', handler, true);
		map.__inmovFtthOrientationHandler = handler;
	}

	function rotateToHeading(map, heading) {
		heading = Number(heading);
		if (!map || !Number.isFinite(heading) || heading < 0 || typeof map.rotateTo !== 'function') return;
		try { map.rotateTo((heading + 360) % 360, { duration: 0 }); } catch (error) {}
	}

	function requestDeviceOrientationPermission(map) {
		var Orientation = window.DeviceOrientationEvent;
		if (!Orientation || typeof Orientation.requestPermission !== 'function') {
			attachDeviceOrientation(map);
			return;
		}
		if (map.__inmovFtthOrientationPermissionRequested) return;
		map.__inmovFtthOrientationPermissionRequested = true;
		try {
			var result = Orientation.requestPermission();
			if (result && typeof result.then === 'function') result.then(function (state) {
				if (state === 'granted') attachDeviceOrientation(map);
			}).catch(function () {});
		} catch (error) {}
	}

	function enableDeviceOrientation(map) {
		if (!map) return;
		map.__inmovFtthOrientationEnabled = true;
		if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
			// iOS requires a user gesture. The geolocation button is already a
			// deliberate gesture, so use it to request the orientation permission.
			var container = typeof map.getContainer === 'function' ? map.getContainer() : null;
			if (container && !container.__inmovFtthOrientationClickBound && container.addEventListener) {
				container.__inmovFtthOrientationClickBound = true;
				container.addEventListener('click', function (event) {
					var target = event && event.target && event.target.closest ? event.target.closest('.mapboxgl-ctrl-geolocate') : null;
					if (target) requestDeviceOrientationPermission(map);
				}, true);
			}
			return;
		}
		attachDeviceOrientation(map);
	}

	function startNativeGeolocation(map, control) {
		if (!map || !control || map.__inmovFtthAutoLocationStarted) return;
		map.__inmovFtthAutoLocationStarted = true;
		var trigger = function () {
			try {
				if (typeof control.trigger === 'function') control.trigger();
				else {
					var container = typeof map.getContainer === 'function' ? map.getContainer() : null;
					var button = container && container.querySelector ? container.querySelector('.mapboxgl-ctrl-geolocate') : null;
					if (button && typeof button.click === 'function') button.click();
				}
			} catch (error) {}
		};
		if (typeof map.loaded === 'function' && map.loaded()) trigger();
		else if (typeof map.once === 'function') map.once('load', trigger);
		else window.setTimeout(trigger, 350);
	}

	function getOverviewZoom(map) {
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		var width = container && container.clientWidth ? container.clientWidth : 600;
		return width < 500 ? 12.3 : 12.8;
	}

	function applyInitialNetworkOverview(map) {
		if (!map || map.__inmovFtthInitialOverviewApplied || typeof map.flyTo !== 'function') return;
		map.__inmovFtthInitialOverviewApplied = true;
		var center = [-39.965351, -13.524918];
		try { map.flyTo({ center: center, zoom: getOverviewZoom(map), duration: 0, essential: true }); } catch (error) {}
	}

	function normalizeSheetStatus(value) {
		var raw = String(value || '').trim();
		if (!raw) return 'Não informado';
		var normalized = raw.toLowerCase().replace(/[_-]+/g, ' ');
		var labels = {
			'nativo': 'Nativo',
			'ativo': 'Ativo',
			'planejado': 'Planejado',
			'em implantacao': 'Em implantação',
			'manutencao': 'Manutenção',
			'inativo': 'Inativo',
			'em configuracao': 'Em configuração',
			'concluida': 'Concluída'
		};
		return labels[normalized] || raw.charAt(0).toUpperCase() + raw.slice(1);
	}

	function sheetTypeVisual(kind, type) {
		if ('route' === kind) {
			var routeColor = String(arguments[2] || '').trim();
			if (!/^#[0-9a-f]{6}$/i.test(routeColor)) routeColor = '#f97316';
			return { key: 'route', label: type || 'Rota de fibra', glyph: '━', color: routeColor, soft: routeColor + '1c' };
		}
		var visual = pointVisuals[normalizePointType(type)] || pointVisuals.outro;
		return { key: normalizePointType(type), label: visual.label, glyph: visual.glyph, color: visual.color, soft: visual.color + '1c' };
	}

	function sheetSetText(sheet, selector, value) {
		var node = sheet.querySelector(selector);
		if (node) node.textContent = value || '';
	}

	function syncSheetTitleMarquee(sheet) {
		var viewport = sheet && sheet.querySelector ? sheet.querySelector('.inmov-ftth-map-sheet__title-viewport') : null;
		var title = sheet && sheet.querySelector ? sheet.querySelector('.inmov-ftth-map-sheet__title') : null;
		if (!viewport || !title) return;
		title.classList.remove('is-marquee');
		title.style.removeProperty('--inmov-title-shift');
		var schedule = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : function (callback) { window.setTimeout(callback, 0); };
		schedule(function () {
			if (!title.isConnected) return;
			var overflow = title.scrollWidth - viewport.clientWidth;
			if (overflow > 2) {
				title.style.setProperty('--inmov-title-shift', (-overflow) + 'px');
				title.classList.add('is-marquee');
			}
		});
	}

	function copySheetValue(value) {
		if (!value) return;
		try {
			var nav = window.navigator || (typeof navigator !== 'undefined' ? navigator : null);
			if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(value);
		} catch (error) {}
	}

	function openExternalUrl(url) {
		if (!url || !window) return false;
		var opened = null;
		/* A direct window.open keeps the current map untouched. Use a plain
		 * feature set so browsers do not return a falsey WindowProxy merely
		 * because noopener was requested, then detach the opener explicitly. */
		try { opened = window.open(url, '_blank'); } catch (error) {}
		if (opened) {
			try { opened.opener = null; } catch (error) {}
			return true;
		}
		/* Some embedded browsers block window.open but still allow a user-clicked
		 * target=_blank anchor. Never fall back to window.location: the map page
		 * must remain available when the external destination cannot be opened. */
		try {
			var link = document.createElement('a');
			link.href = url;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.setAttribute('aria-hidden', 'true');
			link.style.position = 'fixed';
			link.style.left = '-9999px';
			(document.body || document.documentElement).appendChild(link);
			link.click();
			window.setTimeout(function () { if (link.parentNode) link.parentNode.removeChild(link); }, 0);
			return true;
		} catch (error) {
			return false;
		}
	}

	function openGoogleMapsRoute(center) {
		if (!center || center.length !== 2) return;
		var lng = Number(center[0]);
		var lat = Number(center[1]);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
		var coordinates = lat.toFixed(6) + ',' + lng.toFixed(6);
		var destination = encodeURIComponent(coordinates);
		/* Google Maps URLs are universal links: on mobile they hand off to the
		 * installed app, and otherwise show the web route. Opening this same URL
		 * in a new context provides the fallback without replacing our map tab. */
		var url = 'https://www.google.com/maps/dir/?api=1&destination=' + destination + '&travelmode=driving&dir_action=navigate';
		openExternalUrl(url);
	}

	function openSheet(map, title, rows, center, options) {
		var sheet = document.querySelector('.inmov-ftth-map-sheet');
		if (!sheet || !sheet.querySelector) return;
		hideMapSearch(map);
		options = options || {};
		var visual = sheetTypeVisual(options.kind || 'point', options.type || '', options.color || '');
		var status = normalizeSheetStatus(options.status);
		var statusKey = String(options.status || '').toLowerCase().replace(/[_-]+/g, '-');
		var icon = sheet.querySelector('.inmov-ftth-map-sheet__icon');
		sheet.style.setProperty('--sheet-accent', visual.color);
		sheet.style.setProperty('--sheet-accent-soft', visual.soft);
		if (icon) {
			icon.textContent = visual.glyph;
			icon.style.setProperty('--sheet-accent', visual.color);
			icon.style.setProperty('--sheet-accent-soft', visual.soft);
		}
		sheet.dataset.itemKind = options.kind || 'point';
		sheet.dataset.itemType = visual.key;
		sheet.dataset.status = statusKey;
		sheet.dataset.itemId = options.id || '';
		sheet.dataset.itemCode = options.code || '';
		sheetSetText(sheet, '.inmov-ftth-map-sheet__type', visual.label);
		sheetSetText(sheet, '.inmov-ftth-map-sheet__status-text', status);
		sheetSetText(sheet, '.inmov-ftth-map-sheet__code', options.code ? '#' + options.code : '');
		sheetSetText(sheet, '.inmov-ftth-map-sheet__title', title || 'Item do mapa');
		syncSheetTitleMarquee(sheet);
		sheetSetText(sheet, '.inmov-ftth-map-sheet__locality-text', options.locality || 'Localidade não informada');
		var statusDot = sheet.querySelector('.inmov-ftth-map-sheet__status-dot');
		if (statusDot) statusDot.style.setProperty('--sheet-status-color', (statusKey === 'inativo' ? '#ef4444' : statusKey === 'manutencao' ? '#f59e0b' : '#10b981'));
		var body = sheet.querySelector('.inmov-ftth-map-sheet__body');
		if (body) {
			body.innerHTML = '';
			rows.forEach(function (row) {
				if (row[1] === undefined || row[1] === null || row[1] === '') return;
				var item = document.createElement('div');
				var isCoordinates = /^coordenadas$/i.test(String(row[0]));
				var wide = /observa|endere[cç]o|descri[cç]/i.test(String(row[0]));
				item.className = 'inmov-ftth-map-sheet__row' + (wide ? ' is-wide' : '');
				var label = document.createElement('span'); label.className = 'inmov-ftth-map-sheet__row-label'; label.textContent = row[0];
				var value = document.createElement('strong'); value.className = 'inmov-ftth-map-sheet__row-value' + (isCoordinates ? ' is-copyable' : ''); value.textContent = row[1];
				item.appendChild(label);
				if (isCoordinates) {
					var valueWrap = document.createElement('div'); valueWrap.className = 'inmov-ftth-map-sheet__coordinate-value';
					var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'inmov-ftth-map-sheet__copy-inline'; copy.setAttribute('aria-label', 'Copiar coordenadas'); copy.title = 'Copiar coordenadas'; copy.innerHTML = '<span class="inmov-ftth-copy-icon" aria-hidden="true"></span>';
					copy.addEventListener('click', function (event) { if (event && event.stopPropagation) event.stopPropagation(); copySheetValue(String(row[1])); copy.classList.add('is-copied'); window.setTimeout(function () { copy.classList.remove('is-copied'); }, 1400); });
					valueWrap.appendChild(value); valueWrap.appendChild(copy); item.appendChild(valueWrap);
				} else {
					item.appendChild(value);
				}
				body.appendChild(item);
			});
		}
		var coordinates = center && center.length === 2 ? center[1] + ', ' + center[0] : '';
		sheet.__inmovFtthCenter = center;
		sheet.__inmovFtthCoordinates = coordinates;
		sheet.__inmovFtthRouteCenter = center;
		var coordinateButton = sheet.querySelector('[data-sheet-action="copy-coordinates"]');
		if (coordinateButton) coordinateButton.classList.add('is-hidden');
		sheet.classList.add('is-open');
		var sheetShell = sheet.closest && sheet.closest('.inmov-ftth-map-shell');
		if (sheetShell && sheetShell.classList) sheetShell.classList.add('inmov-ftth-map-shell--sheet-open');
		sheet.setAttribute('aria-hidden', 'false');
		/* Refreshing an already-open sheet must update its contents without
		 * starting a second camera animation. The user may have moved the map
		 * after opening it, and the refresh should never pull the map elsewhere. */
		if (center && !options.preserveView) focusMapCoordinate(map, center, getDetailZoom(map, center[1]));
	}

	function openPointSheet(map, id, renderOptions) {
		var point = pointRecords[id];
		if (!point) return;
		renderOptions = renderOptions || {};
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		var marker = groups && groups[id] && groups[id][0] && groups[id][0].marker;
		clearRouteSelection();
		selectPointMarker(marker);
		var updated = point.updatedAt ? point.updatedAt + (point.updatedBy ? ' por ' + point.updatedBy : '') : '';
		var coordinates = Number(point.lat).toFixed(6) + ', ' + Number(point.lng).toFixed(6);
		openSheet(map, point.name || point.code, [['Código', point.code], ['Tipo de ponto', point.type], ['Situação', point.status], ['Localidade', point.locality], ['Endereço técnico', point.address], ['Coordenadas', coordinates], ['Capacidade', point.capacity ? point.capacity + ' portas' : ''], ['Última atualização', updated], ['Observações', point.observation]], [point.lng, point.lat], { kind: 'point', id: point.id, type: point.type, status: point.status, code: point.code, locality: point.locality, preserveView: !!renderOptions.preserveView });
	}

	function routeFeatureCoordinates(feature) {
		var result = [];
		function walk(value) {
			if (!Array.isArray(value)) return;
			if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
				result.push([Number(value[0]), Number(value[1])]);
				return;
			}
			value.forEach(walk);
		}
		walk(feature && feature.geometry && feature.geometry.coordinates);
		return result;
	}

	function refreshOpenSheet(map) {
		var sheet = document.querySelector('.inmov-ftth-map-sheet.is-open');
		if (!sheet || !sheet.dataset) return;
		var kind = sheet.dataset.itemKind || 'point';
		if (kind === 'point') {
			if (sheet.dataset.itemId && pointRecords[sheet.dataset.itemId]) openPointSheet(map, sheet.dataset.itemId, { preserveView: true });
			return;
		}
		if (kind !== 'route' || !routeData || !Array.isArray(routeData.features)) return;
		var identity = String(sheet.dataset.itemId || sheet.dataset.itemCode || '');
		var feature = routeData.features.find(function (item) {
			var props = item && item.properties || {};
			return String(item && item.id || '') === identity || String(props._ID || props.id || props.code || props.ftthRouteId || '') === identity;
		});
		if (!feature) return;
		var props = feature.properties || {};
		var center = Array.isArray(sheet.__inmovFtthCenter) && sheet.__inmovFtthCenter.length === 2 ? sheet.__inmovFtthCenter : routeFeatureCoordinates(feature)[0];
		if (!center) return;
		var updated = props.updatedAt ? props.updatedAt + (props.updatedBy ? ' por ' + props.updatedBy : '') : '';
		var coordinates = Number(center[1]).toFixed(6) + ', ' + Number(center[0]).toFixed(6);
		var routeId = props._ID || props.id || props.ftthRouteId || feature.id;
		openSheet(map, props.name || 'Trecho de fibra', [['Localidade', props.locality], ['Tipo', props.routeType], ['Cabo', props.cableType], ['Fibras', props.fibers ? props.fibers + ' FO' : ''], ['Extensão', props.lengthM ? props.lengthM + ' m' : ''], ['Coordenadas', coordinates], ['Última atualização', updated], ['Status', props.status]], center, { kind: 'route', id: routeId, type: props.routeType, status: props.status, code: routeId, locality: props.locality, color: props.ftthColor, preserveView: true });
	}

	function bindPointClickHandlers(map) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups) return;
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (!marker || marker._map !== map || !marker.getElement || pointClickHandlers.has(marker)) return;
				decoratePointMarker(marker, pointRecords[id] || {});
				pointClickHandlers.add(marker);
				marker.getElement().addEventListener('click', function (event) {
					if (event && event.stopPropagation) event.stopPropagation();
					selectPointMarker(marker);
					openPointSheet(map, id);
				}, true);
			});
		});
	}

	function markerRecords(container) {
		try {
			var raw = container.getAttribute('data-markers');
			var data = raw ? JSON.parse(raw) : [];
			return Array.isArray(data) ? data : [];
		} catch (error) { return []; }
	}

	function markerCoordinates(item) {
		var position = item.position || item.point || item.coordinates;
		var lng = Number(item.lng ?? item.longitude ?? item.lon ?? position?.lng ?? position?.[0]);
		var lat = Number(item.lat ?? item.latitude ?? position?.lat ?? position?.[1]);
		return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
	}

	function createMapLegend(container) {
		var parent = container && container.parentNode;
		if (!parent || typeof parent.querySelector !== 'function' || typeof parent.insertBefore !== 'function' || parent.querySelector('.inmov-ftth-map-legend')) return;
		var legend = document.createElement('div');
		legend.className = 'inmov-ftth-map-legend is-hidden';
		legend.setAttribute('aria-label', 'Legenda técnica do mapa');
		var pointsRow = document.createElement('div');
		pointsRow.className = 'inmov-ftth-map-legend__row';
		var pointsLabel = document.createElement('span');
		pointsLabel.className = 'inmov-ftth-map-legend__label';
		pointsLabel.textContent = 'Pontos:';
		pointsRow.appendChild(pointsLabel);
		Object.keys(pointVisuals).forEach(function (key) {
			var visual = pointVisuals[key];
			var item = document.createElement('span');
			item.className = 'inmov-ftth-map-legend__item';
			item.title = visual.label;
			item.innerHTML = '<i style="--legend-color:' + visual.color + '"></i><span>' + visual.label + '</span>';
			pointsRow.appendChild(item);
		});
		var cablesRow = document.createElement('div');
		cablesRow.className = 'inmov-ftth-map-legend__row is-cables';
		var cablesLabel = document.createElement('span');
		cablesLabel.className = 'inmov-ftth-map-legend__label';
		cablesLabel.textContent = 'Cabos:';
		cablesRow.appendChild(cablesLabel);
		Object.keys(fiberStyles).forEach(function (fiberCount) {
			var style = fiberStyles[fiberCount];
			var item = document.createElement('span');
			item.className = 'inmov-ftth-map-legend__item';
			item.innerHTML = '<i class="is-line" style="--legend-color:' + style[0] + '"></i><span>' + fiberCount + 'FO</span>';
			cablesRow.appendChild(item);
		});
		legend.appendChild(pointsRow);
		legend.appendChild(cablesRow);
		parent.insertBefore(legend, container);
	}

	function mapShellFor(container) {
		var host = container && container.parentNode;
		return host && host.classList && host.classList.contains('inmov-ftth-map-shell') ? host : host;
	}

	function hideMapSearch(map) {
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		var host = container && container.parentNode;
		var results = host && host.querySelector ? host.querySelector('.inmov-ftth-point-search__results') : null;
		if (results) results.innerHTML = '';
		if (host) host.__inmovFtthSearchResultsOpen = false;
	}

	function bindBottomSheetDrag(panel, handle) {
		if (!panel || !handle || typeof handle.addEventListener !== 'function') return;
		var startY = 0;
		var lastY = 0;
		var moved = false;
		var finish = function (event) {
			if (!moved) return;
			var delta = lastY - startY;
			if (event && event.preventDefault) event.preventDefault();
			panel.__inmovFtthSuppressHandleClick = true;
			if (delta < -32) panel.classList.add('is-expanded');
			else if (delta > 32) {
				if (panel.classList.contains('is-expanded')) panel.classList.remove('is-expanded');
				else {
					panel.classList.remove('is-open');
					panel.setAttribute('aria-hidden', 'true');
					var shell = panel.closest && panel.closest('.inmov-ftth-map-shell');
					if (shell && shell.classList) { shell.classList.remove('inmov-ftth-map-shell--sheet-open', 'inmov-ftth-map-shell--panel-open', 'inmov-ftth-map-shell--inventory-open'); }
					if (panel.classList.contains('inmov-ftth-map-sheet')) { clearPointSelection(); clearRouteSelection(); }
				}
			}
			panel.classList.remove('is-dragging');
			window.setTimeout(function () { panel.__inmovFtthSuppressHandleClick = false; }, 0);
			moved = false;
		};
		handle.addEventListener('pointerdown', function (event) {
			startY = lastY = Number(event.clientY) || 0;
			moved = false;
			panel.classList.add('is-dragging');
			if (handle.setPointerCapture && event.pointerId !== undefined) { try { handle.setPointerCapture(event.pointerId); } catch (error) {} }
		});
		handle.addEventListener('pointermove', function (event) {
			if (!panel.classList.contains('is-dragging')) return;
			lastY = Number(event.clientY) || lastY;
			if (Math.abs(lastY - startY) > 8) moved = true;
		});
		handle.addEventListener('pointerup', finish);
		handle.addEventListener('pointercancel', finish);
	}

	function getMapFitPadding(map) {
		resetMapShellScroll(map);
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		if (!container || !container.getBoundingClientRect) return { top: 24, right: 24, bottom: 24, left: 24 };
		var mapRect = container.getBoundingClientRect();
		var panel = getActiveMapPanel();
		var panelRect = panel && panel.getBoundingClientRect ? panel.getBoundingClientRect() : null;
		var isDesktopViewport = window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
		var isMobileViewport = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
		if (isDesktopViewport && !isMobileViewport && panelRect && panelRect.width > 0 && panelRect.width < mapRect.width * 0.8) {
			var panelCenter = ((panelRect.left - mapRect.left) + (panelRect.right - mapRect.left)) / 2;
			if (panelCenter <= mapRect.width / 2) return { top: 24, right: 24, bottom: 24, left: Math.max(24, panelRect.right - mapRect.left + 18) };
			return { top: 24, right: Math.max(24, mapRect.right - panelRect.left + 18), bottom: 24, left: 24 };
		}
		var search = document.querySelector('.inmov-ftth-point-search');
		var top = search && search.getBoundingClientRect ? Math.max(24, search.getBoundingClientRect().bottom - mapRect.top + 18) : 24;
		var bottom = panelRect ? Math.max(24, mapRect.bottom - panelRect.top + 18) : 24;
		return { top: top, right: 24, bottom: bottom, left: 24 };
	}

	function setRouteLayerVisibility(map, visible) {
		if (!map || typeof map.setLayoutProperty !== 'function') return;
		[layerId, hitLayerId, highlightLayerId].forEach(function (id) {
			try { if (map.getLayer && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); } catch (error) {}
		});
	}

	function applyPointLayerVisibility(map) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups) return;
		var visibility = map.__inmovFtthPointTypeVisibility || {};
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (!marker || !marker.getElement) return;
				var element = marker.getElement();
				if (!element || !element.classList) return;
				var type = normalizePointType((pointRecords[id] || {}).type);
				element.classList.toggle('inmov-ftth-point-marker--filtered', visibility[type] === false);
			});
		});
		updateMarkerVisibility(map, { lightweight: true, refreshClusters: true });
	}

	function applyMapQuickFilter(container, map, key) {
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		if (!groups) return;
		var pointFilter = key === 'rotas' ? null : (key === 'pontos' || key === 'tudo' ? null : normalizePointType(key));
		var routesVisible = key === 'tudo' || key === 'rotas';
		if (key === 'tudo') {
			map.__inmovFtthPointTypeVisibility = {};
			Object.keys(pointVisuals).forEach(function (type) { map.__inmovFtthPointTypeVisibility[type] = true; });
		}
		Object.keys(groups).forEach(function (id) {
			(groups[id] || []).forEach(function (entry) {
				var marker = entry && entry.marker;
				if (!marker || !marker.getElement) return;
				var element = marker.getElement();
				if (!element || !element.classList) return;
				var type = normalizePointType((pointRecords[id] || {}).type);
				var filtered = key === 'rotas' || (pointFilter && type !== pointFilter);
				element.classList.toggle('inmov-ftth-point-marker--filtered', !!filtered);
			});
		});
		setRouteLayerVisibility(map, routesVisible);
		map.__inmovFtthQuickFilter = key;
		if (key === 'tudo') applyPointLayerVisibility(map);
		updateMarkerVisibility(map, { lightweight: true, refreshClusters: true });
	}

	function createMapQuickFilters(container, map, searchWrap) {
		var host = mapShellFor(container);
		if (!host || !host.insertBefore || !document.createElement || host.querySelector && host.querySelector('.inmov-ftth-map-quick-filters')) return;
		var wrap = document.createElement('div');
		wrap.className = 'inmov-ftth-map-quick-filters';
		wrap.setAttribute('aria-label', 'Filtros rápidos do mapa');
		var filters = [
			['tudo', 'Tudo'], ['pontos', 'Pontos'], ['cto', 'CTOs'], ['olt', 'OLTs'], ['pop', 'POPs'], ['rotas', 'Rotas']
		];
		filters.forEach(function (filter, index) {
			var button = document.createElement('button');
			button.type = 'button';
			if (!button.dataset) button.dataset = {};
			button.className = 'inmov-ftth-map-quick-filter' + (index === 0 ? ' is-active' : '');
			button.dataset.filter = filter[0];
			button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
			button.textContent = filter[1];
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (item) {
					var active = item === button;
					item.classList.toggle('is-active', active);
					item.setAttribute('aria-pressed', active ? 'true' : 'false');
				});
				applyMapQuickFilter(container, map, filter[0]);
			});
			wrap.appendChild(button);
		});
		host.insertBefore(wrap, searchWrap ? searchWrap.nextSibling : container);
	}

	function createMapStylePanel(container, map) {
		var host = mapShellFor(container);
		if (!host || !host.appendChild || !document.createElement || host.querySelector && host.querySelector('.inmov-ftth-map-style-panel')) return;
		var panel = document.createElement('section');
		panel.className = 'inmov-ftth-map-style-panel';
		panel.setAttribute('aria-hidden', 'true');
		panel.innerHTML = '<div class="inmov-ftth-map-style-panel__handle" role="button" tabindex="0" aria-label="Expandir configurações"><span></span></div><div class="inmov-ftth-map-style-panel__head"><strong>Configurações do mapa</strong><button type="button" class="inmov-ftth-map-style-panel__close" aria-label="Fechar">×</button></div>' +
			'<div class="inmov-ftth-map-style-panel__section"><span>Tipo de mapa</span><div class="inmov-ftth-map-style-panel__styles" role="group" aria-label="Tipo de mapa">' +
			'<button type="button" class="inmov-ftth-map-style-choice is-selected" data-map-style="default"><i class="is-standard"></i><span>Padrão</span></button>' +
			'<button type="button" class="inmov-ftth-map-style-choice" data-map-style="satellite"><i class="is-satellite"></i><span>Satélite</span></button>' +
			'<button type="button" class="inmov-ftth-map-style-choice" data-map-style="dark"><i class="is-dark"></i><span>Escuro</span></button>' +
			'</div></div>' +
			'<div class="inmov-ftth-map-style-panel__section"><span>Itens exibidos</span><div class="inmov-ftth-map-style-panel__checklist">' +
			'<label><input type="checkbox" data-map-layer="routes" checked><i class="is-line"></i><span>Cabos e rotas</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-cto" checked><i class="is-cto">▦</i><span>CTOs</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-olt" checked><i class="is-olt">◉</i><span>OLTs</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-pop" checked><i class="is-pop">▣</i><span>POPs</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-caixa_emenda" checked><i class="is-caixa">✣</i><span>Caixas de emenda</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-loja" checked><i class="is-loja">⌂</i><span>Lojas / sedes</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-poste" checked><i class="is-poste">│</i><span>Postes</span></label>' +
			'<label><input type="checkbox" data-map-layer="point-outro" checked><i class="is-outro">•</i><span>Outros pontos</span></label>' +
			'<label><input type="checkbox" data-map-layer="legend"><i class="is-legend">≡</i><span>Ativar / desativar legenda técnica</span></label>' +
			'</div></div>';
		host.appendChild(panel);
		if (typeof panel.querySelector !== 'function' || typeof panel.querySelectorAll !== 'function') return panel;
		var close = panel.querySelector('.inmov-ftth-map-style-panel__close');
		var closePanel = function () { panel.classList.remove('is-open', 'is-expanded'); panel.setAttribute('aria-hidden', 'true'); if (host.classList) host.classList.remove('inmov-ftth-map-shell--panel-open'); };
		if (close) close.addEventListener('click', closePanel);
		var panelHandle = panel.querySelector('.inmov-ftth-map-style-panel__handle');
		if (panelHandle) { panelHandle.addEventListener('click', function () { if (panel.__inmovFtthSuppressHandleClick) return; panel.classList.toggle('is-expanded'); }); bindBottomSheetDrag(panel, panelHandle); }
		Array.prototype.forEach.call(panel.querySelectorAll('[data-map-style]'), function (button) {
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var styleKey = button.dataset.mapStyle;
				var satellite = styleKey === 'satellite';
				map.__inmovFtthAlternateStyle = satellite;
				Array.prototype.forEach.call(panel.querySelectorAll('[data-map-style]'), function (item) { item.classList.toggle('is-selected', item === button); });
				var styleUrl = styleKey === 'dark' ? darkMapStyle : (satellite ? alternateMapStyle : defaultMapStyle);
				try { if (typeof map.setStyle === 'function') map.setStyle(styleUrl, { diff: false }); } catch (error) {}
			});
		});
		Array.prototype.forEach.call(panel.querySelectorAll('[data-map-layer]'), function (button) {
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var enabled = button.checked !== false;
				var layerKey = button.dataset.mapLayer;
				if (layerKey === 'routes') setRouteLayerVisibility(map, enabled);
				if (layerKey === 'legend') {
					var legend = host.querySelector('.inmov-ftth-map-legend');
					if (legend) legend.classList.toggle('is-hidden', !enabled);
					positionRefreshNotice(container);
					return;
				}
				if (layerKey.indexOf('point-') === 0) {
					map.__inmovFtthPointTypeVisibility = map.__inmovFtthPointTypeVisibility || {};
					map.__inmovFtthPointTypeVisibility[layerKey.slice(6)] = enabled;
					applyPointLayerVisibility(map);
				}
			});
		});
		return panel;
	}

	function createMapBottomBar(container, map) {
		var host = mapShellFor(container);
		if (!host || !host.appendChild || !document.createElement || host.querySelector && host.querySelector('.inmov-ftth-map-bottom-bar')) return;
		var bar = document.createElement('nav');
		bar.className = 'inmov-ftth-map-bottom-bar';
		bar.setAttribute('aria-label', 'Ações do mapa');
		bar.innerHTML = '<button type="button" data-map-bottom="settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Configurações</span></button>' +
			'<button type="button" data-map-bottom="inventory"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 10h14M5 15h14M5 20h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="3" cy="5" r=".8" fill="currentColor"/><circle cx="3" cy="10" r=".8" fill="currentColor"/><circle cx="3" cy="15" r=".8" fill="currentColor"/><circle cx="3" cy="20" r=".8" fill="currentColor"/></svg><span>Inventário</span></button>' +
			'<button type="button" data-map-bottom="refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-13.6-5.7L4 7.7M4 4v3.7h3.7M4 13a8 8 0 0 0 13.6 5.7L20 16.3M20 20v-3.7h-3.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Atualizar</span></button>';
		host.appendChild(bar);
		if (typeof bar.querySelectorAll !== 'function') return;
		Array.prototype.forEach.call(bar.querySelectorAll('[data-map-bottom]'), function (button) {
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var action = button.dataset.mapBottom;
				if (action === 'settings') {
					var panel = host.querySelector('.inmov-ftth-map-style-panel');
					if (panel) { var open = !panel.classList.contains('is-open'); panel.classList.toggle('is-open', open); panel.setAttribute('aria-hidden', open ? 'false' : 'true'); host.classList.toggle('inmov-ftth-map-shell--panel-open', open); }
				}
				if (action === 'inventory') {
					var inventory = host.querySelector('.inmov-ftth-map-inventory-panel');
					if (inventory) {
						if (typeof inventory.__inmovFtthRender === 'function') inventory.__inmovFtthRender();
						var inventoryOpen = !inventory.classList.contains('is-open');
						inventory.classList.toggle('is-open', inventoryOpen);
						inventory.setAttribute('aria-hidden', inventoryOpen ? 'false' : 'true');
						host.classList.toggle('inmov-ftth-map-shell--inventory-open', inventoryOpen);
					}
				}
				if (action === 'refresh') { var refresh = host.querySelector('.inmov-ftth-refresh-control button'); if (refresh) refresh.click(); }
			});
		});
	}

	function createMapInventoryPanel(container, map, getRecords) {
		var host = mapShellFor(container);
		if (!host || !host.appendChild || !document.createElement || host.querySelector && host.querySelector('.inmov-ftth-map-inventory-panel')) return;
		var panel = document.createElement('section');
		panel.className = 'inmov-ftth-map-inventory-panel';
		panel.setAttribute('aria-hidden', 'true');
		panel.innerHTML = '<div class="inmov-ftth-map-inventory-panel__handle" role="button" tabindex="0" aria-label="Expandir inventário"><span></span></div><div class="inmov-ftth-map-inventory-panel__head"><strong>Inventário da rede</strong><button type="button" class="inmov-ftth-map-inventory-panel__close" aria-label="Fechar">×</button></div><div class="inmov-ftth-map-inventory-panel__body"></div>';
		host.appendChild(panel);
		if (typeof panel.querySelector !== 'function') return panel;
		var body = panel.querySelector('.inmov-ftth-map-inventory-panel__body');
		if (!body || typeof body.addEventListener !== 'function') return panel;
		var close = panel.querySelector('.inmov-ftth-map-inventory-panel__close');
		var closePanel = function () { panel.classList.remove('is-open', 'is-expanded'); panel.setAttribute('aria-hidden', 'true'); if (host.classList) host.classList.remove('inmov-ftth-map-shell--inventory-open'); };
		if (close) close.addEventListener('click', closePanel);
		var handle = panel.querySelector('.inmov-ftth-map-inventory-panel__handle');
		if (handle) { handle.addEventListener('click', function () { if (panel.__inmovFtthSuppressHandleClick) return; panel.classList.toggle('is-expanded'); }); bindBottomSheetDrag(panel, handle); }
		function cityKey(value) { return localityClusterInfo(value).key; }
		function recordsForCity(city) {
			return (getRecords() || []).filter(function (item) { return cityKey(item.locality || item.cidade || item.city || item.municipio) === city.key; });
		}
		function routesForCity(city) {
			return routeData && Array.isArray(routeData.features) ? routeData.features.filter(function (feature) { return cityKey(feature.properties && feature.properties.locality) === city.key; }) : [];
		}
		function routeCoordinates(feature) {
			var result = [];
			function walk(value) { if (!Array.isArray(value)) return; if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) { result.push([Number(value[0]), Number(value[1])]); return; } value.forEach(walk); }
			walk(feature && feature.geometry && feature.geometry.coordinates);
			return result;
		}
		function routeFiberCount(feature) {
			var properties = feature && feature.properties || {};
			return Number(properties.fibers || properties.ftthFiberCount) || 0;
		}
		function cities() {
			var result = {};
			(getRecords() || []).forEach(function (item) {
				var info = localityClusterInfo(item.locality || item.cidade || item.city || item.municipio);
				if (!result[info.key]) result[info.key] = { key: info.key, label: info.label, points: 0, routes: 0 };
				result[info.key].points++;
			});
			(routeData && Array.isArray(routeData.features) ? routeData.features : []).forEach(function (feature) {
				var info = localityClusterInfo(feature.properties && feature.properties.locality);
				if (!result[info.key]) result[info.key] = { key: info.key, label: info.label, points: 0, routes: 0 };
				result[info.key].routes++;
			});
			return Object.keys(result).map(function (key) { return result[key]; }).sort(function (a, b) { return (b.points + b.routes) - (a.points + a.routes) || a.label.localeCompare(b.label, 'pt-BR'); });
		}
		function fitCity(city) {
			var coords = recordsForCity(city).map(markerCoordinates).filter(Boolean);
			routesForCity(city).forEach(function (feature) { coords = coords.concat(routeCoordinates(feature)); });
			if (!coords.length) return;
			if (typeof map.fitBounds === 'function' && coords.length > 1) {
				var minLng = coords.reduce(function (v, item) { return Math.min(v, item[0]); }, Infinity), maxLng = coords.reduce(function (v, item) { return Math.max(v, item[0]); }, -Infinity);
				var minLat = coords.reduce(function (v, item) { return Math.min(v, item[1]); }, Infinity), maxLat = coords.reduce(function (v, item) { return Math.max(v, item[1]); }, -Infinity);
				map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: getMapFitPadding(map), maxZoom: 14, duration: 550, essential: true });
			} else if (typeof map.flyTo === 'function') focusMapCoordinate(map, coords[0], 13);
		}
		function setPanelOpen(open) {
			panel.classList.toggle('is-open', open); panel.setAttribute('aria-hidden', open ? 'false' : 'true');
			var shell = panel.closest && panel.closest('.inmov-ftth-map-shell');
			if (shell && shell.classList) shell.classList.toggle('inmov-ftth-map-shell--inventory-open', open);
		}
		function centerPoint(item, details) {
			var center = markerCoordinates(item);
			if (!center) return;
			var group = window.JetEngineMaps && window.JetEngineMaps.markersData && window.JetEngineMaps.markersData[item.id];
			if (details) {
				if (group && group[0] && group[0].marker && group[0].marker.getElement) group[0].marker.getElement().click();
			} else {
				/* Inventory centering should have the same visual feedback as touching
				 * the marker, without opening its details sheet. */
				if (group && group[0] && group[0].marker) selectPointMarker(group[0].marker);
				focusMapCoordinate(map, center, getDetailZoom(map, center[1]));
			}
		}
		function renderCityList() {
			panel.__inmovFtthInventoryCity = null;
			panel.__inmovFtthInventoryView = 'cities';
			panel.__inmovFtthInventoryCategory = null;
			body.innerHTML = '<p class="inmov-ftth-map-inventory-panel__hint">Escolha uma cidade para explorar os pontos e cabos.</p>';
			cities().forEach(function (city) {
				var button = document.createElement('button'); button.type = 'button'; button.className = 'inmov-ftth-map-inventory-city'; button.dataset.city = city.key;
				button.innerHTML = '<span><strong>' + city.label + '</strong><small>' + (city.points + city.routes) + ' itens</small></span><b>›</b>';
				body.appendChild(button);
			});
		}
		function renderCity(city) {
			panel.__inmovFtthInventoryCity = city;
			panel.__inmovFtthInventoryView = 'city';
			panel.__inmovFtthInventoryCategory = null;
			var points = recordsForCity(city), routes = routesForCity(city), categories = {};
			points.forEach(function (item) { var type = normalizePointType(item.type); var visual = pointVisuals[type] || pointVisuals.outro; var key = 'point:' + type; if (!categories[key]) categories[key] = { key: key, label: visual.label, color: visual.color, count: 0, kind: 'point', type: type }; categories[key].count++; });
			routes.forEach(function (feature) { var key = 'route:all'; if (!categories[key]) categories[key] = { key: key, label: 'Fibras e rotas', color: (feature.properties && (feature.properties.ftthColor || feature.properties.color)) || '#2563eb', count: 0, kind: 'route' }; categories[key].count++; });
			body.innerHTML = '<button type="button" data-inventory-back="cities" class="inmov-ftth-map-inventory-panel__back">‹ Todas as cidades</button><h4>' + city.label + '</h4><p class="inmov-ftth-map-inventory-panel__hint">Categorias disponíveis nesta localidade.</p>';
			Object.keys(categories).map(function (key) { return categories[key]; }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'); }).forEach(function (category) {
				var button = document.createElement('button'); button.type = 'button'; button.className = 'inmov-ftth-map-inventory-category'; button.dataset.category = category.key; button.innerHTML = '<i style="--inventory-color:' + category.color + '">' + (category.kind === 'route' ? '━' : (pointVisuals[category.type] || pointVisuals.outro).glyph) + '</i><span>' + category.label + '</span><b>' + category.count + '</b>'; body.appendChild(button);
			});
		}
		function renderCategory(city, categoryKey) {
			panel.__inmovFtthInventoryCity = city;
			panel.__inmovFtthInventoryView = 'category';
			panel.__inmovFtthInventoryCategory = categoryKey;
			var isRoute = categoryKey.indexOf('route:') === 0, items = isRoute && categoryKey !== 'route:all' ? routesForCity(city).filter(function (feature) { var fibers = routeFiberCount(feature); return categoryKey === 'route:' + (fibers || 'outro'); }) : recordsForCity(city).filter(function (item) { return 'point:' + normalizePointType(item.type) === categoryKey; });
			if (categoryKey === 'route:all') {
				var fiberGroups = {};
				routesForCity(city).forEach(function (feature) { var fibers = routeFiberCount(feature); var key = 'route:' + (fibers || 'outro'); if (!fiberGroups[key]) fiberGroups[key] = { key: key, label: fibers ? 'Fibra ' + fibers + 'FO' : 'Outras fibras', count: 0, color: (feature.properties && (feature.properties.ftthColor || feature.properties.color)) || '#2563eb' }; fiberGroups[key].count++; });
				body.innerHTML = '<button type="button" data-inventory-back="city" class="inmov-ftth-map-inventory-panel__back">‹ ' + city.label + '</button><h4>Fibras e rotas</h4><p class="inmov-ftth-map-inventory-panel__hint">Escolha uma capacidade para ver as rotas.</p>';
				Object.keys(fiberGroups).map(function (key) { return fiberGroups[key]; }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'); }).forEach(function (group) { var button = document.createElement('button'); button.type = 'button'; button.className = 'inmov-ftth-map-inventory-category'; button.dataset.category = group.key; button.innerHTML = '<i style="--inventory-color:' + group.color + '">━</i><span>' + group.label + '</span><b>' + group.count + '</b>'; body.appendChild(button); });
				return;
			}
			body.innerHTML = '<button type="button" data-inventory-back="city" class="inmov-ftth-map-inventory-panel__back">‹ ' + city.label + '</button><h4>' + (isRoute ? categoryKey.replace('route:', 'Fibra ') : (pointVisuals[categoryKey.replace('point:', '')] || pointVisuals.outro).label) + '</h4>';
			items.sort(function (a, b) { var av = isRoute ? String(a.properties && a.properties.name || '') : String(a.name || a.code || ''); var bv = isRoute ? String(b.properties && b.properties.name || '') : String(b.name || b.code || ''); return av.localeCompare(bv, 'pt-BR'); }).forEach(function (item) {
				var button = document.createElement('button'); button.type = 'button'; button.className = 'inmov-ftth-map-inventory-item'; button.dataset.inventoryAction = 'center'; button.dataset.inventoryKind = isRoute ? 'route' : 'point';
				if (isRoute) { button.dataset.routeId = String(item.id || ''); button.innerHTML = '<span><strong>' + String(item.properties && item.properties.name || 'Rota de fibra') + '</strong><small>#' + String(item.id || '') + '</small></span><b>⌾</b>'; }
				else { button.dataset.itemId = String(item.id || ''); button.innerHTML = '<span><strong>' + String(item.name || item.code || 'Ponto da rede') + '</strong><small>#' + String(item.code || item.id || '') + ' · ' + String(item.locality || '') + '</small></span><b>⌾</b>'; }
				body.appendChild(button);
			});
		}
		body.addEventListener('click', function (event) {
			var target = event.target && event.target.closest ? event.target.closest('button') : null;
			if (!target) return;
			if (target.classList.contains('inmov-ftth-map-inventory-panel__back')) { if (target.dataset.inventoryBack === 'city' && panel.__inmovFtthInventoryCity) renderCity(panel.__inmovFtthInventoryCity); else renderCityList(); return; }
			if (target.dataset.city) { var city = cities().find(function (item) { return item.key === target.dataset.city; }); if (city) { fitCity(city); renderCity(city); } return; }
			if (target.dataset.category) { var city = panel.__inmovFtthInventoryCity; if (city) renderCategory(city, target.dataset.category); return; }
			if (target.dataset.inventoryAction === 'center') {
				if (target.dataset.inventoryKind === 'point') centerPoint((getRecords() || []).find(function (item) { return String(item.id) === target.dataset.itemId; }), false);
				else {
					var feature = routeData && routeData.features && routeData.features.find(function (item) { return String(item.id) === target.dataset.routeId; });
					var routeCoords = routeCoordinates(feature); var coords = routeCoords[0];
					if (coords && feature) {
						clearPointSelection(); clearRouteSelection();
						var routeId = feature.id;
						if (routeId === undefined || routeId === null || routeId === '') { var routeProps = feature.properties || {}; routeId = routeProps.ftthRouteId || routeProps._ID || routeProps.id || routeProps.code; }
						if (routeId !== undefined && routeId !== null && routeId !== '') {
							selectedRouteRecord = { map: map }; selectedRouteId = String(routeId);
							try { if (map.getLayer && map.getLayer(highlightLayerId)) map.setFilter(highlightLayerId, ['==', ['id'], selectedRouteId]); } catch (error) {}
						}
						focusMapCoordinate(map, coords, getDetailZoom(map, coords[1]));
					}
				}
			}
		});
		panel.__inmovFtthRender = renderCityList;
		panel.__inmovFtthRefresh = function () {
			var city = panel.__inmovFtthInventoryCity;
			if (panel.__inmovFtthInventoryView === 'category' && city && panel.__inmovFtthInventoryCategory) {
				renderCategory(city, panel.__inmovFtthInventoryCategory);
			} else if (panel.__inmovFtthInventoryView === 'city' && city) {
				renderCity(city);
			} else {
				renderCityList();
			}
		};
		renderCityList();
		return panel;
	}

	function positionRefreshNotice(container) {
		var host = mapShellFor(container);
		if (!host || !host.querySelector || !window.matchMedia || !window.matchMedia('(max-width: 767px)').matches) return;
		var notice = host.querySelector('.inmov-ftth-refresh-notice');
		if (!notice || !host.getBoundingClientRect) return;
		var shellRect = host.getBoundingClientRect();
		var search = host.querySelector('.inmov-ftth-point-search');
		var legend = host.querySelector('.inmov-ftth-map-legend:not(.is-hidden)');
		var anchorBottom = search && search.getBoundingClientRect ? search.getBoundingClientRect().bottom : shellRect.top + 58;
		if (legend && legend.getBoundingClientRect) anchorBottom = Math.max(anchorBottom, legend.getBoundingClientRect().bottom);
		notice.style.top = Math.round(anchorBottom - shellRect.top + 12) + 'px';
		notice.style.left = '50%';
	}

	function updateRefreshNotice(container, state) {
		var host = mapShellFor(container);
		if (!host || !host.appendChild || !document.createElement) return;
		var notice = host.querySelector && host.querySelector('.inmov-ftth-refresh-notice');
		if (!notice) {
			notice = document.createElement('div');
			notice.className = 'inmov-ftth-refresh-notice';
			notice.setAttribute('role', 'status');
			var search = host.querySelector && host.querySelector('.inmov-ftth-point-search');
			if (search && search.parentNode === host) host.insertBefore(notice, search.nextSibling); else host.appendChild(notice);
		}
		positionRefreshNotice(container);
		if (state && state.loading) {
			if (host.__inmovFtthRefreshNoticeDismissed) return;
			notice.classList.remove('is-error', 'is-success');
			notice.classList.add('is-visible');
			notice.innerHTML = '<span class="inmov-ftth-refresh-notice__spinner" aria-hidden="true"></span><span>Atualizando dados…</span>';
			return;
		}
		if (state && state.error) {
			notice.classList.remove('is-success');
			notice.classList.add('is-visible', 'is-error');
			notice.innerHTML = '<span class="inmov-ftth-refresh-notice__icon" aria-hidden="true">!</span><span>' + state.error + '</span><button type="button" aria-label="Dispensar aviso">×</button>';
			var dismiss = notice.querySelector && notice.querySelector('button');
			if (dismiss) dismiss.addEventListener('click', function (event) { if (event && event.stopPropagation) event.stopPropagation(); host.__inmovFtthRefreshNoticeDismissed = true; notice.classList.remove('is-visible'); });
			return;
		}
		if (state && state.done) {
			host.__inmovFtthRefreshNoticeDismissed = false;
			notice.classList.remove('is-error');
			notice.classList.add('is-visible', 'is-success');
			notice.innerHTML = '<span class="inmov-ftth-refresh-notice__icon" aria-hidden="true">✓</span><span>Dados atualizados</span>';
			window.setTimeout(function () { notice.classList.remove('is-visible', 'is-success'); }, 1200);
		}
	}

	function addMapControls(container, map) {
		if (controlsAdded.has(container) || !window.mapboxgl) return;
		controlsAdded.add(container);
		updateMapLoading(container, map, {});
		var nativeLocationControl = false;
		var refreshMapData = null;
		try {
			if (typeof window.mapboxgl.NavigationControl === 'function') map.addControl(new window.mapboxgl.NavigationControl(), 'top-right');
			var globeControl = {
				onAdd: function (mapInstance) {
					this._map = mapInstance;
					this._container = document.createElement('div');
					this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group inmov-ftth-globe-control';
					this._button = document.createElement('button');
					this._button.type = 'button';
					this._button.className = 'inmov-ftth-globe-control__button';
					this._button.innerHTML = '<span aria-hidden="true">🌐</span>';
					this._button.setAttribute('aria-label', 'Abrir opções de mapa');
					this._button.title = 'Opções de mapa';
					this._button.addEventListener('click', function (event) {
						if (event && event.stopPropagation) event.stopPropagation();
						var panel = container.parentNode && container.parentNode.querySelector('.inmov-ftth-map-style-panel');
						if (panel) { var open = !panel.classList.contains('is-open'); panel.classList.toggle('is-open', open); panel.setAttribute('aria-hidden', open ? 'false' : 'true'); var shell = panel.closest && panel.closest('.inmov-ftth-map-shell'); if (shell && shell.classList) shell.classList.toggle('inmov-ftth-map-shell--panel-open', open); }
					}.bind(this._button));
					this._container.appendChild(this._button);
					return this._container;
				},
				onRemove: function () {
					if (this._container && this._container.parentNode) this._container.parentNode.removeChild(this._container);
					this._map = null;
				}
			};
			if (typeof window.mapboxgl.Control === 'function' || globeControl.onAdd) map.addControl(globeControl, 'top-right');
			if (typeof window.mapboxgl.GeolocateControl === 'function') {
				var geolocateControl = new window.mapboxgl.GeolocateControl({
					positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true
				});
				map.addControl(geolocateControl, 'top-right');
				var geolocateContainer = geolocateControl._container;
				if (!geolocateContainer && container && container.querySelector) {
					var geolocateButton = container.querySelector('.mapboxgl-ctrl-geolocate');
					geolocateContainer = geolocateButton && geolocateButton.parentNode;
				}
				if (geolocateContainer && geolocateContainer.classList) geolocateContainer.classList.add('inmov-ftth-geolocate-control');
				nativeLocationControl = true;
				map.__inmovFtthGeolocateControl = geolocateControl;
			}
			var layersControl = {
				onAdd: function (mapInstance) {
					this._map = mapInstance;
					this._container = document.createElement('div');
					this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group inmov-ftth-layers-control';
					this._button = document.createElement('button');
					this._button.type = 'button';
					this._button.className = 'inmov-ftth-map-control__button';
					this._button.setAttribute('aria-label', 'Alternar legenda técnica');
					this._button.title = 'Alternar legenda técnica';
					this._button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
					this._button.addEventListener('click', function (event) {
						if (event && event.stopPropagation) event.stopPropagation();
						var legend = container.parentNode && container.parentNode.querySelector('.inmov-ftth-map-legend');
						if (!legend) return;
						var hidden = legend.classList.toggle('is-hidden');
						this.classList.toggle('is-active', !hidden);
					}.bind(this._button));
					this._container.appendChild(this._button);
					return this._container;
				},
				onRemove: function () { if (this._container && this._container.parentNode) this._container.parentNode.removeChild(this._container); this._map = null; }
			};
			map.addControl(layersControl, 'top-right');
			var refreshControl = {
				onAdd: function (mapInstance) {
					this._map = mapInstance;
					this._container = document.createElement('div');
					this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group inmov-ftth-refresh-control';
					this._button = document.createElement('button');
					this._button.type = 'button';
					this._button.className = 'inmov-ftth-map-control__button';
					this._button.setAttribute('aria-label', 'Atualizar dados da rede');
					this._button.title = 'Atualizar dados da rede';
					this._button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-13.6-5.7L4 7.7M4 4v3.7h3.7M4 13a8 8 0 0 0 13.6 5.7L20 16.3M20 20v-3.7h-3.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
					this._button.addEventListener('click', function (event) {
						if (event && event.stopPropagation) event.stopPropagation();
						if (typeof mapInstance.__inmovFtthRefreshData === 'function') mapInstance.__inmovFtthRefreshData(this);
						else {
							this.classList.add('is-loading');
							routeData = null;
							requestPromise = null;
							fetchRoutes().then(function (data) {
								if (data && mapInstance.getSource && mapInstance.getSource(sourceId) && mapInstance.getSource(sourceId).setData) mapInstance.getSource(sourceId).setData(data);
							}).finally(function () { window.setTimeout(function () { this.classList.remove('is-loading'); }.bind(this), 350); }.bind(this));
						}
					}.bind(this._button));
					this._container.appendChild(this._button);
					return this._container;
				},
				onRemove: function () { if (this._container && this._container.parentNode) this._container.parentNode.removeChild(this._container); this._map = null; }
			};
			map.addControl(refreshControl, 'top-right');
			map.on('geolocate', function (event) {
				if (event && Number.isFinite(event.longitude) && Number.isFinite(event.latitude) && typeof map.flyTo === 'function') {
					userPosition = [event.longitude, event.latitude];
					enableDeviceOrientation(map);
					var eventHeading = event.heading;
					if (event.coords && Number.isFinite(Number(event.coords.heading))) eventHeading = event.coords.heading;
					if (Number.isFinite(Number(eventHeading)) && Number(eventHeading) >= 0) rotateToHeading(map, eventHeading);
					if (!map.__inmovFtthFirstGeolocateHandled) {
						map.__inmovFtthFirstGeolocateHandled = true;
						map.flyTo({ center: [event.longitude, event.latitude], zoom: getOverviewZoom(map), essential: true });
					}
				}
			});
			map.on('trackuserlocationstart', function () { enableDeviceOrientation(map); });
			map.on('trackuserlocationend', function () { map.__inmovFtthOrientationEnabled = false; });
			map.on('mousedown', function () { map.__inmovFtthMapPointerActive = true; map.__inmovFtthMapMoved = false; });
			map.on('touchstart', function () { map.__inmovFtthMapPointerActive = true; map.__inmovFtthMapMoved = false; });
			map.on('dragstart', function () {
				map.__inmovFtthOrientationEnabled = false;
				map.__inmovFtthMapMoved = true;
			});
			map.on('click', function (event) {
				var moved = !!map.__inmovFtthMapMoved;
				map.__inmovFtthMapPointerActive = false;
				map.__inmovFtthMapMoved = false;
				if (moved) return;
				var originalTarget = event && event.originalEvent && event.originalEvent.target;
				hideMapSearch(map);
				var isInteractive = originalTarget && originalTarget.closest && originalTarget.closest('.jet-map-marker, .mapboxgl-marker, .inmov-ftth-point-cluster, .mapboxgl-ctrl, .inmov-ftth-map-sheet');
				if (isInteractive) return;
				var sheet = document.querySelector('.inmov-ftth-map-sheet.is-open');
				if (sheet && sheet.classList) { sheet.classList.remove('is-open', 'is-expanded'); sheet.setAttribute('aria-hidden', 'true'); var shell = sheet.closest && sheet.closest('.inmov-ftth-map-shell'); if (shell && shell.classList) shell.classList.remove('inmov-ftth-map-shell--sheet-open'); clearPointSelection(); clearRouteSelection(); return; }
				var stylePanel = document.querySelector('.inmov-ftth-map-style-panel.is-open');
				if (stylePanel && stylePanel.classList) { stylePanel.classList.remove('is-open', 'is-expanded'); stylePanel.setAttribute('aria-hidden', 'true'); var styleShell = stylePanel.closest && stylePanel.closest('.inmov-ftth-map-shell'); if (styleShell && styleShell.classList) styleShell.classList.remove('inmov-ftth-map-shell--panel-open'); return; }
				var inventoryPanel = document.querySelector('.inmov-ftth-map-inventory-panel.is-open');
				if (inventoryPanel && inventoryPanel.classList) { inventoryPanel.classList.remove('is-open', 'is-expanded'); inventoryPanel.setAttribute('aria-hidden', 'true'); var inventoryShell = inventoryPanel.closest && inventoryPanel.closest('.inmov-ftth-map-shell'); if (inventoryShell && inventoryShell.classList) inventoryShell.classList.remove('inmov-ftth-map-shell--inventory-open'); return; }
				var legend = document.querySelector('.inmov-ftth-map-legend:not(.is-hidden)');
				if (legend && legend.classList) legend.classList.add('is-hidden');
			});
			map.on('moveend', function () { updateMarkerVisibility(map); });
			map.on('move', function () { scheduleMarkerVisibility(map); });
			map.on('zoomend', function () { updateMarkerVisibility(map); });
			map.on('resize', function () { updateMarkerVisibility(map); });
			if (typeof map.loaded === 'function' && map.loaded()) applyInitialNetworkOverview(map);
			else if (typeof map.once === 'function') map.once('load', function () { applyInitialNetworkOverview(map); });
			if (nativeLocationControl && map.__inmovFtthGeolocateControl) startNativeGeolocation(map, map.__inmovFtthGeolocateControl);
		} catch (error) {}
		var wrap = document.createElement('div');
		wrap.className = 'inmov-ftth-point-search mapboxgl-ctrl';
		if (container.parentNode && container.parentNode.classList) container.parentNode.classList.add('inmov-ftth-map-shell');
		var input = document.createElement('input');
		input.type = 'search'; input.placeholder = 'Pesquisar CTO, OLT ou código'; input.setAttribute('aria-label', 'Pesquisar pontos da rede');
		var results = document.createElement('div'); results.className = 'inmov-ftth-point-search__results';
		wrap.appendChild(input); wrap.appendChild(results); container.parentNode.insertBefore(wrap, container);
		createMapLegend(container);
		createMapQuickFilters(container, map, wrap);
		createMapStylePanel(container, map);
		createMapBottomBar(container, map);
		if (!map.__inmovFtthStyleApplied) {
			map.__inmovFtthStyleApplied = true;
			try { if (typeof map.setStyle === 'function') map.setStyle(defaultMapStyle, { diff: false }); } catch (error) {}
		}
		var sheet = document.createElement('section');
		sheet.className = 'inmov-ftth-map-sheet';
		sheet.setAttribute('aria-hidden', 'true');
			sheet.innerHTML = '<div class="inmov-ftth-map-sheet__handle" role="button" tabindex="0" aria-label="Expandir detalhes"><span></span></div>' +
			'<div class="inmov-ftth-map-sheet__header">' +
				'<div class="inmov-ftth-map-sheet__icon" aria-hidden="true">•</div>' +
				'<div class="inmov-ftth-map-sheet__heading">' +
					'<div class="inmov-ftth-map-sheet__meta"><span class="inmov-ftth-map-sheet__type"></span><span class="inmov-ftth-map-sheet__status"><i class="inmov-ftth-map-sheet__status-dot"></i><span class="inmov-ftth-map-sheet__status-text"></span></span></div>' +
					'<div class="inmov-ftth-map-sheet__title-viewport"><h3 class="inmov-ftth-map-sheet__title"></h3></div>' +
					'<p class="inmov-ftth-map-sheet__locality"><span aria-hidden="true">⌖</span><span class="inmov-ftth-map-sheet__locality-text"></span><span class="inmov-ftth-map-sheet__code"></span></p>' +
				'</div>' +
				'<div class="inmov-ftth-map-sheet__header-actions"><button type="button" class="inmov-ftth-map-sheet__close" aria-label="Fechar">×</button></div>' +
			'</div>' +
			'<div class="inmov-ftth-map-sheet__body"></div>' +
			'<div class="inmov-ftth-map-sheet__footer">' +
				'<button type="button" class="inmov-ftth-map-sheet__action" data-sheet-action="center">⌾ <span>Centralizar</span></button>' +
				'<button type="button" class="inmov-ftth-map-sheet__action is-hidden" data-sheet-action="copy-coordinates">▣ <span>Copiar coordenadas</span></button>' +
			'<button type="button" class="inmov-ftth-map-sheet__action" data-sheet-action="route" aria-label="Abrir rota no Google Maps"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a3 3 0 1 1 0-6h7a3 3 0 1 0 0-6h-1m0 0 3-3m-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="16" r="1.35" fill="currentColor"/></svg><span>Rotas</span></button>' +
				'<button type="button" class="inmov-ftth-map-sheet__action inmov-ftth-map-sheet__edit" data-sheet-action="edit">✎ <span>Editar</span></button>' +
			'</div>';
		container.parentNode.appendChild(sheet);
		if (!sheet.querySelector) return;
		var closeButton = sheet.querySelector && sheet.querySelector('.inmov-ftth-map-sheet__close');
		var closeSheet = function () { if (sheet.classList) sheet.classList.remove('is-open', 'is-expanded'); sheet.setAttribute('aria-hidden', 'true'); var shell = sheet.closest && sheet.closest('.inmov-ftth-map-shell'); if (shell && shell.classList) shell.classList.remove('inmov-ftth-map-shell--sheet-open'); clearPointSelection(); clearRouteSelection(); };
		if (closeButton && closeButton.addEventListener) closeButton.addEventListener('click', closeSheet);
		var handle = sheet.querySelector('.inmov-ftth-map-sheet__handle');
		if (handle && handle.addEventListener) {
			handle.addEventListener('click', function () { if (sheet.__inmovFtthSuppressHandleClick) return; sheet.classList.toggle('is-expanded'); });
			handle.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sheet.classList.toggle('is-expanded'); } });
			bindBottomSheetDrag(sheet, handle);
		}
		var centerButton = sheet.querySelector('[data-sheet-action="center"]');
		if (centerButton && centerButton.addEventListener) centerButton.addEventListener('click', function () {
			var center = sheet.__inmovFtthCenter;
			if (center) focusMapCoordinate(map, center, getDetailZoom(map, center[1]));
		});
		var copyButton = sheet.querySelector('[data-sheet-action="copy-coordinates"]');
		if (copyButton && copyButton.addEventListener) copyButton.addEventListener('click', function () { copySheetValue(sheet.__inmovFtthCoordinates || ''); copyButton.classList.add('is-copied'); window.setTimeout(function () { copyButton.classList.remove('is-copied'); }, 1400); });
		var routeButton = sheet.querySelector('[data-sheet-action="route"]');
		if (routeButton && routeButton.addEventListener) routeButton.addEventListener('click', function () { openGoogleMapsRoute(sheet.__inmovFtthRouteCenter || []); });
		var editButton = sheet.querySelector('[data-sheet-action="edit"]');
		if (editButton && editButton.addEventListener) editButton.addEventListener('click', function () {
			var detail = { id: sheet.dataset.itemId || '', code: sheet.dataset.itemCode || '', kind: sheet.dataset.itemKind || '', type: sheet.dataset.itemType || '' };
			try { document.dispatchEvent(new CustomEvent('inmov-ftth:edit-item', { detail: detail })); } catch (error) {}
			var selector = config.editPopupSelector || '';
			if (selector) { var trigger = document.querySelector(selector); if (trigger && typeof trigger.click === 'function') trigger.click(); }
		});
		var records = markerRecords(container);
		createMapInventoryPanel(container, map, function () { return records; });
		refreshMapData = function (button) {
			if (button && button.classList) button.classList.add('is-loading');
			updateRefreshNotice(container, { loading: true });
			routeData = null;
			requestPromise = null;
			var refreshFailed = false;
			var routeRequest = fetchRoutes().then(function (data) {
				if (data && map.getSource && map.getSource(sourceId) && map.getSource(sourceId).setData) map.getSource(sourceId).setData(data);
				refreshOpenSheet(map);
				var inventory = container.parentNode && container.parentNode.querySelector ? container.parentNode.querySelector('.inmov-ftth-map-inventory-panel') : null;
				if (inventory && typeof inventory.__inmovFtthRefresh === 'function') inventory.__inmovFtthRefresh();
				return data;
			}).catch(function () { refreshFailed = true; return null; });
			var pointRequest = !config.pointsEndpoint || typeof window.fetch !== 'function' ? Promise.resolve() : window.fetch(config.pointsEndpoint, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
				.then(function (response) { return response.ok ? response.json() : []; })
				.then(function (data) {
					if (Array.isArray(data)) {
						records = data;
						pointRecords = {};
						data.forEach(function (item) { pointRecords[item.id] = item; });
						decorateAllPointMarkers(map);
						updateMarkerVisibility(map);
						render();
						refreshOpenSheet(map);
						var inventory = container.parentNode && container.parentNode.querySelector ? container.parentNode.querySelector('.inmov-ftth-map-inventory-panel') : null;
						if (inventory && typeof inventory.__inmovFtthRefresh === 'function') inventory.__inmovFtthRefresh();
					}
				})
				.catch(function () { refreshFailed = true; });
			Promise.all([routeRequest, pointRequest]).finally(function () { updateRefreshNotice(container, refreshFailed ? { error: 'Não foi possível atualizar os dados.' } : { done: true }); if (button && button.classList) window.setTimeout(function () { button.classList.remove('is-loading'); }, 350); });
		};
		map.__inmovFtthRefreshData = refreshMapData;
		if (!map.__inmovFtthRefreshTimer && typeof window.setInterval === 'function') map.__inmovFtthRefreshTimer = window.setInterval(function () { if (document.hidden) return; refreshMapData(); }, 60000);
		if (config.pointsEndpoint && typeof window.fetch === 'function') {
			window.fetch(config.pointsEndpoint, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
				.then(function (response) { return response.ok ? response.json() : []; })
				.then(function (data) {
					if (Array.isArray(data)) {
						records = data;
						pointRecords = {};
						data.forEach(function (item) { pointRecords[item.id] = item; });
						decorateAllPointMarkers(map);
						updateMarkerVisibility(map);
						render();
						refreshOpenSheet(map);
						var inventory = container.parentNode && container.parentNode.querySelector ? container.parentNode.querySelector('.inmov-ftth-map-inventory-panel') : null;
						if (inventory && typeof inventory.__inmovFtthRefresh === 'function') inventory.__inmovFtthRefresh();
					}
					updateMapLoading(container, map, { points: false });
				}).catch(function () { updateMapLoading(container, map, { points: false }); });
		}
		var userPosition = null;
		var searchResultsOpen = false;
		var mapHost = container.parentNode;
		function distance(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
		function render() {
			if (mapHost && mapHost.__inmovFtthSearchResultsOpen === false) searchResultsOpen = false;
			var query = input.value.trim().toLowerCase();
			results.innerHTML = '';
			if (!query || !searchResultsOpen) return;
			var found = records.filter(function (item) { return JSON.stringify(item).toLowerCase().indexOf(query) !== -1; });
			found.sort(function (a, b) {
				if (!userPosition) return 0;
				var ac = markerCoordinates(a), bc = markerCoordinates(b);
				return (ac ? distance(ac, userPosition) : Infinity) - (bc ? distance(bc, userPosition) : Infinity);
			});
			found.slice(0, 8).forEach(function (item) {
				var point = markerCoordinates(item); if (!point) return;
				var button = document.createElement('button'); button.type = 'button';
				button.className = 'inmov-ftth-point-search__result';
				var visual = pointVisual(item);
				var icon = document.createElement('i'); icon.className = 'inmov-ftth-point-search__result-icon'; icon.style.setProperty('--result-color', visual.data.color); icon.textContent = visual.data.glyph;
				var content = document.createElement('span'); content.className = 'inmov-ftth-point-search__result-content';
				var title = document.createElement('strong'); title.textContent = item.title || item.name || item.label || item.post_title || 'Ponto da rede';
				var meta = document.createElement('small'); meta.textContent = (item.code ? '#' + item.code + ' · ' : '') + (item.locality || 'Localidade não informada');
				content.appendChild(title); content.appendChild(meta); button.appendChild(icon); button.appendChild(content);
				button.addEventListener('click', function () {
					searchResultsOpen = false;
					var markerGroup = window.JetEngineMaps && window.JetEngineMaps.markersData && window.JetEngineMaps.markersData[item.id];
					if (markerGroup && markerGroup[0] && markerGroup[0].marker && markerGroup[0].marker.getElement) markerGroup[0].marker.getElement().click();
					else focusMapCoordinate(map, point, getDetailZoom(map, point[1]));
					results.innerHTML = ''; if (mapHost) mapHost.__inmovFtthSearchResultsOpen = false; input.blur();
				});
				results.appendChild(button);
			});
		}
		input.addEventListener('input', function () { searchResultsOpen = !!input.value.trim(); if (mapHost) mapHost.__inmovFtthSearchResultsOpen = searchResultsOpen; render(); });
		input.addEventListener('focus', function () { resetMapShellScroll(map); if (input.value.trim()) { searchResultsOpen = true; if (mapHost) mapHost.__inmovFtthSearchResultsOpen = true; render(); } });
		if (container.addEventListener) container.addEventListener('click', function (event) {
			if (document.querySelector('.inmov-ftth-map-sheet.is-open')) return;
			var markerElement = event.target && event.target.closest ? event.target.closest('.jet-map-marker') : null;
			if (!markerElement || typeof map.flyTo !== 'function') return;
			var markerGroup = window.JetEngineMaps && window.JetEngineMaps.markersData;
			if (!markerGroup) return;
			Object.keys(markerGroup).some(function (id) { var marker = markerGroup[id]?.[0]?.marker; if (marker && marker.getElement && marker.getElement() === markerElement) { var position = marker.getLngLat(); focusMapCoordinate(map, [position.lng, position.lat], getDetailZoom(map, position.lat)); return true; } return false; });
		});
		if (!nativeLocationControl && window.navigator && window.navigator.geolocation) window.navigator.geolocation.getCurrentPosition(function (position) {
			userPosition = [position.coords.longitude, position.coords.latitude];
			if (!map.__inmovFtthInitialLocationApplied && typeof map.flyTo === 'function') {
				map.__inmovFtthInitialLocationApplied = true;
				map.flyTo({ center: userPosition, zoom: getOverviewZoom(map), essential: true });
			}
		}, function () {}, { enableHighAccuracy: true, maximumAge: 300000, timeout: 8000 });
	}
	// Widths in pixels at zoom 14. Unknown counts remain neutral, never inferred.
	var fiberStyles = {
		1: ['#64748b', 1.5], 2: ['#38bdf8', 2], 4: ['#22c55e', 2.5],
		6: ['#2563eb', 3], 12: ['#eab308', 3.5], 24: ['#f97316', 4.5],
		36: ['#9333ea', 5], 48: ['#ef4444', 5.5]
	};

	function applyFiberStyles(data) {
		data.features.forEach(function (feature, index) {
			var props = feature.properties || (feature.properties = {});
			var routeId = feature.id;
			if (routeId === undefined || routeId === null || routeId === '') routeId = props._ID || props.id || props.code || ('route-' + index);
			feature.id = String(routeId);
			props.ftthRouteId = String(routeId);
			var count = Number(props.fibers);
			// Imported KMLs often encode the engineering label in the route name
			// (e.g. "FIBRA 6FO"). Prefer that explicit label for visualization.
			var label = String(props.name || '') + ' ' + String(props.cableType || '');
			label = label.match(/(?:^|[^a-z])0*(\d{1,3})\s*FO\b/i);
			if (!label) label = String(props.cableType || '').match(/(?:^|[-_])s?0*(\d{1,3})\s*FO\b/i);
			if (label) count = Number(label[1]);
			var style = Number.isInteger(count) && count > 0
				? (count >= 72 ? ['#ec4899', 6] : fiberStyles[count]) : null;
			style = style || ['#94a3b8', 2];
			props.ftthColor = style[0];
			props.ftthWidth = style[1];
			props.ftthFiberCount = Number.isInteger(count) && count > 0 ? count : '';
		});
		return data;
	}

	function recoverNativeMap(container) {
		// Replay only JetEngine's own widget initializer if its Elementor event was
		// missed. Never construct a second map or reset a partially initialized one.
		if (nativeInitAttempts.has(container) || !container.isConnected) return;
		if (!window.JetEngineMaps || typeof window.JetEngineMaps.widgetMap !== 'function' ||
			!window.mapboxgl || typeof window.mapboxgl.Map !== 'function' ||
			!window.JetEngineMapboxData || !window.JetEngineMapboxData.token) return;
		if (container.id || container.querySelector('canvas')) return;
		var bounds = container.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		var scope = $(container).closest('.elementor-widget-jet-engine-maps-listing');
		if (!scope.length) return;
		nativeInitAttempts.add(container);
		try {
			window.JetEngineMaps.widgetMap(scope);
		} catch (error) {
			// A failed constructor must not create an unbounded WebGL allocation loop.
			window.console.warn('[FTTH] Não foi possível iniciar o mapa nativo.', error);
		}
	}

	function getMapInstance(container) {
		try {
			var map = $(container).data('mapInstance');
			return map && typeof map.addSource === 'function' && typeof map.on === 'function' ? map : null;
		} catch (error) {
			return null;
		}
	}

	function fetchRoutes() {
		if (routeData) return Promise.resolve(routeData);
		if (requestPromise) return requestPromise;
		if (typeof window.fetch !== 'function') return Promise.resolve(null);

		var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
		var timeout = controller ? window.setTimeout(function () { controller.abort(); }, 20000) : null;
		var headers = {};
		if (config.nonce) headers['X-WP-Nonce'] = config.nonce;

		var options = {
			credentials: 'same-origin',
			cache: 'no-store',
			headers: headers
		};
		if (controller) options.signal = controller.signal;

		requestPromise = Promise.resolve()
			.then(function () { return window.fetch(config.endpoint, options); })
			.then(function (response) {
				if (!response || !response.ok) {
					var status = response ? response.status : 'sem resposta';
					throw new Error('A API de rotas respondeu com ' + status + '.');
				}
				return response.json();
			})
			.then(function (data) {
				if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
					throw new Error('A resposta de rotas não é um GeoJSON válido.');
				}
				routeData = applyFiberStyles(data);
				requestRetryDelay = 1000;
				return data;
			})
			.catch(function (error) {
				scheduleRouteRetry();
				return null;
			})
			.then(function (data) {
				if (timeout) window.clearTimeout(timeout);
				requestPromise = null;
				if (data) scanMaps();
				return data;
			});

		return requestPromise;
	}

	function scheduleRouteRetry() {
		if (stopped || requestRetryTimer) return;

		var delay = requestRetryDelay;
		requestRetryDelay = Math.min(requestRetryDelay * 2, 30000);
		requestRetryTimer = window.setTimeout(function () {
			requestRetryTimer = null;
			fetchRoutes();
		}, delay);
	}

	function removeLayerEvents(record) {
		var map = record.map;
		if (!record.layerEventsBound || !map || typeof map.off !== 'function') return;

		try {
			var eventLayer = record.eventLayerId || layerId;
			map.off('mouseenter', eventLayer, record.onMouseEnter);
			map.off('mouseleave', eventLayer, record.onMouseLeave);
			map.off('click', eventLayer, record.onClick);
		} catch (error) {
			// A style change can remove the layer before these handlers are detached.
		}
		record.layerEventsBound = false;
	}

	function detachMap(record) {
		if (!record || !record.map) return;

		try {
			record.map.off('style.load', record.onStyleLoad);
		} catch (error) {
			// The map may already have been removed by Elementor/JetEngine.
		}
		removeLayerEvents(record);
		if (record.map.__inmovFtthRefreshTimer) {
			window.clearInterval(record.map.__inmovFtthRefreshTimer);
			record.map.__inmovFtthRefreshTimer = null;
			record.map.__inmovFtthRefreshData = null;
		}
		if (record.resizeObserver) record.resizeObserver.disconnect();
		if (record.resizeTimer) window.clearTimeout(record.resizeTimer);
		if (record.renderTimer) window.clearTimeout(record.renderTimer);
	}

	function scheduleRender(record) {
		if (!record || record.renderTimer || stopped) return;
		record.renderTimer = window.setTimeout(function () {
			record.renderTimer = null;
			renderRoutes(record);
		}, record.renderRetryDelay);
		record.renderRetryDelay = Math.min(record.renderRetryDelay * 2, 8000);
	}

	function bindLayerEvents(record) {
		var map = record.map;
		if (typeof map.on !== 'function') return;

		removeLayerEvents(record);
		record.onMouseEnter = function () {
			try { map.getCanvas().style.cursor = 'pointer'; } catch (error) {}
		};
		record.onMouseLeave = function () {
			try { map.getCanvas().style.cursor = ''; } catch (error) {}
		};
		record.onClick = function (event) {
			try {
				if (event && event.lngLat && typeof map.flyTo === 'function') map.flyTo({ center: [event.lngLat.lng, event.lngLat.lat], zoom: getDetailZoom(map, event.lngLat.lat), essential: true });
				var feature = event && event.features && event.features[0];
				if (!feature) return;
				selectRoute(record, feature);

				var props = feature.properties || {};
				var updated = props.updatedAt ? props.updatedAt + (props.updatedBy ? ' por ' + props.updatedBy : '') : '';
				var coordinates = Number(event.lngLat.lat).toFixed(6) + ', ' + Number(event.lngLat.lng).toFixed(6);
				openSheet(map, props.name || 'Trecho de fibra', [['Localidade', props.locality], ['Tipo', props.routeType], ['Cabo', props.cableType], ['Fibras', props.fibers ? props.fibers + ' FO' : ''], ['Extensão', props.lengthM ? props.lengthM + ' m' : ''], ['Coordenadas', coordinates], ['Última atualização', updated], ['Status', props.status]], [event.lngLat.lng, event.lngLat.lat], { kind: 'route', id: props._ID || props.id || feature.id, type: props.routeType, status: props.status, code: props._ID || props.id || feature.id, locality: props.locality, color: props.ftthColor });
				return;
				/* Native floating popup kept below for backward compatibility. */
				var card = document.createElement('div');
				card.className = 'inmov-ftth-route-popup';
				var title = document.createElement('strong');
				title.textContent = props.name || 'Trecho de fibra';
				card.appendChild(title);

				[
					['Localidade', props.locality],
					['Tipo', props.routeType],
					['Cabo', props.cableType],
					['Fibras', props.fibers],
					['Extensão', props.lengthM ? props.lengthM + ' m' : '']
				].forEach(function (item) {
					if (item[1] === undefined || item[1] === null || item[1] === '') return;
					var row = document.createElement('div');
					row.textContent = item[0] + ': ' + item[1];
					card.appendChild(row);
				});

				new window.mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px' })
					.setLngLat(event.lngLat)
					.setDOMContent(card)
					.addTo(map);
			} catch (error) {
				// Popup failures must not affect the JetEngine map or its markers.
			}
		};

		record.eventLayerId = map.getLayer(hitLayerId) ? hitLayerId : layerId;
		map.on('mouseenter', record.eventLayerId, record.onMouseEnter);
		map.on('mouseleave', record.eventLayerId, record.onMouseLeave);
		map.on('click', record.eventLayerId, record.onClick);
		record.layerEventsBound = true;
	}

	function renderRoutes(record) {
		if (!routeData || !record || record.rendered || stopped) return;

		var map = record.map;
		try {
			if (typeof map.isStyleLoaded !== 'function' || !map.isStyleLoaded()) return;

			var source = map.getSource(sourceId);
			if (!source) {
				map.addSource(sourceId, { type: 'geojson', data: routeData });
			} else if (typeof source.setData === 'function') {
				source.setData(routeData);
			}

			if (!map.getLayer(layerId)) {
				map.addLayer({
					id: layerId,
					type: 'line',
					source: sourceId,
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: {
						'line-color': ['get', 'ftthColor'],
						'line-width': ['interpolate', ['linear'], ['zoom'],
							8, ['*', ['get', 'ftthWidth'], 0.5],
							14, ['get', 'ftthWidth'],
							18, ['*', ['get', 'ftthWidth'], 1.5]],
						'line-opacity': 0.9
					}
				});
			}
			if (!map.getLayer(hitLayerId)) {
				map.addLayer({
					id: hitLayerId,
					type: 'line',
					source: sourceId,
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: {
						'line-color': '#ffffff',
						'line-width': ['interpolate', ['linear'], ['zoom'],
							8, ['+', ['get', 'ftthWidth'], 10],
							14, ['+', ['get', 'ftthWidth'], 12],
							18, ['+', ['get', 'ftthWidth'], 16]],
						'line-opacity': 0.001
					}
				});
			}
			if (!map.getLayer(highlightLayerId)) {
				map.addLayer({
					id: highlightLayerId,
					type: 'line',
					source: sourceId,
					filter: ['==', ['id'], selectedRouteId || '__none__'],
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: {
						'line-color': '#ffffff',
						'line-width': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 12, 18, 18],
						'line-opacity': 1,
						'line-blur': 1.8
					}
				});
			}
			if (selectedRouteRecord === record && selectedRouteId && map.getLayer(highlightLayerId)) {
				try { map.setFilter(highlightLayerId, ['==', ['id'], selectedRouteId]); } catch (error) {}
			}
			if (map.__inmovFtthQuickFilter && map.__inmovFtthQuickFilter !== 'tudo') {
				applyMapQuickFilter(record.container, map, map.__inmovFtthQuickFilter);
			}

			bindLayerEvents(record);
			record.rendered = true;
			record.renderRetryDelay = 1000;
			updateMapLoading(record.container, record.map, { map: false, routes: false });
		} catch (error) {
			record.rendered = false;
			scheduleRender(record);
		}
	}

	function bindMap(container, map) {
		var existing = mapRecords.get(container);
		if (existing && existing.map === map) {
			renderRoutes(existing);
			return;
		}
		if (existing) detachMap(existing);

		var record = {
			container: container,
			map: map,
			rendered: false,
			layerEventsBound: false,
			renderRetryDelay: 1000,
			renderTimer: null,
			resizeTimer: null,
			resizeObserver: null,
			onStyleLoad: null,
			onMouseEnter: null,
			onMouseLeave: null,
			onClick: null
		};
		record.onStyleLoad = function () {
			record.rendered = false;
			record.renderRetryDelay = 1000;
			renderRoutes(record);
		};
		mapRecords.set(container, record);
		addMapControls(container, map);
		if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) updateMapLoading(container, map, { map: false });
		trackedContainers.add(container);

		try {
			map.on('style.load', record.onStyleLoad);
		} catch (error) {
			// The map can be rebuilding while Elementor changes responsive layout.
		}

		if (typeof window.ResizeObserver === 'function') {
			record.resizeObserver = new window.ResizeObserver(function () {
				if (record.resizeTimer) window.clearTimeout(record.resizeTimer);
				record.resizeTimer = window.setTimeout(function () {
					record.resizeTimer = null;
					try { if (typeof map.resize === 'function') map.resize(); } catch (error) {}
				}, 100);
			});
			record.resizeObserver.observe(container);
		}

		fetchRoutes().then(function (data) {
			if (!data) updateMapLoading(container, map, { routes: false, error: 'Não foi possível carregar as rotas. Tentando novamente…' });
			else clearMapLoadingError(container, map);
			renderRoutes(record);
		});
	}

	function scanMaps() {
		if (stopped) return;

		var containers = document.querySelectorAll('.jet-map-listing.mapbox-provider');
		var activeContainers = new Set();
		Array.prototype.forEach.call(containers, function (container) {
			activeContainers.add(container);
			var map = getMapInstance(container);
			if (!map) {
				recoverNativeMap(container);
				map = getMapInstance(container);
			}
			if (map) bindMap(container, map);
			if (map) bindPointClickHandlers(map);
		});

		trackedContainers.forEach(function (container) {
			if (activeContainers.has(container) && container.isConnected) return;
			detachMap(mapRecords.get(container));
			mapRecords.delete(container);
			trackedContainers.delete(container);
		});
	}

	function stop() {
		stopped = true;
		if (scanTimer) window.clearInterval(scanTimer);
		if (requestRetryTimer) window.clearTimeout(requestRetryTimer);
		trackedContainers.forEach(function (container) { detachMap(mapRecords.get(container)); });
		trackedContainers.clear();
	}

	function start() {
		if (stopped || scanTimer) return;
		/* Warm the route request immediately, in parallel with JetEngine/Mapbox
		 * discovery. Previously this only started after bindMap(), which could
		 * add up to the discovery polling delay before the network request began. */
		fetchRoutes();
		scanMaps();
		// Elementor/JetEngine may create or replace the Mapbox instance after a
		// responsive reflow or a delayed provider load. This lightweight check
		// reuses the existing instance, recovering a missed native init at most once.
		scanTimer = window.setInterval(scanMaps, 1500);

		if (window.jQuery) {
			window.jQuery(window).on(
				'jet-engine/frontend-maps/loaded jet-engine/maps/provider-script-loaded jet-engine/maps/provider-script-async-loaded',
				scanMaps
			);
		}
		window.addEventListener('resize', scanMaps, { passive: true });
		window.addEventListener('orientationchange', function () {
			window.setTimeout(scanMaps, 250);
		}, { passive: true });
		window.addEventListener('pagehide', function (event) {
			if (!event || !event.persisted) stop();
		});
		window.addEventListener('pageshow', start);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
})(window.jQuery, window, document);
