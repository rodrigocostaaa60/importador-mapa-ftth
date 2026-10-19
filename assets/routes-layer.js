(function ($, window, document) {
	'use strict';

	var config = window.InmovFtthMapRoutes;
	if (!$ || !config || !config.endpoint || !document) return;

	var sourceId = 'inmov-ftth-routes-source';
	var layerId = 'inmov-ftth-routes-line';
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
			if (typeof window.mapboxgl.GeolocateControl === 'function') map.addControl(new window.mapboxgl.GeolocateControl({
				positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, showUserHeading: true
			}), 'top-right');
		} catch (error) {}
		var wrap = document.createElement('div');
		wrap.className = 'inmov-ftth-point-search mapboxgl-ctrl';
		var input = document.createElement('input');
		input.type = 'search'; input.placeholder = 'Pesquisar CTO, OLT ou código'; input.setAttribute('aria-label', 'Pesquisar pontos da rede');
		var results = document.createElement('div'); results.className = 'inmov-ftth-point-search__results';
		wrap.appendChild(input); wrap.appendChild(results); container.parentNode.insertBefore(wrap, container);
		var records = markerRecords(container);
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
				button.addEventListener('click', function () { map.flyTo({ center: point, zoom: Math.max(map.getZoom ? map.getZoom() : 13, 16), essential: true }); results.innerHTML = ''; input.blur(); });
				results.appendChild(button);
			});
		}
		input.addEventListener('input', render);
		if (window.navigator && window.navigator.geolocation) window.navigator.geolocation.getCurrentPosition(function (position) {
			userPosition = [position.coords.longitude, position.coords.latitude];
		}, function () {}, { enableHighAccuracy: true, maximumAge: 300000, timeout: 8000 });
	}
	// Widths in pixels at zoom 14. Unknown counts remain neutral, never inferred.
	var fiberStyles = {
		1: ['#64748b', 1.5], 2: ['#38bdf8', 2], 4: ['#22c55e', 2.5],
		6: ['#2563eb', 3], 12: ['#eab308', 3.5], 24: ['#f97316', 4.5],
		36: ['#9333ea', 5], 48: ['#ef4444', 5.5]
	};

	function applyFiberStyles(data) {
		data.features.forEach(function (feature) {
			var props = feature.properties || (feature.properties = {});
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
				if (event && event.lngLat && typeof map.flyTo === 'function') map.flyTo({ center: [event.lngLat.lng, event.lngLat.lat], zoom: Math.max(map.getZoom ? map.getZoom() : 13, 15), essential: true });
				var feature = event && event.features && event.features[0];
				if (!feature || !window.mapboxgl || !window.mapboxgl.Popup) return;

				var props = feature.properties || {};
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
