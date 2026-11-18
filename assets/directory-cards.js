(function () {
	'use strict';

	var visuals = {
		pop: { label: 'POP', glyph: '▣', color: '#7c3aed', soft: '#f3e8ff' },
		olt: { label: 'OLT', glyph: '◉', color: '#2563eb', soft: '#dbeafe' },
		cto: { label: 'CTO', glyph: '▦', color: '#f59e0b', soft: '#fff7ed' },
		poste: { label: 'Poste', glyph: '│', color: '#64748b', soft: '#f1f5f9' },
		caixa_emenda: { label: 'Caixa de emenda', glyph: '✣', color: '#06b6d4', soft: '#cffafe' },
		splitter: { label: 'Splitter', glyph: '◇', color: '#10b981', soft: '#d1fae5' },
		loja: { label: 'Loja / sede', glyph: '⌂', color: '#db2777', soft: '#fce7f3' },
		outro: { label: 'Outro', glyph: '•', color: '#475569', soft: '#f1f5f9' }
	};

	function normalize(value) {
		var key = String(value || '').toLowerCase().trim();
		if (key.normalize) key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		key = key.replace(/[\s-]+/g, '_');
		if (key === 'ceo') key = 'caixa_emenda';
		if (key === 'caixa_de_emenda') key = 'caixa_emenda';
		return visuals[key] ? key : 'outro';
	}

	function decorate(scope) {
		var fields = (scope || document).querySelectorAll('.elementor-element-72dfbd72 .jet-listing-dynamic-field__content');
		fields.forEach(function (field) {
			var key = normalize(field.textContent);
			var visual = visuals[key];
			var widget = field.closest('.elementor-element-72dfbd72');
			if (!widget || !visual) return;
			widget.classList.add('inmov-ftth-listing-type', 'inmov-ftth-type--' + key);
			field.dataset.glyph = visual.glyph;
			field.dataset.pointType = key;
			field.style.setProperty('--inmov-point-color', visual.color);
			field.style.setProperty('--inmov-point-soft', visual.soft);
			field.textContent = visual.label;
			field.setAttribute('aria-label', visual.label);
		});
	}

	function boot() {
		decorate(document);
		document.querySelectorAll('.jet-listing-grid').forEach(function (grid) {
			if (grid.__inmovDirectoryCardsObserver) return;
			var observer = new MutationObserver(function () { decorate(grid); });
			observer.observe(grid, { childList: true, subtree: true });
			grid.__inmovDirectoryCardsObserver = observer;
		});
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
	document.addEventListener('jet-engine/listing-grid/after-load', function () { decorate(document); });
})();
