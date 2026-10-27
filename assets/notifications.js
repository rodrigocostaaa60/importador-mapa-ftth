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
	var close = create('button', 'inmov-ftth-notification-close', '×');
	close.type = 'button';
	close.setAttribute('aria-label', 'Fechar notificações');
	headActions.appendChild(close);
	head.appendChild(headActions);
	var filterBar = create('div', 'inmov-ftth-notification-filters');
	var filterScroller = create('div', 'inmov-ftth-notification-filter-scroller');
	var filterDefinitions = [
		{ key: 'todos', label: 'Todas' },
		{ key: 'nao-lidas', label: 'Não lidas' },
		{ key: 'importante', label: 'Importantes' }
	];
	var filterButtons = {};
	filterDefinitions.forEach(function (definition) {
		var button = create('button', 'inmov-ftth-notification-filter', definition.label);
		button.type = 'button';
		button.dataset.notificationFilter = definition.key;
		button.addEventListener('click', function () {
			currentFilter = definition.key;
			render();
		});
		filterButtons[definition.key] = button;
		filterScroller.appendChild(button);
	});
	var filterReadAll = create('button', 'inmov-ftth-notification-filter-read-all', 'Ver todas');
	filterReadAll.type = 'button';
	filterReadAll.setAttribute('aria-label', 'Ver todas as notificações');
	filterReadAll.addEventListener('click', function () {
		currentFilter = 'todos';
		render();
	});
	filterBar.appendChild(filterScroller);
	filterBar.appendChild(filterReadAll);
	var list = create('div', 'inmov-ftth-notification-list');
	var footer = create('div', 'inmov-ftth-notification-footer');
	var markAll = create('button', 'inmov-ftth-notification-mark-all', 'Marcar todas como lidas');
	markAll.type = 'button';
	markAll.setAttribute('aria-label', 'Marcar todas as notificações como lidas');
	footer.appendChild(markAll);
	var mobileFooter = create('div', 'inmov-ftth-notification-mobile-footer');
	var mobileUnreadText = create('span', 'inmov-ftth-notification-mobile-unread', '0 notificações não lidas');
	var mobileMarkAll = create('button', 'inmov-ftth-notification-mobile-mark-all', 'Marcar todas como lidas');
	mobileMarkAll.type = 'button';
	mobileMarkAll.setAttribute('aria-label', 'Marcar todas as notificações como lidas');
	mobileFooter.appendChild(mobileUnreadText);
	mobileFooter.appendChild(mobileMarkAll);
	footer.appendChild(mobileFooter);
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
	var urgentAudioTimer = null;
	var urgentAlertItem = null;
	var pendingAnnouncements = [];
	var accessChecks = new WeakSet();

	window.addEventListener('inmov-ftth-notification-created', function (event) {
		var item = event && event.detail;
		if (!item) return;
		if (typeof config.announce === 'function') config.announce(item);
		else pendingAnnouncements.push(item);
	});

	function unlockNotificationAudio() {
		if (!window.AudioContext && !window.webkitAudioContext) return;
		if (audioContext) {
			if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
			return;
		}
		try {
			var AudioCtor = window.AudioContext || window.webkitAudioContext;
			audioContext = new AudioCtor();
			if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
		} catch (error) { audioContext = null; }
	}

	function playNotificationSound() {
		unlockNotificationAudio();
		if (!audioContext) return;
		if (audioContext.state === 'suspended') return;
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
	var currentFilter = 'nao-lidas';

	function setOpen(open) {
		panel.classList.toggle('is-open', !!open);
		panel.setAttribute('aria-hidden', open ? 'false' : 'true');
		trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
	}

	function updateBadge(unread) {
		var count = Number(unread || 0);
		var canMarkAll = count > 0;
		badge.hidden = count < 1;
		badge.textContent = count > 99 ? '99+' : String(count);
		trigger.classList.toggle('has-unread', count > 0);
		panelUnreadPill.textContent = count ? (count > 99 ? '99+ não lidas' : count + ' não lidas') : '0 não lidas';
		panelUnreadPill.classList.toggle('is-empty', count < 1);
		mobileUnreadText.textContent = count ? (count > 99 ? '99+ notificações não lidas' : count + ' notificações não lidas') : '0 notificações não lidas';
		[markAll, mobileMarkAll].forEach(function (button) {
			button.disabled = !canMarkAll;
			button.setAttribute('aria-disabled', canMarkAll ? 'false' : 'true');
		});
	}

	function typeLabel(type) {
		var labels = { alerta: 'Alerta', urgente: 'Urgente', sucesso: 'Concluído', demanda: 'Demanda', manutencao: 'Manutenção', feedback: 'Aviso', informacao: 'Informação' };
		return labels[notificationTypeKey(type)] || 'Notificação';
	}

	function notificationTypeKey(value) {
		var raw = value && typeof value === 'object' ? (value.type || value.notificacao_tipo || value.category || value.categoria || '') : value;
		var token = String(raw || '').trim().toLowerCase().normalize ? String(raw || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '') : String(raw || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
		var aliases = {
			alerta: 'alerta', alert: 'alerta', erro: 'alerta', error: 'alerta', danger: 'alerta',
			urgente: 'urgente', urgent: 'urgente', warning: 'urgente', prioridade: 'urgente',
			sucesso: 'sucesso', success: 'sucesso', concluido: 'sucesso', concluida: 'sucesso', ok: 'sucesso',
			demanda: 'demanda', pendencia: 'demanda', tarefa: 'demanda', solicitacao: 'demanda',
			manutencao: 'manutencao', maintenance: 'manutencao',
			feedback: 'feedback', aviso: 'feedback',
			informacao: 'informacao', info: 'informacao', information: 'informacao'
		};
		return aliases[token] || 'informacao';
	}

	function notificationPriorityKey(value) {
		var raw = value && typeof value === 'object' ? (value.priority || value.notificacao_prioridade || value.prioridade || '') : value;
		var token = String(raw || '').trim().toLowerCase().normalize ? String(raw || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '') : String(raw || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
		var aliases = {
			baixa: 'baixa', low: 'baixa', normal: 'normal', media: 'normal', medio: 'normal', média: 'normal',
			alta: 'alta', high: 'alta', importante: 'alta',
			urgente: 'urgente', urgent: 'urgente', critica: 'urgente', critico: 'urgente', critical: 'urgente'
		};
		return aliases[token] || 'normal';
	}

	function priorityLabel(item) {
		var priority = notificationPriorityKey(item);
		return priority === 'urgente' ? 'Urgente' : (priority === 'alta' ? 'Importante' : '');
	}

	function isImportant(item) {
		var priority = notificationPriorityKey(item);
		return priority === 'alta' || priority === 'urgente';
	}

	function isUrgent(item) {
		return notificationPriorityKey(item) === 'urgente';
	}

	function notificationTag(item) {
		var value = [item && item.title, item && item.message].filter(Boolean).join(' ').toLowerCase();
		if (/(acesso|permiss[aã]o|seguran[cç]a|restri[cç][aã]o)/i.test(value)) return 'Acessos';
		if (/(rede|ftth|fibra|cabo|olt|cto|pop|ponto|mapa|sincroniza)/i.test(value)) return 'Rede FTTH';
		if (notificationTypeKey(item) === 'manutencao') return 'Operação';
		return typeLabel(item);
	}

	function matchesFilter(item) {
		if (currentFilter === 'todos') return true;
		if (currentFilter === 'nao-lidas') return !!item && !item.read;
		if (currentFilter === 'importante') return isImportant(item);
		return true;
	}

	function notificationIconSvg(type, read) {
		if (read) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
		type = notificationTypeKey(type);
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
		/* JetEngine stores this field as a local wall-clock value
		 * (YYYY-MM-DDTHH:mm). Preserve that value instead of letting a browser
		 * running in UTC convert Bahia's 07:23 to 04:23. Values that carry an
		 * explicit offset are still converted to the site's Brazilian timezone. */
		var localParts = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
		if (localParts) return localParts[3] + '/' + localParts[2] + ' ' + localParts[4] + ':' + localParts[5];
		if (/^\d{9,13}$/.test(raw)) {
			var timestamp = Number(raw);
			if (timestamp < 100000000000) timestamp *= 1000;
			date = new Date(timestamp);
			/* JetEngine serializes this local datetime field as an epoch whose UTC
			 * clock components are the values entered in the CCT (07:23 must remain
			 * 07:23 in Bahia, not become 04:23 after a second timezone conversion). */
			return date.toLocaleString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
		} else {
			date = new Date(raw.replace(' ', 'T'));
		}
		if (isNaN(date.getTime())) return String(value).replace('T', ' ');
		return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	}

	function itemDate(item) {
		return item && (item.created_at_display || (item.created_at ? formatDate(item.created_at) : ''));
	}

	function hasActionLink(item) {
		if (!item || !item.url) return false;
		/* Permission and access-denied notices intentionally stay on the current
		 * screen. Older CCT rows may still contain the map URL, so suppress it in
		 * the UI as well as clearing it for newly-created rows in PHP. */
		return !/(acesso\s+n[aã]o\s+permitido|edi[cç][aã]o\s+de\s+ponto\s+sem\s+permiss[aã]o)/i.test(String(item.title || ''));
	}

	function hidePreview() {
		preview.classList.remove('is-visible', 'is-persistent');
		preview.setAttribute('aria-hidden', 'true');
		preview.setAttribute('aria-live', 'polite');
	}

	function startUrgentAlert(item) {
		urgentAlertItem = item;
		if (urgentAudioTimer) return;
		playNotificationSound();
		urgentAudioTimer = window.setInterval(function () {
			if (!urgentAlertItem || urgentAlertItem.read || !isUrgent(urgentAlertItem)) {
				stopUrgentAlert();
				return;
			}
			playNotificationSound();
		}, 2800);
	}

	function stopUrgentAlert() {
		if (urgentAudioTimer) window.clearInterval(urgentAudioTimer);
		urgentAudioTimer = null;
		urgentAlertItem = null;
		if (previewItem && isUrgent(previewItem) && !previewItem.read) hidePreview();
	}

	function syncUrgentAlert() {
		var urgentItems = items.filter(function (item) { return item && !item.read && isUrgent(item); });
		if (!urgentItems.length) {
			stopUrgentAlert();
			return;
		}
		var item = urgentItems[0];
		if (!preview.classList.contains('is-visible') || !preview.classList.contains('is-persistent') || !previewItem || String(previewItem.id) !== String(item.id)) showPreview(item, true);
		else urgentAlertItem = item;
		startUrgentAlert(item);
	}

	function showPreview(item, persistent) {
		if (!item) return;
		persistent = !!persistent || isUrgent(item);
		previewItem = item;
		var marker = preview.querySelector('.inmov-ftth-notification-preview__marker');
		var title = preview.querySelector('strong');
		var message = preview.querySelector('p');
		var time = preview.querySelector('time');
		var type = preview.querySelector('.inmov-ftth-notification-preview__meta span');
		var closeButton = preview.querySelector('.inmov-ftth-notification-preview__close');
		var itemType = notificationTypeKey(item);
		marker.innerHTML = notificationIconSvg(itemType, false);
		title.textContent = item.title || 'Nova notificação';
		message.textContent = item.message || '';
		time.textContent = itemDate(item) || 'agora';
		var priority = priorityLabel(item);
		type.textContent = typeLabel(itemType) + (priority ? ' · ' + priority : '');
		preview.className = 'inmov-ftth-notification-preview is-visible is-' + itemType + ' is-priority-' + notificationPriorityKey(item) + (persistent ? ' is-persistent' : '');
		preview.setAttribute('aria-hidden', 'false');
		preview.setAttribute('aria-live', persistent ? 'assertive' : 'polite');
		if (closeButton) {
			closeButton.textContent = persistent ? '✓' : '×';
			closeButton.setAttribute('aria-label', persistent ? 'Marcar alerta como lido' : 'Fechar aviso');
		}
		if (previewTimer) window.clearTimeout(previewTimer);
		previewTimer = null;
		if (!persistent) {
			previewTimer = window.setTimeout(hidePreview, 8000);
			playNotificationSound();
		} else {
			startUrgentAlert(item);
		}
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
			syncUrgentAlert();
		}).catch(function () {});
	}

	function render() {
		list.textContent = '';
		Object.keys(filterButtons).forEach(function (key) { filterButtons[key].classList.toggle('is-active', key === currentFilter); });
		filterReadAll.hidden = currentFilter === 'todos';
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
			var itemType = notificationTypeKey(item);
			var itemPriority = notificationPriorityKey(item);
			var card = create('article', 'inmov-ftth-notification-card' + (item.read ? '' : ' is-unread') + ' is-' + itemType + ' is-priority-' + itemPriority);
			var marker = create('span', 'inmov-ftth-notification-marker');
			marker.innerHTML = notificationIconSvg(itemType, !!item.read);
			marker.setAttribute('aria-label', item.read ? 'Lida' : typeLabel(itemType));
			var body = create('div', 'inmov-ftth-notification-card-body');
			var meta = create('div', 'inmov-ftth-notification-meta');
			var metaType = create('span', 'inmov-ftth-notification-meta-type');
			metaType.appendChild(create('span', 'inmov-ftth-notification-type', typeLabel(itemType)));
			var itemPriorityLabel = priorityLabel(item);
			if (itemPriorityLabel) metaType.appendChild(create('span', 'inmov-ftth-notification-priority', itemPriorityLabel));
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
				var readButton = create('button', 'inmov-ftth-notification-read-button', 'Marcar como lida');
				readButton.type = 'button';
				readButton.addEventListener('click', function (event) { event.stopPropagation(); markRead(item, card); });
				actions.appendChild(readButton);
			}
			if (hasActionLink(item)) {
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
				if (hasActionLink(item)) window.location.href = item.url;
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
			syncUrgentAlert();
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
		if (open) { currentFilter = 'nao-lidas'; refresh(); }
	});
	close.addEventListener('click', function () { setOpen(false); });
	function markAllAsRead(event) {
		if (event) event.preventDefault();
		if (markAll.disabled) return;
		request(config.readAllEndpoint, { method: 'POST' }).then(function () {
			items.forEach(function (item) { item.read = true; });
			updateBadge(0);
			render();
			syncUrgentAlert();
		}).catch(function () {});
	}
	markAll.addEventListener('click', markAllAsRead);
	mobileMarkAll.addEventListener('click', markAllAsRead);
	preview.querySelector('.inmov-ftth-notification-preview__close').addEventListener('click', function (event) {
		event.stopPropagation();
		if (previewItem && isUrgent(previewItem) && !previewItem.read) {
			markRead(previewItem);
			return;
		}
		hidePreview();
	});
	preview.addEventListener('click', function (event) {
		if (event.target && event.target.closest && event.target.closest('button')) return;
		setOpen(true);
		currentFilter = 'nao-lidas';
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
