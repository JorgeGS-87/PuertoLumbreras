/**
 * history-manager.js
 * Historial de rutas calculadas por usuario registrado/admin.
 *
 * Cambios respecto a la versión original:
 *  - El panel flotante muestra solo las 3 últimas rutas.
 *  - Si hay más de 3 aparece un botón "Ver más" que abre una pestaña
 *    en el panel izquierdo con todas las rutas.
 *  - El panel flotante se reposiciona cuando el panel izquierdo se
 *    abre/cierra para estar siempre a la derecha del widget msw.
 *  - Al repintar una ruta del historial se guarda la referencia en
 *    window._historialRutaLayer; esa capa se elimina cuando se hace
 *    un nuevo cálculo o cuando se borra la entrada del historial.
 */

// ==================== ESTADO ====================

let _historialPanel   = null;
let _historialVisible = false;

/** Todas las rutas cargadas en memoria (usadas por la pestaña "Ver más") */
let _todasLasRutas = [];

// ==================== CAPA DE MAPA DEL HISTORIAL ====================

/**
 * Elimina del mapa la capa pintada desde el historial (si existe).
 * Se llama desde route-manager.js al calcular una ruta nueva
 * y desde historialEliminarYRefrescar si la ruta activa se borra.
 */
function historialLimpiarCapaMapa() {
    if (window._historialRutaLayer) {
        try { map.removeLayer(window._historialRutaLayer); } catch (_) {}
        window._historialRutaLayer = null;
    }
    // Limpiar también el borde rojo de emergencia si lo hubiera
    if (window._historialRutaBorde) {
        try { map.removeLayer(window._historialRutaBorde); } catch (_) {}
        window._historialRutaBorde = null;
    }
    window._historialRutaLayerId = null;
}

// ==================== API CALLS ====================

async function historialRegistrarRuta(datos) {
    if (!['registrado', 'admin'].includes(window._userRol)) return;
    // Limpiar capa del historial anterior al calcular una ruta nueva
    historialLimpiarCapaMapa();
    try {
        await fetch('/api/historial/guardar', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(datos)
        });
    } catch (e) {
        console.warn('historialRegistrarRuta: no se pudo guardar', e);
        return;
    }

    // Refrescar ambos paneles automáticamente tras guardar
    _todasLasRutas = await historialObtener();
    if (_historialVisible) _renderizarHistorial(_todasLasRutas);
    const seccion = document.getElementById('historial-section');
    if (seccion && seccion.style.display !== 'none') _renderizarPestana(seccion, _todasLasRutas);
}

async function historialObtener() {
    try {
        const r = await fetch('/api/historial');
        if (!r.ok) return [];
        const data = await r.json();
        return data.rutas || [];
    } catch (e) {
        return [];
    }
}

async function historialEliminar(id) {
    try {
        await fetch('/api/historial/' + id, { method: 'DELETE' });
    } catch (e) {
        console.warn('historialEliminar error', e);
    }
}

// ==================== POSICIÓN RESPONSIVE ====================

/**
 * Recalcula la posición left del panel flotante según si el panel
 * izquierdo está abierto o cerrado.
 * Se conecta a toggleLeftPanel() mediante un MutationObserver al init.
 */
function _reposicionarPanelHistorial() {
    if (!_historialPanel) return;
    const leftPanel = document.getElementById('left-panel');
    const msw       = document.getElementById('map-search-widget');
    if (!msw) return;

    // Obtener la posición real del widget msw en pantalla
    const mswRect = msw.getBoundingClientRect();
    // El panel aparece pegado a la derecha del widget + 8px de gap
    _historialPanel.style.left = (mswRect.right + 8) + 'px';
    _historialPanel.style.top  = mswRect.top + 'px';
}

/**
 * Observa cambios de clase en left-panel para reposicionar
 * el historial cuando el panel se abre o cierra.
 */
function _observarPanelIzquierdo() {
    const leftPanel = document.getElementById('left-panel');
    if (!leftPanel) return;

    const obs = new MutationObserver(() => {
        // Pequeño delay para que la transición CSS haya terminado
        setTimeout(_reposicionarPanelHistorial, 320);
    });
    obs.observe(leftPanel, { attributes: true, attributeFilter: ['class', 'style'] });

    // También al redimensionar ventana
    window.addEventListener('resize', _reposicionarPanelHistorial);
}

// ==================== UI — PANEL FLOTANTE (últimas 3) ====================

