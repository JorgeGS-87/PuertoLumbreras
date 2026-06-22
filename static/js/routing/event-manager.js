/**
 * event-manager.js
 * Gestión de eventos especiales (marchas, conciertos, etc.) definidos como
 * polígonos en el mapa. Cada evento tiene fecha, afluencia y duración.
 *
 * Flujo de creación:
 *   1. Admin pulsa "Crear evento" → modo dibujo activo
 *   2. Clicks en el mapa añaden vértices (preview en tiempo real)
 *   3. Click derecho cierra el polígono
 *   4. Modal pide: nombre, fecha/hora inicio, nivel de impacto (Amarillo/Naranja/Rojo), duración (h)
 *   5. El polígono queda guardado en `eventos[]`
 *
 * Integración con calcularRuta (route-manager.js):
 *   · window.obtenerPenalizacionEventos(segmentoS, segmentoE, fechaEfectiva)
 *     devuelve el factor multiplicador mayor (≥1) de todos los eventos activos
 *     que intersectan ese segmento en ese momento.
 *
 * Depende de: map-config.js (map), ui-controls.js (showNotification)
 */

// ── Estado global ─────────────────────────────────────────────────────────────

/** Array de eventos creados. Cada entrada es un objeto evento o null (eliminado). */
let eventos = [];
let _eventosExportHandle = null;

/** true mientras el admin está dibujando un polígono nuevo. */
let _modoEvento = false;
// Alias global para que map-widgets.js pueda consultarlo
Object.defineProperty(window, '_modoEvento', {
    get: () => _modoEvento,
    set: v  => { _modoEvento = v; }
});

/** Vértices del polígono en construcción [ L.LatLng, … ] */
let _verticesActuales = [];

/** Polyline/Polygon de preview mientras se dibuja. */
let _previewLayer = null;

/** Markers de vértice (puntos azules) mientras se dibuja. */
let _previewMarkers = [];

/** LatLng del último vértice (para la línea de seguimiento al mover el ratón). */
let _lineaSeguimiento = null;

/** Botón flotante para cerrar polígono en móvil */
let _botonCrearEventoMovil = null;

/** Tooltip que sigue al cursor durante el modo dibujo */
let _cursorTooltip = null;

function _crearCursorTooltip() {
    if (_cursorTooltip) return;
    _cursorTooltip = document.createElement('div');
    _cursorTooltip.id = 'evento-cursor-tooltip';
    _cursorTooltip.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:9999',
        'background:rgba(30,20,40,0.82)',
        'color:#fff',
        'font-size:12px',
        'font-family:var(--font-base)',
        'font-weight:500',
        'padding:5px 10px',
        'border-radius:6px',
        'white-space:nowrap',
        'display:none',
        'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
        'border-left:3px solid #8e44ad',
        'transform:translate(16px,12px)',
    ].join(';');
    document.body.appendChild(_cursorTooltip);
}

function _mostrarCursorTooltip() {
    if (window.isMobile) return;
    _crearCursorTooltip();
    _actualizarTextoCursorTooltip();
    _cursorTooltip.style.display = 'block';
    document.addEventListener('mousemove', _moverCursorTooltip);
}

function _ocultarCursorTooltip() {
    if (!_cursorTooltip) return;
    _cursorTooltip.style.display = 'none';
    document.removeEventListener('mousemove', _moverCursorTooltip);
}

function _moverCursorTooltip(e) {
    if (!_cursorTooltip) return;
    _cursorTooltip.style.left = e.clientX + 'px';
    _cursorTooltip.style.top  = e.clientY + 'px';
}

function _actualizarTextoCursorTooltip() {
    if (!_cursorTooltip) return;
    const n = _verticesActuales.length;
    if (n === 0) {
        _cursorTooltip.textContent = '\uD83C\uDFAA Clic para a\u00F1adir el 1\u00BA v\u00E9rtice';
    } else if (n === 1) {
        _cursorTooltip.textContent = '\uD83C\uDFAA 1 v\u00E9rtice \u2014 necesitas 2 m\u00E1s m\u00EDnimo';
    } else if (n === 2) {
        _cursorTooltip.textContent = '\uD83C\uDFAA 2 v\u00E9rtices \u2014 necesitas 1 m\u00E1s para poder cerrar';
    } else {
        _cursorTooltip.textContent = '\uD83C\uDFAA ' + n + ' v\u00E9rtices \u2014 clic derecho para cerrar';
    }
}

// ── Botón flotante para móvil ────────────────────────────────────────────────

/**
 * Crea el botón flotante para móvil si no existe.
 */
function _crearBotonCrearEventoMovil() {
    if (_botonCrearEventoMovil) return;

    _botonCrearEventoMovil = document.createElement('button');
    _botonCrearEventoMovil.textContent = '+ Crear';
    _botonCrearEventoMovil.style.cssText = `
        position: fixed;
        background: #8e44ad;
        color: white;
        border: none;
        border-radius: 25px;
        padding: 12px 20px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1500;
        display: none;
        pointer-events: all;
        transition: all 0.2s ease;
    `;
    _botonCrearEventoMovil.onmouseover = () => _botonCrearEventoMovil.style.transform = 'scale(1.05)';
    _botonCrearEventoMovil.onmouseout = () => _botonCrearEventoMovil.style.transform = 'scale(1)';
    _botonCrearEventoMovil.onmousedown = () => _botonCrearEventoMovil.style.transform = 'scale(0.95)';
    _botonCrearEventoMovil.onmouseup = () => _botonCrearEventoMovil.style.transform = 'scale(1.05)';

    _botonCrearEventoMovil.onclick = function(e) {
        e.stopPropagation();
        if (_verticesActuales.length < 3) {
            showNotification('⚠️ Necesitas al menos 3 vértices para cerrar el polígono.', 'warning');
            return;
        }

        // Simular el comportamiento del contextmenu (click derecho)
        _modoEvento = false;
        map.off('mousemove', _onMouseMoveEvento);
        if (_lineaSeguimiento) { map.removeLayer(_lineaSeguimiento); _lineaSeguimiento = null; }
        document.getElementById('map').classList.remove('modo-evento');

        const btn = document.getElementById('btn-crear-evento');
        if (btn) {
            btn.classList.remove('evento-activo');
            btn.textContent      = '🎪 Crear evento';
        }

        // Guardar copia de los vértices y abrir modal
        const verticesCopia = [..._verticesActuales];
        _verticesActuales = [];
        _ocultarBotonCrearEventoMovil();
        _abrirModalEvento(verticesCopia);
    };

    document.body.appendChild(_botonCrearEventoMovil);
}

