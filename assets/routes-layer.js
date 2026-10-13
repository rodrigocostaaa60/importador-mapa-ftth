(function ($, window, document) {
	'use strict';

	// JetEngine loads the Mapbox provider after its main maps script; wait for
	// the map instance below instead of requiring the provider global here.
	if (!$ || !window.InmovFtthMapRoutes) return;

	var sourceId = 'inmov-ftth-routes-source';
	var layerId = 'inmov-ftth-routes-line';
	var attempts = 0;
	var timer = window.setInterval(function () {
		attempts++;
		var container = document.querySelector('.jet-map-listing');
		var map = container ? $(container).data('mapInstance') : null;

		if (map && typeof map.addSource === 'function') {
			window.clearInterval(timer);
			initializeRouteLayer(map);
		} else if (attempts >= 60) {
			window.clearInterval(timer);
		}
	}, 250);

	function initializeRouteLayer(map) {
		if (map.__inmovFtthRouteLayerLoading) return;
		map.__inmovFtthRouteLayerLoading = true;

		fetch(window.InmovFtthMapRoutes.endpoint, {
			credentials: 'same-origin',
			headers: { 'X-WP-Nonce': window.InmovFtthMapRoutes.nonce }
		})
			.then(function (response) {
				if (!response.ok) throw new Error('Não foi possível carregar as rotas.');
				return response.json();
			})
			.then(function (geojson) {
				map.__inmovFtthRouteData = geojson;
				map.on('style.load', function () { addLayer(map); });
				if (map.isStyleLoaded()) addLayer(map);
			})
			.catch(function (error) {
				map.__inmovFtthRouteLayerLoading = false;
				if (window.console && console.warn) console.warn('[Mapa FTTH]', error.message);
			});
	}

	function addLayer(map) {
		var data = map.__inmovFtthRouteData;
		if (!data || !map.isStyleLoaded()) return;

		if (!map.getSource(sourceId)) {
			map.addSource(sourceId, { type: 'geojson', data: data });
		} else {
			map.getSource(sourceId).setData(data);
		}

		if (!map.getLayer(layerId)) {
			map.addLayer({
				id: layerId,
				type: 'line',
				source: sourceId,
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': ['coalesce', ['get', 'color'], '#f97316'],
					'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4, 18, 6],
					'line-opacity': 0.9
				}
			});
		}

		if (!map.__inmovFtthRouteEventsBound) {
			map.__inmovFtthRouteEventsBound = true;
			map.on('mouseenter', layerId, function () { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', layerId, function () { map.getCanvas().style.cursor = ''; });
			map.on('click', layerId, function (event) {
				var feature = event.features && event.features[0];
				if (!feature) return;

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
			});
		}
	}
})(window.jQuery, window, document);
