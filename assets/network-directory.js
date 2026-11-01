(function () {
  'use strict';
  var config = window.InmovFtthDirectory || {};
  var labels = { pop:'POP', olt:'OLT', cto:'CTO', poste:'Poste', caixa_emenda:'Caixa de emenda', splitter:'Splitter', loja:'Loja / sede', outro:'Outro' };
  var glyphs = { pop:'▣', olt:'◉', cto:'▦', poste:'│', caixa_emenda:'✣', splitter:'✣', loja:'⌂', outro:'•' };
  var colors = { pop:'#7c3aed', olt:'#2563eb', cto:'#f59e0b', poste:'#64748b', caixa_emenda:'#06b6d4', splitter:'#06b6d4', loja:'#ec4899', outro:'#64748b' };
  function text(value) { return value === null || value === undefined ? '' : String(value); }
  function esc(value) { return text(value).replace(/[&<>"']/g, function (character) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[character]; }); }
  function normalize(value) { return text(value).toLocaleLowerCase('pt-BR').normalize ? text(value).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text(value).toLocaleLowerCase(); }
  function request(url) { return window.fetch(url, { credentials:'same-origin', headers:{'X-WP-Nonce': config.nonce || ''} }).then(function (response) { if (!response.ok) throw new Error('Não foi possível carregar os dados.'); return response.json(); }); }
  function option(select, value, label) { var node = document.createElement('option'); node.value = value; node.textContent = label; select.appendChild(node); }
  function cardPoint(item) {
    var type = text(item.type || 'outro'); var color = colors[type] || colors.outro;
    var card = document.createElement('article'); card.className = 'inmov-ftth-directory__card';
    var badge = document.createElement('span'); badge.className = 'inmov-ftth-directory__badge'; badge.textContent = glyphs[type] || glyphs.outro; badge.style.setProperty('--accent', color); badge.style.setProperty('--soft', color + '1c');
    var main = document.createElement('div'); main.className = 'inmov-ftth-directory__card-main';
    var title = document.createElement('h2'); title.className = 'inmov-ftth-directory__card-title'; title.textContent = item.name || item.code || 'Ponto sem nome';
    var meta = document.createElement('p'); meta.className = 'inmov-ftth-directory__card-meta'; meta.innerHTML = '<strong>' + esc(item.code ? '#' + item.code : 'Sem código') + '</strong> · ' + esc(item.locality || 'Localidade não informada') + (item.address ? ' · ' + esc(item.address) : '');
    var status = document.createElement('span'); status.className = 'inmov-ftth-directory__card-status'; status.textContent = labels[type] + ' · ' + (item.status || 'sem status');
    main.appendChild(title); main.appendChild(meta); main.appendChild(status); card.appendChild(badge); card.appendChild(main);
    if (config.mapUrl) { var link = document.createElement('a'); link.className = 'inmov-ftth-directory__card-action'; link.href = config.mapUrl + (config.mapUrl.indexOf('?') === -1 ? '?' : '&') + 'focus_point=' + encodeURIComponent(item.id); link.textContent = 'Ver no mapa'; card.appendChild(link); }
    return card;
  }
  function cardRoute(feature) {
    var p = feature.properties || {}; var card = document.createElement('article'); card.className = 'inmov-ftth-directory__card';
    var badge = document.createElement('span'); badge.className = 'inmov-ftth-directory__badge'; badge.textContent = '━'; badge.style.setProperty('--accent', p.color || '#2563eb'); badge.style.setProperty('--soft', (p.color || '#2563eb') + '1c');
    var main = document.createElement('div'); main.className = 'inmov-ftth-directory__card-main'; var title = document.createElement('h2'); title.className = 'inmov-ftth-directory__card-title'; title.textContent = p.name || 'Rota sem nome';
    var meta = document.createElement('p'); meta.className = 'inmov-ftth-directory__card-meta'; meta.innerHTML = '<strong>' + esc(p.locality || 'Localidade não informada') + '</strong> · ' + esc(p.fibers ? p.fibers + 'FO' : 'FO não informado') + (p.cableType ? ' · ' + esc(p.cableType) : '');
    var status = document.createElement('span'); status.className = 'inmov-ftth-directory__card-status'; status.textContent = (p.routeType || 'Rota') + ' · ' + (p.status || 'sem status'); main.appendChild(title); main.appendChild(meta); main.appendChild(status); card.appendChild(badge); card.appendChild(main); return card;
  }
  function init(root) {
    var kind = root.getAttribute('data-directory-kind'); var list = root.querySelector('[data-directory-list]'); var empty = root.querySelector('[data-directory-empty]'); var summary = root.querySelector('[data-directory-summary]'); var search = root.querySelector('[data-directory-search]'); var city = root.querySelector('[data-directory-city]'); var type = root.querySelector('[data-directory-type]'); var status = root.querySelector('[data-directory-status]'); var fibers = root.querySelector('[data-directory-fibers]');
    var endpoint = kind === 'routes' ? config.routesEndpoint : config.pointsEndpoint;
    request(endpoint).then(function (payload) {
      var items = kind === 'routes' ? (payload.features || []) : (Array.isArray(payload) ? payload : []);
      var records = kind === 'routes' ? items : items;
      var cities = {}; var statuses = {}; var types = {}; var fiberOptions = {};
      records.forEach(function (record) { var p = kind === 'routes' ? (record.properties || {}) : record; var locality = p.locality || ''; if (locality) cities[locality] = true; if (p.status) statuses[p.status] = true; if (kind === 'points' && p.type) types[p.type] = true; if (kind === 'routes' && p.fibers) fiberOptions[p.fibers] = true; });
      Object.keys(cities).sort(function(a,b){return normalize(a).localeCompare(normalize(b));}).forEach(function(v){option(city,v,v);}); Object.keys(statuses).sort().forEach(function(v){option(status,v,v.replace(/_/g,' '));});
      if (kind === 'points') { Object.keys(types).sort().forEach(function(v){option(type,v,labels[v] || v);}); var initial = root.getAttribute('data-initial-type'); if (initial && types[initial]) type.value = initial; }
      if (kind === 'routes') Object.keys(fiberOptions).sort(function(a,b){return Number(a)-Number(b);}).forEach(function(v){option(fibers,v,v + 'FO');});
      function render() {
        var q = normalize(search.value);
        var filtered = records.filter(function (record) {
          var p = kind === 'routes' ? (record.properties || {}) : record;
          var hay = normalize([p.name, p.code, p.locality, p.address, p.cableType].join(' '));
          var matchesType = kind === 'points' ? (!type.value || p.type === type.value) : (!fibers.value || String(p.fibers) === fibers.value);
          return (!q || hay.indexOf(q) !== -1) && (!city.value || p.locality === city.value) && (!status.value || p.status === status.value) && matchesType;
        });
        list.innerHTML = '';
        filtered.forEach(function (record) { list.appendChild(kind === 'routes' ? cardRoute(record) : cardPoint(record)); });
        empty.hidden = filtered.length !== 0;
        summary.textContent = filtered.length + (kind === 'routes' ? ' rota(s) encontrada(s)' : ' ponto(s) encontrado(s)');
      }
      [search,city,status,type,fibers].forEach(function(node){if(node) node.addEventListener('input',render);}); render();
    }).catch(function(error){ summary.textContent = error.message; empty.hidden = false; empty.textContent = 'Não foi possível carregar os dados agora.'; });
  }
  function boot(){Array.prototype.forEach.call(document.querySelectorAll('.inmov-ftth-directory'),init);}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}());