/**
 * Muestra el botón flotante centrado en el polígono actual.
 */
function _mostrarBotonCrearEventoMovil() {
    if (!window.isMobile || !_modoEvento || _verticesActuales.length < 3) return;

    _crearBotonCrearEventoMovil();

    // Calcular centro del polígono
    let latSum = 0, lngSum = 0;
    _verticesActuales.forEach(v => {
        latSum += v.lat;
        lngSum += v.lng;
    });
    const centerLat = latSum / _verticesActuales.length;
    const centerLng = lngSum / _verticesActuales.length;

    // Convertir a coordenadas de pantalla
    const point = map.latLngToContainerPoint([centerLat, centerLng]);

    _botonCrearEventoMovil.style.left = (point.x - 50) + 'px'; // Centrado horizontalmente
    _botonCrearEventoMovil.style.top = (point.y - 25) + 'px';  // Centrado verticalmente
    _botonCrearEventoMovil.style.display = 'block';
}

/**
 * Oculta el botón flotante.
 */
function _ocultarBotonCrearEventoMovil() {
    if (_botonCrearEventoMovil) {
        _botonCrearEventoMovil.style.display = 'none';
    }
}

// ── Niveles de afluencia ──────────────────────────────────────────────────────

/**
 * Tabla de 4 niveles de impacto para eventos.
 * Usa la MISMA fórmula de penalización que los obstáculos:
 *   factor = 1 / (1 - obstruccion * 0.99)
 *   Nivel Amarillo → obstruccion=0.33 → factor ≈ x1.49  (Precaución)
 *   Nivel Naranja  → obstruccion=0.67 → factor ≈ x3.03  (Peligro)
 *   Nivel Rojo     → obstruccion=0.99 → factor ≈ x100   (Bloqueado)
 */
const NIVELES_EVENTO = {
    1: { obstruccion: 0.33, color: '#f1c40f', label: 'Nivel Amarillo', desc: 'Precaución' },
    2: { obstruccion: 0.67, color: '#e67e22', label: 'Nivel Naranja',  desc: 'Peligro'    },
    3: { obstruccion: 0.99, color: '#e74c3c', label: 'Nivel Rojo',     desc: 'Bloqueado'  },
};

/**
 * Devuelve el nivel (1-4) dado un valor de afluencia (0-1).
 */
function _nivelAfluencia(afluencia) {
    const ob = afluencia ?? 0.33;
    let mejor = 1, mejorDist = Infinity;
    for (const [n, cfg] of Object.entries(NIVELES_EVENTO)) {
        const d = Math.abs(cfg.obstruccion - ob);
        if (d < mejorDist) { mejorDist = d; mejor = parseInt(n); }
    }
    return mejor;
}

/**
 * Devuelve el color del nivel correspondiente a la afluencia dada.
 */
function _colorEvento(afluencia) {
    return NIVELES_EVENTO[_nivelAfluencia(afluencia)].color;
}

// ── Activar / desactivar modo dibujo ─────────────────────────────────────────

/**
 * Activa el modo de creación de eventos.
 * Solo disponible para admin; si no hay capa de vías cargada, avisa.
 */
function activarModoEvento() {
    if (window._userRol !== 'admin') {
        showNotification('Solo el administrador puede crear eventos', 'warning');
        return;
    }

    // Cancelar selección de origen/destino si estaba activa
    const habiaCancelando = window._esperandoDestino || window._esperandoOrigen;
    if (habiaCancelando) {
        window._esperandoDestino = false;
        window._esperandoOrigen  = false;
        if (typeof ocultarInstruccion === 'function') ocultarInstruccion();
    }

    // Desactivar modo obstáculo si estaba activo
    const habiaObstaculo = typeof modoObstaculo !== 'undefined' && modoObstaculo;
    if (habiaObstaculo && typeof desactivarModoObstaculo === 'function') desactivarModoObstaculo();

    _modoEvento = true;
    _verticesActuales = [];
    _limpiarPreview();

    // Cursor crosshair en el mapa
    document.getElementById('map').classList.add('modo-evento');

    // Actualizar botón
    const btn = document.getElementById('btn-crear-evento');
    if (btn) {
        btn.classList.add('evento-activo');
        const textoBtn = window.isMobile
            ? '🎪 Dibujando… (botón para cerrar)'
            : '🎪 Dibujando… (clic der. para cerrar)';
        btn.textContent = textoBtn;
    }

    const msg = window.isMobile
        ? '🎪 Toca en el mapa para añadir vértices. Cuando tengas 3+ vértices aparecerá el botón "+ Crear".'
        : (habiaCancelando || habiaObstaculo)
            ? '🎪 Modo anterior cancelado — Haz clic en el mapa para añadir vértices. Clic derecho para cerrar el polígono.'
            : '🎪 Haz clic en el mapa para añadir vértices. Clic derecho para cerrar el polígono.';
    showNotification(msg, 'info');

    // Listener de movimiento del ratón (línea de seguimiento)
    map.on('mousemove', _onMouseMoveEvento);

    // Tooltip que sigue al cursor
    _mostrarCursorTooltip();
}

/**
 * Cancela el modo dibujo sin crear nada.
 */
