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

	function getSheetOffset(map) {
		if (!window.matchMedia || !window.matchMedia('(max-width: 767px)').matches) return [0, 0];
		var container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
		var sheet = document.querySelector('.inmov-ftth-map-sheet.is-open');
		if (!container || !sheet || !container.getBoundingClientRect) return [0, 0];
		var mapRect = container.getBoundingClientRect();
		var sheetRect = sheet.getBoundingClientRect();
		var search = document.querySelector('.inmov-ftth-point-search');
		var searchBottom = search && search.getBoundingClientRect ? search.getBoundingClientRect().bottom - mapRect.top : 0;
		var visibleTop = Math.max(8, searchBottom + 8);
		var visibleBottom = Math.min(mapRect.height - 8, mapRect.height - sheetRect.height - 8);
		if (visibleBottom <= visibleTop) return [0, -Math.min(120, mapRect.height * 0.2)];
		return [0, ((visibleTop + visibleBottom) / 2) - (mapRect.height / 2)];
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

	function openGoogleMapsRoute(center) {
		if (!center || center.length !== 2) return;
		var lng = Number(center[0]);
		var lat = Number(center[1]);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
		var coordinates = lat.toFixed(6) + ',' + lng.toFixed(6);
		var destination = encodeURIComponent(coordinates);
		var userAgent = String((window.navigator && window.navigator.userAgent) || '');
		var isAndroid = /Android/i.test(userAgent);
		var isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
		if (isAndroid) {
			// Intent nativo abre o app sem substituir a URL da aba do nosso mapa.
			window.location.href = 'intent://maps.google.com/?daddr=' + destination + '&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end';
			return;
		}
		if (isAppleMobile) {
			window.location.href = 'comgooglemaps://?daddr=' + destination + '&directionsmode=driving';
			return;
		}
		var url = 'https://www.google.com/maps/dir/?api=1&destination=' + destination + '&travelmode=driving&dir_action=navigate';
		var opened = null;
		try { opened = window.open(url, '_blank', 'noopener,noreferrer'); } catch (error) {}
		if (!opened) window.location.href = url;
	}

	function openSheet(map, title, rows, center, options) {
		var sheet = document.querySelector('.inmov-ftth-map-sheet');
		if (!sheet || !sheet.querySelector) return;
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
		if (center && typeof map.flyTo === 'function') map.flyTo({ center: center, zoom: getDetailZoom(map, center[1]), offset: getSheetOffset(map), essential: true });
	}

	function openPointSheet(map, id) {
		var point = pointRecords[id];
		if (!point) return;
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		var marker = groups && groups[id] && groups[id][0] && groups[id][0].marker;
		clearRouteSelection();
		selectPointMarker(marker);
		var updated = point.updatedAt ? point.updatedAt + (point.updatedBy ? ' por ' + point.updatedBy : '') : '';
		var coordinates = Number(point.lat).toFixed(6) + ', ' + Number(point.lng).toFixed(6);
		openSheet(map, point.name || point.code, [['Código', point.code], ['Tipo de ponto', point.type], ['Situação', point.status], ['Localidade', point.locality], ['Endereço técnico', point.address], ['Coordenadas', coordinates], ['Capacidade', point.capacity ? point.capacity + ' portas' : ''], ['Última atualização', updated], ['Observações', point.observation]], [point.lng, point.lat], { kind: 'point', id: point.id, type: point.type, status: point.status, code: point.code, locality: point.locality });
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
		legend.className = 'inmov-ftth-map-legend';
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
		panel.innerHTML = '<div class="inmov-ftth-map-style-panel__head"><strong>Configurações do mapa</strong><button type="button" class="inmov-ftth-map-style-panel__close" aria-label="Fechar">×</button></div>' +
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
			'</div></div>';
		host.appendChild(panel);
		if (typeof panel.querySelector !== 'function' || typeof panel.querySelectorAll !== 'function') return panel;
		var close = panel.querySelector('.inmov-ftth-map-style-panel__close');
		var closePanel = function () { panel.classList.remove('is-open'); panel.setAttribute('aria-hidden', 'true'); };
		if (close) close.addEventListener('click', closePanel);
		Array.prototype.forEach.call(panel.querySelectorAll('[data-map-style]'), function (button) {
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var styleKey = button.dataset.mapStyle;
				var satellite = styleKey === 'satellite';
				map.__inmovFtthAlternateStyle = satellite;
				Array.prototype.forEach.call(panel.querySelectorAll('[data-map-style]'), function (item) { item.classList.toggle('is-selected', item === button); });
				var styleUrl = styleKey === 'dark' ? darkMapStyle : (satellite ? alternateMapStyle : defaultMapStyle);
				try { if (typeof map.setStyle === 'function') map.setStyle(styleUrl); } catch (error) {}
			});
		});
		Array.prototype.forEach.call(panel.querySelectorAll('[data-map-layer]'), function (button) {
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var enabled = button.checked !== false;
				var layerKey = button.dataset.mapLayer;
				if (layerKey === 'routes') setRouteLayerVisibility(map, enabled);
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
			'<button type="button" data-map-bottom="legend"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4-8 4-8-4 8-4Zm-8 9 8 4 8-4M4 17l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span>Legenda</span></button>' +
			'<button type="button" data-map-bottom="refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-13.6-5.7L4 7.7M4 4v3.7h3.7M4 13a8 8 0 0 0 13.6 5.7L20 16.3M20 20v-3.7h-3.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Atualizar</span></button>';
		host.appendChild(bar);
		if (typeof bar.querySelectorAll !== 'function') return;
		Array.prototype.forEach.call(bar.querySelectorAll('[data-map-bottom]'), function (button) {
			button.addEventListener('click', function (event) {
				if (event && event.stopPropagation) event.stopPropagation();
				var action = button.dataset.mapBottom;
				if (action === 'settings') {
					var panel = host.querySelector('.inmov-ftth-map-style-panel');
					if (panel) { panel.classList.toggle('is-open'); panel.setAttribute('aria-hidden', panel.classList.contains('is-open') ? 'false' : 'true'); }
				}
				if (action === 'legend') {
					var legend = host.querySelector('.inmov-ftth-map-legend');
					if (legend) legend.classList.toggle('is-hidden');
				}
				if (action === 'refresh') { var refresh = host.querySelector('.inmov-ftth-refresh-control button'); if (refresh) refresh.click(); }
			});
		});
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
						if (panel) { panel.classList.toggle('is-open'); panel.setAttribute('aria-hidden', panel.classList.contains('is-open') ? 'false' : 'true'); }
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
						map.flyTo({ center: [event.longitude, event.latitude], zoom: getDetailZoom(map, event.latitude), essential: true });
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
				var isInteractive = originalTarget && originalTarget.closest && originalTarget.closest('.jet-map-marker, .mapboxgl-marker, .inmov-ftth-point-cluster, .mapboxgl-ctrl, .inmov-ftth-map-sheet');
				if (isInteractive) return;
				var sheet = document.querySelector('.inmov-ftth-map-sheet.is-open');
				if (sheet && sheet.classList) { sheet.classList.remove('is-open', 'is-expanded'); sheet.setAttribute('aria-hidden', 'true'); var shell = sheet.closest && sheet.closest('.inmov-ftth-map-shell'); if (shell && shell.classList) shell.classList.remove('inmov-ftth-map-shell--sheet-open'); }
				var stylePanel = document.querySelector('.inmov-ftth-map-style-panel.is-open');
				if (stylePanel && stylePanel.classList) { stylePanel.classList.remove('is-open'); stylePanel.setAttribute('aria-hidden', 'true'); }
				clearPointSelection();
				clearRouteSelection();
			});
			map.on('moveend', function () { updateMarkerVisibility(map); });
			map.on('move', function () { scheduleMarkerVisibility(map); });
			map.on('zoomend', function () { updateMarkerVisibility(map); });
			map.on('resize', function () { updateMarkerVisibility(map); });
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
			try { if (typeof map.setStyle === 'function') map.setStyle(defaultMapStyle); } catch (error) {}
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
				'<button type="button" class="inmov-ftth-map-sheet__action" data-sheet-action="route" aria-label="Abrir rota no Google Maps">🚗 <span>Rotas</span></button>' +
				'<button type="button" class="inmov-ftth-map-sheet__action inmov-ftth-map-sheet__edit" data-sheet-action="edit">✎ <span>Editar</span></button>' +
			'</div>';
		container.parentNode.appendChild(sheet);
		if (!sheet.querySelector) return;
		var closeButton = sheet.querySelector && sheet.querySelector('.inmov-ftth-map-sheet__close');
		var closeSheet = function () { if (sheet.classList) sheet.classList.remove('is-open', 'is-expanded'); sheet.setAttribute('aria-hidden', 'true'); var shell = sheet.closest && sheet.closest('.inmov-ftth-map-shell'); if (shell && shell.classList) shell.classList.remove('inmov-ftth-map-shell--sheet-open'); clearPointSelection(); clearRouteSelection(); };
		if (closeButton && closeButton.addEventListener) closeButton.addEventListener('click', closeSheet);
		var handle = sheet.querySelector('.inmov-ftth-map-sheet__handle');
		if (handle && handle.addEventListener) {
			handle.addEventListener('click', function () { sheet.classList.toggle('is-expanded'); });
			handle.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sheet.classList.toggle('is-expanded'); } });
		}
		var centerButton = sheet.querySelector('[data-sheet-action="center"]');
		if (centerButton && centerButton.addEventListener) centerButton.addEventListener('click', function () {
			var center = sheet.__inmovFtthCenter;
			if (center && typeof map.flyTo === 'function') map.flyTo({ center: center, zoom: getDetailZoom(map, center[1]), offset: getSheetOffset(map), essential: true });
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
		refreshMapData = function (button) {
			if (button && button.classList) button.classList.add('is-loading');
			updateMapLoading(container, map, { routes: true, points: !!config.pointsEndpoint, error: '' });
			routeData = null;
			requestPromise = null;
			var routeRequest = fetchRoutes().then(function (data) {
				if (data && map.getSource && map.getSource(sourceId) && map.getSource(sourceId).setData) map.getSource(sourceId).setData(data);
				updateMapLoading(container, map, { routes: false });
				return data;
			}).catch(function () { updateMapLoading(container, map, { routes: false }); return null; });
			var pointRequest = !config.pointsEndpoint || typeof window.fetch !== 'function' ? Promise.resolve() : window.fetch(config.pointsEndpoint, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
				.then(function (response) { return response.ok ? response.json() : []; })
				.then(function (data) { if (Array.isArray(data)) { records = data; data.forEach(function (item) { pointRecords[item.id] = item; }); decorateAllPointMarkers(map); updateMarkerVisibility(map); render(); } updateMapLoading(container, map, { points: false }); })
				.catch(function () { updateMapLoading(container, map, { points: false }); });
			Promise.all([routeRequest, pointRequest]).finally(function () { if (button && button.classList) window.setTimeout(function () { button.classList.remove('is-loading'); }, 350); });
		};
		map.__inmovFtthRefreshData = refreshMapData;
		if (!map.__inmovFtthRefreshTimer && typeof window.setInterval === 'function') map.__inmovFtthRefreshTimer = window.setInterval(function () { if (document.hidden) return; refreshMapData(); }, 60000);
		if (config.pointsEndpoint && typeof window.fetch === 'function') {
			window.fetch(config.pointsEndpoint, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
				.then(function (response) { return response.ok ? response.json() : []; })
				.then(function (data) { if (Array.isArray(data)) { records = data; data.forEach(function (item) { pointRecords[item.id] = item; }); decorateAllPointMarkers(map); updateMarkerVisibility(map); render(); } updateMapLoading(container, map, { points: false }); }).catch(function () { updateMapLoading(container, map, { points: false }); });
		}
		var userPosition = null;
		function distance(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
		function render() {
			var query = input.value.trim().toLowerCase();
			results.innerHTML = '';
			if (!query) return;
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
					map.flyTo({ center: point, zoom: getDetailZoom(map, point[1]), essential: true });
					var markerGroup = window.JetEngineMaps && window.JetEngineMaps.markersData && window.JetEngineMaps.markersData[item.id];
					if (markerGroup && markerGroup[0] && markerGroup[0].marker && markerGroup[0].marker.getElement) markerGroup[0].marker.getElement().click();
					results.innerHTML = ''; input.blur();
				});
				results.appendChild(button);
			});
		}
		input.addEventListener('input', render);
		if (container.addEventListener) container.addEventListener('click', function (event) {
			var markerElement = event.target && event.target.closest ? event.target.closest('.jet-map-marker') : null;
			if (!markerElement || typeof map.flyTo !== 'function') return;
			var markerGroup = window.JetEngineMaps && window.JetEngineMaps.markersData;
			if (!markerGroup) return;
			Object.keys(markerGroup).some(function (id) { var marker = markerGroup[id]?.[0]?.marker; if (marker && marker.getElement && marker.getElement() === markerElement) { var position = marker.getLngLat(); map.flyTo({ center: [position.lng, position.lat], zoom: getDetailZoom(map, position.lat), essential: true }); return true; } return false; });
		});
		if (!nativeLocationControl && window.navigator && window.navigator.geolocation) window.navigator.geolocation.getCurrentPosition(function (position) {
			userPosition = [position.coords.longitude, position.coords.latitude];
			if (!map.__inmovFtthInitialLocationApplied && typeof map.flyTo === 'function') {
				map.__inmovFtthInitialLocationApplied = true;
				map.flyTo({ center: userPosition, zoom: getDetailZoom(map, position.coords.latitude), essential: true });
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
