(function ($, window, document) {
	'use strict';

	var config = window.InmovFtthMapRoutes;
	if (!$ || !config || !config.endpoint || !document) return;

	var sourceId = 'inmov-ftth-routes-source';
	var layerId = 'inmov-ftth-routes-line';
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
	var selectedRouteRecord = null;
	var selectedRouteId = null;
	var defaultMapStyle = 'mapbox://styles/mapbox/outdoors-v12';
	// streets-v12 is a standard street style; satellite-streets-v12 is the
	// Mapbox style that actually provides satellite imagery.
	var alternateMapStyle = 'mapbox://styles/mapbox/satellite-streets-v12';

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

	function pointVisual(point) {
		var key = normalizePointType(point && (point.type || point.ponto_tipo || point.pointType));
		return { key: key, data: pointVisuals[key] || pointVisuals.outro };
	}

	function clearPointSelection() {
		if (selectedPointElement && selectedPointElement.classList) selectedPointElement.classList.remove('inmov-ftth-point-marker--selected');
		selectedPointElement = null;
	}

	function selectPointMarker(marker) {
		clearPointSelection();
		if (!marker || !marker.getElement) return;
		selectedPointElement = marker.getElement();
		if (selectedPointElement && selectedPointElement.classList) selectedPointElement.classList.add('inmov-ftth-point-marker--selected');
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

	function updateMarkerVisibility(map) {
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

	function openSheet(map, title, rows, center) {
		var sheet = document.querySelector('.inmov-ftth-map-sheet');
		if (!sheet || !sheet.querySelector) return;
		sheet.querySelector('.inmov-ftth-map-sheet__title').textContent = title || 'Item do mapa';
		var body = sheet.querySelector('.inmov-ftth-map-sheet__body'); body.innerHTML = '';
		rows.forEach(function (row) { if (row[1] === undefined || row[1] === null || row[1] === '') return; var div = document.createElement('div'); div.className = 'inmov-ftth-map-sheet__row'; div.innerHTML = '<b></b><span></span>'; div.querySelector('b').textContent = row[0]; div.querySelector('span').textContent = row[1]; body.appendChild(div); });
		sheet.classList.add('is-open');
		if (center && typeof map.flyTo === 'function') map.flyTo({ center: center, zoom: getDetailZoom(map, center[1]), offset: getSheetOffset(map), essential: true });
	}

	function openPointSheet(map, id) {
		var point = pointRecords[id];
		if (!point) return;
		var groups = window.JetEngineMaps && window.JetEngineMaps.markersData;
		var marker = groups && groups[id] && groups[id][0] && groups[id][0].marker;
		clearRouteSelection();
		selectPointMarker(marker);
		openSheet(map, point.name || point.code, [['Código', point.code], ['Tipo de ponto', point.type], ['Situação', point.status], ['Localidade', point.locality], ['Endereço', point.address], ['Capacidade', point.capacity], ['Observações', point.observation]], [point.lng, point.lat]);
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

	function addMapControls(container, map) {
		if (controlsAdded.has(container) || !window.mapboxgl) return;
		controlsAdded.add(container);
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
					this._button.setAttribute('aria-label', 'Alternar mapa de satélite');
					this._button.title = 'Alternar mapa de satélite';
					this._button.addEventListener('click', function (event) {
						if (event && event.stopPropagation) event.stopPropagation();
						var next = mapInstance.__inmovFtthAlternateStyle ? defaultMapStyle : alternateMapStyle;
						mapInstance.__inmovFtthAlternateStyle = !mapInstance.__inmovFtthAlternateStyle;
						this.classList.toggle('is-active', mapInstance.__inmovFtthAlternateStyle);
						try { if (typeof mapInstance.setStyle === 'function') mapInstance.setStyle(next); } catch (error) {}
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
			if (typeof window.mapboxgl.GeolocateControl === 'function') map.addControl(new window.mapboxgl.GeolocateControl({
				positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, showUserHeading: true
			}), 'top-right');
			map.on('geolocate', function (event) {
				if (event && Number.isFinite(event.longitude) && Number.isFinite(event.latitude) && typeof map.flyTo === 'function') {
					map.flyTo({ center: [event.longitude, event.latitude], zoom: getDetailZoom(map, event.latitude), essential: true });
				}
			});
			map.on('moveend', function () { updateMarkerVisibility(map); });
			map.on('zoomend', function () { updateMarkerVisibility(map); });
			map.on('resize', function () { updateMarkerVisibility(map); });
		} catch (error) {}
		var wrap = document.createElement('div');
		wrap.className = 'inmov-ftth-point-search mapboxgl-ctrl';
		if (container.parentNode && container.parentNode.classList) container.parentNode.classList.add('inmov-ftth-map-shell');
		var input = document.createElement('input');
		input.type = 'search'; input.placeholder = 'Pesquisar CTO, OLT ou código'; input.setAttribute('aria-label', 'Pesquisar pontos da rede');
		var results = document.createElement('div'); results.className = 'inmov-ftth-point-search__results';
		wrap.appendChild(input); wrap.appendChild(results); container.parentNode.insertBefore(wrap, container);
		if (!map.__inmovFtthStyleApplied) {
			map.__inmovFtthStyleApplied = true;
			try { if (typeof map.setStyle === 'function') map.setStyle(defaultMapStyle); } catch (error) {}
		}
		var sheet = document.createElement('section'); sheet.className = 'inmov-ftth-map-sheet'; sheet.innerHTML = '<button type="button" class="inmov-ftth-map-sheet__close" aria-label="Fechar">×</button><h3 class="inmov-ftth-map-sheet__title"></h3><div class="inmov-ftth-map-sheet__body"></div>'; container.parentNode.appendChild(sheet);
		var closeButton = sheet.querySelector && sheet.querySelector('.inmov-ftth-map-sheet__close');
		if (closeButton && closeButton.addEventListener) closeButton.addEventListener('click', function () { if (sheet.classList) sheet.classList.remove('is-open'); clearPointSelection(); clearRouteSelection(); });
		var records = markerRecords(container);
		if (config.pointsEndpoint && typeof window.fetch === 'function') {
			window.fetch(config.pointsEndpoint, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
				.then(function (response) { return response.ok ? response.json() : []; })
				.then(function (data) { if (Array.isArray(data)) { records = data; data.forEach(function (item) { pointRecords[item.id] = item; }); decorateAllPointMarkers(map); updateMarkerVisibility(map); render(); } }).catch(function () {});
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
				button.textContent = item.title || item.name || item.label || item.post_title || 'Ponto da rede';
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
		if (window.navigator && window.navigator.geolocation) window.navigator.geolocation.getCurrentPosition(function (position) {
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
			map.off('mouseenter', layerId, record.onMouseEnter);
			map.off('mouseleave', layerId, record.onMouseLeave);
			map.off('click', layerId, record.onClick);
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
				openSheet(map, props.name || 'Trecho de fibra', [['Localidade', props.locality], ['Tipo', props.routeType], ['Cabo', props.cableType], ['Fibras', props.fibers], ['Extensão', props.lengthM ? props.lengthM + ' m' : ''], ['Status', props.status]], [event.lngLat.lng, event.lngLat.lat]);
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

		map.on('mouseenter', layerId, record.onMouseEnter);
		map.on('mouseleave', layerId, record.onMouseLeave);
		map.on('click', layerId, record.onClick);
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
			if (!map.getLayer(highlightLayerId)) {
				map.addLayer({
					id: highlightLayerId,
					type: 'line',
					source: sourceId,
					filter: ['==', ['id'], selectedRouteId || '__none__'],
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: {
						'line-color': '#ffffff',
						'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7, 18, 11],
						'line-opacity': 0.95,
						'line-blur': 1.5
					}
				});
			}
			if (selectedRouteRecord === record && selectedRouteId && map.getLayer(highlightLayerId)) {
				try { map.setFilter(highlightLayerId, ['==', ['id'], selectedRouteId]); } catch (error) {}
			}

			bindLayerEvents(record);
			record.rendered = true;
			record.renderRetryDelay = 1000;
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

		fetchRoutes().then(function () { renderRoutes(record); });
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