function desactivarModoEvento() {
    _modoEvento = false;
    _verticesActuales = [];
    _limpiarPreview();
    map.off('mousemove', _onMouseMoveEvento);
    document.getElementById('map').classList.remove('modo-evento');

    // Ocultar tooltip de cursor
    _ocultarCursorTooltip();

    // Ocultar botón flotante en móvil
    if (window.isMobile) _ocultarBotonCrearEventoMovil();

    const btn = document.getElementById('btn-crear-evento');
    if (btn) {
        btn.classList.remove('evento-activo');
        btn.textContent      = '🎪 Crear evento';
    }
}

// ── Preview mientras se dibuja ────────────────────────────────────────────────

/** Elimina todas las capas de preview del mapa. */
function _limpiarPreview() {
    if (_previewLayer)   { map.removeLayer(_previewLayer);   _previewLayer   = null; }
    if (_lineaSeguimiento) { map.removeLayer(_lineaSeguimiento); _lineaSeguimiento = null; }
    _previewMarkers.forEach(m => map.removeLayer(m));
    _previewMarkers = [];
}

/** Actualiza el polígono/polyline de preview con los vértices actuales. */
function _actualizarPreview() {
    if (_previewLayer) map.removeLayer(_previewLayer);

    const latlngs = _verticesActuales;
    if (latlngs.length < 2) {
        _previewLayer = null;
        if (window.isMobile) _ocultarBotonCrearEventoMovil();
        return;
    }

    // Con 2+ vértices dibuja una polyline; con 3+ cierra visualmente
    _previewLayer = latlngs.length >= 3
        ? L.polygon(latlngs, {
            color: '#8e44ad', weight: 2, opacity: 0.9,
            fillColor: '#8e44ad', fillOpacity: 0.15,
            dashArray: '8, 6', interactive: false
        }).addTo(map)
        : L.polyline(latlngs, {
            color: '#8e44ad', weight: 2, opacity: 0.9,
            dashArray: '8, 6', interactive: false
        }).addTo(map);

    // Actualizar posición del botón flotante en móvil
    if (window.isMobile && latlngs.length >= 3) {
        _mostrarBotonCrearEventoMovil();
    }
}

/**
 * Dibuja la línea de seguimiento desde el último vértice al cursor.
 * @param {L.MouseEvent} e
 */
function _onMouseMoveEvento(e) {
    if (!_modoEvento || !_verticesActuales.length) return;
    if (_lineaSeguimiento) map.removeLayer(_lineaSeguimiento);
    const ultimo = _verticesActuales[_verticesActuales.length - 1];
    _lineaSeguimiento = L.polyline([ultimo, e.latlng], {
        color: '#8e44ad', weight: 1.5, opacity: 0.6, dashArray: '4, 4',
        interactive: false
    }).addTo(map);
}

// ── Handlers de clic en el mapa ──────────────────────────────────────────────

/**
 * Añade un vértice al polígono en construcción (clic izquierdo en modo evento).
 * Se inyecta en el listener principal de map.on('click') de route-manager.js
 * a través de la función window._eventoClickHandler expuesta más abajo.
 */
window._eventoClickHandler = function (e) {
    if (!_modoEvento) return false; // no consumido

    _verticesActuales.push(e.latlng);

    // Marker de vértice (non-interactive para que contextmenu llegue al mapa)
    const m = L.circleMarker(e.latlng, {
        radius: 5, color: '#8e44ad', fillColor: '#fff',
        fillOpacity: 1, weight: 2,
        interactive: false
    }).addTo(map);
    _previewMarkers.push(m);

    _actualizarPreview();
    _actualizarTextoCursorTooltip();

    const n = _verticesActuales.length;
    if (n === 1) {
        const msg = window.isMobile
            ? '📍 Primer vértice. Sigue tocando para añadir más.'
            : '📍 Primer vértice. Sigue haciendo clic para añadir más.';
        showNotification(msg, 'info');
    } else if (n === 2) {
        const msg = window.isMobile
            ? '📍 Vértice 2 añadido. Añade uno más para poder cerrar.'
            : '📍 Vértice 2 añadido. Añade uno más para poder cerrar.';
        showNotification(msg, 'info');
    } else if (n === 3) {
        const msg = window.isMobile
            ? '📍 Vértice 3 añadido. Ya puedes cerrar el polígono con el botón "+ Crear".'
            : '📍 Vértice 3 añadido. Ya puedes cerrar el polígono con clic derecho.';
        showNotification(msg, 'info');
        if (window.isMobile) _mostrarBotonCrearEventoMovil();
    } else {
        const msg = window.isMobile
            ? `📍 Vértice ${n} añadido.`
            : `📍 Vértice ${n} añadido.`;
        showNotification(msg, 'info');
        if (window.isMobile) _mostrarBotonCrearEventoMovil();
    }

    return true; // consumido: route-manager no procesará este clic
};

/**
 * Cierra el polígono con clic derecho y abre el modal de atributos.
 */
map.on('contextmenu', function (e) {
    if (!_modoEvento) return;

    if (_verticesActuales.length < 3) {
        showNotification('⚠️ Necesitas al menos 3 vértices para cerrar el polígono.', 'warning');
        return;
    }

    // Desactivar modo dibujo (limpia preview y listeners)
    _modoEvento = false;
    map.off('mousemove', _onMouseMoveEvento);
    if (_lineaSeguimiento) { map.removeLayer(_lineaSeguimiento); _lineaSeguimiento = null; }
    document.getElementById('map').classList.remove('modo-evento');

    // Ocultar botón flotante en móvil
    if (window.isMobile) _ocultarBotonCrearEventoMovil();

    const btn = document.getElementById('btn-crear-evento');
    if (btn) {
        btn.classList.remove('evento-activo');
        btn.textContent      = '🎪 Crear evento';
    }

    // Guardar copia de los vértices y abrir modal
    const verticesCopia = [..._verticesActuales];
    _verticesActuales = [];
    _abrirModalEvento(verticesCopia);
});

// ── Modal de atributos ────────────────────────────────────────────────────────

/** Vértices temporales hasta que el usuario confirme el modal. */
let _verticesPendientes = null;

/**
 * Marca visualmente el nivel seleccionado en el modal y guarda el valor
 * en el input oculto #ev-nivel-value.
 * @param {number} nivel  1-3
 */
