// =============================================================================
// js/ui/map-widgets.js
// Widgets flotantes del mapa:
//   · Botón calcular ruta con barra de progreso inline (MSW)
//   · Control de capas base independiente del panel de Leaflet
//   · Widget de información al hacer clic en el mapa
// Depende de: map-config.js (map), route-manager.js, ui-controls.js
// =============================================================================


// ==================== BOTÓN CALCULAR RUTA INLINE ====================

/**
 * IIFE que gestiona el botón "Calcular ruta" dentro del panel MSW.
 * Cuando se lanza el cálculo, oculta el botón y muestra una barra de progreso
 * que espeja el estado de la barra original (oculta) del route-manager.
 * Al terminar la ruta (la barra original se oculta), la barra inline
 * se completa y desaparece.
 */
(function () {
    const btnCalc  = document.getElementById('msw-btn-calcular');
    const progWrap = document.getElementById('msw-progreso-inline');
    const progFill = document.getElementById('msw-progreso-fill');
    const progText = document.getElementById('msw-progreso-text');
    const progOrig = document.getElementById('progress-container');
    const fillOrig = document.getElementById('progress-fill');
    const textOrig = document.getElementById('progress-text');

    /** Intervalo que sincroniza la barra inline con la barra original. */
    let _mirrorInterval = null;

    /** Muestra la barra de progreso inline y oculta el botón. */
    function mostrarProgreso() {
        btnCalc.style.display  = 'none';
        progWrap.style.display = 'block';
        progFill.style.width   = '0%';
        progText.textContent   = 'Calculando ruta…';
    }

    /** Oculta la barra inline, detiene el mirror y restaura el botón. */
    function ocultarProgreso() {
        progWrap.style.display = 'none';
        btnCalc.style.display  = 'flex';
        clearInterval(_mirrorInterval);
        _mirrorInterval = null;
    }

    /**
     * Arranca el intervalo que copia el estado (width + texto) de la barra
     * original en la barra inline cada 80 ms.
     */
    function iniciarMirror() {
        if (_mirrorInterval) return;
        _mirrorInterval = setInterval(() => {
            if (!fillOrig || !textOrig) return;
            progFill.style.width = fillOrig.style.width || '0%';
            if (textOrig.textContent) progText.textContent = textOrig.textContent;
        }, 80);
    }

    // Observa cuándo la barra original se oculta → la ruta ha terminado
    const observer = new MutationObserver(() => {
        if (progOrig && progOrig.style.display === 'none' && progWrap.style.display === 'block') {
            progFill.style.width = '100%';
            setTimeout(ocultarProgreso, 400);
        }
    });
    if (progOrig) observer.observe(progOrig, { attributes: true, attributeFilter: ['style'] });

    /**
     * Lanza el cálculo de ruta.
     * Comprueba que haya origen y destino antes de proceder; en caso contrario
     * muestra una notificación de aviso.
     * Expuesto como window.msw_lanzarCalculo para ser llamado desde el HTML.
     */
    window.msw_lanzarCalculo = function () {
        const origenLabel  = document.getElementById('msw-origen-label');
        const destinoLabel = document.getElementById('msw-destino-label');
        const sinOrigen    = !origenLabel  || origenLabel.classList.contains('placeholder');
        const sinDestino   = !destinoLabel || destinoLabel.classList.contains('placeholder');
        if (sinOrigen || sinDestino) {
            showNotification('Elige primero un origen y un destino', 'warning');
            return;
        }

        mostrarProgreso();
        iniciarMirror();

        // Intentar los distintos puntos de entrada que puede exponer route-manager
        if (typeof calcularRuta === 'function') {
            calcularRuta();
        } else if (typeof iniciarCalculo === 'function') {
            iniciarCalculo();
        } else {
            document.dispatchEvent(new CustomEvent('msw:calcularRuta'));
            // Seguridad: si en 15 s no ha terminado, quitar la barra de progreso
            setTimeout(() => { if (progWrap.style.display !== 'none') ocultarProgreso(); }, 15000);
        }
    };
})();


