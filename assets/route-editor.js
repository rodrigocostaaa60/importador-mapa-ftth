(function (window, document) {
    'use strict';

    if (!window || !document) return;

    var config = window.InmovFtthRouteEditor || {};
    var form;
    var map;
    var sourceId = 'inmov-ftth-route-editor-source';
    var lineLayerId = 'inmov-ftth-route-editor-line';
    var vertexMarkers = [];
    var coordinates = [];
    var drawing = true;
    var geocodeToken = 0;

    function qs(selector, root) { return (root || document).querySelector(selector); }

    function field(name) { return form && form.querySelector('[name="' + name + '"]'); }

    function number(value) {
        if (value === '' || value === null || value === undefined) return null;
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function validCoordinate(pair) {
        return Array.isArray(pair) && pair.length >= 2 && number(pair[0]) !== null && number(pair[1]) !== null && Math.abs(Number(pair[0])) <= 180 && Math.abs(Number(pair[1])) <= 90;
    }

    function normalizeCoordinates(value) {
        var parsed = value;
        if (typeof value === 'string') {
            try { parsed = JSON.parse(value); } catch (error) { return []; }
        }
        if (parsed && parsed.type === 'Feature') parsed = parsed.geometry;
        if (parsed && parsed.type === 'LineString') parsed = parsed.coordinates;
        if (!Array.isArray(parsed)) return [];
        return parsed.map(function (pair) { return [number(pair && pair[0]), number(pair && pair[1])]; }).filter(validCoordinate);
    }

    function formatMeters(value) {
        var meters = number(value);
        if (meters === null) return '';
        if (meters >= 1000) return (meters / 1000).toFixed(2).replace('.', ',') + ' km';
        return Math.round(meters) + ' m';
    }

    function haversine(a, b) {
        var radius = 6371008.8;
        var lat1 = Number(a[1]) * Math.PI / 180;
        var lat2 = Number(b[1]) * Math.PI / 180;
        var dLat = (Number(b[1]) - Number(a[1])) * Math.PI / 180;
        var dLng = (Number(b[0]) - Number(a[0])) * Math.PI / 180;
        var sinLat = Math.sin(dLat / 2);
        var sinLng = Math.sin(dLng / 2);
        var root = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
        return 2 * radius * Math.atan2(Math.sqrt(root), Math.sqrt(Math.max(0, 1 - root)));
    }

    function calculateLength() {
        var total = 0;
        for (var index = 1; index < coordinates.length; index += 1) total += haversine(coordinates[index - 1], coordinates[index]);
        return Math.round(total);
    }

    function dispatchField(fieldNode) {
        if (!fieldNode || !fieldNode.dispatchEvent) return;
        try { fieldNode.dispatchEvent(new Event('input', { bubbles: true })); } catch (error) {}
        try { fieldNode.dispatchEvent(new Event('change', { bubbles: true })); } catch (error) {}
    }

    function ensureSelectOption(node, value) {
        if (!node || node.tagName !== 'SELECT' || value === '') return;
        var exists = Array.prototype.some.call(node.options || [], function (option) { return String(option.value) === String(value); });
        if (exists) return;
        var option = document.createElement('option');
        option.value = String(value);
        option.textContent = String(value).replace(/_/g, ' ');
        option.dataset.inmovPreserved = '1';
        node.appendChild(option);
    }

    function setField(name, value) {
        var node = field(name);
        if (!node) return;
        ensureSelectOption(node, value === undefined || value === null ? '' : String(value));
        node.value = value === undefined || value === null ? '' : String(value);
        dispatchField(node);
    }

    function geometryValue() {
        return JSON.stringify({ type: 'LineString', coordinates: coordinates.map(function (pair) { return [Number(pair[0]), Number(pair[1])]; }) });
    }

    function syncFields() {
        var geometry = field('rota_geometria_geojson');
        if (geometry) {
            geometry.value = coordinates.length ? geometryValue() : '';
            dispatchField(geometry);
        }
        var length = field('rota_comprimento_metros');
        var meters = coordinates.length >= 2 ? calculateLength() : null;
        if (length) {
            length.value = meters === null ? '' : meters;
            dispatchField(length);
        }
        if (lengthDisplayNode) {
            lengthDisplayNode.textContent = meters === null ? 'Comprimento estimado: —' : 'Comprimento estimado: ' + formatMeters(meters);
        }
        if (stateNode) {
            if (!coordinates.length) stateNode.textContent = 'Clique no mapa para iniciar o desenho.';
            else if (coordinates.length === 1) stateNode.textContent = '1 ponto marcado. Clique novamente para criar a linha.';
            else stateNode.textContent = coordinates.length + ' pontos marcados. Você pode ajustar os vértices.';
        }
        if (finishButton) finishButton.disabled = coordinates.length < 2;
        if (undoButton) undoButton.disabled = coordinates.length === 0;
        if (clearButton) clearButton.disabled = coordinates.length === 0;
    }

    function setStatus(message, type) {
        if (!stateNode) return;
        stateNode.textContent = message;
        stateNode.dataset.state = type || 'info';
    }

    function hashString(value) {
        var hash = 2166136261;
        String(value || '').split('').forEach(function (character) {
            hash ^= character.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        });
        return ('00000000' + (hash >>> 0).toString(16).toUpperCase()).slice(-8);
    }

    function ensureRouteCode() {
        var code = field('rota_codigo');
        if (!code || String(code.value || '').trim() || !coordinates.length) return;
        var fingerprint = [
            field('rota_nome') && field('rota_nome').value,
            field('rota_localidade') && field('rota_localidade').value,
            field('rota_tipo') && field('rota_tipo').value,
            coordinates[0][0].toFixed(6), coordinates[0][1].toFixed(6), Date.now()
        ].join('|');
        setField('rota_codigo', 'IMP-R-' + hashString(fingerprint) + hashString(fingerprint + '|route').slice(0, 2));
    }

    function updateLocalityFromFirstPoint(keepExisting) {
        if (!coordinates.length || !config.reverseGeocodeEndpoint || typeof window.fetch !== 'function') {
            if (!coordinates.length && !keepExisting) setField('rota_localidade', '');
            return;
        }
        var token = ++geocodeToken;
        var coordinate = coordinates[0];
        setStatus('Localizando a cidade do primeiro ponto…', 'info');
        var url = config.reverseGeocodeEndpoint + '?lat=' + encodeURIComponent(coordinate[1]) + '&lng=' + encodeURIComponent(coordinate[0]);
        window.fetch(url, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (result) {
                if (token !== geocodeToken || !result) return;
                if (result.locality) setField('rota_localidade', result.locality);
                setStatus(result.locality ? 'Cidade preenchida a partir do primeiro ponto.' : 'Não foi possível identificar a cidade automaticamente.', result.locality ? 'success' : 'error');
            })
            .catch(function () { if (token === geocodeToken) setStatus('Não foi possível identificar a cidade. Você pode preenchê-la manualmente.', 'error'); });
    }

    function removeMarkers() {
        vertexMarkers.forEach(function (marker) { try { marker.remove(); } catch (error) {} });
        vertexMarkers = [];
    }

    function makeVertexElement(index) {
        var element = document.createElement('button');
        element.type = 'button';
        element.className = 'inmov-ftth-route-editor__vertex';
        element.setAttribute('aria-label', 'Vértice ' + (index + 1));
        element.textContent = String(index + 1);
        element.addEventListener('click', function (event) { if (event) event.stopPropagation(); });
        return element;
    }

    function refreshSource() {
        if (!map || !map.getSource) return;
        var source = map.getSource(sourceId);
        var data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coordinates.length >= 2 ? coordinates : [] } };
        if (source && source.setData) source.setData(data);
        if (!map.getLayer || !map.getLayer(lineLayerId)) return;
        try { map.setPaintProperty(lineLayerId, 'line-opacity', coordinates.length >= 2 ? 1 : 0); } catch (error) {}
    }

    function refreshMarkers() {
        removeMarkers();
        if (!map || !window.mapboxgl || typeof window.mapboxgl.Marker !== 'function') return;
        coordinates.forEach(function (pair, index) {
            var marker = new window.mapboxgl.Marker({ element: makeVertexElement(index), draggable: true, anchor: 'center' }).setLngLat(pair).addTo(map);
            marker.on('drag', function () {
                var position = marker.getLngLat();
                coordinates[index] = [Number(position.lng), Number(position.lat)];
                refreshSource();
                syncFields();
            });
            marker.on('dragend', function () {
                if (index === 0) updateLocalityFromFirstPoint(true);
                setStatus('Vértice ajustado. Arraste outros pontos ou finalize o traçado.', 'success');
                refreshMarkers();
            });
            vertexMarkers.push(marker);
        });
    }

    function refreshEditor() {
        refreshSource();
        refreshMarkers();
        syncFields();
    }

    function fitCoordinates() {
        if (!map || !coordinates.length) return;
        if (coordinates.length === 1) { map.flyTo({ center: coordinates[0], zoom: 16, duration: 350, essential: true }); return; }
        var bounds = new window.mapboxgl.LngLatBounds();
        coordinates.forEach(function (pair) { bounds.extend(pair); });
        map.fitBounds(bounds, { padding: 64, maxZoom: 17, duration: 450, essential: true });
    }

    function setCoordinates(next, message) {
        coordinates = normalizeCoordinates(next);
        drawing = true;
        if (modeNode) modeNode.textContent = 'Modo de edição ativo';
        refreshEditor();
        ensureRouteCode();
        if (coordinates.length) fitCoordinates();
        if (coordinates.length) updateLocalityFromFirstPoint(true);
        if (message) setStatus(message, 'success');
    }

    function addCoordinate(lngLat) {
        if (!drawing || !lngLat) return;
        var pair = [Number(lngLat.lng), Number(lngLat.lat)];
        if (!validCoordinate(pair)) return;
        coordinates.push(pair);
        refreshEditor();
        ensureRouteCode();
        if (coordinates.length === 1) updateLocalityFromFirstPoint(false);
        setStatus(coordinates.length + ' ponto' + (coordinates.length === 1 ? '' : 's') + ' marcado' + (coordinates.length === 1 ? '' : 's') + '.', 'success');
    }

    function undo() {
        if (!coordinates.length) return;
        coordinates.pop();
        refreshEditor();
        setStatus(coordinates.length ? 'Último ponto removido.' : 'Traçado limpo. Clique no mapa para começar.', 'info');
    }

    function clear() {
        coordinates = [];
        drawing = true;
        geocodeToken += 1;
        setField('rota_localidade', '');
        refreshEditor();
        setStatus('Desenho limpo. Clique no mapa para começar uma nova rota.', 'info');
    }

    function finish() {
        if (coordinates.length < 2) { setStatus('Marque pelo menos dois pontos para concluir a rota.', 'error'); return; }
        drawing = false;
        if (modeNode) modeNode.textContent = 'Desenho concluído · arraste os vértices para ajustar';
        setStatus('Rota pronta. Revise o desenho e salve quando terminar.', 'success');
    }

    function addEditorMarkup(geometryField) {
        var row = geometryField.closest ? geometryField.closest('.jet-form-builder-row, .jet-form-builder__field-wrap, .jet-form-builder-field') : null;
        var host = document.createElement('section');
        host.className = 'inmov-ftth-route-editor';
        host.innerHTML = '<div class="inmov-ftth-route-editor__header"><div><span class="inmov-ftth-route-editor__eyebrow">Editor visual</span><h2>Defina o trajeto da fibra</h2><p>Clique no mapa para adicionar pontos ao percurso. Depois, arraste os marcadores para ajustar o caminho.</p></div><span class="inmov-ftth-route-editor__mode" data-route-editor-mode>Modo de desenho ativo</span></div>' +
            '<div class="inmov-ftth-route-editor__map" data-route-editor-map></div>' +
            '<div class="inmov-ftth-route-editor__toolbar"><button type="button" data-route-editor-action="undo">Desfazer</button><button type="button" data-route-editor-action="clear">Limpar desenho</button><button type="button" data-route-editor-action="fit">Enquadrar rota</button><button type="button" class="is-primary" data-route-editor-action="finish">Concluir desenho</button></div>' +
            '<div class="inmov-ftth-route-editor__footer"><span data-route-editor-status>Clique no mapa para iniciar o desenho.</span><span class="inmov-ftth-route-editor__length" data-route-editor-length>Comprimento estimado: —</span></div>';
        if (row && row.parentNode) row.parentNode.insertBefore(host, row);
        else geometryField.parentNode.insertBefore(host, geometryField);
        return host;
    }

    function waitForMapbox(callback) {
        var attempts = 0;
        function check() {
            if (window.mapboxgl && window.JetEngineMapboxData && window.JetEngineMapboxData.token) { callback(); return; }
            attempts += 1;
            if (attempts > 120) { setStatus('O editor de traçado não carregou. Atualize a página e tente novamente.', 'error'); return; }
            window.setTimeout(check, 100);
        }
        check();
    }

    function fetchExistingRoute(id) {
        if (!id || !config.routeDetailsEndpoint || typeof window.fetch !== 'function') return Promise.resolve(null);
        return window.fetch(config.routeDetailsEndpoint + encodeURIComponent(id), { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
            .then(function (response) { return response.ok ? response.json() : null; })
            .catch(function () { return null; });
    }

    function applyRouteRecord(record) {
        if (!record) return;
        var properties = record.properties || record;
        setField('inmov_item_id', record.id || properties.id || '');
        setField('_inmov_item_id', record.id || properties.id || '');
        setField('rota_codigo', properties.code || properties.rota_codigo || '');
        setField('rota_nome', properties.name || properties.rota_nome || '');
        setField('rota_localidade', properties.locality || properties.rota_localidade || '');
        setField('rota_tipo', properties.routeType || properties.rota_tipo || 'outro');
        setField('rota_tipo_cabo', properties.cableType || properties.rota_tipo_cabo || '');
        setField('rota_quantidade_fibras', properties.fibers || properties.rota_quantidade_fibras || '');
        setField('rota_status', properties.status || properties.rota_status || 'nativa');
        setField('rota_cor_mapa', properties.color || properties.rota_cor_mapa || '');
        setField('rota_ponto_inicio_codigo', properties.startCode || properties.rota_ponto_inicio_codigo || '');
        setField('rota_ponto_fim_codigo', properties.endCode || properties.rota_ponto_fim_codigo || '');
        setField('rota_comprimento_metros', properties.lengthM || properties.rota_comprimento_metros || '');
        setField('rota_observacao', properties.observation || properties.rota_observacao || '');
        setCoordinates(record.geometry || properties.geometry || properties.coordinates || [], 'Rota carregada. Você pode ajustar o traçado pelos vértices.');
    }

    function initMap(host) {
        var mapNode = qs('[data-route-editor-map]', host);
        if (!mapNode || !window.mapboxgl || !window.JetEngineMapboxData) return;
        window.mapboxgl.accessToken = window.JetEngineMapboxData.token;
        map = new window.mapboxgl.Map({ container: mapNode, style: config.style || 'mapbox://styles/mapbox/outdoors-v12', center: config.center || [-39.965351, -13.524918], zoom: Number(config.zoom || 12.7), attributionControl: true, cooperativeGestures: true });
        map.addControl(new window.mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
        map.on('load', function () {
            map.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
            map.addLayer({ id: lineLayerId, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': config.lineColor || '#2563eb', 'line-width': 5, 'line-opacity': 0.95 } });
            refreshEditor();
            var params = new URLSearchParams(window.location.search || '');
            var id = params.get('inmov_item_id') || params.get('route_id') || params.get('inserted_cct_rotas_fibra') || '';
            var currentGeometry = normalizeCoordinates(field('rota_geometria_geojson') && field('rota_geometria_geojson').value);
            if (id) {
                setStatus('Carregando rota selecionada…', 'info');
                fetchExistingRoute(id).then(function (record) { if (record) applyRouteRecord(record); else setStatus('Não foi possível carregar os dados da rota. Você ainda pode criar uma nova linha.', 'error'); });
            } else if (currentGeometry.length) {
                setCoordinates(currentGeometry, 'Geometria carregada. Você pode ajustar o traçado pelos vértices.');
            }
        });
        map.on('click', function (event) { addCoordinate(event && event.lngLat); });
    }

    var stateNode;
    var modeNode;
    var finishButton;
    var undoButton;
    var clearButton;
    var lengthDisplayNode;

    function start() {
        form = document.querySelector('form[data-form-id="3700"], form.jet-form-builder');
        if (!form || !field('rota_geometria_geojson') || document.querySelector('.inmov-ftth-route-editor')) return;
        var geometryField = field('rota_geometria_geojson');
        var host = addEditorMarkup(geometryField);
        stateNode = qs('[data-route-editor-status]', host);
        modeNode = qs('[data-route-editor-mode]', host);
        finishButton = qs('[data-route-editor-action="finish"]', host);
        undoButton = qs('[data-route-editor-action="undo"]', host);
        clearButton = qs('[data-route-editor-action="clear"]', host);
        lengthDisplayNode = qs('[data-route-editor-length]', host);
        qs('[data-route-editor-action="undo"]', host).addEventListener('click', undo);
        qs('[data-route-editor-action="clear"]', host).addEventListener('click', clear);
        qs('[data-route-editor-action="fit"]', host).addEventListener('click', fitCoordinates);
        finishButton.addEventListener('click', finish);
        form.addEventListener('submit', function (event) {
            if (coordinates.length < 2) {
                event.preventDefault();
                setStatus('Desenhe pelo menos dois pontos para salvar a rota.', 'error');
                return;
            }
            ensureRouteCode();
            syncFields();
        }, true);
        geometryField.addEventListener('input', function () {
            var parsed = normalizeCoordinates(geometryField.value);
            if (JSON.stringify(parsed) !== JSON.stringify(coordinates)) { coordinates = parsed; refreshEditor(); }
        });
        waitForMapbox(function () { initMap(host); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}(window, document));