function _seleccionarNivelEvento(nivel) {
    const info = NIVELES_EVENTO[nivel];
    if (!info) return;

    // Actualizar input oculto
    const hidden = document.getElementById('ev-nivel-value');
    if (hidden) hidden.value = nivel;

    // Actualizar botones
    for (let n = 1; n <= 3; n++) {
        const btn = document.getElementById(`ev-nivel-btn-${n}`);
        if (!btn) continue;
        const activo = (n === nivel);
        btn.style.background   = activo ? NIVELES_EVENTO[n].color : '#f1f5f9';
        btn.style.color        = activo ? (n === 1 ? '#333' : '#fff') : '#374151';
        btn.style.borderColor  = activo ? NIVELES_EVENTO[n].color : '#e2e8f0';
        btn.style.fontWeight   = activo ? '700' : '500';
        btn.style.transform    = activo ? 'scale(1.05)' : 'scale(1)';
    }

    // Actualizar descripción
    const desc = document.getElementById('ev-nivel-desc');
    if (desc) {
        desc.textContent  = `${info.label} — ${info.desc}  (factor x${(1/(1-info.obstruccion*0.99)).toFixed(1)})`;
        desc.style.color  = info.color;
    }
}

/**
 * Abre el modal para introducir los atributos del evento.
 * @param {L.LatLng[]} vertices
 */
function _abrirModalEvento(vertices) {
    _verticesPendientes = vertices;
    _limpiarPreview();

    // Ocultar botón flotante en móvil
    if (window.isMobile) _ocultarBotonCrearEventoMovil();

    // Mostrar preview definitivo (sin trazo, no interactivo)
    _previewLayer = L.polygon(vertices, {
        color: '#8e44ad', weight: 2, opacity: 0.8,
        fillColor: '#8e44ad', fillOpacity: 0.12,
        interactive: false
    }).addTo(map);

    // Rellenar fecha/hora con ahora como valor por defecto
    const ahora = new Date();
    const fechaStr = ahora.toISOString().slice(0, 10);
    const horaStr  = ahora.toTimeString().slice(0, 5);

    const elFecha = document.getElementById('ev-fecha');
    const elHora  = document.getElementById('ev-hora');
    if (elFecha) elFecha.value = fechaStr;
    if (elHora)  elHora.value  = horaStr;

    // Limpiar campos
    const elNombre    = document.getElementById('ev-nombre');
    const elDuracion  = document.getElementById('ev-duracion');
    if (elNombre)   elNombre.value   = '';
    if (elDuracion) elDuracion.value = 2;

    // Seleccionar nivel 1 (Amarillo) por defecto
    _seleccionarNivelEvento(1);

    document.getElementById('evento-modal').style.display = 'flex';
}

/** Cierra el modal y descarta el polígono pendiente. */
function cerrarModalEvento() {
    document.getElementById('evento-modal').style.display = 'none';
    _limpiarPreview();
    _verticesPendientes = null;
    // Asegura que el botón del panel MSW vuelve al estado inactivo
    if (typeof desactivarModoEvento === 'function') desactivarModoEvento();
}

/** Confirma el modal y crea el evento. */
function confirmarEvento() {
    const nombre    = document.getElementById('ev-nombre')?.value.trim();
    const fechaStr  = document.getElementById('ev-fecha')?.value;
    const horaStr   = document.getElementById('ev-hora')?.value   || '00:00';
    const nivel     = parseInt(document.getElementById('ev-nivel-value')?.value ?? 1, 10);
    const afluencia = NIVELES_EVENTO[nivel]?.obstruccion ?? 0.33;
    const duracion  = parseFloat(document.getElementById('ev-duracion')?.value ?? 2);

    // Helper: marca un campo en rojo, muestra notificación y hace foco
    function _campoError(id, msg) {
        const el = document.getElementById(id);
        if (el) {
            el.style.borderColor = '#e74c3c';
            el.style.boxShadow   = '0 0 0 2px rgba(231,76,60,.25)';
            el.focus();
            // Quitar el rojo al editar
            el.addEventListener('input', () => {
                el.style.borderColor = '';
                el.style.boxShadow   = '';
            }, { once: true });
        }
        showNotification(msg, 'warning');
    }

    // Validaciones
    if (!nombre) {
        _campoError('ev-nombre', '⚠️ Introduce un nombre para el evento.');
        return;
    }
    if (!fechaStr) {
        _campoError('ev-fecha', '⚠️ Selecciona la fecha del evento.');
        return;
    }
    const fechaInicio = new Date(`${fechaStr}T${horaStr}:00`);
    if (isNaN(fechaInicio.getTime())) {
        _campoError('ev-hora', '⚠️ Fecha u hora no válidas.');
        return;
    }
    if (isNaN(duracion) || duracion <= 0) {
        _campoError('ev-duracion', '⚠️ La duración debe ser mayor que 0.');
        return;
    }

    if (!_verticesPendientes || _verticesPendientes.length < 3) {
        showNotification('⚠️ Error interno: no hay polígono dibujado.', 'warning');
        return;
    }

    document.getElementById('evento-modal').style.display = 'none';
    
    // Limpiar el polígono preview antes de crear el evento final
    _limpiarPreview();
    
    _crearEvento(_verticesPendientes, nombre, fechaInicio, afluencia, duracion);
    _verticesPendientes = null;
    desactivarModoEvento();
}

// ── Creación del evento ───────────────────────────────────────────────────────

/**
 * Crea y registra un evento en el mapa.
 *
 * @param {L.LatLng[]} vertices    - Vértices del polígono
 * @param {string}     nombre      - Nombre descriptivo
 * @param {Date}       fechaInicio - Fecha y hora de inicio
 * @param {number}     afluencia   - 0-1 (proporción de afluencia máxima)
 * @param {number}     duracion    - Duración en horas
 */