function _crearPanelHistorial() {
    if (_historialPanel) return;

    const panel = document.createElement('div');
    panel.id = 'historial-panel';
    panel.innerHTML = `
        <div class="hist-header">
            <span class="hist-titulo">🕐 Historial de rutas</span>
            <div style="display:flex;align-items:center;gap:4px;">
                <button class="hist-limpiar-btn" onclick="historialLimpiarTodo()" title="Eliminar todas las rutas">🗑️ Limpiar</button>
                <button class="hist-cerrar-btn" onclick="toggleHistorial()" title="Cerrar">✕</button>
            </div>
        </div>
        <div class="hist-body" id="hist-body">
            <div class="hist-loading">Cargando…</div>
        </div>
    `;

    document.body.appendChild(panel);
    _historialPanel = panel;

    // Posicionar y conectar observer
    _reposicionarPanelHistorial();
    _observarPanelIzquierdo();
}

/**
 * Renderiza hasta 3 rutas en el panel flotante.
 * Si hay más, muestra el botón "Ver más".
 */
function _renderizarHistorial(rutas) {
    const body = document.getElementById('hist-body');
    if (!body) return;

    if (!rutas.length) {
        body.innerHTML = '<div class="hist-empty">Sin rutas registradas aún.</div>';
        return;
    }

    const visibles = rutas.slice(0, 3);
    const hayMas   = rutas.length > 3;

    body.innerHTML = visibles.map(r => _htmlItem(r)).join('') +
        (hayMas ? `
        <button class="hist-ver-mas-btn" onclick="abrirPestanaHistorial()">
            📋 Ver todas las rutas (${rutas.length})
        </button>` : '');
}

function _iconoVehiculo(vehiculo) {
    if (vehiculo === 'emergencia') return '🚗🚨';
    if (vehiculo === 'camion')     return '🚛';
    return '🚗';
}

function _htmlItem(r) {
    const fecha  = r.fecha
        ? new Date(r.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
    const tiempo = r.tiempo_min  != null ? `${Math.round(r.tiempo_min)} min` : '—';
    const dist   = r.distancia_km != null ? `${parseFloat(r.distancia_km).toFixed(1)} km` : '—';
    const icono  = _iconoVehiculo(r.vehiculo);

    return `
        <div class="hist-item" data-id="${r.id}">
            <div class="hist-item-header">
                <span class="hist-vehiculo">${icono}</span>
                <span class="hist-fecha">${fecha}</span>
                <button class="hist-delete-btn" onclick="historialEliminarYRefrescar(${r.id})" title="Eliminar">🗑️</button>
            </div>
            <div class="hist-item-ruta">
                <div class="hist-origen">📍 ${r.origen_label || 'Origen'}</div>
                <div class="hist-flecha">↓</div>
                <div class="hist-destino">🎯 ${r.destino_label || 'Destino'}</div>
            </div>
            <div class="hist-item-stats">
                <span class="hist-stat">⏱ ${tiempo}</span>
                <span class="hist-stat">📏 ${dist}</span>
            </div>
            ${r.origen_coords && r.destino_coords ? `
            <button class="hist-repintar-btn"
                onclick="historialRepintar(${JSON.stringify(r).replace(/"/g, '&quot;')})"
                title="Ver ruta en mapa">🗺️ Ver en mapa</button>` : ''}
        </div>
    `;
}

// ==================== PESTAÑA "VER MÁS" EN PANEL IZQUIERDO ====================

/**
 * Abre (o crea) la pestaña de historial completo en el panel izquierdo
 * y la muestra con todas las rutas.
 */
function abrirPestanaHistorial() {
    // 1. Añadir el botón de pestaña a la barra lateral si no existe
    let tabBtn = document.getElementById('tab-historial');
    if (!tabBtn) {
        tabBtn = document.createElement('button');
        tabBtn.id        = 'tab-historial';
        tabBtn.className = 'side-bar-item';
        tabBtn.title     = 'Historial de rutas';
        tabBtn.setAttribute('data-title', 'Historial');
        tabBtn.textContent = '🕐';
        tabBtn.onclick = () => selectLeftTab('historial');

        // Insertar después del botón de momento
        const tabMomento = document.getElementById('tab-momento');
        if (tabMomento?.parentNode) {
            tabMomento.parentNode.insertBefore(tabBtn, tabMomento.nextSibling);
        } else {
            document.getElementById('leftsideTabs')?.appendChild(tabBtn);
        }
    }

    // 2. Crear la sección de contenido si no existe
    let seccion = document.getElementById('historial-section');
    if (!seccion) {
        seccion = document.createElement('div');
        seccion.id        = 'historial-section';
        seccion.className = 'layer-section';
        seccion.style.display = 'none';

        const panelContent = document.querySelector('#left-panel .panel-content');
        if (panelContent) panelContent.appendChild(seccion);
    }

    // 3. Rellenar contenido con todas las rutas
    _renderizarPestana(seccion, _todasLasRutas);

    // 4. Activar la pestaña
    selectLeftTab('historial');

    // 5. Cerrar el panel flotante
    if (_historialVisible) toggleHistorial();
}