// ==================== BOTONES HOME Y CAPAS BASE (control Leaflet nativo) ====================
/**
 * Crea un L.Control con los botones Home y Capas Base en bottomleft,
 * justo a la derecha del zoom. Al ser un control nativo de Leaflet,
 * siempre está dentro del mapa y se comporta igual que el zoom.
 * El div #map-controls del HTML queda vacío y oculto — los botones
 * originales (#btn-capas-base, resetView) se delegan a este control.
 */
document.addEventListener('DOMContentLoaded', function () {
    function _initMapButtons() {
        if (typeof L === 'undefined' || typeof map === 'undefined') {
            setTimeout(_initMapButtons, 200); return;
        }

        const MapButtonsControl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd: function () {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-btns-control');
                container.style.cssText = 'display:flex;flex-direction:row;gap:4px;border:none;box-shadow:none;background:transparent;';

                // Botón Home
                const btnHome = L.DomUtil.create('button', 'map-btn-ctrl', container);
                btnHome.innerHTML = '🏠';
                btnHome.title = 'Vista inicial';
                btnHome.type  = 'button';
                L.DomEvent.on(btnHome, 'click', function (e) {
                    L.DomEvent.stopPropagation(e);
                    if (typeof resetView === 'function') resetView();
                });

                // Botón Capas Base
                const btnCapas = L.DomUtil.create('button', 'map-btn-ctrl', container);
                btnCapas.id       = 'btn-capas-base';
                btnCapas.innerHTML = '🗺️';
                btnCapas.title    = 'Capas base';
                btnCapas.type     = 'button';
                // El click lo conecta _initLayerControl en el bloque siguiente

                // Botón Capa Compartida de Obstáculos
                const btnComp = L.DomUtil.create('button', 'map-btn-ctrl', container);
                btnComp.id        = 'btn-capa-compartida';
                btnComp.innerHTML = '🚧';
                btnComp.title     = 'Abrir capa de obstáculos compartida';
                btnComp.type      = 'button';
                L.DomEvent.on(btnComp, 'click', function (e) {
                    L.DomEvent.stopPropagation(e);
                    if (typeof window.toggleCapaCompartida === 'function') {
                        window.toggleCapaCompartida();
                    } else {
                        console.error('[map-widgets] toggleCapaCompartida no está definida — ¿cargó realtime.js?');
                    }
                });

                L.DomEvent.disableClickPropagation(container);

                return container;
            }
        });

        new MapButtonsControl().addTo(map);

        // Ocultar el div #map-controls original del HTML (ya no se usa)
        const old = document.getElementById('map-controls');
        if (old) old.style.display = 'none';
    }
    setTimeout(_initMapButtons, 100);
});


// ==================== CONTROL DE CAPAS BASE ====================

/**
 * Conecta el botón #btn-capas-base (ya presente en el HTML) con el panel
 * de capas base nativo de Leaflet.
 * El panel se posiciona sobre el botón al hacer clic.
 *
 * Se ejecuta con retardo para asegurarse de que Leaflet ya ha renderizado
 * el control en el DOM. Reintenta hasta 10 veces si no lo encuentra aún.
 */