function _crearEvento(vertices, nombre, fechaInicio, afluencia, duracion) {
    const color = _colorEvento(afluencia);

    // Polígono principal
    const poligono = L.polygon(vertices, {
        color, weight: 2.5, opacity: 0.85,
        fillColor: color, fillOpacity: 0.20
    }).addTo(map);

    // Etiqueta centrada
    const centro  = poligono.getBounds().getCenter();

    const label   = L.marker(centro, {
        icon: L.divIcon({
            className: '',
            html: `<div style="
                background:${color};color:${afluencia < 0.5 ? '#333' : '#fff'};border-radius:6px;
                padding:3px 8px;font-size:12px;font-weight:700;
                box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap;
                pointer-events:none;">
                🎪 ${nombre}
            </div>`,
            iconAnchor: [0, 0]
        }),
        interactive: false
    }).addTo(map);

    // Fecha fin
    const fechaFin = new Date(fechaInicio.getTime() + duracion * 3600000);

    const idx   = eventos.length;
    const evento = {
        idx, nombre, fechaInicio, fechaFin, afluencia, duracion,
        vertices, poligono, label,
        // Guardamos el polígono de Leaflet para intersección
        bounds: poligono.getBounds()
    };
    eventos.push(evento);

    // Popup con info y botón eliminar
    poligono.bindPopup(_popupEventoHTML(idx));
    poligono.on('popupopen', () => {
        // Re-bind para actualizar si se modificó
        poligono.setPopupContent(_popupEventoHTML(idx));
    });

    _actualizarListaEventos();
    const nivel = _nivelAfluencia(afluencia);
    showNotification(`✅ Evento "${nombre}" creado (Nivel ${nivel} — ${NIVELES_EVENTO[nivel].desc}, ${duracion}h)`, 'success');
}

// ── HTML del popup ────────────────────────────────────────────────────────────

function _popupEventoHTML(idx) {
    const ev   = eventos[idx];
    if (!ev) return '';
    const nivel = _nivelAfluencia(ev.afluencia);
    const info  = NIVELES_EVENTO[nivel];
    const color = info.color;
    const _fmt  = d => d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

    return `
        <div style="font-family:var(--font-base,sans-serif);min-width:200px;font-size:13px;">
            <strong style="font-size:14px;">🎪 ${ev.nombre}</strong>
            <hr style="margin:6px 0;border:none;border-top:1px solid #eee;">
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;color:#555;">
                <span>📅 Inicio</span>  <span>${_fmt(ev.fechaInicio)}</span>
                <span>🏁 Fin</span>     <span>${_fmt(ev.fechaFin)}</span>
                <span>⏱️ Duración</span><span>${ev.duracion}h</span>
                <span>👥 Impacto</span>
                <span style="color:${color};font-weight:700;">${info.label} — ${info.desc}</span>
            </div>
            <button onclick="eliminarEvento(${idx})"
                style="margin-top:10px;width:100%;padding:6px;background:#e74c3c;
                       color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                🗑️ Eliminar evento
            </button>
        </div>`;
}

// ── Eliminar evento ───────────────────────────────────────────────────────────

/**
 * Elimina un evento del mapa y del array.
 * @param {number} idx
 */
function eliminarEvento(idx) {
    const ev = eventos[idx];
    if (!ev) return;
    
    // Cerrar y desvincular popup antes de quitar la capa
    // (evita que el listener 'popupopen' intente acceder al evento ya eliminado)
    if (ev.poligono) {
        ev.poligono.off();
        ev.poligono.unbindPopup();
        if (map.hasLayer(ev.poligono)) map.removeLayer(ev.poligono);
    }
    
    if (ev.label && map.hasLayer(ev.label)) {
        map.removeLayer(ev.label);
    }
    
    // Cerrar popup si está abierto (por si acaso)
    map.closePopup();
    
    eventos[idx] = null;
    _actualizarListaEventos();
    showNotification(`Evento "${ev.nombre}" eliminado`, 'info');
}

/** Elimina todos los eventos del mapa. */
function limpiarEventos() {
    eventos.forEach(ev => {
        if (!ev) return;
        if (ev.poligono) {
            ev.poligono.off();
            ev.poligono.unbindPopup();
            if (map.hasLayer(ev.poligono)) map.removeLayer(ev.poligono);
        }
        if (ev.label && map.hasLayer(ev.label)) {
            map.removeLayer(ev.label);
        }
    });
    map.closePopup();
    eventos = [];
    _actualizarListaEventos();
    showNotification('Todos los eventos eliminados', 'info');
}

// ── Lista de eventos en el panel ──────────────────────────────────────────────

