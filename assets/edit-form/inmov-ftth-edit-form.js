(function (window, document) {
    'use strict';

    if (!window || !document) return;

    var POINT_TYPES = [
        { value: 'cto', label: 'CTO' },
        { value: 'olt', label: 'OLT' },
        { value: 'pop', label: 'POP' },
        { value: 'caixa_emenda', label: 'Caixa de emenda' },
        { value: 'splitter', label: 'Splitter' },
        { value: 'loja', label: 'Loja / sede' },
        { value: 'poste', label: 'Poste' },
        { value: 'outro', label: 'Outro ponto' }
    ];

    var POINT_STATUSES = [
        { value: 'nativo', label: 'Nativo' },
        { value: 'planejado', label: 'Planejado' },
        { value: 'em_implantacao', label: 'Em implantação' },
        { value: 'manutencao', label: 'Em manutenção' },
        { value: 'inativo', label: 'Inativo' }
    ];

    var ROUTE_TYPES = [
        { value: 'backbone', label: 'Backbone' },
        { value: 'asu', label: 'ASU' },
        { value: 'alimentacao', label: 'Alimentação' },
        { value: 'distribuicao', label: 'Distribuição' },
        { value: 'drop', label: 'Drop' },
        { value: 'outro', label: 'Outro tipo' }
    ];

    var ROUTE_STATUSES = [
        { value: 'nativa', label: 'Nativa' },
        { value: 'planejada', label: 'Planejada' },
        { value: 'em_implantacao', label: 'Em implantação' },
        { value: 'manutencao', label: 'Em manutenção' },
        { value: 'inativa', label: 'Inativa' }
    ];

    var FIBER_OPTIONS = [1, 2, 4, 6, 12, 24, 36, 48, 72].map(function (value) {
        return { value: String(value), label: value + ' FO' };
    });

    var hasOwn = Object.prototype.hasOwnProperty;

    function clone(value) {
        if (value === undefined || value === null) return value;
        try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
    }

    function stringValue(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function numberValue(value) {
        if (value === '' || value === null || value === undefined) return null;
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeKind(value) {
        return String(value || '').toLowerCase() === 'route' || String(value || '').toLowerCase() === 'line' ? 'route' : 'point';
    }

    function normalizePointType(value) {
        var raw = stringValue(value).toLowerCase().trim();
        if (raw === 'cep') return 'cto';
        if (raw === 'ceo' || raw === 'caixa_de_emenda') return 'caixa_emenda';
        return POINT_TYPES.some(function (item) { return item.value === raw; }) ? raw : 'outro';
    }

    function makeElement(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function optionsFor(select, values, selected) {
        values.forEach(function (item) {
            var option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.label;
            option.selected = stringValue(item.value) === stringValue(selected);
            select.appendChild(option);
        });
    }

    function fieldLabel(label, required) {
        var text = makeElement('span', 'inmov-ftth-edit-form__label-text', label);
        if (required) text.appendChild(makeElement('b', 'inmov-ftth-edit-form__required', ' *'));
        return text;
    }

    function createField(parent, definition, value) {
        var wrapper = makeElement('div', 'inmov-ftth-edit-form__field');
        wrapper.dataset.field = definition.name;
        if (definition.span) wrapper.classList.add('is-wide');
        var label = makeElement('label', 'inmov-ftth-edit-form__label');
        label.appendChild(fieldLabel(definition.label, definition.required));
        var control;
        if (definition.type === 'textarea') {
            control = makeElement('textarea', 'inmov-ftth-edit-form__control');
            control.rows = definition.rows || 3;
        } else if (definition.type === 'select') {
            control = makeElement('select', 'inmov-ftth-edit-form__control');
            optionsFor(control, definition.options || [], value);
        } else {
            control = makeElement('input', 'inmov-ftth-edit-form__control');
            control.type = definition.type || 'text';
            if (definition.step) control.step = definition.step;
            if (definition.min !== undefined) control.min = definition.min;
            if (definition.max !== undefined) control.max = definition.max;
            if (definition.inputMode) control.inputMode = definition.inputMode;
        }
        control.name = definition.name;
        control.id = 'inmov-ftth-edit-' + definition.name;
        label.htmlFor = control.id;
        control.autocomplete = 'off';
        if (definition.placeholder) control.placeholder = definition.placeholder;
        if (definition.required) control.required = true;
        if (definition.readOnly) control.readOnly = true;
        if (definition.description) {
            var description = makeElement('small', 'inmov-ftth-edit-form__help', definition.description);
            wrapper.appendChild(label);
            wrapper.appendChild(control);
            wrapper.appendChild(description);
        } else {
            wrapper.appendChild(label);
            wrapper.appendChild(control);
        }
        control.value = value === undefined || value === null ? '' : value;
        parent.appendChild(wrapper);
        return { wrapper: wrapper, control: control };
    }

    function setFieldVisible(wrapper, visible) {
        if (!wrapper) return;
        wrapper.hidden = !visible;
        wrapper.setAttribute('aria-hidden', visible ? 'false' : 'true');
        wrapper.classList.toggle('is-hidden', !visible);
    }

    function getRawPoint(data) {
        data = data || {};
        var source = data.properties && typeof data.properties === 'object' ? data.properties : data;
        var coordinates = Array.isArray(data.coordinates) ? data.coordinates : (data.geometry && Array.isArray(data.geometry.coordinates) ? data.geometry.coordinates : []);
        return {
            id: data.id !== undefined ? data.id : (source.id !== undefined ? source.id : source._ID),
            code: stringValue(source.code !== undefined ? source.code : source.ponto_codigo),
            name: stringValue(source.name !== undefined ? source.name : source.ponto_nome),
            type: normalizePointType(source.type !== undefined ? source.type : source.ponto_tipo),
            locality: stringValue(source.locality !== undefined ? source.locality : source.ponto_localidade),
            address: stringValue(source.address !== undefined ? source.address : source.ponto_endereco),
            lat: source.lat !== undefined ? source.lat : (source.ponto_latitude !== undefined ? source.ponto_latitude : coordinates[1]),
            lng: source.lng !== undefined ? source.lng : (source.ponto_longitude !== undefined ? source.ponto_longitude : coordinates[0]),
            status: stringValue(source.status !== undefined ? source.status : source.ponto_status) || 'nativo',
            capacity: source.capacity !== undefined ? source.capacity : source.ponto_capacidade_portas,
            observation: stringValue(source.observation !== undefined ? source.observation : source.ponto_observacao)
        };
    }

    function getRawRoute(data) {
        data = data || {};
        var source = data.properties && typeof data.properties === 'object' ? data.properties : data;
        var geometry = data.geometry && data.geometry.type === 'LineString' ? data.geometry.coordinates : (Array.isArray(data.geometry) ? data.geometry : data.coordinates);
        return {
            id: data.id !== undefined ? data.id : (source.id !== undefined ? source.id : source._ID),
            name: stringValue(source.name !== undefined ? source.name : source.rota_nome),
            locality: stringValue(source.locality !== undefined ? source.locality : source.rota_localidade),
            routeType: stringValue(source.routeType !== undefined ? source.routeType : source.rota_tipo) || 'outro',
            cableType: stringValue(source.cableType !== undefined ? source.cableType : source.rota_tipo_cabo),
            fibers: source.fibers !== undefined ? source.fibers : source.rota_quantidade_fibras,
            status: stringValue(source.status !== undefined ? source.status : source.rota_status) || 'nativa',
            lengthM: source.lengthM !== undefined ? source.lengthM : source.rota_comprimento_metros,
            observation: stringValue(source.observation !== undefined ? source.observation : source.rota_observacao),
            geometry: Array.isArray(geometry) ? clone(geometry) : []
        };
    }

    function canonical(value) {
        if (value === '' || value === null || value === undefined) return '';
        if (typeof value === 'number') return value;
        return stringValue(value).trim();
    }

    function diff(original, values, keys) {
        var changes = {};
        keys.forEach(function (key) {
            if (JSON.stringify(canonical(original[key])) !== JSON.stringify(canonical(values[key]))) changes[key] = values[key];
        });
        return changes;
    }

    function dispatch(name, detail) {
        var event;
        try { event = new CustomEvent(name, { detail: detail }); } catch (error) {
            event = document.createEvent('CustomEvent');
            event.initCustomEvent(name, false, false, detail);
        }
        document.dispatchEvent(event);
    }

    function EditForm(options) {
        options = options || {};
        this.root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
        if (!this.root) throw new Error('InmovFTTHEditForm: root não encontrado.');
        this.kind = normalizeKind(options.kind);
        this.options = options;
        this.original = this.kind === 'route' ? getRawRoute(options.data) : getRawPoint(options.data);
        this.values = clone(this.original);
        this.pendingLocation = null;
        this.pendingGeometry = null;
        this.fieldRefs = {};
        this.statusNode = null;
        this.render();
    }

    EditForm.prototype.render = function () {
        var self = this;
        this.root.innerHTML = '';
        this.root.classList.add('inmov-ftth-edit-form-host');
        var form = makeElement('form', 'inmov-ftth-edit-form');
        form.noValidate = true;
        form.dataset.kind = this.kind;
        form.dataset.integration = 'not-integrated';
        this.form = form;

        var header = makeElement('header', 'inmov-ftth-edit-form__header');
        var titleGroup = makeElement('div');
        titleGroup.appendChild(makeElement('p', 'inmov-ftth-edit-form__eyebrow', 'Prévia de edição'));
        titleGroup.appendChild(makeElement('h2', 'inmov-ftth-edit-form__title', this.kind === 'route' ? 'Editar rota de fibra' : 'Editar ponto da rede'));
        titleGroup.appendChild(makeElement('p', 'inmov-ftth-edit-form__subtitle', 'Nenhuma alteração será enviada ou salva nesta etapa.'));
        header.appendChild(titleGroup);
        header.appendChild(makeElement('span', 'inmov-ftth-edit-form__badge', 'Não integrado'));
        form.appendChild(header);

        var body = makeElement('div', 'inmov-ftth-edit-form__body');
        form.appendChild(body);
        this.buildIdentitySection(body);
        if (this.kind === 'route') this.buildRouteSection(body); else this.buildPointSection(body);
        this.buildReviewSection(body);

        var footer = makeElement('div', 'inmov-ftth-edit-form__footer');
        var reset = makeElement('button', 'inmov-ftth-edit-form__button is-quiet', 'Restaurar dados originais');
        reset.type = 'button';
        reset.dataset.action = 'reset';
        var preview = makeElement('button', 'inmov-ftth-edit-form__button is-primary', 'Gerar prévia da alteração');
        preview.type = 'submit';
        preview.dataset.action = 'preview';
        footer.appendChild(reset);
        footer.appendChild(preview);
        form.appendChild(footer);
        this.statusNode = makeElement('div', 'inmov-ftth-edit-form__status');
        this.statusNode.setAttribute('role', 'status');
        this.statusNode.setAttribute('aria-live', 'polite');
        form.appendChild(this.statusNode);
        this.root.appendChild(form);

        form.addEventListener('input', function (event) {
            if (event.target && event.target.name) self.values[event.target.name] = event.target.value;
            self.syncConditionalFields();
            self.updateDirtyState();
        });
        form.addEventListener('change', function (event) {
            if (event.target && event.target.name) self.values[event.target.name] = event.target.value;
            self.syncConditionalFields();
            self.updateDirtyState();
        });
        form.addEventListener('click', function (event) {
            var button = event.target.closest ? event.target.closest('button') : null;
            if (!button || !form.contains(button)) return;
            if (button.dataset.action === 'request-location') self.requestLocation();
            if (button.dataset.action === 'request-geometry') self.requestGeometry();
            if (button.dataset.action === 'copy-payload') self.copyPayload();
            if (button.dataset.action === 'reset') self.reset();
        });
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            self.preview();
        });
        this.syncConditionalFields();
        this.updateDirtyState();
    };

    EditForm.prototype.buildSection = function (parent, title, description) {
        var section = makeElement('fieldset', 'inmov-ftth-edit-form__section');
        var legend = makeElement('legend', 'inmov-ftth-edit-form__section-title', title);
        section.appendChild(legend);
        if (description) section.appendChild(makeElement('p', 'inmov-ftth-edit-form__section-description', description));
        var grid = makeElement('div', 'inmov-ftth-edit-form__grid');
        section.appendChild(grid);
        parent.appendChild(section);
        return grid;
    };

    EditForm.prototype.addField = function (grid, definition, value) {
        var ref = createField(grid, definition, value);
        this.fieldRefs[definition.name] = ref;
        return ref;
    };

    EditForm.prototype.buildIdentitySection = function (body) {
        var grid = this.buildSection(body, 'Identificação', 'Campos básicos usados na pesquisa e no inventário da rede.');
        if (this.kind === 'route') {
            this.addField(grid, { name: 'name', label: 'Nome da rota', required: true, span: true, placeholder: 'Ex.: Anel central - trecho norte' }, this.original.name);
            this.addField(grid, { name: 'locality', label: 'Localidade', required: true, placeholder: 'Cidade ou região' }, this.original.locality);
        } else {
            this.addField(grid, { name: 'code', label: 'Código', required: true, placeholder: 'Código operacional' }, this.original.code);
            this.addField(grid, { name: 'name', label: 'Nome exibido', required: true, placeholder: 'Nome do ponto' }, this.original.name);
            this.addField(grid, { name: 'locality', label: 'Localidade', required: true, placeholder: 'Cidade ou região' }, this.original.locality);
            this.addField(grid, { name: 'address', label: 'Endereço', span: true, placeholder: 'Rua, número, referência' }, this.original.address);
        }
    };

    EditForm.prototype.buildPointSection = function (body) {
        var self = this;
        var grid = this.buildSection(body, 'Classificação e operação', 'Os campos adicionais aparecem conforme o tipo e a situação escolhidos.');
        this.addField(grid, { name: 'type', label: 'Tipo de ponto', type: 'select', required: true, options: POINT_TYPES }, this.original.type);
        this.addField(grid, { name: 'status', label: 'Situação', type: 'select', required: true, options: POINT_STATUSES }, this.original.status);
        this.addField(grid, { name: 'capacity', label: 'Capacidade / portas', type: 'number', min: 0, step: 1, inputMode: 'numeric', placeholder: 'Opcional' }, this.original.capacity);
        this.addField(grid, { name: 'observation', label: 'Observações técnicas', type: 'textarea', span: true, rows: 4, placeholder: 'Informações úteis para a equipe' }, this.original.observation);
        this.addField(grid, { name: 'deploymentNote', label: 'Nota de implantação', type: 'textarea', span: true, rows: 3, placeholder: 'Exibida apenas para revisão enquanto o ponto estiver planejado ou em implantação' }, '');
        this.addField(grid, { name: 'maintenanceNote', label: 'Nota de manutenção', type: 'textarea', span: true, rows: 3, placeholder: 'Descreva o motivo ou a janela de manutenção' }, '');

        var locationGrid = this.buildSection(body, 'Localização', 'Escolha se as coordenadas permanecem iguais ou se serão substituídas.');
        this.addField(locationGrid, {
            name: 'locationMode', label: 'Como alterar a localização', type: 'select', span: true,
            options: [
                { value: 'keep', label: 'Manter localização atual' },
                { value: 'coordinates', label: 'Informar latitude e longitude' },
                { value: 'map', label: 'Selecionar nova posição no mapa' }
            ]
        }, 'keep');
        var lat = this.addField(locationGrid, { name: 'lat', label: 'Latitude', type: 'number', step: 'any', min: -90, max: 90, inputMode: 'decimal', required: true }, this.original.lat);
        var lng = this.addField(locationGrid, { name: 'lng', label: 'Longitude', type: 'number', step: 'any', min: -180, max: 180, inputMode: 'decimal', required: true }, this.original.lng);
        lat.wrapper.dataset.locationField = 'true';
        lng.wrapper.dataset.locationField = 'true';
        var action = makeElement('div', 'inmov-ftth-edit-form__inline-action');
        action.dataset.locationAction = 'true';
        var actionText = makeElement('p', 'inmov-ftth-edit-form__inline-copy', 'A integração futura poderá devolver uma coordenada selecionada diretamente no mapa.');
        var locateButton = makeElement('button', 'inmov-ftth-edit-form__button is-secondary', 'Selecionar no mapa');
        locateButton.type = 'button';
        locateButton.dataset.action = 'request-location';
        action.appendChild(actionText);
        action.appendChild(locateButton);
        locationGrid.appendChild(action);
        this.locationRefs = { lat: lat, lng: lng, action: action };
        void self;
    };

    EditForm.prototype.buildRouteSection = function (body) {
        var grid = this.buildSection(body, 'Características da rota', 'Os valores correspondem aos campos já usados pela camada de rotas do mapa.');
        this.addField(grid, { name: 'routeType', label: 'Tipo de rota', type: 'select', required: true, options: ROUTE_TYPES }, this.original.routeType);
        this.addField(grid, { name: 'status', label: 'Situação', type: 'select', required: true, options: ROUTE_STATUSES }, this.original.status);
        this.addField(grid, { name: 'cableType', label: 'Tipo de cabo', placeholder: 'Ex.: ASU80, CFOA-SM' }, this.original.cableType);
        this.addField(grid, { name: 'fibers', label: 'Quantidade de fibras', type: 'select', required: true, options: FIBER_OPTIONS }, String(this.original.fibers || ''));
        this.addField(grid, { name: 'lengthM', label: 'Comprimento (m)', type: 'number', min: 0, step: 1, readOnly: true, description: 'Calculado a partir da geometria quando a integração estiver ativa.' }, this.original.lengthM);
        this.addField(grid, { name: 'observation', label: 'Observações técnicas', type: 'textarea', span: true, rows: 4, placeholder: 'Informações úteis para a equipe' }, this.original.observation);
        this.addField(grid, { name: 'deploymentNote', label: 'Nota de implantação', type: 'textarea', span: true, rows: 3, placeholder: 'Exibida apenas para revisão enquanto a rota estiver planejada ou em implantação' }, '');
        this.addField(grid, { name: 'maintenanceNote', label: 'Nota de manutenção', type: 'textarea', span: true, rows: 3, placeholder: 'Descreva o motivo ou a janela de manutenção' }, '');

        var geometryGrid = this.buildSection(body, 'Geometria', 'A edição dos vértices será conectada ao mapa somente em uma etapa posterior.');
        this.addField(geometryGrid, {
            name: 'geometryMode', label: 'Como alterar a geometria', type: 'select', span: true,
            options: [
                { value: 'keep', label: 'Manter traçado atual' },
                { value: 'map', label: 'Desenhar novo traçado no mapa' }
            ]
        }, 'keep');
        var geometryInfo = makeElement('div', 'inmov-ftth-edit-form__geometry-card');
        geometryInfo.dataset.geometryInfo = 'true';
        geometryInfo.appendChild(makeElement('strong', '', this.original.geometry.length ? this.original.geometry.length + ' vértices carregados' : 'Geometria ainda não informada'));
        geometryInfo.appendChild(makeElement('span', '', 'O comprimento será recalculado quando o traçado for confirmado no mapa.'));
        var geometryButton = makeElement('button', 'inmov-ftth-edit-form__button is-secondary', 'Editar traçado no mapa');
        geometryButton.type = 'button';
        geometryButton.dataset.action = 'request-geometry';
        geometryInfo.appendChild(geometryButton);
        geometryGrid.appendChild(geometryInfo);
        this.geometryRefs = { info: geometryInfo, button: geometryButton };
    };

    EditForm.prototype.buildReviewSection = function (body) {
        var grid = this.buildSection(body, 'Revisão', 'Este bloco ajuda a preparar o payload para a futura integração, sem enviar nada.');
        this.addField(grid, { name: 'changeReason', label: 'Motivo da alteração', type: 'textarea', required: true, span: true, rows: 3, placeholder: 'Descreva por que este item será alterado' }, '');
        var review = makeElement('label', 'inmov-ftth-edit-form__check');
        var checkbox = makeElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'reviewed';
        review.appendChild(checkbox);
        review.appendChild(makeElement('span', '', 'Confirmei os dados antes de gerar a prévia'));
        grid.appendChild(review);
    };

    EditForm.prototype.readControls = function () {
        var self = this;
        Object.keys(this.fieldRefs).forEach(function (key) {
            var control = self.fieldRefs[key].control;
            if (!control) return;
            self.values[key] = control.value;
        });
        var reviewed = this.form.querySelector('input[name="reviewed"]');
        this.values.reviewed = !!(reviewed && reviewed.checked);
        return this.values;
    };

    EditForm.prototype.syncConditionalFields = function () {
        var values = this.readControls();
        var type = this.kind === 'point' ? values.type : '';
        var status = values.status;
        var capacity = this.fieldRefs.capacity && this.fieldRefs.capacity.wrapper;
        setFieldVisible(capacity, this.kind === 'point' && ['cto', 'olt', 'pop', 'caixa_emenda'].indexOf(type) >= 0);
        setFieldVisible(this.fieldRefs.deploymentNote && this.fieldRefs.deploymentNote.wrapper, ['planejado', 'em_implantacao', 'planejada'].indexOf(status) >= 0);
        setFieldVisible(this.fieldRefs.maintenanceNote && this.fieldRefs.maintenanceNote.wrapper, status === 'manutencao');
        if (this.kind === 'point' && this.locationRefs) {
            var mode = values.locationMode || 'keep';
            var editable = mode === 'coordinates';
            if (mode === 'keep') {
                this.pendingLocation = null;
                this.locationRefs.lat.control.value = this.original.lat === null || this.original.lat === undefined ? '' : this.original.lat;
                this.locationRefs.lng.control.value = this.original.lng === null || this.original.lng === undefined ? '' : this.original.lng;
                this.values.lat = this.locationRefs.lat.control.value;
                this.values.lng = this.locationRefs.lng.control.value;
            }
            setFieldVisible(this.locationRefs.lat.wrapper, mode !== 'keep');
            setFieldVisible(this.locationRefs.lng.wrapper, mode !== 'keep');
            this.locationRefs.lat.control.readOnly = !editable;
            this.locationRefs.lng.control.readOnly = !editable;
            setFieldVisible(this.locationRefs.action, mode === 'map');
        }
        if (this.kind === 'route' && this.geometryRefs) {
            if (values.geometryMode !== 'map') this.pendingGeometry = null;
            setFieldVisible(this.geometryRefs.info, values.geometryMode === 'map');
        }
    };

    EditForm.prototype.updateDirtyState = function () {
        if (!this.form) return;
        var values = this.readControls();
        var keys = this.kind === 'route'
            ? ['name', 'locality', 'routeType', 'cableType', 'fibers', 'status', 'lengthM', 'observation']
            : ['code', 'name', 'type', 'locality', 'address', 'lat', 'lng', 'status', 'capacity', 'observation'];
        var dirty = Object.keys(diff(this.original, values, keys)).length > 0 || !!this.pendingLocation || !!this.pendingGeometry;
        this.form.classList.toggle('is-dirty', dirty);
        this.form.dataset.dirty = dirty ? 'true' : 'false';
    };

    EditForm.prototype.clearErrors = function () {
        var self = this;
        this.form.querySelectorAll('.has-error').forEach(function (node) { node.classList.remove('has-error'); });
        this.form.querySelectorAll('[aria-invalid="true"]').forEach(function (node) { node.removeAttribute('aria-invalid'); });
        this.form.querySelectorAll('.inmov-ftth-edit-form__error').forEach(function (node) { node.remove(); });
        void self;
    };

    EditForm.prototype.error = function (name, message) {
        var ref = this.fieldRefs[name];
        if (!ref) return;
        ref.wrapper.classList.add('has-error');
        ref.control.setAttribute('aria-invalid', 'true');
        ref.wrapper.appendChild(makeElement('small', 'inmov-ftth-edit-form__error', message));
    };

    EditForm.prototype.validate = function () {
        var values = this.readControls();
        this.clearErrors();
        var valid = true;
        var required = this.kind === 'route' ? ['name', 'locality', 'routeType', 'status', 'fibers'] : ['code', 'name', 'locality', 'type', 'status'];
        required.forEach(function (name) {
            if (!stringValue(values[name]).trim()) { this.error(name, 'Preencha este campo.'); valid = false; }
        }, this);
        if (!values.reviewed) {
            var check = this.form.querySelector('input[name="reviewed"]');
            if (check) { check.setAttribute('aria-invalid', 'true'); check.closest('label').classList.add('has-error'); }
            valid = false;
        }
        if (!stringValue(values.changeReason).trim()) { this.error('changeReason', 'Informe o motivo para esta prévia.'); valid = false; }
        if (this.kind === 'point' && values.locationMode === 'coordinates') {
            var lat = numberValue(values.lat);
            var lng = numberValue(values.lng);
            if (lat === null || lat < -90 || lat > 90) { this.error('lat', 'Use uma latitude entre -90 e 90.'); valid = false; }
            if (lng === null || lng < -180 || lng > 180) { this.error('lng', 'Use uma longitude entre -180 e 180.'); valid = false; }
        }
        if (this.kind === 'point' && values.locationMode === 'map' && !this.pendingLocation) {
            this.error('locationMode', 'Solicite a posição no mapa antes de gerar a prévia.');
            valid = false;
        }
        if (this.kind === 'route' && values.geometryMode === 'map' && (!this.pendingGeometry || this.pendingGeometry.length < 2)) {
            var modeRef = this.fieldRefs.geometryMode;
            if (modeRef) { modeRef.wrapper.classList.add('has-error'); modeRef.wrapper.appendChild(makeElement('small', 'inmov-ftth-edit-form__error', 'Solicite o novo traçado no mapa antes de gerar a prévia.')); }
            valid = false;
        }
        return valid;
    };

    EditForm.prototype.getPayload = function () {
        var values = this.readControls();
        var payload = {
            kind: this.kind,
            id: this.original.id,
            original: clone(this.original),
            values: clone(values),
            changes: {},
            locationChange: null,
            geometryChange: null,
            integration: { status: 'not-integrated', destination: 'future-map-or-api-adapter' }
        };
        if (this.kind === 'point') {
            payload.changes = diff(this.original, values, ['code', 'name', 'type', 'locality', 'address', 'lat', 'lng', 'status', 'capacity', 'observation']);
            if (values.locationMode !== 'keep') {
                payload.locationChange = {
                    mode: values.locationMode,
                    lat: numberValue(values.lat),
                    lng: numberValue(values.lng),
                    source: values.locationMode === 'map' ? 'map-selection-hook' : 'manual-coordinates'
                };
                if (this.pendingLocation) payload.locationChange.selected = clone(this.pendingLocation);
            }
        } else {
            payload.changes = diff(this.original, values, ['name', 'locality', 'routeType', 'cableType', 'fibers', 'status', 'lengthM', 'observation']);
            if (values.geometryMode === 'map') {
                payload.geometryChange = { mode: 'map-selection-hook', coordinates: clone(this.pendingGeometry || []) };
            }
        }
        payload.review = { reason: stringValue(values.changeReason).trim(), reviewed: !!values.reviewed, workflowNote: stringValue(values.maintenanceNote || values.deploymentNote).trim() };
        return payload;
    };

    EditForm.prototype.preview = function () {
        if (!this.validate()) {
            this.statusNode.textContent = 'Revise os campos destacados para gerar a prévia.';
            this.statusNode.className = 'inmov-ftth-edit-form__status is-error';
            return null;
        }
        var payload = this.getPayload();
        this.lastPayload = payload;
        this.statusNode.textContent = 'Prévia gerada. Nenhum dado foi enviado.';
        this.statusNode.className = 'inmov-ftth-edit-form__status is-success';
        dispatch('inmov-ftth:edit-preview', payload);
        if (typeof this.options.onPreview === 'function') this.options.onPreview(payload, this);
        this.showPayloadActions();
        return payload;
    };

    EditForm.prototype.showPayloadActions = function () {
        if (!this.form || this.form.querySelector('[data-action="copy-payload"]')) return;
        var button = makeElement('button', 'inmov-ftth-edit-form__button is-secondary', 'Copiar payload de teste');
        button.type = 'button';
        button.dataset.action = 'copy-payload';
        var footer = this.form.querySelector('.inmov-ftth-edit-form__footer');
        if (footer) footer.appendChild(button);
    };

    EditForm.prototype.requestLocation = function () {
        var detail = { kind: this.kind, id: this.original.id, current: { lat: numberValue(this.original.lat), lng: numberValue(this.original.lng) } };
        dispatch('inmov-ftth:edit-location-request', detail);
        if (typeof this.options.onLocationRequest === 'function') this.options.onLocationRequest(detail, this);
        this.statusNode.textContent = 'Aguardando uma coordenada da integração com o mapa…';
        this.statusNode.className = 'inmov-ftth-edit-form__status is-info';
    };

    EditForm.prototype.requestGeometry = function () {
        var detail = { kind: this.kind, id: this.original.id, current: clone(this.original.geometry || []) };
        dispatch('inmov-ftth:edit-geometry-request', detail);
        if (typeof this.options.onGeometryRequest === 'function') this.options.onGeometryRequest(detail, this);
        this.statusNode.textContent = 'Aguardando um novo traçado da integração com o mapa…';
        this.statusNode.className = 'inmov-ftth-edit-form__status is-info';
    };

    EditForm.prototype.setLocation = function (lat, lng) {
        lat = numberValue(lat); lng = numberValue(lng);
        if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('Coordenadas inválidas.');
        if (this.fieldRefs.lat) this.fieldRefs.lat.control.value = lat;
        if (this.fieldRefs.lng) this.fieldRefs.lng.control.value = lng;
        if (this.fieldRefs.locationMode) this.fieldRefs.locationMode.control.value = 'map';
        this.values.lat = lat; this.values.lng = lng; this.values.locationMode = 'map';
        this.pendingLocation = { lat: lat, lng: lng };
        this.syncConditionalFields();
        this.updateDirtyState();
        this.statusNode.textContent = 'Nova posição recebida para a prévia.';
        this.statusNode.className = 'inmov-ftth-edit-form__status is-info';
        return this;
    };

    EditForm.prototype.setGeometry = function (coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('A rota precisa de pelo menos dois vértices.');
        this.pendingGeometry = coordinates.map(function (pair) { return [numberValue(pair[0]), numberValue(pair[1])]; });
        if (this.fieldRefs.geometryMode) this.fieldRefs.geometryMode.control.value = 'map';
        this.values.geometryMode = 'map';
        if (this.geometryRefs && this.geometryRefs.info) {
            var label = this.geometryRefs.info.querySelector('strong');
            if (label) label.textContent = this.pendingGeometry.length + ' vértices recebidos';
        }
        this.syncConditionalFields();
        this.updateDirtyState();
        this.statusNode.textContent = 'Novo traçado recebido para a prévia.';
        this.statusNode.className = 'inmov-ftth-edit-form__status is-info';
        return this;
    };

    EditForm.prototype.copyPayload = function () {
        var payload = this.lastPayload || this.getPayload();
        var text = JSON.stringify(payload, null, 2);
        var self = this;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { self.statusNode.textContent = 'Payload copiado para a área de transferência.'; }).catch(function () { self.fallbackCopy(text); });
        } else this.fallbackCopy(text);
    };

    EditForm.prototype.fallbackCopy = function (text) {
        var textarea = makeElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed'; textarea.style.opacity = '0';
        document.body.appendChild(textarea); textarea.select();
        try { document.execCommand('copy'); this.statusNode.textContent = 'Payload copiado para a área de transferência.'; } catch (error) { this.statusNode.textContent = 'Não foi possível copiar automaticamente o payload.'; }
        document.body.removeChild(textarea);
    };

    EditForm.prototype.reset = function () {
        this.original = this.kind === 'route' ? getRawRoute(this.options.data) : getRawPoint(this.options.data);
        this.values = clone(this.original);
        this.pendingLocation = null; this.pendingGeometry = null;
        this.fieldRefs = {};
        this.render();
    };

    EditForm.prototype.destroy = function () {
        if (this.root) this.root.innerHTML = '';
        this.form = null;
    };

    EditForm.prototype.getValue = function (name) {
        return this.fieldRefs[name] ? this.fieldRefs[name].control.value : undefined;
    };

    function create(options) { return new EditForm(options); }

    window.InmovFTTHEditForm = {
        create: create,
        normalizeKind: normalizeKind,
        pointTypes: clone(POINT_TYPES),
        pointStatuses: clone(POINT_STATUSES),
        routeTypes: clone(ROUTE_TYPES),
        routeStatuses: clone(ROUTE_STATUSES),
        fiberOptions: clone(FIBER_OPTIONS)
    };
}(window, document));