document.addEventListener('DOMContentLoaded', function () {

    function _initLayerControl(intentos) {
        intentos = intentos || 0;
        // Leaflet puede añadirlo en topleft o bottomleft según map-config
        const ctrl = document.querySelector('.leaflet-control-layers');
        const btn  = document.getElementById('btn-capas-base');

        if (!ctrl || !btn) {
            if (intentos < 20) setTimeout(() => _initLayerControl(intentos + 1), 200);
            return;
        }

        // Sacar el ctrl del DOM de Leaflet y esconderlo
        if (ctrl.parentNode) ctrl.parentNode.removeChild(ctrl);
        ctrl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
        document.body.appendChild(ctrl);

        let panelAbierto = false;

        /** Posiciona y muestra el panel SOBRE el botón. */
        function abrirPanel() {
            const r = btn.getBoundingClientRect();
            ctrl.classList.add('leaflet-control-layers-expanded');
            ctrl.style.cssText = [
                'position:fixed',
                'bottom:' + (window.innerHeight - Math.round(r.top) + 6) + 'px',
                'left:'   + Math.round(r.left) + 'px',
                'z-index:3000',
                'background:white',
                'border-radius:8px',
                'border:1px solid #dde3ea',
                'box-shadow:0 6px 20px rgba(0,0,0,0.18)',
                'padding:8px 6px',
                'min-width:190px'
            ].join(';');
            panelAbierto = true;
        }

        function cerrarPanel() {
            ctrl.classList.remove('leaflet-control-layers-expanded');
            ctrl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
            panelAbierto = false;
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            panelAbierto ? cerrarPanel() : abrirPanel();
        });

        ctrl.addEventListener('click',    function (e) { e.stopPropagation(); });
        document.addEventListener('click', function ()  { if (panelAbierto) cerrarPanel(); });

        console.log('[map-widgets] ✅ Control de capas base conectado.');
    }

    setTimeout(() => _initLayerControl(0), 600);
});


// ==================== REPOSICIONAMIENTO WIDGET BÚSQUEDA ====================

/**
 * Mantiene el widget de búsqueda (map-search-widget) pegado al borde
 * derecho del panel izquierdo + un margen fijo.
 * Reacciona al toggle del panel izquierdo, al resize de ventana y a la
 * apertura/cierre de la tabla de atributos (que no afecta al widget pero
 * puede cambiar el layout en móvil).
 *
 * - Panel colapsado: left = ancho de la barra lateral de tabs (56px) + margen
 * - Panel abierto  : left = 56px + 320px (ancho del panel) + margen
 */