/** Actualiza el panel izquierdo y el panel flotante con la lista de eventos activos. */
function _actualizarListaEventos() {
    const lista     = document.getElementById('lista-eventos');
    const vacia     = document.getElementById('lista-eventos-vacia');
    const contador  = document.getElementById('eventos-contador');

    // ── Panel flotante ──
    const panelFlotante    = document.getElementById('eventos-panel-flotante');
    const listaFlotante    = document.getElementById('ev-flotante-lista');
    const contadorFlotante = document.getElementById('ev-flotante-contador');

    const activos = eventos.filter(Boolean);
    const esAdmin = window._userRol === 'admin';

    // ── Panel flotante: visible si hay eventos y es admin ──
    if (contadorFlotante) contadorFlotante.textContent = activos.length;
    if (listaFlotante)    listaFlotante.innerHTML      = '';
    if (panelFlotante) {
        const mostrar = activos.length > 0 && esAdmin;
        panelFlotante.style.display = mostrar ? 'flex' : 'none';
        // Reposicionar siempre que cambie visibilidad o contenido
        if (mostrar) setTimeout(_reposicionarPanelEventos, 0);
    }

    // ── Layer-item en panel izquierdo ──
    const layerItem    = document.getElementById('layer-eventos');
    const layerDesc    = document.getElementById('eventos-layer-desc');
    const btnTabla     = document.getElementById('btn-tabla-eventos-layer');
    const importExport = document.getElementById('eventos-import-export-top');
    if (layerItem)    layerItem.style.display    = esAdmin ? '' : 'none';
    if (layerDesc)    layerDesc.textContent      = activos.length > 0
        ? `${activos.length} evento(s) activo(s)` : 'Sin cargar';
    if (btnTabla)     btnTabla.style.display     = activos.length > 0 ? '' : 'none';
    if (importExport) importExport.style.display = esAdmin ? 'flex' : 'none';

    // Limpiar panel lateral (oculto, solo para compatibilidad interna)
    if (lista) lista.innerHTML = '';
    if (vacia) vacia.style.display = 'none';
    if (contador) contador.textContent = activos.length;

    const _fmt = d => d.toLocaleString('es-ES', {
        day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
    });

    activos.forEach(ev => {
        const nivel = _nivelAfluencia(ev.afluencia);
        const info  = NIVELES_EVENTO[nivel];
        const color = info.color;

        // ── Item panel lateral ──
        if (lista) {
            const item = document.createElement('div');
            item.className = 'evento-item obs-item';
            item.innerHTML = `
                <div class="obs-item-header">
                    <div class="obs-item-titulo">
                        <strong>🎪 ${ev.nombre}</strong>
                        <span style="color:${color};margin-left:6px;font-weight:700;">${info.label}</span>
                    </div>
                    <button class="obs-item-del" onclick="eliminarEvento(${ev.idx})" title="Eliminar">✕</button>
                </div>
                <div class="obs-item-sub" style="font-size:11px;color:#7f8c8d;">
                    📅 ${_fmt(ev.fechaInicio)} → ${_fmt(ev.fechaFin)} · ⏱️ ${ev.duracion}h
                </div>`;
            item.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                map.fitBounds(ev.poligono.getBounds(), { padding: [40, 40] });
                ev.poligono.openPopup();
            });
            lista.appendChild(item);
        }

        // ── Item panel flotante ──
        if (listaFlotante) {
            const fitem = document.createElement('div');
            fitem.className = 'ev-flotante-item';
            fitem.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                    <span style="font-size:13px;font-weight:700;color:#2c3e50;flex:1;
                                 overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        🎪 ${ev.nombre}
                    </span>
                    <span style="color:${color};font-weight:700;font-size:12px;white-space:nowrap;">${info.label}</span>
                    <button onclick="eliminarEvento(${ev.idx})"
                        style="background:none;border:none;color:#aab0b7;font-size:14px;
                               cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;"
                        onmouseover="this.style.color='#e74c3c'"
                        onmouseout="this.style.color='#aab0b7'"
                        title="Eliminar">✕</button>
                </div>
                <div style="font-size:11px;color:#7f8c8d;margin-top:3px;">
                    📅 ${_fmt(ev.fechaInicio)} → ${_fmt(ev.fechaFin)} · ⏱️ ${ev.duracion}h
                </div>`;
            fitem.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                map.fitBounds(ev.poligono.getBounds(), { padding: [40, 40] });
                ev.poligono.openPopup();
            });
            listaFlotante.appendChild(fitem);
        }
    });
}

// ── Exportar / Importar eventos ──────────────────────────────────────────────

/**
 * Exporta todos los eventos activos como GeoPackage (.gpkg) vía el backend.
 * El polígono de cada evento se convierte en geometría Polygon.
 */
async function exportarEventos(options = {}) {
    const activos = eventos.filter(Boolean);
    if (!activos.length) {
        showNotification('No hay eventos que exportar', 'info');
        return;
    }

    const formato = (options.formato || 'gpkg').toLowerCase();
    const payload = activos.map(ev => ({
        vertices:     ev.vertices.map(v => [v.lng, v.lat]),  // [lon, lat] para GeoJSON
        nombre:       ev.nombre,
        fecha_inicio: ev.fechaInicio.toISOString(),
        fecha_fin:    ev.fechaFin.toISOString(),
        afluencia:    ev.afluencia,   // valor obstruccion 0-1 (mismo sistema que obstáculos)
        duracion:     ev.duracion,
    }));

    try {
        showNotification('⏳ Generando archivo...', 'info');
        const resp = await fetch('/api/exportar-eventos', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ eventos: payload, formato }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showNotification('Error: ' + (err.error || resp.status), 'error');
            return;
        }
        const blob = await resp.blob();
        const ext  = formato === 'shp' ? 'zip' : 'gpkg';
        const defaultName = formato === 'shp'
            ? `eventos_${new Date().toISOString().slice(0,10)}.zip`
            : `eventos_${new Date().toISOString().slice(0,10)}.gpkg`;
        const nombre = options.filename || defaultName;

        if (options.fileHandle) {
            const success = await guardarBlobEnHandle(blob, options.fileHandle);
            if (!success) return;
        } else {
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = nombre;
            a.click();
            URL.revokeObjectURL(url);
        }

        const tipo = formato === 'shp' ? 'Shapefile (.zip)' : 'GeoPackage (.gpkg)';
        showNotification(`${activos.length} evento(s) exportado(s) como ${tipo}`, 'success');
    } catch (err) {
        showNotification('Error al exportar: ' + err.message, 'error');
    }
}

function abrirModalExportacionEventos() {
    const modal = document.getElementById('export-eventos-modal');
    const formatoSelect = document.getElementById('export-eventos-formato-select');
    const filepathInput = document.getElementById('export-eventos-filepath-input');
    if (!modal || !formatoSelect || !filepathInput) return;
    const fecha = new Date().toISOString().slice(0,10);
    formatoSelect.value = 'gpkg';
    filepathInput.value = `eventos_${fecha}.gpkg`;
    _eventosExportHandle = null;
    modal.style.display = 'flex';
    setTimeout(() => formatoSelect.focus(), 80);
}

function cerrarModalExportacionEventos() {
    const modal = document.getElementById('export-eventos-modal');
    if (modal) modal.style.display = 'none';
}

function cambiarFormatoExportacionEventos() {
    const formatoSelect = document.getElementById('export-eventos-formato-select');
    const filepathInput = document.getElementById('export-eventos-filepath-input');
    if (!formatoSelect || !filepathInput) return;
    let valor = filepathInput.value.trim();
    if (!valor) valor = `eventos_${new Date().toISOString().slice(0,10)}.${formatoSelect.value === 'shp' ? 'zip' : 'gpkg'}`;
    valor = valor.replace(/\.(gpkg|zip)$/i, '');
    filepathInput.value = `${valor}.${formatoSelect.value === 'shp' ? 'zip' : 'gpkg'}`;
    _eventosExportHandle = null;
}

async function explorarRutaExportacionEventos() {
    const formatoSelect = document.getElementById('export-eventos-formato-select');
    const filepathInput = document.getElementById('export-eventos-filepath-input');
    if (!formatoSelect || !filepathInput) return;
    const formato = formatoSelect.value;
    const ext     = formato === 'shp' ? '.zip' : '.gpkg';
    const sugerido = filepathInput.value.trim() || `eventos_${new Date().toISOString().slice(0,10)}${ext}`;

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: sugerido,
                types: [{
                    description: formato === 'shp' ? 'Shapefile (ZIP)' : 'GeoPackage',
                    accept: formato === 'shp'
                        ? { 'application/zip': ['.zip'] }
                        : { 'application/geopackage+sqlite3': ['.gpkg'] }
                }],
                excludeAcceptAllOption: true,
            });
            _eventosExportHandle = handle;
            filepathInput.value = handle.name || sugerido;
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
        }
        return;
    }

    showNotification('El navegador no admite exploración de archivos directa. Escribe un nombre de archivo válido y presiona Exportar.', 'warning');
}

function obtenerNombreArchivoExportacionEventos() {
    const filepathInput = document.getElementById('export-eventos-filepath-input');
    const formatoSelect = document.getElementById('export-eventos-formato-select');
    const formato = formatoSelect?.value || 'gpkg';
    let nombre = filepathInput?.value.trim() || '';
    if (!nombre) nombre = `eventos_${new Date().toISOString().slice(0,10)}.${formato === 'shp' ? 'zip' : 'gpkg'}`;
    if (!/\.(gpkg|zip)$/i.test(nombre)) nombre = `${nombre}.${formato === 'shp' ? 'zip' : 'gpkg'}`;
    nombre = nombre.replace(/[\\/:*?"<>|]+/g, '_');
    return nombre;
}

async function confirmarExportacionEventos() {
    const formato = document.getElementById('export-eventos-formato-select')?.value || 'gpkg';
    const filename = obtenerNombreArchivoExportacionEventos();
    const handle = _eventosExportHandle;
    cerrarModalExportacionEventos();
    await exportarEventos({ fileHandle: handle, filename, formato });
}

/**
 * Importa eventos desde un .gpkg, .geojson, .zip (shapefile) o .shp.
 * Llama al endpoint /api/importar-eventos del backend.
 * @param {HTMLInputElement} input
 */
function importarEventos(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    input.value = '';

    showNotification('⏳ Importando eventos...', 'info');
    fetch('/api/importar-eventos', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showNotification('Error: ' + data.error, 'error'); return; }
            const evs = data.eventos || [];
            if (!evs.length) { showNotification('No se encontraron eventos válidos', 'warning'); return; }
            evs.forEach(ev => {
                try {
                    const vertices    = ev.vertices.map(([lon, lat]) => L.latLng(lat, lon));
                    const fechaInicio = new Date(ev.fecha_inicio);
                    const fechaFin    = new Date(ev.fecha_fin);
                    const duracion    = (fechaFin - fechaInicio) / 3600000;
                    const afluencia   = (typeof ev.afluencia === 'number' && ev.afluencia <= 1)
                        ? ev.afluencia
                        : (ev.afluencia ?? 50) / 100;  // compatibilidad con archivos viejos
                    _crearEvento(vertices, ev.nombre, fechaInicio, afluencia, duracion);
                } catch (e) {
                    console.warn('[event-manager] Error al importar evento:', e);
                }
            });
            showNotification(`${evs.length} evento(s) importado(s)`, 'success');
        })
        .catch(err => showNotification('Error al importar: ' + err.message, 'error'));
}

// ── Integración con calcularRuta ──────────────────────────────────────────────

/**
 * Comprueba si un segmento de vía [s, e] (formato [lon,lat]) está dentro
 * de algún evento activo en la fechaEfectiva dada y devuelve el factor de
 * penalización resultante (≥ 1.0).
 *
 * Factor de penalización:
 *   factor = 1 / (1 - afluencia * 0.99)   — idéntica a la fórmula de obstáculos en app.py
 *   → Nivel Amarillo (0.33) → x1.49
 *   → Nivel Naranja  (0.67) → x3.03
 *   → Nivel Rojo     (0.99) → x100  (prácticamente bloqueado)
 *
 * Se expone como window.obtenerPenalizacionEventos para ser llamada desde
 * _calcularPesosAristas() en route-manager.js.
 *
 * @param {number[]} s             - [lon, lat] del inicio del segmento
 * @param {number[]} e             - [lon, lat] del fin del segmento
 * @param {Date}     fechaEfectiva - Momento del viaje
 * @returns {number}               Factor multiplicador (≥ 1.0)
 */
window.obtenerPenalizacionEventos = function (s, e, fechaEfectiva) {
    const activos = eventos.filter(Boolean);
    if (!activos.length) return 1.0;

    // Punto medio del segmento (suficiente para la mayoría de casos)
    const midLat = (s[1] + e[1]) / 2;
    const midLon = (s[0] + e[0]) / 2;
    const midPt  = L.latLng(midLat, midLon);

    let factorMax = 1.0;

    for (const ev of activos) {
        // Comprobar ventana temporal
        if (fechaEfectiva < ev.fechaInicio || fechaEfectiva >= ev.fechaFin) continue;

        // Comprobar si el punto medio está dentro del polígono
        if (!_puntoDentroDePoligono(midPt, ev.vertices)) continue;

        // Misma fórmula que el backend usa para obstáculos:
        // factor = 1 / (1 - afluencia * 0.99)
        const factor = 1.0 / (1.0 - Math.min(ev.afluencia, 0.99) * 0.99);  // ev.afluencia ES obstruccion (0-1)
        if (factor > factorMax) factorMax = factor;
        console.log(`[event-manager] Evento "${ev.nombre}" activo, factor ${factor} para segmento ${s}→${e}`);
    }

    return factorMax;
};

/**
 * Algoritmo ray-casting para comprobar si un punto está dentro de un polígono.
 * @param {L.LatLng}   punto    - Punto a comprobar
 * @param {L.LatLng[]} vertices - Vértices del polígono
 * @returns {boolean}
 */
function _puntoDentroDePoligono(punto, vertices) {
    const x = punto.lng;
    const y = punto.lat;
    let dentro = false;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = vertices[i].lng, yi = vertices[i].lat;
        const xj = vertices[j].lng, yj = vertices[j].lat;
        const intersecta = ((yi > y) !== (yj > y)) &&
                           (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersecta) dentro = !dentro;
    }
    return dentro;
}

// ── Parche sobre calcularRuta ─────────────────────────────────────────────────

/**
 * Extiende _calcularPesosAristas para que, después de calcular el peso base
 * de cada arista, lo multiplique por el factor de evento si corresponde.
 *
 * Se aplica monkey-patching sobre la función original de route-manager.js
 * una vez que ambos scripts han cargado.
 *
 * La fecha efectiva se lee de obtenerFechaEfectiva() (route-manager.js).
 */
(function _parchearPesosAristas() {
    // Esperar a que route-manager.js haya definido _calcularPesosAristas
    const MAX_INTENTOS = 20;
    let intentos = 0;

    function intentarParchear() {
        if (typeof _calcularPesosAristas !== 'function') {
            if (++intentos < MAX_INTENTOS) setTimeout(intentarParchear, 150);
            else console.warn('[event-manager] No se pudo parchear _calcularPesosAristas.');
            return;
        }

        const _original = _calcularPesosAristas;

        // Sobreescribir en el scope global para que cualquier llamada global use la versión parcheada.
        const patched = function () {
            const pesos = _original();

            // Si no hay eventos activos, devolver sin modificar
            if (!eventos.filter(Boolean).length) return pesos;

            const fechaEfectiva = (typeof obtenerFechaEfectiva === 'function')
                ? obtenerFechaEfectiva()
                : new Date();

            return pesos.map(p => {
                const factorEvento = window.obtenerPenalizacionEventos(p.s, p.e, fechaEfectiva);
                if (factorEvento === 1.0) return p;
                console.log(`[event-manager] Penalizando segmento ${p.s}→${p.e} con factor ${factorEvento}`);
                return {
                    ...p,
                    peso:       p.peso       * factorEvento,
                    tiempo_min: p.tiempo_min * factorEvento,
                    factor_evento: factorEvento,
                };
            });
        };

        window._calcularPesosAristas = _calcularPesosAristas = patched;

        console.log('[event-manager] ✅ _calcularPesosAristas parcheada con penalización de eventos.');
    }

    setTimeout(intentarParchear, 100);
})();

// ── Nota sobre clicks ────────────────────────────────────────────────────────
// El handler de clic del mapa está en map-widgets.js, que comprueba
// window._modoEvento y llama a window._eventoClickHandler cuando está activo.
// No se registra un listener adicional aquí para evitar dobles llamadas.


// ── Posicionamiento del panel de eventos debajo del de obstáculos ──────────

function _reposicionarPanelEventos() {
    const obs = document.getElementById('obstaculos-panel-flotante');
    const ev  = document.getElementById('eventos-panel-flotante');
    if (!ev) return;
    if (!obs || obs.style.display === 'none' || obs.style.display === '') {
        ev.style.top = '122px';
    } else {
        const rect = obs.getBoundingClientRect();
        ev.style.top = (rect.bottom + 8) + 'px';
    }
}

(function _observarPanelObstaculos() {
    function iniciar() {
        const obs = document.getElementById('obstaculos-panel-flotante');
        if (!obs) { setTimeout(iniciar, 100); return; }
        new ResizeObserver(_reposicionarPanelEventos).observe(obs);
        new MutationObserver(_reposicionarPanelEventos)
            .observe(obs, { attributes: true, attributeFilter: ['style'] });
        window.addEventListener('resize', _reposicionarPanelEventos);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();

// ── Visibilidad de la capa de eventos (checkbox del panel izquierdo) ──────────

/**
 * Muestra u oculta todos los polígonos/etiquetas de eventos en el mapa.
 * Se engancha al sistema genérico toggleLayerVisibility('eventos', checked)
 * parcheándolo una vez que el script que lo define haya cargado.
 */
(function _parchearToggleEventos() {
    const MAX = 20;
    let intentos = 0;

    function intentar() {
        if (typeof toggleLayerVisibility !== 'function') {
            if (++intentos < MAX) setTimeout(intentar, 150);
            return;
        }
        const _orig = toggleLayerVisibility;
        window.toggleLayerVisibility = function(capa, visible) {
            if (capa === 'eventos') {
                eventos.filter(Boolean).forEach(ev => {
                    if (visible) {
                        if (!map.hasLayer(ev.poligono)) map.addLayer(ev.poligono);
                        if (!map.hasLayer(ev.label))   map.addLayer(ev.label);
                    } else {
                        if (map.hasLayer(ev.poligono)) map.removeLayer(ev.poligono);
                        if (map.hasLayer(ev.label))    map.removeLayer(ev.label);
                    }
                });
                return;
            }
            return _orig(capa, visible);
        };
        console.log('[event-manager] ✅ toggleLayerVisibility parcheada para eventos.');
    }
    setTimeout(intentar, 100);
})();

// ── Refrescar panel izquierdo al cambiar de rol (login/logout) ───────────────
(function _observarRol() {
    let _rolActual = window._userRol;
    Object.defineProperty(window, '_userRol', {
        get: () => _rolActual,
        set: v  => {
            _rolActual = v;
            // Actualizar visibilidad de layer-item e import/export sin esperar eventos
            _actualizarListaEventos();
        },
        configurable: true,
    });
})();