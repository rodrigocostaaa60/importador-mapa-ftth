const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'routes-layer.js'), 'utf8');
const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-39, -13], [-39.1, -13.1]] }, properties: { color: '#f97316' } }] };

function makeMap() {
	const handlers = new Map();
	const sources = new Map();
	const layers = new Map();
	return {
		handlers,
		sources,
		layers,
		resizeCalls: 0,
		styleLoaded: true,
		isStyleLoaded() { return this.styleLoaded; },
		getSource(id) { return sources.get(id); },
		addSource(id, value) { sources.set(id, { ...value, setData(data) { this.data = data; } }); },
		getLayer(id) { return layers.get(id); },
		addLayer(layer) { layers.set(layer.id, layer); },
		getCanvas() { return { style: {} }; },
		resize() { this.resizeCalls++; },
		on(type, layerOrHandler, maybeHandler) {
			const layer = typeof layerOrHandler === 'string' ? layerOrHandler : '';
			const handler = maybeHandler || layerOrHandler;
			const key = type + ':' + layer;
			if (!handlers.has(key)) handlers.set(key, new Set());
			handlers.get(key).add(handler);
		},
		off(type, layerOrHandler, maybeHandler) {
			const layer = typeof layerOrHandler === 'string' ? layerOrHandler : '';
			const handler = maybeHandler || layerOrHandler;
			handlers.get(type + ':' + layer)?.delete(handler);
		},
		fire(type) {
			for (const handler of handlers.get(type + ':') || []) handler();
		}
	};
}

function boot({ fetchImpl } = {}) {
	let nextId = 1;
	const intervals = new Map();
	const timeouts = new Map();
	const eventListeners = new Map();
	const container = { isConnected: true, map: null, id: '',
		querySelector() { return null; },
		getBoundingClientRect() { return { width: 900, height: 600 }; } };
	const window = {
		InmovFtthMapRoutes: { endpoint: '/wp-json/inmov-ftth/v1/routes', nonce: 'test-nonce' },
		fetch: fetchImpl || (() => Promise.resolve({ ok: true, json: () => Promise.resolve(geojson) })),
		setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
		clearInterval(id) { intervals.delete(id); },
		setTimeout(fn) { const id = nextId++; timeouts.set(id, fn); return id; },
		clearTimeout(id) { timeouts.delete(id); },
		addEventListener(type, fn) { eventListeners.set(type, fn); }
	};
	function jquery(value) {
		if (value === window) return { on() {} };
		return { data(key) { return key === 'mapInstance' ? value.map : null; },
			closest() { return { length: 1, 0: container }; } };
	}
	window.jQuery = jquery;
	const document = {
		readyState: 'complete',
		querySelectorAll() { return container.isConnected ? [container] : []; },
		createElement() { return { appendChild() {}, set textContent(value) { this.text = value; } }; }
	};
	vm.runInNewContext(source, { window, document, Array, Promise, Set, WeakMap, Error, Date, console });
	return {
		container,
		window,
		intervals,
		timeouts,
		runInterval() { for (const fn of intervals.values()) fn(); },
		runTimeout() { const entry = timeouts.entries().next().value; if (!entry) return false; timeouts.delete(entry[0]); entry[1](); return true; }
	};
}

async function flushPromises() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('finds a map instance created after the initial page scan', async () => {
	const app = boot();
	const map = makeMap();
	app.container.map = map;
	app.runInterval();
	await flushPromises();
	assert.ok(map.sources.has('inmov-ftth-routes-source'));
	assert.ok(map.layers.has('inmov-ftth-routes-line'));
});

test('recovers a missed Elementor init only after native dependencies arrive', async () => {
	const app = boot();
	let calls = 0;
	app.window.JetEngineMaps = { widgetMap(scope) {
		calls++;
		assert.equal(scope[0], app.container);
		app.container.map = makeMap();
	} };
	app.runInterval();
	assert.equal(calls, 0);
	app.window.mapboxgl = { Map() {} };
	app.window.JetEngineMapboxData = { token: 'test-public-token' };
	app.runInterval();
	await flushPromises();
	for (let i = 0; i < 20; i++) app.runInterval();
	assert.equal(calls, 1);
	assert.ok(app.container.map.layers.has('inmov-ftth-routes-line'));
});

