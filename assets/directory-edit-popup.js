(function (window, document) {
	'use strict';

	var config = window.InmovFtthDirectoryEdit || {};
	var pendingPoint = null;
	var pointRequest = null;
	var popupBindTimer = null;
	var prefillTimer = null;
	var noticeTimer = null;

	function text(value) {
		return value === undefined || value === null ? '' : String(value).trim();
	}

	function canEditPoints() {
		return config.canEditPoints === true || config.canEditPoints === 1 || config.canEditPoints === '1' || config.canEditPoints === 'true';
	}

	function cleanField(value, prefix) {
		var result = text(value);
		if (prefix) result = result.replace(new RegExp('^' + prefix + '\\s*[·:–-]?\\s*', 'i'), '');
		return result;
	}

	function normalizeType(value) {
		var raw = text(value).toLowerCase();
		if (raw === 'loja / sede' || raw === 'loja') return 'loja';
		if (raw === 'caixa de emenda' || raw === 'ceo') return 'caixa_emenda';
		return raw.replace(/[\s-]+/g, '_');
	}

	function cardFor(button) {
		if (!button) return null;
		var card = button.closest && button.closest('.jet-listing-grid__item, .jet-listing-dynamic-post');
		if (card) return card;
		var node = button.parentElement;
		for (var i = 0; node && i < 10; i += 1, node = node.parentElement) {
			if (node.querySelector && node.querySelector('.elementor-element-118fd1c5, .elementor-element-791c119f')) return node;
		}
		return button.parentElement || button;
	}

	function field(card, selector, prefix) {
		var element = card && card.querySelector ? card.querySelector(selector) : null;
		return cleanField(element ? element.textContent : '', prefix);
	}

	function itemId(card) {
		if (!card) return '';
		var attributes = ['data-post-id', 'data-item-id', 'data-cct-id', 'data-id'];
		for (var i = 0; i < attributes.length; i += 1) {
			var value = card.getAttribute && card.getAttribute(attributes[i]);
			if (/^\d+$/.test(text(value))) return text(value);
		}
		var link = card.querySelector && card.querySelector('a[href*="_post_id="]');
		if (!link) return '';
		try {
			var url = new URL(link.href, window.location.href);
			var queryId = url.searchParams.get('_post_id');
			return /^\d+$/.test(text(queryId)) ? text(queryId) : '';
		} catch (error) {
			return '';
		}
	}

	function payloadFromButton(button) {
		var card = cardFor(button);
		var point = {
			id: itemId(card),
			code: field(card, '.elementor-element-118fd1c5 .jet-listing-dynamic-field__content', 'ID'),
			name: field(card, '.elementor-element-791c119f .jet-listing-dynamic-field__content'),
			type: normalizeType(field(card, '.elementor-element-72dfbd72 .jet-listing-dynamic-field__content')),
			status: field(card, '.elementor-element-2a61c39b .jet-listing-dynamic-field__content'),
			locality: field(card, '.elementor-element-383e041c .jet-listing-dynamic-field__content', 'Localidade'),
			address: field(card, '.elementor-element-53d730d8 .jet-listing-dynamic-field__content'),
			observation: field(card, '.elementor-element-25660286 .jet-listing-dynamic-field__content', 'Observação')
		};
		point.status = point.status.toLowerCase().replace(/[\s-]+/g, '_');
		return point;
	}

	function setField(form, name, value) {
		if (!form || !name) return;
		var fields;
		try { fields = form.querySelectorAll('[name="' + name.replace(/"/g, '\\"') + '"]'); } catch (error) { return; }
		Array.prototype.forEach.call(fields, function (input) {
			var normalized = value === undefined || value === null ? '' : String(value);
			if (input.type === 'radio') {
				input.checked = String(input.value) === normalized;
			} else if (input.type === 'checkbox') {
				input.checked = normalized === 'yes' || normalized === '1' || normalized === 'true';
			} else {
				input.value = normalized;
			}
			try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (eventError) {}
			try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (eventError2) {}
		});
	}

	function validCoordinates(point) {
		var lat = Number(point && point.lat);
		var lng = Number(point && point.lng);
		return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180 ? { lat: lat, lng: lng } : null;
	}

	function applyMapDefaults(form, point) {
		var coordinates = validCoordinates(point);
		if (!form || !coordinates) return false;
		setField(form, 'ponto_latitude', coordinates.lat);
		setField(form, 'ponto_longitude', coordinates.lng);
		setField(form, 'ponto_localizacao', coordinates.lat + ',' + coordinates.lng);

		var mapField = form.querySelector && form.querySelector('.jet-fb-map-field');
		if (!mapField) return false;
		var valueField = mapField.querySelector('input[name="ponto_localizacao"], input:not([data-map-field])');
		var hashField = mapField.querySelector('[data-map-field="hash"]');
		var latField = mapField.querySelector('[data-map-field="lat"]');
		var lngField = mapField.querySelector('[data-map-field="lng"]');
		var value = coordinates.lat + ',' + coordinates.lng;
		if (valueField) {
			valueField.value = value;
			try { valueField.dispatchEvent(new Event('input', { bubbles: true })); } catch (error) {}
			try { valueField.dispatchEvent(new Event('change', { bubbles: true })); } catch (error2) {}
		}
		if (latField) latField.value = String(coordinates.lat);
		if (lngField) lngField.value = String(coordinates.lng);
		if (hashField && !hashField.value) hashField.value = value;
		var preview = mapField.querySelector('.jet-fb-map-field__position');
		if (preview) preview.textContent = coordinates.lat + ', ' + coordinates.lng;
		return !!valueField;
	}

	function readMapCoordinates(form) {
		if (!form || !form.querySelector) return null;
		var mapField = form.querySelector('.jet-fb-map-field');
		var valueField = mapField && mapField.querySelector('input[name="ponto_localizacao"], input:not([data-map-field])');
		var raw = valueField ? text(valueField.value) : text((form.querySelector('[name="ponto_localizacao"]') || {}).value);
		var parts = raw.split(',').map(function (item) { return Number(String(item).trim()); });
		if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180) return { lat: parts[0], lng: parts[1] };
		var lat = Number((mapField && mapField.querySelector('[data-map-field="lat"]') || form.querySelector('[name="ponto_latitude"]') || {}).value);
		var lng = Number((mapField && mapField.querySelector('[data-map-field="lng"]') || form.querySelector('[name="ponto_longitude"]') || {}).value);
		return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat: lat, lng: lng } : null;
	}

	function reverseGeocode(form, coordinates) {
		if (!form || !coordinates || !config.reverseGeocodeEndpoint || typeof window.fetch !== 'function') return;
		var requestId = (form.__inmovFtthReverseRequestId || 0) + 1;
		form.__inmovFtthReverseRequestId = requestId;
		var url = config.reverseGeocodeEndpoint + '?lat=' + encodeURIComponent(coordinates.lat) + '&lng=' + encodeURIComponent(coordinates.lng);
		window.fetch(url, { credentials: 'same-origin', headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {} })
			.then(function (response) { return response.ok ? response.json() : null; })
			.then(function (data) {
				if (!data || requestId !== form.__inmovFtthReverseRequestId) return;
				if (data.locality) setField(form, 'ponto_localidade', data.locality);
				if (data.address) setField(form, 'ponto_endereco', data.address);
			})
			.catch(function () {});
	}

	function syncMapLocation(form) {
		if (!form || !form.__inmovFtthPoint) return;
		var coordinates = readMapCoordinates(form);
		if (!coordinates) return;
		var last = form.__inmovFtthLastCoordinates;
		if (last && Math.abs(last.lat - coordinates.lat) < 0.0000001 && Math.abs(last.lng - coordinates.lng) < 0.0000001) return;
		form.__inmovFtthLastCoordinates = coordinates;
		var original = validCoordinates(form.__inmovFtthPoint);
		if (original && Math.abs(original.lat - coordinates.lat) < 0.0000001 && Math.abs(original.lng - coordinates.lng) < 0.0000001) return;
		setField(form, 'ponto_latitude', coordinates.lat);
		setField(form, 'ponto_longitude', coordinates.lng);
		setField(form, 'ponto_localizacao', coordinates.lat + ',' + coordinates.lng);
		setField(form, 'inmov_location_mode', 'map');
		reverseGeocode(form, coordinates);
	}

	function bindLocationDefaults(form, point) {
		if (!form || form.__inmovFtthLocationDefaultsBound) return;
		form.__inmovFtthLocationDefaultsBound = true;
		form.__inmovFtthPoint = point;
		form.__inmovFtthLastCoordinates = validCoordinates(point);
		var update = function () {
			if (!form.__inmovFtthLocationSeeded && applyMapDefaults(form, form.__inmovFtthPoint)) {
				form.__inmovFtthLocationSeeded = true;
				form.__inmovFtthLastCoordinates = validCoordinates(form.__inmovFtthPoint);
			}
		};
		form.addEventListener('change', function (event) {
			if (!event.target || event.target.name !== 'inmov_location_mode') return;
			if (event.target.value === 'keep') {
				form.__inmovFtthLastCoordinates = validCoordinates(form.__inmovFtthPoint);
				applyMapDefaults(form, form.__inmovFtthPoint);
			} else {
				window.setTimeout(syncMapLocation, 0, form);
			}
		});
		if (typeof MutationObserver === 'function') {
			form.__inmovFtthLocationObserver = new MutationObserver(update);
			form.__inmovFtthLocationObserver.observe(form, { childList: true, subtree: true });
		}
		update();
		if (form.__inmovFtthLocationWatch) window.clearInterval(form.__inmovFtthLocationWatch);
		form.__inmovFtthLocationWatch = window.setInterval(function () {
			if (!form.isConnected) { window.clearInterval(form.__inmovFtthLocationWatch); form.__inmovFtthLocationWatch = null; return; }
			syncMapLocation(form);
		}, 180);
	}

	function prefillForm(form, point) {
		if (!form || !point || !point.id) return false;
		setField(form, 'inmov_item_id', point.id);
		setField(form, '_inmov_item_id', point.id);
		setField(form, 'ponto_codigo', point.code);
		setField(form, 'ponto_nome', point.name);
		setField(form, 'ponto_tipo', point.type);
		setField(form, 'ponto_status', point.status || 'nativo');
		setField(form, 'ponto_localidade', point.locality);
		setField(form, 'ponto_endereco', point.address);
		setField(form, 'ponto_latitude', point.lat);
		setField(form, 'ponto_longitude', point.lng);
		setField(form, 'ponto_capacidade_portas', point.capacity);
		setField(form, 'ponto_observacao', point.observation);
		setField(form, 'ponto_localizacao', point.lat !== undefined && point.lng !== undefined ? String(point.lat) + ',' + String(point.lng) : '');
		/* JetPopup reuses the same form node for successive cards. Refresh the
		 * location state before applying the next record so the watcher never
		 * keeps comparing against the previously opened point. */
		form.__inmovFtthPoint = point;
		form.__inmovFtthLocationSeeded = false;
		form.__inmovFtthLastCoordinates = validCoordinates(point);
		/* Open the location section on the current point. The user can still
		 * leave it unchanged, but the coordinate fields and the JetFormBuilder
		 * map start with the existing position instead of the provider default. */
		setField(form, 'inmov_location_mode', 'keep');
		setField(form, 'inmov_change_reason', '');
		setField(form, 'inmov_reviewed', '');
		bindLocationDefaults(form, point);
		applyMapDefaults(form, point);
		form.setAttribute('data-inmov-ftth-directory-prefilled', String(point.id));
		return true;
	}

	function applyPrefill() {
		if (!pendingPoint || !pendingPoint.id) return false;
		var selector = config.editFormId ? 'form[data-form-id="' + String(config.editFormId).replace(/"/g, '\\"') + '"]' : 'form.jet-form-builder';
		var forms;
		try { forms = document.querySelectorAll(selector); } catch (error) { return false; }
		var found = false;
		Array.prototype.forEach.call(forms, function (form) {
			if (prefillForm(form, pendingPoint)) found = true;
		});
		return found;
	}

	function schedulePrefill() {
		if (prefillTimer) window.clearTimeout(prefillTimer);
		var attempts = 0;
		var run = function () {
			if (applyPrefill() || attempts++ > 40) { prefillTimer = null; return; }
			prefillTimer = window.setTimeout(run, 100);
		};
		run();
	}

	function loadPointDetails(point) {
		if (!point || !point.id || !config.pointsEndpoint || typeof window.fetch !== 'function') return Promise.resolve(point);
		if (!pointRequest) {
			pointRequest = window.fetch(config.pointsEndpoint, {
				credentials: 'same-origin',
				headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {}
			}).then(function (response) { return response.ok ? response.json() : []; }).catch(function () { return []; });
		}
		return pointRequest.then(function (items) {
			if (!Array.isArray(items)) return point;
			var full = items.find(function (item) { return String(item && item.id) === String(point.id); });
			return full ? Object.assign({}, point, full) : point;
		});
	}

	function showNotice(message) {
		var notice = document.querySelector('.inmov-ftth-directory-edit-notice');
		if (!notice) {
			notice = document.createElement('div');
			notice.className = 'inmov-ftth-directory-edit-notice';
			notice.setAttribute('role', 'status');
			notice.setAttribute('aria-live', 'polite');
			notice.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147482000;display:flex;gap:10px;align-items:center;max-width:min(92vw,520px);padding:13px 18px;border:1px solid #fecaca;border-radius:14px;background:#fff7f7;color:#991b1b;box-shadow:0 12px 30px rgba(15,23,42,.18);font:600 14px/1.4 Inter,system-ui,sans-serif;';
			document.body.appendChild(notice);
		}
		notice.textContent = message;
		notice.hidden = false;
		if (noticeTimer) window.clearTimeout(noticeTimer);
		noticeTimer = window.setTimeout(function () { notice.hidden = true; }, 4500);
	}

	function recordPermission(point) {
		if (!point || !config.permissionNotificationEndpoint || typeof window.fetch !== 'function') return Promise.resolve(false);
		var headers = { 'Content-Type': 'application/json' };
		if (config.nonce) headers['X-WP-Nonce'] = config.nonce;
		return window.fetch(config.permissionNotificationEndpoint, {
			method: 'POST',
			credentials: 'same-origin',
			headers: headers,
			body: JSON.stringify({ point_id: point.id, point_name: point.name || point.code || '', point_code: point.code || '', locality: point.locality || '' })
		}).then(function (response) { return response.ok ? response.json() : false; }).catch(function () { return false; });
	}

	function bindPopupSelector() {
		if (!window.JetPopupFrontend || typeof window.JetPopupFrontend.onCustomSelector !== 'function') {
			if (!popupBindTimer) popupBindTimer = window.setTimeout(function () { popupBindTimer = null; bindPopupSelector(); }, 250);
			return;
		}
		try {
			window.JetPopupFrontend.onCustomSelector(config.editPopupSelector || '.e_pdrf');
			if (popupBindTimer) { window.clearTimeout(popupBindTimer); popupBindTimer = null; }
		} catch (error) {
			if (!popupBindTimer) popupBindTimer = window.setTimeout(function () { popupBindTimer = null; bindPopupSelector(); }, 250);
		}
	}

	function bind() {
		bindPopupSelector();
		document.addEventListener('click', function (event) {
			var button = event.target && event.target.closest ? event.target.closest('.e_pdrf, .inmov-ftth-listing-edit-point') : null;
			if (!button) return;
			var point = payloadFromButton(button);
			if (!point.id) {
				event.preventDefault();
				event.stopPropagation();
				showNotice('Não foi possível identificar o ponto selecionado.');
				return;
			}
			if (!canEditPoints()) {
				event.preventDefault();
				event.stopPropagation();
				showNotice('Seu usuário não tem permissão para editar este ponto.');
				recordPermission(point).then(function (recorded) {
					if (recorded && recorded.created && window.InmovFtthNotifications && typeof window.InmovFtthNotifications.announce === 'function') {
						window.InmovFtthNotifications.announce(recorded);
					}
				});
				return;
			}
			pendingPoint = point;
			schedulePrefill();
			loadPointDetails(point).then(function (fullPoint) {
				pendingPoint = fullPoint;
				schedulePrefill();
			});
		}, true);
		if (window.jQuery) {
			window.jQuery(window).off('jet-popup/show-event/after-show.inmovFtthDirectoryEdit').on('jet-popup/show-event/after-show.inmovFtthDirectoryEdit', function () { schedulePrefill(); });
		}
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
	else bind();
})(window, document);