function _renderizarPestana(seccion, rutas) {
    if (!rutas.length) {
        seccion.innerHTML = '<h3>🕐 Historial completo</h3><p style="font-size:13px;color:#9ca3af;padding:12px 0;">Sin rutas registradas.</p>';
        return;
    }

    seccion.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <h3 style="margin:0;">🕐 Historial completo <span style="font-size:12px;color:#9ca3af;font-weight:400;">(${rutas.length} rutas)</span></h3>
            <button onclick="historialLimpiarTodo(true)"
                style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);
                       color:#e74c3c;border-radius:6px;padding:4px 10px;font-size:12px;
                       cursor:pointer;white-space:nowrap;"
                onmouseover="this.style.background='rgba(231,76,60,0.25)'"
                onmouseout="this.style.background='rgba(231,76,60,0.12)'">
                🗑️ Limpiar todo
            </button>
        </div>
        ${rutas.map(r => `
        <div class="hist-item hist-item-panel" data-id="${r.id}">
            <div class="hist-item-header">
                <span class="hist-vehiculo">${_iconoVehiculo(r.vehiculo)}</span>
                <span class="hist-fecha">${r.fecha ? new Date(r.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span>
                <button class="hist-delete-btn" onclick="historialEliminarYRefrescar(${r.id}, true)" title="Eliminar">🗑️</button>
            </div>
            <div class="hist-item-ruta">
                <div class="hist-origen">📍 ${r.origen_label || 'Origen'}</div>
                <div class="hist-flecha">↓</div>
                <div class="hist-destino">🎯 ${r.destino_label || 'Destino'}</div>
            </div>
            <div class="hist-item-stats">
                <span class="hist-stat">⏱ ${r.tiempo_min != null ? Math.round(r.tiempo_min) + ' min' : '—'}</span>
                <span class="hist-stat">📏 ${r.distancia_km != null ? parseFloat(r.distancia_km).toFixed(1) + ' km' : '—'}</span>
            </div>
            ${r.origen_coords && r.destino_coords ? `
            <button class="hist-repintar-btn"
                onclick="historialRepintar(${JSON.stringify(r).replace(/"/g, '&quot;')})"
                title="Ver ruta en mapa">🗺️ Ver en mapa</button>` : ''}
        </div>`).join('')}
    `;
}

// Hook para que selectLeftTab conozca la sección de historial
const _selectLeftTabOriginal = window.selectLeftTab;
window.selectLeftTab = function(tab) {
    const seccionHistorial = document.getElementById('historial-section');

    if (tab === 'historial') {
        // Ocultar todas las secciones normales del panel izquierdo
        document.querySelectorAll('#left-panel .panel-content > div').forEach(el => {
            el.style.display = 'none';
        });
        // Mostrar solo la sección del historial
        if (seccionHistorial) seccionHistorial.style.display = 'block';

        // Actualizar título
        const titulo = document.getElementById('left-panel-title');
        if (titulo) titulo.textContent = '🕐 Historial';

        // Asegurarse de que el panel izquierdo esté abierto
        const leftPanel = document.getElementById('left-panel');
        if (leftPanel?.classList.contains('collapsed') && typeof toggleLeftPanel === 'function') {
            toggleLeftPanel();
        }

        // Marcar pestaña activa
        document.querySelectorAll('.side-bar-item').forEach(b => b.classList.remove('active'));
        document.getElementById('tab-historial')?.classList.add('active');
        return;
    }

    // Al cambiar a otra pestaña, ocultar el historial y dejar que el original gestione el resto
    if (seccionHistorial) seccionHistorial.style.display = 'none';

    if (typeof _selectLeftTabOriginal === 'function') {
        _selectLeftTabOriginal(tab);
    }
};

// ==================== ACCIONES PÚBLICAS ====================

async function toggleHistorial() {
    if (!['registrado', 'admin'].includes(window._userRol)) {
        showNotification('El historial está disponible solo para usuarios registrados.', 'info');
        return;
    }

    _crearPanelHistorial();
    _historialVisible = !_historialVisible;
    _historialPanel.classList.toggle('visible', _historialVisible);

    if (_historialVisible) {
        _todasLasRutas = await historialObtener();
        _renderizarHistorial(_todasLasRutas);
        // Reposicionar por si el layout cambió
        _reposicionarPanelHistorial();
    }
}

/**
 * Elimina una ruta y refresca tanto el panel flotante como la pestaña (si está abierta).
 * @param {number}  id
 * @param {boolean} desdePestana  - true si la llamada viene de la pestaña completa
 */
/**
 * Elimina todas las rutas del historial de una vez.
 * @param {boolean} desdePestana  true si se llama desde la pestaña del panel izquierdo
 */
async function historialLimpiarTodo(desdePestana = false) {
    if (!_todasLasRutas.length) {
        showNotification('El historial ya está vacío', 'info');
        return;
    }
    const n = _todasLasRutas.length;
    // Limpiar la capa activa en el mapa si la hay
    historialLimpiarCapaMapa();
    // Borrar todas las rutas en paralelo
    await Promise.all(_todasLasRutas.map(r => historialEliminar(r.id)));
    _todasLasRutas = [];

    // Refrescar panel flotante
    if (_historialVisible) _renderizarHistorial(_todasLasRutas);

    // Refrescar pestaña si está visible
    const seccion = document.getElementById('historial-section');
    if (seccion && seccion.style.display !== 'none') {
        _renderizarPestana(seccion, _todasLasRutas);
    }

    // Eliminar la pestaña del historial y volver a capas
    const tabHistorial = document.getElementById('tab-historial');
    if (tabHistorial) {
        tabHistorial.remove();
        if (typeof selectLeftTab === 'function') selectLeftTab('capas');
    }

    showNotification(`🗑️ ${n} ruta(s) eliminadas del historial`, 'info');
}

async function historialEliminarYRefrescar(id, desdePestana = false) {
    // Si la ruta activa en el mapa es la que se borra, limpiarla
    if (window._historialRutaLayer && window._historialRutaLayerId === id) {
        historialLimpiarCapaMapa();
    }

    await historialEliminar(id);
    _todasLasRutas = await historialObtener();

    // Refrescar panel flotante
    if (_historialVisible) _renderizarHistorial(_todasLasRutas);

    // Refrescar pestaña si está visible
    const seccion = document.getElementById('historial-section');
    if (seccion && seccion.style.display !== 'none') {
        _renderizarPestana(seccion, _todasLasRutas);
    }

    // Si ya no hay rutas y la pestaña estaba activa, volver a capas
    if (!_todasLasRutas.length) {
        const tabHistorial = document.getElementById('tab-historial');
        if (tabHistorial) {
            tabHistorial.remove();
            if (typeof selectLeftTab === 'function') selectLeftTab('capas');
        }
    }

    showNotification('Ruta eliminada del historial', 'info');
}

/**
 * Pinta en el mapa la geometría de una ruta del historial.
 * Guarda la referencia en window._historialRutaLayer para poder borrarla después.
 */
function historialRepintar(ruta) {
    // Eliminar capas previas del historial (ruta + borde emergencia)
    historialLimpiarCapaMapa();

    if (ruta.geojson_ruta) {
        try {
            const geojson = typeof ruta.geojson_ruta === 'string'
                ? JSON.parse(ruta.geojson_ruta)
                : ruta.geojson_ruta;

            const esEmergencia = ruta.vehiculo === 'emergencia';
            const esCamion     = ruta.vehiculo === 'camion';
            const color        = esCamion ? '#2980b9' : '#85c9f7';
            const peso         = esCamion ? 7 : 5;

            // Borde rojo si es emergencia
            if (esEmergencia) {
                window._historialRutaBorde = L.geoJSON(geojson, {
                    style: { color: '#e74c3c', weight: peso + 4, opacity: 0.9 }
                }).addTo(map);
            }

            window._historialRutaLayer   = L.geoJSON(geojson, {
                style: { color: esEmergencia ? color : color, weight: peso, opacity: 0.85 }
            }).addTo(map);
            window._historialRutaLayerId = ruta.id;

            map.fitBounds(window._historialRutaLayer.getBounds(), { padding: [40, 40] });
        } catch (e) {
            console.warn('historialRepintar: error al parsear geojson_ruta', e);
        }
    } else if (ruta.origen_coords && ruta.destino_coords) {
        const o = ruta.origen_coords;
        const d = ruta.destino_coords;
        map.fitBounds([[o[0], o[1]], [d[0], d[1]]], { padding: [60, 60] });
    }

    // Cerrar el panel flotante si estaba abierto
    if (_historialVisible) toggleHistorial();
    showNotification('Ruta del historial cargada en el mapa', 'success');
}

// ==================== CSS INYECTADO ====================

(function _injectHistorialCSS() {
    if (document.getElementById('historial-style')) return;
    const st = document.createElement('style');
    st.id = 'historial-style';
    st.textContent = `