(function _mswReposicionar() {
    const SIDEBAR_TABS_W = 56;   // px — ancho de .column.left (tabs iconos)
    const PANEL_W        = 320;  // px — ancho de .left-panel cuando está abierto
    const MARGIN         = 10;   // px — margen entre panel y widget

    function _calcLeft() {
        const leftPanel = document.getElementById('left-panel');
        const isOpen    = leftPanel && !leftPanel.classList.contains('collapsed');
        return SIDEBAR_TABS_W + (isOpen ? PANEL_W : 0) + MARGIN;
    }

    function _aplicar() {
        const widget = document.getElementById('map-search-widget');
        if (!widget) return;
        widget.style.left = _calcLeft() + 'px';
    }

    function _init() {
        _aplicar();

        // Suscribirse al hub central en vez de crear otro ResizeObserver sobre #left-panel
        if (typeof window.layoutHubSubscribe === 'function') {
            window.layoutHubSubscribe(_aplicar);
        } else {
            // Hub aún no inicializado: registrar en la lista compartida
            window._layoutHubCallbacks = window._layoutHubCallbacks || [];
            window._layoutHubCallbacks.push(_aplicar);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    // Exponer para que ui-controls.js pueda llamarlo si necesita forzar un refresco
    window.msw_actualizarPosicion = _aplicar;
})();


// ==================== WIDGET CLIC EN MAPA ====================

/**
 * IIFE que gestiona el widget flotante que aparece al hacer clic en el mapa.
 * Muestra la dirección más cercana (consultando /api/portal-por-coordenadas),
 * coloca una chincheta temporal y ofrece el botón "Cómo llegar" para
 * abrir el panel MSW con ese punto como destino.
 */
(function () {
    /** Marcador (chincheta) que indica el punto clicado. */
    let _chincheta    = null;

    /** Objeto latlng del último clic; sirve para cancelar fetches anteriores. */
    let _latlngActual = null;

    // ── API pública ──────────────────────────────────────────────────────────

    /**
     * Cierra el widget y opcionalmente quita la chincheta del mapa.
     * Expuesto como window.cerrarClickWidget para ser llamado desde el HTML.
     *
     * @param {boolean} [mantenerChincheta=false] - Si es true, no retira el marcador.
     */
    window.cerrarClickWidget = function (mantenerChincheta) {
        document.getElementById('click-info-widget').style.display = 'none';
        if (!mantenerChincheta && _chincheta) {
            map.removeLayer(_chincheta);
            _chincheta = null;
        }
        _latlngActual = null;
    };

    /**
     * Acción del botón "Cómo llegar" del widget.
     * Cierra el widget, abre el panel MSW y fija el punto clicado como destino.
     * Acepta opcionalmente un parámetro latlng externo (ej. desde búsqueda de portales).
     * Expuesto como window.clickWidgetComoLlegar para ser llamado desde el HTML.
     * 
     * @param {L.LatLng} [latlngExterno] - Coordenadas opcionales desde búsqueda
     */
    window.clickWidgetComoLlegar = function (latlngExterno) {
        const latlng = latlngExterno || _latlngActual;
        if (!latlng) {
            console.error('❌ clickWidgetComoLlegar: sin coordenadas');
            showNotification('Error: sin coordenadas válidas', 'error');
            return;
        }

        console.log('🧭 clickWidgetComoLlegar:', latlng);

        // Cerrar widget manteniendo chincheta (la ruta pondrá su propio marcador)
        cerrarClickWidget(true);
        if (_chincheta) { map.removeLayer(_chincheta); _chincheta = null; }

        // Abrir panel de rutas (MSW)
        const mswPanel      = document.getElementById('msw-panel');
        const btnComoLlegar = document.querySelector('.msw-como-llegar-btn');
        if (mswPanel)      mswPanel.style.display      = 'block';
        if (btnComoLlegar) btnComoLlegar.style.display = 'none';

        // Configurar modo ruta
        modoActual = 'ruta';
        if (!window.camposRutaConfigurados && window.currentViasGeoJSON?.features?.length) {
            if (typeof autodetectarCamposRuta === 'function') autodetectarCamposRuta(window.currentViasGeoJSON);
        }

        // Fijar destino directamente
        if (marcadorDestino) map.removeLayer(marcadorDestino);
        if (typeof rutaLayer !== 'undefined' && rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
        puntoDestino    = latlng;
        marcadorDestino = L.marker(latlng, { icon: crearIconoMarcador('🎯') }).addTo(map);

        // Actualizar label destino en el widget MSW
        const dl = document.getElementById('msw-destino-label');
        if (dl) {
            dl.textContent = `🎯 ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
            dl.classList.remove('placeholder');
        }
        // Sincronizar labels del panel derecho si existe
        if (typeof _actualizarLabels === 'function') _actualizarLabels();

        // NOTA: Ya NO activamos automáticamente el modo "esperando origen"
        // El usuario debe seleccionar manualmente origen y destino por separado
        // window._esperandoOrigen  = true;
        // window._esperandoDestino = false;
        // mostrarInstruccionOrigen();
        // showNotification('🎯 Destino fijado. Ahora selecciona el origen en el mapa', 'success');

        showNotification('🎯 Destino fijado. Ahora selecciona el origen.', 'success');
    };

    // ── Helpers de renderizado ───────────────────────────────────────────────

    /**
     * Genera el HTML de una fila de dato del widget (icono + label + valor).
     * Devuelve cadena vacía si el valor es falsy (excepto 0).
     *
     * @param {string} icono  - Emoji o carácter a mostrar
     * @param {string} label  - Texto descriptivo del dato
     * @param {*}      valor  - Valor a mostrar
     * @returns {string}
     */
    function _fila(icono, label, valor) {
        if (!valor && valor !== 0) return '';
        return `<span style="color:#95a5a6;font-size:12px;">${icono} ${label}</span>
                <span style="font-weight:500;">${valor}</span>`;
    }

    /**
     * Capitaliza la primera letra de cada palabra en una cadena.
     *
     * @param {string} str - Cadena a transformar
     * @returns {string}
     */
    function _capitalizar(str) {
        if (!str) return '';
        return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    }

    /**
     * Rellena y muestra el widget con los datos de dirección obtenidos.
     *
     * @param {L.LatLng} latlng - Coordenadas del clic
     * @param {Object|null} datos - Datos del portal más cercano, o null
     */
    function _mostrarWidget(latlng, datos) {
        const titulo = document.getElementById('ciw-titulo');
        const cuerpo = document.getElementById('ciw-cuerpo');
        const coords = document.getElementById('ciw-coords');
        const widget = document.getElementById('click-info-widget');

        let nombreCalle = '—';
        let filas = '';

        if (datos) {
            const tv  = _capitalizar(datos.tipo_vial);
            const nv  = _capitalizar(datos.nombre_via);
            nombreCalle = `${tv} ${nv}`.trim() || '—';
            filas = [
                _fila('🛣️', 'Calle',     nombreCalle),
                _fila('🔢', 'Número',    datos.numero    || '—'),
                _fila('📮', 'C. Postal', datos.cod_postal || '—'),
                _fila('🏙️', 'Municipio', _capitalizar(datos.municipio) || '—'),
                _fila('🗺️', 'Provincia', _capitalizar(datos.provincia) || '—'),
            ].filter(Boolean).join('');
        } else {
            filas = `<span style="color:#aab0b7;grid-column:1/-1;font-size:12px;">Sin información de dirección en este punto</span>`;
        }

        titulo.textContent   = nombreCalle;
        cuerpo.innerHTML     = filas;
        coords.textContent   = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        widget.style.display = 'block';
    }

    // ── Listener de clic en el mapa ──────────────────────────────────────────

    map.on('click', function (e) {
        // Si algún modo especial está activo, ceder el clic a su handler
        // Orden de prioridad: evento > obstáculo > ruta > chincheta
        if (typeof window._eventoClickHandler === 'function' && window._modoEvento) {
            window._eventoClickHandler(e);
            return;
        }
        // En móvil, no crear chincheta si se está moviendo un obstáculo
        if (window.isMobile && window._mobileMovingObstacle) return;
        if (modoActual === 'ruta' || (typeof modoObstaculo !== 'undefined' && modoObstaculo)) return;
        // Si el clic viene de un control del mapa (home, capas...), ignorar
        if (e.originalEvent?.target?.closest?.('.map-controls, .leaflet-control')) return;

        _latlngActual = e.latlng;

        // Quitar chincheta anterior
        if (_chincheta) { map.removeLayer(_chincheta); _chincheta = null; }

        // Crear chincheta pequeña en el punto clicado
        _chincheta = L.marker(e.latlng, {
            icon: L.divIcon({
                className: '',
                html: `<div style="font-size:22px;filter:drop-shadow(1px 2px 3px rgba(0,0,0,.5));">📍</div>`,
                iconSize:  [22, 22],
                iconAnchor:[11, 22]
            }),
            zIndexOffset: 500
        }).addTo(map);

        // Mostrar widget con la barra de progreso mientras se consulta la API
        document.getElementById('ciw-titulo').textContent = 'Buscando dirección...';
        document.getElementById('ciw-cuerpo').innerHTML   = `<span style="color:#aab0b7;grid-column:1/-1;font-size:12px;">⏳ Consultando...</span>`;
        document.getElementById('ciw-coords').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
        document.getElementById('click-info-widget').style.display = 'block';

        // Consultar el portal más cercano al punto clicado
        fetch(`/api/portal-por-coordenadas?lat=${e.latlng.lat}&lon=${e.latlng.lng}&radio=120`)
            .then(r => r.json())
            .then(data => {
                if (_latlngActual !== e.latlng) return; // clic más nuevo en camino
                _mostrarWidget(e.latlng, data.resultado || null);
            })
            .catch(() => {
                if (_latlngActual !== e.latlng) return;
                _mostrarWidget(e.latlng, null);
            });
    });

    // Cerrar el widget al hacer clic fuera de él (pero no si el clic es en el mapa,
    // ya que el handler de arriba abrirá un nuevo widget)
    document.addEventListener('click', function (e) {
        const widget = document.getElementById('click-info-widget');
        if (widget.style.display === 'none') return;
        if (e.target.closest('#click-info-widget')) return;
        if (e.target.closest('#map')) return; // el mapa gestiona su propio clic
        cerrarClickWidget();
    });
})();

// ==================== BOTONES OBSTÁCULOS / EVENTO — EXCLUSIÓN MUTUA Y COLOR ====================

/**
 * Centraliza el estado activo/inactivo de los botones 🚧 Obstáculos y 🎪 Evento.
 * - Al activar uno, desactiva el otro automáticamente.
 * - Colorea el botón activo con el color de su modo.
 * - Parchea activarModoObstaculo / desactivarModoObstaculo / activarModoEvento /
 *   desactivarModoEvento para interceptar las llamadas originales.
 */
(function _gestionarBotonesModo() {

    function _btnObs() { return document.getElementById('msw-btn-obstaculo'); }
    function _btnEv()  { return document.getElementById('msw-btn-evento'); }

    /** Aplica estilos de activo/inactivo a un botón. */
    function _setActivo(btn, activo, tipo) {
        if (!btn) return;
        btn.classList.toggle('obs-activo', activo && tipo === 'obs');
        btn.classList.toggle('ev-activo', activo && tipo === 'ev');
        btn.classList.toggle('active', activo);
    }

    /** Desactiva obstáculo sin llamar al parche (evita recursión). */
    function _desactivarObs() {
        if (typeof _origDesactivarObs === 'function') _origDesactivarObs();
        _setActivo(_btnObs(), false);
    }

    /** Desactiva evento sin llamar al parche (evita recursión). */
    function _desactivarEv() {
        if (typeof _origDesactivarEv === 'function') _origDesactivarEv();
        _setActivo(_btnEv(), false);
    }

    function intentar() {
        const tieneObs = typeof activarModoObstaculo   === 'function';
        const tieneEv  = typeof activarModoEvento      === 'function';
        if (!tieneObs || !tieneEv) { setTimeout(intentar, 150); return; }

        // Guardar originales
        window._origActivarObs     = activarModoObstaculo;
        window._origDesactivarObs  = typeof desactivarModoObstaculo === 'function' ? desactivarModoObstaculo : () => {};
        window._origActivarEv      = activarModoEvento;
        window._origDesactivarEv   = typeof desactivarModoEvento    === 'function' ? desactivarModoEvento    : () => {};

        // Parchear activarModoObstaculo
        window.activarModoObstaculo = function () {
            // Si ya está activo, desactivar (toggle)
            if (typeof modoObstaculo !== 'undefined' && modoObstaculo) {
                _origDesactivarObs();
                _setActivo(_btnObs(), false);
                return;
            }
            // Desactivar evento si estaba activo
            if (window._modoEvento) {
                _origDesactivarEv();
                _setActivo(_btnEv(), false);
            }
            _origActivarObs();
            _setActivo(_btnObs(), true, 'obs');
        };

        // Parchear desactivarModoObstaculo
        window.desactivarModoObstaculo = function () {
            _origDesactivarObs();
            _setActivo(_btnObs(), false, 'obs');
        };

        // Parchear activarModoEvento
        window.activarModoEvento = function () {
            // Si ya está activo, desactivar (toggle)
            if (window._modoEvento) {
                _origDesactivarEv();
                _setActivo(_btnEv(), false);
                return;
            }
            // Desactivar obstáculo si estaba activo
            if (typeof modoObstaculo !== 'undefined' && modoObstaculo) {
                _origDesactivarObs();
                _setActivo(_btnObs(), false);
            }
            _origActivarEv();
            _setActivo(_btnEv(), true, 'ev');
        };

        // Parchear desactivarModoEvento
        window.desactivarModoEvento = function () {
            _origDesactivarEv();
            _setActivo(_btnEv(), false);
        };

        console.log('[map-widgets] ✅ Botones Obstáculos/Evento con exclusión mutua y color activo.');
    }

    // Esperar a que los scripts de obstáculos y eventos hayan cargado
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(intentar, 300));
    } else {
        setTimeout(intentar, 300);
    }
})();