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

	var preview = create('aside', 'inmov-ftth-notification-preview');
	preview.setAttribute('role', 'status');
	preview.setAttribute('aria-live', 'polite');
	preview.setAttribute('aria-hidden', 'true');
	preview.innerHTML = '<div class="inmov-ftth-notification-preview__marker">!</div><div class="inmov-ftth-notification-preview__body"><div class="inmov-ftth-notification-preview__meta"><span>Nova notificação</span><time></time></div><strong></strong><p></p></div><button type="button" class="inmov-ftth-notification-preview__close" aria-label="Fechar aviso">×</button>';
	document.body.appendChild(preview);
	var previewTimer = null;
	var previewItem = null;
	var announcedIds = {};
	var audioContext = null;
	var pendingAnnouncements = [];
	var accessChecks = new WeakSet();

	window.addEventListener('inmov-ftth-notification-created', function (event) {
		var item = event && event.detail;
		if (!item) return;
		if (typeof config.announce === 'function') config.announce(item);
		else pendingAnnouncements.push(item);
	});

	function unlockNotificationAudio() {
		if (audioContext || !window.AudioContext && !window.webkitAudioContext) return;
		try {
			var AudioCtor = window.AudioContext || window.webkitAudioContext;
			audioContext = new AudioCtor();
			if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
		} catch (error) { audioContext = null; }
	}

	function playNotificationSound() {
		unlockNotificationAudio();
		if (!audioContext) return;
		try {
			var now = audioContext.currentTime;
			[0, 0.13].forEach(function (offset, index) {
				var oscillator = audioContext.createOscillator();
				var gain = audioContext.createGain();
				oscillator.type = 'sine';
				oscillator.frequency.value = index ? 880 : 660;
				gain.gain.setValueAtTime(0.0001, now + offset);
				gain.gain.exponentialRampToValueAtTime(0.07, now + offset + 0.015);
				gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
				oscillator.connect(gain);
				gain.connect(audioContext.destination);
				oscillator.start(now + offset);
				oscillator.stop(now + offset + 0.13);
			});
		} catch (error) {}
	}

	document.addEventListener('pointerdown', unlockNotificationAudio, { passive: true });
	document.addEventListener('keydown', unlockNotificationAudio, { passive: true });

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

	function itemDate(item) {
		return item && (item.created_at_display || formatDate(item.created_at));
	}

	function showPreview(item) {
		if (!item) return;
		previewItem = item;
		var marker = preview.querySelector('.inmov-ftth-notification-preview__marker');
		var title = preview.querySelector('strong');
		var message = preview.querySelector('p');
		var time = preview.querySelector('time');
		var type = preview.querySelector('.inmov-ftth-notification-preview__meta span');
		marker.textContent = item.type === 'alerta' || item.type === 'urgente' ? '!' : '•';
		title.textContent = item.title || 'Nova notificação';
		message.textContent = item.message || '';
		time.textContent = itemDate(item) || 'agora';
		type.textContent = typeLabel(item.type);
		preview.className = 'inmov-ftth-notification-preview is-visible is-' + (item.type || 'informacao');
		preview.setAttribute('aria-hidden', 'false');
		if (previewTimer) window.clearTimeout(previewTimer);
		previewTimer = window.setTimeout(function () {
			preview.classList.remove('is-visible');
			preview.setAttribute('aria-hidden', 'true');
		}, 8000);
		playNotificationSound();
	}

	function announce(item) {
		if (!item) return;
		var key = item.id ? String(item.id) : '';
		if (key && announcedIds[key]) return;
		if (key) announcedIds[key] = true;
		showPreview(item);
	}

	function accessDeniedText(html) {
		if (!html) return '';
		try {
			var parsed = new DOMParser().parseFromString(String(html), 'text/html');
			return ((parsed.title || '') + ' ' + (parsed.body ? parsed.body.textContent : '')).replace(/\s+/g, ' ').trim().slice(0, 16000);
		} catch (error) {
			return String(html).replace(/\s+/g, ' ').slice(0, 16000);
		}
	}

	function looksLikeAccessDenied(response, html) {
		var responseUrl = '';
		try { responseUrl = new URL(response.url || '', window.location.href).pathname; } catch (error) {}
		if (!response || response.status === 401 || response.status === 403 || response.status >= 500) return true;
		if (/wp-login\.php|acesso-negado|access-denied/i.test(responseUrl)) return true;
		return /(você\s+não\s+tem\s+permissão|nao\s+tem\s+permiss[aã]o|não\s+possui\s+permissão|nao\s+possui\s+permiss[aã]o|acesso\s+negado|permiss[aã]o\s+necess[aá]ria|you\s+are\s+not\s+allowed|permission\s+denied|access\s+denied|forbidden)/i.test(accessDeniedText(html));
	}

	function showAccessDeniedNotice(label) {
		var item = {
			id: 'access-denied-local-' + Date.now(),
			title: 'Acesso não permitido',
			message: 'Você não possui a permissão necessária para abrir “' + (label || 'esta página') + '”. Contate a gerência para solicitar acesso.',
			type: 'alerta',
			created_at_display: 'agora',
			read: false
		};
		if (typeof config.announce === 'function') config.announce(item);
		else announce(item);
	}

	function recordAccessDeniedNotice(url, label) {
		if (!config.accessDeniedEndpoint) {
			showAccessDeniedNotice(label);
			return;
		}
		request(config.accessDeniedEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: url.href, label: label || '' })
		}).then(function (data) {
			if (data && data.created) {
				var item = {
					id: data.notification_id,
					title: data.title,
					message: data.message,
					type: data.type || 'alerta',
					url: data.url || '',
					created_at: data.created_at || '',
					created_at_display: data.created_at_display || '',
					read: false
				};
				if (typeof config.announce === 'function') config.announce(item);
				else announce(item);
			} else if (!data || !data.deduplicated) {
				showAccessDeniedNotice(label);
			}
		}).catch(function () { showAccessDeniedNotice(label); });
	}

	function preflightSidebarLink(link, event) {
		if (!link || !link.href || !link.closest || !link.closest('.po-sidebar')) return;
		if (event.defaultPrevented || (event.button !== undefined && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (link.dataset.inmovAccessBypass === '1' || accessChecks.has(link)) return;
		if (link.target && link.target !== '_self') return;
		var url;
		try { url = new URL(link.href, window.location.href); } catch (error) { return; }
		if (url.origin !== window.location.origin || url.pathname === window.location.pathname && url.hash) return;
		if (!url.pathname || url.pathname === '/') return;

		event.preventDefault();
		event.stopPropagation();
		accessChecks.add(link);
		link.setAttribute('aria-busy', 'true');
		window.fetch(url.href, {
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { 'Accept': 'text/html', 'X-Inmov-Access-Check': '1' }
		}).then(function (response) {
			return response.text().then(function (html) { return { response: response, html: html }; });
		}).then(function (result) {
			link.removeAttribute('aria-busy');
			if (looksLikeAccessDenied(result.response, result.html)) {
				var linkLabel = (link.textContent || '').replace(/\s+/g, ' ').replace(/^\s*[•–—-]\s*/, '').trim();
				recordAccessDeniedNotice(url, linkLabel);
				return;
			}
			link.dataset.inmovAccessBypass = '1';
			window.location.assign(url.href);
		}).catch(function () {
			link.removeAttribute('aria-busy');
			link.dataset.inmovAccessBypass = '1';
			window.location.assign(url.href);
		}).finally(function () { accessChecks.delete(link); });
	}

	document.addEventListener('click', function (event) {
		var target = event.target && event.target.closest ? event.target : (event.target && event.target.parentElement);
		var link = target && target.closest ? target.closest('a') : null;
		preflightSidebarLink(link, event);
	}, true);

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
			if (item.created_at || item.created_at_display) meta.appendChild(create('time', '', itemDate(item)));
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
		var wasLoaded = loaded;
		var previousIds = {};
		items.forEach(function (item) { if (item && item.id) previousIds[String(item.id)] = true; });
		return request(config.endpoint).then(function (data) {
			var nextItems = Array.isArray(data.items) ? data.items : [];
			items = nextItems;
			loaded = true;
			updateBadge(data.unread || items.filter(function (item) { return !item.read; }).length);
			render();
			if (wasLoaded) {
				nextItems.filter(function (item) { return item && !item.read && item.id && !previousIds[String(item.id)]; }).slice().reverse().forEach(announce);
			}
		}).catch(function () {
			if (!loaded) updateBadge(0);
		});
	}

	trigger.addEventListener('click', function () {
		unlockNotificationAudio();
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
	preview.querySelector('.inmov-ftth-notification-preview__close').addEventListener('click', function (event) {
		event.stopPropagation();
		preview.classList.remove('is-visible');
		preview.setAttribute('aria-hidden', 'true');
	});
	preview.addEventListener('click', function (event) {
		if (event.target && event.target.closest && event.target.closest('button')) return;
		setOpen(true);
		refresh();
	});
	document.addEventListener('click', function (event) {
		if (!root.contains(event.target) && !preview.contains(event.target)) setOpen(false);
	});
	refresh();
	config.announce = function (item) {
		if (!item) return;
		if (item.id && !items.some(function (entry) { return String(entry.id) === String(item.id); })) {
			item.read = false;
			items.unshift(item);
			updateBadge(items.filter(function (entry) { return !entry.read; }).length);
			if (panel.classList.contains('is-open')) render();
		}
		announce(item);
	};
	pendingAnnouncements.splice(0).forEach(config.announce);
	window.setInterval(refresh, Number(config.pollMs || 10000));
	document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
}());