/* ── Botón historial en el header del msw-panel ─────────── */
#msw-historial-btn {
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    color: #374151;
    cursor: pointer;
    font-size: 13px;
    padding: 4px 8px;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
}
#msw-historial-btn:hover {
    background: #f3f4f6;
    border-color: #9ca3af;
}

/* ── Panel flotante historial ──────────────────────────── */
#historial-panel {
    position: fixed;
    width: 300px;
    max-height: 520px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    border: 1px solid #e5e7eb;
    z-index: 2500;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-10px);
    transition: opacity 0.2s ease, transform 0.2s ease;
}
#historial-panel.visible {
    opacity: 1;
    pointer-events: all;
    transform: translateX(0);
}

/* Header */
.hist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #1e3a5f;
    color: #fff;
    flex-shrink: 0;
}
.hist-titulo {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
}
.hist-cerrar-btn {
    background: rgba(255,255,255,0.15);
    border: none;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 7px;
    transition: background 0.15s;
}
.hist-cerrar-btn:hover { background: rgba(255,255,255,0.3); }
.hist-limpiar-btn {
    background: rgba(231,76,60,0.2);
    border: 1px solid rgba(231,76,60,0.45);
    color: #ffb3aa;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 8px;
    transition: background 0.15s;
    white-space: nowrap;
}
.hist-limpiar-btn:hover { background: rgba(231,76,60,0.4); }

