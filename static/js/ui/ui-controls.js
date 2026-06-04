/**
 * ui-controls.js
 * Controles de interfaz de usuario
 */

// ==================== PESTAÑAS IZQUIERDA ====================

function selectLeftTab(name) {
    document.querySelectorAll('.side-bar-item').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name)?.classList.add('active');

    const leftPanel      = document.getElementById('left-panel');
    const sideToggle     = document.getElementById('side-toggle-left');
    const layersSection  = document.getElementById('layers-section');
    const momentoSection = document.getElementById('momento-section');

    const currentCenter = map.getCenter();
    const currentZoom   = map.getZoom();

    if (['capas', 'momento'].includes(name)) {
        if (leftPanel?.classList.contains('collapsed')) {
            leftPanel.classList.remove('collapsed');
            sideToggle?.classList.remove('active');
            if (sideToggle) sideToggle.textContent = '◀';
        }
        if (layersSection)  layersSection.style.display  = name === 'capas'   ? 'block' : 'none';
        if (momentoSection) momentoSection.style.display = name === 'momento' ? 'block' : 'none';

        if (name === 'momento' && typeof actualizarContextoMomento === 'function') {
            actualizarContextoMomento();
        }
    } else {
        if (leftPanel && !leftPanel.classList.contains('collapsed')) {
            leftPanel.classList.add('collapsed');
            sideToggle?.classList.add('active');
            if (sideToggle) sideToggle.textContent = '▶';
        }
    }

    setTimeout(() => {
        map.invalidateSize();
        map.setView(currentCenter, currentZoom, { animate: false });
    }, 350);
}

// ==================== PESTAÑAS DERECHA ====================

function selectRightTab(name) {
    document.querySelectorAll('.side-bar-item').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-right-' + name)?.classList.add('active');
    document.getElementById('tab-' + name)?.classList.add('active');

    const rightPanel = document.getElementById('right-panel');
    const rutasSection      = document.getElementById('right-section-rutas');
    const obstaculosSection = document.getElementById('right-section-obstaculos');
    const titleEl           = document.getElementById('right-panel-title');

    const currentCenter = map.getCenter();
    const currentZoom   = map.getZoom();

    if (rightPanel?.classList.contains('collapsed')) {
        rightPanel.classList.remove('collapsed');
        document.getElementById('side-toggle-right')?.classList.remove('visible');
        document.body.classList.add('right-panel-open');
    }

    if (rutasSection)      rutasSection.style.display      = name === 'rutas'      ? 'block' : 'none';
    if (obstaculosSection) obstaculosSection.style.display = name === 'obstaculos' ? 'block' : 'none';

    const titulos = { rutas: '🎯 Cálculo de Rutas', obstaculos: '🚧 Obstáculos' };
    if (titleEl) titleEl.textContent = titulos[name] || '';

    setTimeout(() => {
        map.invalidateSize();
        map.setView(currentCenter, currentZoom, { animate: false });
    }, 350);
}

function iniciarSeleccionRuta() {
    // Si los campos no están configurados, abrir el modal primero
    if (!window.camposRutaConfigurados) {
        if (typeof abrirConfigCamposRuta === 'function') abrirConfigCamposRuta();
        return;
    }
    document.getElementById('info-ruta-pasos')?.style.setProperty('display', 'block');
    if (!puntoOrigen)       mostrarInstruccionOrigen();
    else if (!puntoDestino) mostrarInstruccionDestino();
}

// ==================== MODOS ====================

function cambiarModo(modo, ev) {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    modoActual = modo;
    if (modo !== 'ruta') {
        ocultarInstruccion();
        document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');
        if (typeof desactivarModoObstaculo === 'function') desactivarModoObstaculo();
    }
}

// ==================== PANELS ====================

function _togglePanel(panelId, toggleId) {
    const panel      = document.getElementById(panelId);
    const sideToggle = document.getElementById(toggleId);
    if (!panel) return;

    const collapseBtn   = panel.querySelector('.collapse-btn');
    const currentCenter = map.getCenter();
    const currentZoom   = map.getZoom();

    panel.classList.toggle('collapsed');
    const isCollapsed = panel.classList.contains('collapsed');

    if (sideToggle) {
        // ▶ = panel oculto (queremos mostrarlo) | ◀ = panel visible (queremos ocultarlo)
        sideToggle.textContent = isCollapsed ? '▶' : '◀';
        sideToggle.classList.toggle('active', isCollapsed);
    }






    setTimeout(() => {
        map.invalidateSize();
        map.setView(currentCenter, currentZoom, { animate: false });
    }, 350);
}

function toggleLeftPanel()  { _togglePanel('left-panel',  'side-toggle-left');  }