test('does not recreate partial maps or repeatedly allocate failed maps', () => {
	const app = boot();
	let calls = 0;
	app.window.console = { warn() {} };
	app.window.JetEngineMaps = { widgetMap() { calls++; throw new Error('WebGL unavailable'); } };
	app.window.mapboxgl = { Map() {} };
	app.window.JetEngineMapboxData = { token: 'test-public-token' };
	app.container.id = 'native-in-progress';
	app.runInterval();
	assert.equal(calls, 0);
	app.container.id = '';
	app.container.querySelector = () => ({});
	app.runInterval();
	assert.equal(calls, 0);
	app.container.querySelector = () => null;
	for (let i = 0; i < 20; i++) app.runInterval();
	assert.equal(calls, 1);
});

test('waits until a hidden map is visible before native initialization', () => {
	const app = boot();
	let calls = 0;
	app.window.JetEngineMaps = { widgetMap() { calls++; } };
	app.window.mapboxgl = { Map() {} };
	app.window.JetEngineMapboxData = { token: 'test-public-token' };
	app.container.getBoundingClientRect = () => ({ width: 0, height: 0 });
	app.runInterval();
	assert.equal(calls, 0);
	app.container.getBoundingClientRect = () => ({ width: 400, height: 500 });
	app.runInterval();
	assert.equal(calls, 1);
});

test('retries a temporary routes request failure', async () => {
	let attempts = 0;
	const app = boot({ fetchImpl: () => {
		attempts++;
		if (attempts === 1) return Promise.reject(new Error('temporary failure'));
		return Promise.resolve({ ok: true, json: () => Promise.resolve(geojson) });
	} });
	const map = makeMap();
	app.container.map = map;
	app.runInterval();
	await flushPromises();
	assert.equal(attempts, 1);
	assert.ok(app.runTimeout());
	await flushPromises();
	assert.equal(attempts, 2);
	assert.ok(map.layers.has('inmov-ftth-routes-line'));
});

test('attaches the route layer to a replacement map after a responsive rebuild', async () => {
	const app = boot();
	const firstMap = makeMap();
	app.container.map = firstMap;
	app.runInterval();
	await flushPromises();
	const replacementMap = makeMap();
	app.container.map = replacementMap;
	app.runInterval();
	await flushPromises();
	assert.ok(replacementMap.sources.has('inmov-ftth-routes-source'));
	assert.ok(replacementMap.layers.has('inmov-ftth-routes-line'));
	assert.equal(firstMap.handlers.get('style.load:')?.size || 0, 0);
});

test('rebuilds the route layer after the map style is reloaded', async () => {
	const app = boot();
	const map = makeMap();
	app.container.map = map;
	app.runInterval();
	await flushPromises();
	map.sources.clear();
	map.layers.clear();
	map.styleLoaded = true;
	map.fire('style.load');
	assert.ok(map.sources.has('inmov-ftth-routes-source'));
	assert.ok(map.layers.has('inmov-ftth-routes-line'));
});

test('contains an overlay rendering error and retries without replacing base-map data', async () => {
	const app = boot();
	const map = makeMap();
	map.baseMarkers = ['jetengine-marker'];
	const addLayer = map.addLayer.bind(map);
	let addAttempts = 0;
	map.addLayer = (layer) => {
		addAttempts++;
		if (addAttempts === 1) throw new Error('temporary style race');
		addLayer(layer);
	};
	app.container.map = map;
	app.runInterval();
	await flushPromises();
	assert.equal(map.baseMarkers[0], 'jetengine-marker');
	assert.equal(map.layers.has('inmov-ftth-routes-line'), false);
	assert.ok(app.runTimeout());
	assert.ok(map.layers.has('inmov-ftth-routes-line'));
	assert.equal(map.baseMarkers[0], 'jetengine-marker');
});
