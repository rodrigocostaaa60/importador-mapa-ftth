(function () {
	'use strict';

	var config = window.InmovFtthNotifications;
	if (!config || !config.endpoint || !document.body) return;

	function create(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (typeof text === 'string') node.textContent = text;
		return node;
	}

	function request(url, options) {
		var settings = options || {};
		settings.credentials = 'same-origin';
		settings.headers = Object.assign({
			'Accept': 'application/json',
			'X-WP-Nonce': config.nonce || ''
		}, settings.headers || {});
		return window.fetch(url, settings).then(function (response) {
			if (!response.ok) throw new Error('notification_request_failed');
			return response.json();
		});
	}

	var root = create('div', 'inmov-ftth-notification-root');
	root.setAttribute('data-inmov-notifications', 'true');
	var trigger = create('button', 'inmov-ftth-notification-trigger');
	trigger.type = 'button';
	trigger.setAttribute('aria-label', 'Abrir notificações');
	trigger.setAttribute('aria-expanded', 'false');
	trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="inmov-ftth-notification-label">Notificações</span>';
	var badge = create('span', 'inmov-ftth-notification-badge');
	badge.hidden = true;
	trigger.appendChild(badge);

	var panel = create('section', 'inmov-ftth-notification-panel');
	panel.setAttribute('aria-hidden', 'true');
	var head = create('div', 'inmov-ftth-notification-head');
	head.appendChild(create('div', 'inmov-ftth-notification-head-copy', 'Notificações'));
	var close = create('button', 'inmov-ftth-notification-close', '×');
	close.type = 'button';
	close.setAttribute('aria-label', 'Fechar notificações');
	head.appendChild(close);
	var list = create('div', 'inmov-ftth-notification-list');
	var footer = create('div', 'inmov-ftth-notification-footer');
	var markAll = create('button', 'inmov-ftth-notification-mark-all', 'Marcar todas como lidas');
	markAll.type = 'button';
	footer.appendChild(markAll);
	panel.appendChild(head);
	panel.appendChild(list);
	panel.appendChild(footer);
	root.appendChild(trigger);
	root.appendChild(panel);
	document.body.appendChild(root);

	function isVisibleSidebar(sidebar) {
		if (!sidebar || window.matchMedia('(max-width: 767px)').matches) return false;
		var style = window.getComputedStyle(sidebar);
		var rect = sidebar.getBoundingClientRect();
		return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
	}

	function syncSidebarPlacement() {
		var sidebar = document.querySelector('.po-sidebar');
		if (!isVisibleSidebar(sidebar)) {
			if (root.parentNode !== document.body) document.body.appendChild(root);
			root.classList.remove('is-sidebar');
			root.style.removeProperty('--inmov-ftth-sidebar-width');
			return;
		}

		var footer = sidebar.querySelector('.po-sidebar-footer');
		if (footer && root.parentNode !== sidebar) {
			sidebar.insertBefore(root, footer);
		} else if (!footer && root.parentNode !== sidebar) {
			sidebar.appendChild(root);
		}
		root.classList.add('is-sidebar');
		root.style.setProperty('--inmov-ftth-sidebar-width', Math.round(sidebar.getBoundingClientRect().width) + 'px');
	}

	syncSidebarPlacement();
	window.addEventListener('resize', syncSidebarPlacement, { passive: true });
	window.setTimeout(syncSidebarPlacement, 250);

	var items = [];
	var loaded = false;

	function setOpen(open) {
		panel.classList.toggle('is-open', !!open);
		panel.setAttribute('aria-hidden', open ? 'false' : 'true');
		trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
	}

	function updateBadge(unread) {
		var count = Number(unread || 0);
		badge.hidden = count < 1;
		badge.textContent = count > 99 ? '99+' : String(count);
		trigger.classList.toggle('has-unread', count > 0);
	}

	function typeLabel(type) {
		var labels = { alerta: 'Alerta', urgente: 'Urgente', sucesso: 'Concluído', demanda: 'Demanda', manutencao: 'Manutenção', feedback: 'Aviso', informacao: 'Informação' };
		return labels[type] || 'Notificação';
	}

	function formatDate(value) {
		if (!value) return '';
		var raw = String(value).trim();
		var date;
		if (/^\d{9,13}$/.test(raw)) {
			var timestamp = Number(raw);
			if (timestamp < 100000000000) timestamp *= 1000;
			date = new Date(timestamp);
		} else {
			date = new Date(raw.replace(' ', 'T'));
		}
		if (isNaN(date.getTime())) return String(value).replace('T', ' ');
		return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	}

	function markRead(item, card) {
		if (!item || item.read) return Promise.resolve();
		return request(config.readEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notification_id: item.id })
		}).then(function () {
			item.read = true;
			if (card) {
				card.classList.remove('is-unread');
				var marker = card.querySelector('.inmov-ftth-notification-marker');
				var readButton = card.querySelector('.inmov-ftth-notification-actions button');
				if (marker) marker.textContent = '✓';
				if (readButton) readButton.remove();
			}
			updateBadge(items.filter(function (entry) { return !entry.read; }).length);
		}).catch(function () {});
	}

	function render() {
		list.textContent = '';
		if (!items.length) {
			var empty = create('div', 'inmov-ftth-notification-empty');
			empty.appendChild(create('span', 'inmov-ftth-notification-empty-icon', '✓'));
			empty.appendChild(create('strong', '', 'Tudo em dia'));
			empty.appendChild(create('p', '', 'Você não tem notificações novas.'));
			list.appendChild(empty);
			return;
		}
		items.forEach(function (item) {
			var card = create('article', 'inmov-ftth-notification-card' + (item.read ? '' : ' is-unread') + ' is-' + (item.type || 'informacao'));
			var marker = create('span', 'inmov-ftth-notification-marker', item.read ? '✓' : '!');
			var body = create('div', 'inmov-ftth-notification-card-body');
			var meta = create('div', 'inmov-ftth-notification-meta');
			meta.appendChild(create('span', 'inmov-ftth-notification-type', typeLabel(item.type)));
			if (item.created_at) meta.appendChild(create('time', '', formatDate(item.created_at)));
			body.appendChild(meta);
			body.appendChild(create('strong', 'inmov-ftth-notification-title', item.title || 'Notificação'));
			if (item.message) body.appendChild(create('p', 'inmov-ftth-notification-message', item.message));
			var actions = create('div', 'inmov-ftth-notification-actions');
			if (!item.read) {
				var readButton = create('button', '', 'Marcar como lida');
				readButton.type = 'button';
				readButton.addEventListener('click', function (event) { event.stopPropagation(); markRead(item, card); });
				actions.appendChild(readButton);
			}
			if (item.url) {
				var link = create('a', '', 'Abrir');
				link.href = item.url;
				link.addEventListener('click', function () { markRead(item, card); });
				actions.appendChild(link);
			}
			if (actions.childNodes.length) body.appendChild(actions);
			card.appendChild(marker);
			card.appendChild(body);
			card.addEventListener('click', function (event) {
				if (event.target && (event.target.tagName === 'A' || event.target.tagName === 'BUTTON')) return;
				markRead(item, card);
				if (item.url) window.location.href = item.url;
			});
			list.appendChild(card);
		});
	}

	function refresh() {
		return request(config.endpoint).then(function (data) {
			items = Array.isArray(data.items) ? data.items : [];
			loaded = true;
			updateBadge(data.unread || items.filter(function (item) { return !item.read; }).length);
			render();
		}).catch(function () {
			if (!loaded) updateBadge(0);
		});
	}

	trigger.addEventListener('click', function () {
		var open = !panel.classList.contains('is-open');
		setOpen(open);
		if (open) refresh();
	});
	close.addEventListener('click', function () { setOpen(false); });
	markAll.addEventListener('click', function () {
		request(config.readAllEndpoint, { method: 'POST' }).then(function () {
			items.forEach(function (item) { item.read = true; });
			updateBadge(0);
			render();
		}).catch(function () {});
	});
	document.addEventListener('click', function (event) {
		if (!root.contains(event.target)) setOpen(false);
	});
	refresh();
	window.setInterval(refresh, Number(config.pollMs || 60000));
}());
