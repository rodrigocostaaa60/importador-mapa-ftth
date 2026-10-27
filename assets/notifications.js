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
	var headMain = create('div', 'inmov-ftth-notification-head-main');
	var headIcon = create('span', 'inmov-ftth-notification-head-icon');
	headIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
	var headText = create('div', 'inmov-ftth-notification-head-text');
	var headTitleRow = create('div', 'inmov-ftth-notification-head-title-row');
	headTitleRow.appendChild(create('div', 'inmov-ftth-notification-head-copy', 'Notificações'));
	var panelUnreadPill = create('span', 'inmov-ftth-notification-unread-pill is-empty', '0 não lidas');
	headTitleRow.appendChild(panelUnreadPill);
	headText.appendChild(headTitleRow);
	headText.appendChild(create('div', 'inmov-ftth-notification-head-subtitle', 'Atualizações da rede e da equipe'));
	headMain.appendChild(headIcon);
	headMain.appendChild(headText);
	head.appendChild(headMain);
	var sheetHandle = create('div', 'inmov-ftth-notification-sheet-handle');
	sheetHandle.setAttribute('role', 'button');
	sheetHandle.setAttribute('tabindex', '0');
	sheetHandle.setAttribute('aria-label', 'Expandir ou recolher notificações');
	sheetHandle.innerHTML = '<span></span><small>Toque para expandir</small>';
	var panelExpanded = false;
	function togglePanelExpanded() {
		panelExpanded = !panelExpanded;
		panel.classList.toggle('is-expanded', panelExpanded);
		sheetHandle.setAttribute('aria-label', panelExpanded ? 'Recolher notificações' : 'Expandir notificações');
		var label = sheetHandle.querySelector('small');
		if (label) label.textContent = panelExpanded ? 'Toque para recolher' : 'Toque para expandir';
	}
	sheetHandle.addEventListener('click', togglePanelExpanded);
	sheetHandle.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePanelExpanded(); } });
	var headActions = create('div', 'inmov-ftth-notification-head-actions');
	var markAllTop = create('button', 'inmov-ftth-notification-head-action');
	markAllTop.type = 'button';
	markAllTop.setAttribute('aria-label', 'Marcar todas como lidas');
	markAllTop.setAttribute('title', 'Marcar todas como lidas');
	markAllTop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 4 4L18 6M4 6l4 4m4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
	headActions.appendChild(markAllTop);
	var close = create('button', 'inmov-ftth-notification-close', '×');
	close.type = 'button';
	close.setAttribute('aria-label', 'Fechar notificações');
	headActions.appendChild(close);
	head.appendChild(headActions);
	var filterBar = create('div', 'inmov-ftth-notification-filters');
	var filterScroller = create('div', 'inmov-ftth-notification-filter-scroller');
	var filterDefinitions = [
		{ key: 'todos', label: 'Todas' },
		{ key: 'urgente', label: 'Urgentes' },
		{ key: 'rede', label: 'Rede FTTH' },
		{ key: 'seguranca', label: 'Acessos' }
	];
	var filterButtons = {};
	filterDefinitions.forEach(function (definition) {
		var button = create('button', 'inmov-ftth-notification-filter' + (definition.key === 'todos' ? ' is-active' : ''), definition.label);
		button.type = 'button';
		button.dataset.notificationFilter = definition.key;
		button.addEventListener('click', function () {
			currentFilter = definition.key;
			Object.keys(filterButtons).forEach(function (key) { filterButtons[key].classList.toggle('is-active', key === currentFilter); });
			render();
		});
		filterButtons[definition.key] = button;
		filterScroller.appendChild(button);
	});
	var filterReadAll = create('button', 'inmov-ftth-notification-filter-read-all', 'Ler todas');
	filterReadAll.type = 'button';
	filterReadAll.addEventListener('click', function () { markAll.click(); });
	filterBar.appendChild(filterScroller);
	filterBar.appendChild(filterReadAll);
	var list = create('div', 'inmov-ftth-notification-list');
	var footer = create('div', 'inmov-ftth-notification-footer');
	var footerSync = create('span', 'inmov-ftth-notification-sync');
	footerSync.innerHTML = '<span class="inmov-ftth-notification-sync-dot"></span><span>Sincronização JetEngine ativa</span>';
	var footerSettings = create('a', 'inmov-ftth-notification-settings', 'Configurar alertas');
	footerSettings.href = '#';
	footerSettings.addEventListener('click', function (event) { event.preventDefault(); });
	footer.appendChild(footerSync);
	footer.appendChild(footerSettings);
	var mobileFooter = create('div', 'inmov-ftth-notification-mobile-footer');
	var mobileUnreadText = create('span', 'inmov-ftth-notification-mobile-unread', '0 notificações não lidas');
	var mobileExpand = create('button', 'inmov-ftth-notification-mobile-expand', 'Expandir tela inteira');
	mobileExpand.type = 'button';
	mobileExpand.addEventListener('click', togglePanelExpanded);
	mobileFooter.appendChild(mobileUnreadText);
	mobileFooter.appendChild(mobileExpand);
	footer.appendChild(mobileFooter);
	var markAll = create('button', 'inmov-ftth-notification-mark-all', 'Marcar todas como lidas');
	markAll.type = 'button';
	markAllTop.addEventListener('click', function () { markAll.click(); });
	panel.appendChild(sheetHandle);
	panel.appendChild(head);
	panel.appendChild(filterBar);
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
	var currentFilter = 'todos';

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
		panelUnreadPill.textContent = count ? (count > 99 ? '99+ não lidas' : count + ' não lidas') : '0 não lidas';
		panelUnreadPill.classList.toggle('is-empty', count < 1);
		mobileUnreadText.textContent = count ? (count > 99 ? '99+ notificações não lidas' : count + ' notificações não lidas') : '0 notificações não lidas';
	}

	function typeLabel(type) {
		var labels = { alerta: 'Alerta', urgente: 'Urgente', sucesso: 'Concluído', demanda: 'Demanda', manutencao: 'Manutenção', feedback: 'Aviso', informacao: 'Informação' };
		return labels[type] || 'Notificação';
	}

	function notificationTag(item) {
		var value = [item && item.title, item && item.message].filter(Boolean).join(' ').toLowerCase();
		if (/(acesso|permiss[aã]o|seguran[cç]a|restri[cç][aã]o)/i.test(value)) return 'Acessos';
		if (/(rede|ftth|fibra|cabo|olt|cto|pop|ponto|mapa|sincroniza)/i.test(value)) return 'Rede FTTH';
		if (item && item.type === 'manutencao') return 'Operação';
		return typeLabel(item && item.type);
	}

	function matchesFilter(item) {
		if (currentFilter === 'todos') return true;
		var text = [item && item.title, item && item.message, item && item.url].filter(Boolean).join(' ');
		if (currentFilter === 'urgente') return item && (item.type === 'urgente' || item.type === 'alerta' || item.priority === 'urgente');
		if (currentFilter === 'seguranca') return /(acesso|permiss[aã]o|seguran[cç]a|restri[cç][aã]o|negado)/i.test(text) || (item && item.type === 'alerta');
		if (currentFilter === 'rede') return /(rede|ftth|fibra|cabo|olt|cto|pop|ponto|mapa|opera[cç][aã]o|manuten[cç][aã]o)/i.test(text);
		return true;
	}

	function notificationIconSvg(type, read) {
		if (read) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
		var paths = {
			alerta: '<path d="M12 3 4 6v5c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path><path d="M12 8v4m0 3h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
			urgente: '<path d="m12 3 9 17H3L12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path><path d="M12 9v4m0 3h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
			sucesso: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="m8 12 2.5 2.5L16.5 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>',
			manutencao: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-2.1-2.1 2.5-2.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>',
			demanda: '<path d="M7 7h10M7 12h6M7 17h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><path d="M5 4h14v16H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>',
			informacao: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M12 11v5m0-8h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>'
		};
		return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[type] || paths.informacao) + '</svg>';
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
		marker.innerHTML = notificationIconSvg(item.type, false);
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

	function preflightInternalLink(link, event) {
		if (!link || !link.href) return;
		if (event.defaultPrevented || (event.button !== undefined && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (link.dataset.inmovAccessBypass === '1' || accessChecks.has(link)) return;
		if (link.target && link.target !== '_self') return;
		var rawHref = (link.getAttribute('href') || '').trim();
		if (!rawHref || rawHref.charAt(0) === '#' || /^(?:mailto|tel|javascript):/i.test(rawHref) || link.hasAttribute('download')) return;
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
		preflightInternalLink(link, event);
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
				if (marker) { marker.innerHTML = notificationIconSvg('sucesso', true); marker.setAttribute('aria-label', 'Lida'); }
				if (readButton) readButton.remove();
			}
			updateBadge(items.filter(function (entry) { return !entry.read; }).length);
		}).catch(function () {});
	}

	function render() {
		list.textContent = '';
		Object.keys(filterButtons).forEach(function (key) { filterButtons[key].classList.toggle('is-active', key === currentFilter); });
		var visibleItems = items.filter(matchesFilter);
		if (!visibleItems.length) {
			var empty = create('div', 'inmov-ftth-notification-empty');
			var emptyIcon = create('span', 'inmov-ftth-notification-empty-icon');
			emptyIcon.innerHTML = notificationIconSvg('sucesso', true);
			empty.appendChild(emptyIcon);
			empty.appendChild(create('strong', '', items.length ? 'Nenhuma notificação neste filtro' : 'Tudo em dia'));
			empty.appendChild(create('p', '', items.length ? 'Escolha outro filtro para visualizar os avisos.' : 'Você não tem notificações novas.'));
			list.appendChild(empty);
			return;
		}
		visibleItems.forEach(function (item) {
			var card = create('article', 'inmov-ftth-notification-card' + (item.read ? '' : ' is-unread') + ' is-' + (item.type || 'informacao'));
			var marker = create('span', 'inmov-ftth-notification-marker');
			marker.innerHTML = notificationIconSvg(item.type, !!item.read);
			marker.setAttribute('aria-label', item.read ? 'Lida' : typeLabel(item.type));
			var body = create('div', 'inmov-ftth-notification-card-body');
			var meta = create('div', 'inmov-ftth-notification-meta');
			var metaType = create('span', 'inmov-ftth-notification-meta-type');
			metaType.appendChild(create('span', 'inmov-ftth-notification-type', typeLabel(item.type)));
			if (!item.read) metaType.appendChild(create('span', 'inmov-ftth-notification-unread-dot'));
			meta.appendChild(metaType);
			if (item.created_at || item.created_at_display) meta.appendChild(create('time', '', itemDate(item)));
			body.appendChild(meta);
			body.appendChild(create('strong', 'inmov-ftth-notification-title', item.title || 'Notificação'));
			if (item.message) body.appendChild(create('p', 'inmov-ftth-notification-message', item.message));
			var cardFooter = create('div', 'inmov-ftth-notification-card-footer');
			cardFooter.appendChild(create('span', 'inmov-ftth-notification-tag', notificationTag(item)));
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
				link.setAttribute('aria-label', 'Abrir notificação: ' + (item.title || 'Notificação'));
				link.addEventListener('click', function () { markRead(item, card); });
				actions.appendChild(link);
			}
			if (actions.childNodes.length) cardFooter.appendChild(actions);
			body.appendChild(cardFooter);
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