// ==================== SINCRONIZAR CONTROLES CON PANEL IZQUIERDO ====================

/**
 * Actualiza la posición (left) de .map-controls y .leaflet-bottom.leaflet-left
 * en función del estado del panel izquierdo (abierto/colapsado).
 * Se llama al inicio y cada vez que el panel cambia de estado.
 */
function _actualizarControlesMapa() {
    const leftPanel   = document.getElementById('left-panel');
    const isOpen      = leftPanel && !leftPanel.classList.contains('collapsed');
    const TABS_W      = 56;
    const PANEL_W     = 320;
    const MARGIN      = 10;
    const GAP         = 6;

    const basePx = TABS_W + (isOpen ? PANEL_W : 0) + MARGIN;

    // zoom de Leaflet: left base
    const leafletZoom = document.querySelector('.leaflet-bottom.leaflet-left');
    if (leafletZoom) leafletZoom.style.left = basePx + 'px';

    // .map-controls: justo a la derecha del bloque zoom real
    const controls = document.querySelector('.map-controls');
    if (controls) {
        if (leafletZoom) {
            const zoomRect = leafletZoom.getBoundingClientRect();
            controls.style.left = (zoomRect.right + GAP) + 'px';
        } else {
            controls.style.left = (basePx + 26 + GAP) + 'px';
        }
    }

    if (isOpen) {
        document.body.classList.add('left-panel-open');
    } else {
        document.body.classList.remove('left-panel-open');
    }
}

// ── Hub central de layout: un único ResizeObserver para #left-panel ───────────
// Todos los módulos (table-manager, map-widgets, ui-controls) subscriben aquí
// sus callbacks en vez de crear observadores propios sobre el mismo elemento.
// Esto evita que tres observadores independientes disparen en cascada en cada
// frame de la transición CSS del panel (300-350 ms × 60fps ≈ 18-21 disparos
// por transición, multiplicados por 3 = hasta 63 disparos simultáneos).

(function _initLayoutHub() {
    // Callbacks registrados por otros módulos
    window._layoutHubCallbacks = window._layoutHubCallbacks || [];

    // rAF-throttle: colapsa múltiples disparos del mismo frame en uno solo
    let _rafPending = false;
    function _dispatch() {
        if (_rafPending) return;
        _rafPending = true;
        requestAnimationFrame(function () {
            _rafPending = false;
            window._layoutHubCallbacks.forEach(function (cb) {
                try { cb(); } catch (e) {}
            });
        });
    }

    // Suscribir _actualizarControlesMapa como primer consumidor
    window._layoutHubCallbacks.push(_actualizarControlesMapa);

    function _init() {
        setTimeout(_actualizarControlesMapa, 150); // primer cálculo post-Leaflet

        const leftPanel = document.getElementById('left-panel');
        if (leftPanel) {
            if (window.ResizeObserver) {
                // UN SOLO observador para todo el hub
                new ResizeObserver(_dispatch).observe(leftPanel);
            }
            leftPanel.addEventListener('transitionend', _dispatch);
        }

        // MutationObserver sobre body.class (tabla-abierta, etc.)
        new MutationObserver(function () {
            _dispatch();
            setTimeout(_dispatch, 360); // garantía post-transición tabla
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

        window.addEventListener('resize', _dispatch);

        // Exponer para suscripciones tardías (map-widgets, table-manager)
        window.layoutHubSubscribe = function (cb) {
            if (typeof cb === 'function') window._layoutHubCallbacks.push(cb);
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();


// ==================== RESET VIEW ====================

function resetView() {
    const coords    = [37.55980075138512, -1.8103973775466737];
    const zoomLevel = 15;

    map.invalidateSize();
    setTimeout(() => {
        map.setView(coords, zoomLevel, { animate: true, duration: 0.5 });
    }, 100);
}

/**
 * Evita que los clicks en los controles del mapa (#map-controls)
 * se propaguen al mapa de Leaflet, eliminando chinchetas accidentales
 * al pulsar los botones de home, capas base, etc.
 * Se ejecuta una vez tras el DOMContentLoaded.
 */
document.addEventListener('DOMContentLoaded', function () {
    const mapControls = document.getElementById('map-controls');
    if (mapControls && typeof L !== 'undefined') {
        L.DomEvent.disableClickPropagation(mapControls);
    }
});

// ==================== NOTIFICACIONES ====================

function showNotification(message, type) {
    const notif = document.getElementById('notification');
    if (!notif) return;
    notif.textContent = message;
    notif.className   = 'notification show ' + (type || '');
    setTimeout(() => notif.classList.remove('show'), 3000);
}