/* Body */
.hist-body {
    overflow-y: auto;
    flex: 1;
    padding: 6px 0;
}
.hist-loading, .hist-empty {
    padding: 20px;
    text-align: center;
    font-size: 13px;
    color: #9ca3af;
}

/* Cada ítem */
.hist-item {
    padding: 10px 14px;
    border-bottom: 1px solid #f3f4f6;
    transition: background 0.12s;
}
.hist-item:hover { background: #f9fafb; }
.hist-item:last-child { border-bottom: none; }

/* Ítem dentro de la pestaña del panel izquierdo */
.hist-item-panel {
    border-radius: 8px;
    border: 1px solid #f3f4f6 !important;
    margin-bottom: 8px;
}

.hist-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
}
.hist-vehiculo { font-size: 15px; }
.hist-fecha {
    font-size: 11px;
    color: #6b7280;
    flex: 1;
}
.hist-delete-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    opacity: 0.5;
    transition: opacity 0.15s;
    padding: 0 2px;
}
.hist-delete-btn:hover { opacity: 1; }

.hist-item-ruta {
    font-size: 12px;
    color: #374151;
    line-height: 1.5;
}
.hist-origen, .hist-destino {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
}
.hist-flecha {
    font-size: 11px;
    color: #9ca3af;
    padding-left: 4px;
}
.hist-item-stats {
    display: flex;
    gap: 12px;
    margin-top: 6px;
}
.hist-stat {
    font-size: 11px;
    color: #6b7280;
    background: #f3f4f6;
    border-radius: 4px;
    padding: 2px 6px;
}
.hist-repintar-btn {
    margin-top: 7px;
    width: 100%;
    padding: 5px;
    border: 1px solid #3b82f6;
    border-radius: 6px;
    background: none;
    color: #3b82f6;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}
.hist-repintar-btn:hover {
    background: #3b82f6;
    color: #fff;
}

/* Botón "Ver más" en el panel flotante */
.hist-ver-mas-btn {
    display: block;
    width: calc(100% - 28px);
    margin: 8px 14px 10px;
    padding: 8px;
    border: 1px dashed #3b82f6;
    border-radius: 8px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    text-align: center;
}
.hist-ver-mas-btn:hover {
    background: #dbeafe;
}

/* Pestaña historial en barra lateral */
#tab-historial {
    font-size: 16px;
}
    `;
    document.head.appendChild(st);
})();