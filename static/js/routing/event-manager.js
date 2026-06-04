/**
 * event-manager.js
 * Gestión de eventos especiales (marchas, conciertos, etc.) definidos como
 * polígonos en el mapa. Cada evento tiene fecha, afluencia y duración.
 *
 * Flujo de creación:
 *   1. Admin pulsa "Crear evento" -> modo dibujo activo
 *   2. Clicks en el mapa añaden vértices (preview en tiempo real)
 *   3. Click derecho cierra el polígono
 *   4. Modal pide: nombre, fecha/hora inicio, afluencia (0-100%), duración (h)
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
let eventosExportHandle = null;

/** true mientras el admin está dibujando un polígono nuevo. */
let modoEvento = false;
// Alias global para que map-widgets.js pueda consultarlo
Object.defineProperty(window, 'modoEvento', {
    get: () => modoEvento,
    set: v  => { modoEvento = v; }
});

/** Vértices del polígono en construcción [ L.LatLon, … ] */
let verticesActuales = [];

/** Polyline/Polygon de preview mientras se dibuja. */
let preCapa = null;

/** Marcadores de los vértices mientras se dibuja. */
let preVertices = [];

/** L.LatLon del último vértice (para la línea de seguimiento al mover el ratón). */
let lineaSeguimiento = null;

/** Botón flotante para cerrar polígono en móvil */
let botonCrearEventoMovil = null;

/** Tooltip que sigue al cursor durante el modo dibujo */
let cursorTooltip = null;

function crearCursorTooltip() {
    if (cursorTooltip) return;
    cursorTooltip = document.createElement('div');
    cursorTooltip.id = 'evento-cursor-tooltip';
    cursorTooltip.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:9999',
        'background:rgba(30,20,40,0.82)',
        'color:#fff',
        'font-size:12px',
        'font-family:Segoe UI,system-ui,sans-serif',
        'font-weight:500',
        'padding:5px 10px',
        'border-radius:6px',
        'white-space:nowrap',
        'display:none',
        'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
        'border-left:3px solid #8e44ad',
        'transform:translate(16px,12px)',
    ].join(';');
    document.body.appendChild(cursorTooltip);
}

function mostrarCursorTooltip() {
    if (window.isMobile) return;
    crearCursorTooltip();
    actualizarTextoCursorTooltip();
    cursorTooltip.style.display = 'block';
    document.addEventListener('mousemove', moverCursorTooltip);
}

function ocultarCursorTooltip() {
    if (!cursorTooltip) return;
    cursorTooltip.style.display = 'none';
    document.removeEventListener('mousemove', moverCursorTooltip);
}

function moverCursorTooltip(e) {
    if (!cursorTooltip) return;
    cursorTooltip.style.left = e.clientX + 'px';
    cursorTooltip.style.top  = e.clientY + 'px';
}

function actualizarTextoCursorTooltip() {
    if (!cursorTooltip) return;
    const n = verticesActuales.length;
    if (n === 0) {
        cursorTooltip.textContent = '\uD83C\uDFAA Clic para a\u00F1adir el 1\u00BA v\u00E9rtice';
    } else if (n === 1) {
        cursorTooltip.textContent = '\uD83C\uDFAA 1 v\u00E9rtice \u2014 necesitas 2 m\u00E1s m\u00EDnimo';
    } else if (n === 2) {
        cursorTooltip.textContent = '\uD83C\uDFAA 2 v\u00E9rtices \u2014 necesitas 1 m\u00E1s para poder cerrar';
    } else {
        cursorTooltip.textContent = '\uD83C\uDFAA ' + n + ' v\u00E9rtices \u2014 clic derecho para cerrar';
    }
}

// ── Botón flotante para móvil ────────────────────────────────────────────────

/**
 * Crea el botón flotante para móvil si no existe.
 */
function crearBotonCrearEventoMovil() {
    if (botonCrearEventoMovil) return;

    botonCrearEventoMovil = document.createElement('button');
    botonCrearEventoMovil.textContent = '+ Crear';
    botonCrearEventoMovil.style.cssText = `
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
    botonCrearEventoMovil.onmouseover = () => botonCrearEventoMovil.style.transform = 'scale(1.05)';
    botonCrearEventoMovil.onmouseout = () => botonCrearEventoMovil.style.transform = 'scale(1)';
    botonCrearEventoMovil.onmousedown = () => botonCrearEventoMovil.style.transform = 'scale(0.95)';
    botonCrearEventoMovil.onmouseup = () => botonCrearEventoMovil.style.transform = 'scale(1.05)';

    botonCrearEventoMovil.onclick = function(e) {
        e.stopPropagation();
        if (verticesActuales.length < 3) {
            showNotification('⚠️ Necesitas al menos 3 vértices para cerrar el polígono.', 'warning');
            return;
        }

        // Simular el comportamiento del contextmenu (click derecho)
        modoEvento = false;
        map.off('mousemove', sobreRaton);
        if (lineaSeguimiento) { map.removeLayer(lineaSeguimiento); lineaSeguimiento = null; }
        document.getElementById('map').classList.remove('modo-evento');

        const btn = document.getElementById('btn-crear-evento');
        if (btn) {
            btn.classList.remove('evento-activo');
            btn.textContent      = '🎪 Crear evento';
        }

        // Guardar copia de los vértices y abrir modal
        const verticesCopia = [...verticesActuales];
        verticesActuales = [];
        ocultarBotonCrearEventoMovil();
        abrirModalEvento(verticesCopia);
    };

    document.body.appendChild(botonCrearEventoMovil);
}

/**
 * Muestra el botón flotante centrado en el polígono actual.
 */
function mostrarBotonCrearEventoMovil() {
    if (!window.isMobile || !modoEvento || verticesActuales.length < 3) return;

    crearBotonCrearEventoMovil();

    // Calcular centro del polígono
    let latSum = 0, lonSum = 0;
    verticesActuales.forEach(v => {
        latSum += v.lat;
        lonSum += v.lon;
    });
    const centerLat = latSum / verticesActuales.length;
    const centerLon = lonSum / verticesActuales.length;

    // Convertir a coordenadas de pantalla
    const point = map.latLonToContainerPoint([centerLat, centerLon]);

    botonCrearEventoMovil.style.left = (point.x - 50) + 'px'; // Centrado horizontalmente
    botonCrearEventoMovil.style.top = (point.y - 25) + 'px';  // Centrado verticalmente
    botonCrearEventoMovil.style.display = 'block';
}

/**
 * Oculta el botón flotante.
 */
function ocultarBotonCrearEventoMovil() {
    if (botonCrearEventoMovil) {
        botonCrearEventoMovil.style.display = 'none';
    }
}

// ── Niveles de afluencia ──────────────────────────────────────────────────────

/**
 * Tabla de 4 niveles de afluencia/impacto.
 * afluencia (0-1) se mapea a nivel 1-4 con nivelAfluencia().
 * Los valores de porcentaje coinciden exactamente con los de los obstáculos:
 *   Nivel 1 -> 25% -> ×1.75   (impacto leve)
 *   Nivel 2 -> 50% -> ×2.5    (impacto moderado)
 *   Nivel 3 -> 75% -> ×3.25   (impacto alto)
 *   Nivel 4 -> 100% -> ×4.0   (impacto máximo)
 */
const NIVELES_EVENTO = {
    1: { pct: 25,  color: '#2980b9', label: 'Nivel 1',  desc: 'Leve' },
    2: { pct: 50,  color: '#f39c12', label: 'Nivel 2',  desc: 'Moderado' },
    3: { pct: 75,  color: '#e67e22', label: 'Nivel 3',  desc: 'Alto' },
    4: { pct: 100, color: '#e74c3c', label: 'Nivel 4',  desc: 'Máximo' },
};

/**
 * Devuelve el nivel (1-4) dado un valor de afluencia (0-1).
 * Redondea al nivel más cercano por cuartos.
 */
function nivelAfluencia(afluencia) {
    const nivel = Math.round(afluencia * 4);
    return Math.max(1, Math.min(4, nivel || 1));
}

/**
 * Devuelve el color del nivel correspondiente a la afluencia dada.
 */
function colorEvento(afluencia) {
    return NIVELES_EVENTO[nivelAfluencia(afluencia)].color;
}

// ── Activar / desactivar modo dibujo ─────────────────────────────────────────

/**
 * Activa el modo de creación de eventos.
 * Solo disponible para admin; si no hay capa de vías cargada, avisa.
 */
function activarModoEvento() {
    if (window.userRol !== 'admin') {
        showNotification('Solo el administrador puede crear eventos', 'warning');
        return;
    }

    // Cancelar selección de origen/destino si estaba activa
    const habiaCancelando = window.esperandoDestino || window.esperandoOrigen;
    if (habiaCancelando) {
        window.esperandoDestino = false;
        window.esperandoOrigen  = false;
        if (typeof ocultarInstruccion === 'function') ocultarInstruccion();
    }

    // Desactivar modo obstáculo si estaba activo
    const habiaObstaculo = typeof modoObstaculo !== 'undefined' && modoObstaculo;
    if (habiaObstaculo && typeof desactivarModoObstaculo === 'function') desactivarModoObstaculo();

    modoEvento = true;
    verticesActuales = [];
    limpiarPreview();

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
    map.on('mousemove', sobreRaton);

    // Tooltip que sigue al cursor
    mostrarCursorTooltip();
}

/**
 * Cancela el modo dibujo sin crear nada.
 */
function desactivarModoEvento() {
    modoEvento = false;
    verticesActuales = [];
    limpiarPreview();
    map.off('mousemove', sobreRaton);
    document.getElementById('map').classList.remove('modo-evento');

    // Ocultar tooltip de cursor
    ocultarCursorTooltip();

    // Ocultar botón flotante en móvil
    if (window.isMobile) ocultarBotonCrearEventoMovil();

    const btn = document.getElementById('btn-crear-evento');
    if (btn) {
        btn.classList.remove('evento-activo');
        btn.textContent      = '🎪 Crear evento';
    }
}

// ── Preview mientras se dibuja ────────────────────────────────────────────────

/** Elimina todas las capas de preview del mapa. */
function limpiarPreview() {
    if (preCapa)   { map.removeLayer(preCapa);   preCapa   = null; }
    if (lineaSeguimiento) { map.removeLayer(lineaSeguimiento); lineaSeguimiento = null; }
    preVertices.forEach(m => map.removeLayer(m));
    preVertices = [];
}

/** Actualiza el polígono/polyline de preview con los vértices actuales. */
function actualizarPreview() {
    if (preCapa) map.removeLayer(preCapa);

    const latlons = verticesActuales;
    if (latlons.length < 2) {
        preCapa = null;
        if (window.isMobile) ocultarBotonCrearEventoMovil();
        return;
    }

    // Con 2+ vértices dibuja una polyline; con 3+ cierra visualmente
    preCapa = latlons.length >= 3
        ? L.polygon(latlons, {
            color: '#8e44ad', weight: 2, opacity: 0.9,
            fillColor: '#8e44ad', fillOpacity: 0.15,
            dashArray: '8, 6', interactive: false
        }).addTo(map)
        : L.polyline(latlons, {
            color: '#8e44ad', weight: 2, opacity: 0.9,
            dashArray: '8, 6', interactive: false
        }).addTo(map);

    // Actualizar posición del botón flotante en móvil
    if (window.isMobile && latlons.length >= 3) {
        mostrarBotonCrearEventoMovil();
    }
}

/**
 * Dibuja la línea de seguimiento desde el último vértice al cursor.
 * @param {L.MouseEvent} e
 */
function sobreRaton(e) { 
    if (!modoEvento || !verticesActuales.length) return;
    if (lineaSeguimiento) map.removeLayer(lineaSeguimiento);
    const ultimo = verticesActuales[verticesActuales.length - 1];
    lineaSeguimiento = L.polyline([ultimo, e.latlon], {
        color: '#8e44ad', weight: 1.5, opacity: 0.6, dashArray: '4, 4',
        interactive: false
    }).addTo(map);
}

// ── Handlers de clic en el mapa ──────────────────────────────────────────────

/**
 * Añade un vértice al polígono en construcción (clic izquierdo en modo evento).
 * Se inyecta en el listener principal de map.on('click') de route-manager.js
 * a través de la función window.clicVertice expuesta más abajo.
 */
window.clicVertice = function (e) {
    if (!modoEvento) return false; // no se usa

    verticesActuales.push(e.latlon);

    // Marcador de vértice (non-interactive para que contextmenu llegue al mapa)
    const m = L.circleMarcador(e.latlon, {
        radius: 5, color: '#8e44ad', fillColor: '#fff',
        fillOpacity: 1, weight: 2,
        interactive: false
    }).addTo(map);
    preVertices.push(m);

    actualizarPreview();
    actualizarTextoCursorTooltip();

    const n = verticesActuales.length;
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
        if (window.isMobile) mostrarBotonCrearEventoMovil();
    } else {
        const msg = window.isMobile
            ? `📍 Vértice ${n} añadido.`
            : `📍 Vértice ${n} añadido.`;
        showNotification(msg, 'info');
        if (window.isMobile) mostrarBotonCrearEventoMovil();
    }

    return true; // consumido: route-manager no procesará este clic
};

/**
 * Cierra el polígono con clic derecho y abre el modal de atributos.
 */
map.on('contextmenu', function (e) {
    if (!modoEvento) return;

    if (verticesActuales.length < 3) {
        showNotification('⚠️ Necesitas al menos 3 vértices para cerrar el polígono.', 'warning');
        return;
    }

    // Desactivar modo dibujo (limpia preview y listeners)
    modoEvento = false;
    map.off('mousemove', sobreRaton);
    if (lineaSeguimiento) { map.removeLayer(lineaSeguimiento); lineaSeguimiento = null; }
    document.getElementById('map').classList.remove('modo-evento');

    // Ocultar botón flotante en móvil
    if (window.isMobile) ocultarBotonCrearEventoMovil();

    const btn = document.getElementById('btn-crear-evento');
    if (btn) {
        btn.classList.remove('evento-activo');
        btn.textContent      = '🎪 Crear evento';
    }

    // Guardar copia de los vértices y abrir modal
    const verticesCopia = [...verticesActuales];
    verticesActuales = [];
    abrirModalEvento(verticesCopia);
});

// ── Modal de atributos ────────────────────────────────────────────────────────

/** Vértices temporales hasta que el usuario confirme el modal. */
let verticesPendientes = null;

/**
 * Marca visualmente el nivel seleccionado en el modal y guarda el valor
 * en el input oculto #ev-nivel-value.
 * @param {number} nivel  1-4
 */
function seleccionarNivelEvento(nivel) {
    const info = NIVELES_EVENTO[nivel];
    if (!info) return;

    // Actualizar input oculto
    const oculto = document.getElementById('ev-nivel-value');
    if (oculto) oculto.value = nivel;

    // Actualizar botones
    for (let n = 1; n <= 4; n++) {
        const btn = document.getElementById(`ev-nivel-btn-${n}`);
        if (!btn) continue;
        const activo = (n === nivel);
        btn.style.background   = activo ? NIVELES_EVENTO[n].color : '#f1f5f9';
        btn.style.color        = activo ? '#fff' : '#374151';
        btn.style.borderColor  = activo ? NIVELES_EVENTO[n].color : '#e2e8f0';
        btn.style.fontWeight   = activo ? '700' : '500';
        btn.style.transform    = activo ? 'scale(1.05)' : 'scale(1)';
    }

    // Actualizar descripción
    const desc = document.getElementById('ev-nivel-desc');
    if (desc) {
        desc.textContent  = `${info.label} — ${info.desc} (equiv. ${info.pct}% obstáculo · factor ×${(1 / (1 - info.pct/100 * 0.99)).toFixed(2)})`;
        desc.style.color  = info.color;
    }
}

/**
 * Abre el modal para introducir los atributos del evento.
 * @param {L.LatLng[]} vertices
 */
function abrirModalEvento(vertices) {
    verticesPendientes = vertices;
    limpiarPreview();

    // Ocultar botón flotante en móvil
    if (window.isMobile) ocultarBotonCrearEventoMovil();

    // Mostrar preview definitivo (sin trazo, no interactivo)
    preCapa = L.polygon(vertices, {
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

    // Seleccionar nivel 2 por defecto
    seleccionarNivelEvento(2);

    document.getElementById('evento-modal').style.display = 'flex';
}

/** Cierra el modal y descarta el polígono pendiente. */
function cerrarModalEvento() {
    document.getElementById('evento-modal').style.display = 'none';
    limpiarPreview();
    verticesPendientes = null;
    // Asegura que el botón del panel MSW vuelve al estado inactivo
    if (typeof desactivarModoEvento === 'function') desactivarModoEvento();
}

/** Confirma el modal y crea el evento. */
function confirmarEvento() {
    const nombre    = document.getElementById('ev-nombre')?.value.trim();
    const fechaStr  = document.getElementById('ev-fecha')?.value;
    const horaStr   = document.getElementById('ev-hora')?.value   || '00:00';
    const nivel     = parseInt(document.getElementById('ev-nivel-value')?.value ?? 2, 10);
    const afluencia = (NIVELES_EVENTO[nivel]?.pct ?? 50) / 100;
    const duracion  = parseFloat(document.getElementById('ev-duracion')?.value ?? 2);

    // Helper: marca un campo en rojo, muestra notificación y hace foco
    function campoError(id, msg) {
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
        campoError('ev-nombre', '⚠️ Introduce un nombre para el evento.');
        return;
    }
    if (!fechaStr) {
        campoError('ev-fecha', '⚠️ Selecciona la fecha del evento.');
        return;
    }
    const fechaInicio = new Date(`${fechaStr}T${horaStr}:00`);
    if (isNaN(fechaInicio.getTime())) {
        campoError('ev-hora', '⚠️ Fecha u hora no válidas.');
        return;
    }
    if (isNaN(duracion) || duracion <= 0) {
        campoError('ev-duracion', '⚠️ La duración debe ser mayor que 0.');
        return;
    }

    if (!verticesPendientes || verticesPendientes.length < 3) {
        showNotification('⚠️ Error interno: no hay polígono dibujado.', 'warning');
        return;
    }

    document.getElementById('evento-modal').style.display = 'none';
    
    // Limpiar el polígono preview antes de crear el evento final
    limpiarPreview();
    
    crearEvento(verticesPendientes, nombre, fechaInicio, afluencia, duracion);
    verticesPendientes = null;
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
function crearEvento(vertices, nombre, fechaInicio, afluencia, duracion) {
    const color = colorEvento(afluencia);

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
                background:${color};color:#fff;border-radius:6px;
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

    const indice   = eventos.length; 
    const evento = {
        indice, nombre, fechaInicio, fechaFin, afluencia, duracion,
        vertices, poligono, label,
        // Guardamos el polígono de Leaflet para intersección
        bounds: poligono.getBounds()
    };
    eventos.push(evento);

    // Popup con info y botón eliminar
    poligono.bindPopup(popupEventoHTML(indice));
    poligono.on('popupopen', () => {
        // Re-bind para actualizar si se modificó
        poligono.setPopupContent(popupEventoHTML(indice));
    });

    actualizarListaEventos();
    const nivel = nivelAfluencia(afluencia);
    showNotification(`✅ Evento "${nombre}" creado (Nivel ${nivel} — ${NIVELES_EVENTO[nivel].desc}, ${duracion}h)`, 'success');
}

// ── HTML del popup ────────────────────────────────────────────────────────────

function popupEventoHTML(indice) {
    const ev   = eventos[indice];
    if (!ev) return '';
    const nivel = nivelAfluencia(ev.afluencia);
    const info  = NIVELES_EVENTO[nivel];
    const color = info.color;
    const fecha  = d => d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

    return `
        <div style="font-family:sans-serif;min-width:200px;font-size:13px;">
            <strong style="font-size:14px;">🎪 ${ev.nombre}</strong>
            <hr style="margin:6px 0;border:none;border-top:1px solid #eee;">
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;color:#555;">
                <span>📅 Inicio</span>  <span>${fecha(ev.fechaInicio)}</span>
                <span>🏁 Fin</span>     <span>${fecha(ev.fechaFin)}</span>
                <span>⏱️ Duración</span><span>${ev.duracion}h</span>
                <span>👥 Impacto</span>
                <span style="color:${color};font-weight:700;">${info.label} — ${info.desc}</span>
            </div>
            <button onclick="eliminarEvento(${indice})"
                style="margin-top:10px;width:100%;padding:6px;background:#e74c3c;
                       color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                🗑️ Eliminar evento
            </button>
        </div>`;
}

// ── Eliminar evento ───────────────────────────────────────────────────────────

/**
 * Elimina un evento del mapa y del array.
 * @param {number} indice
 */
function eliminarEvento(indice) {
    const ev = eventos[indice];
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
    
    eventos[indice] = null;
    actualizarListaEventos();
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
    actualizarListaEventos();
    showNotification('Todos los eventos eliminados', 'info');
}

// ── Lista de eventos en el panel ──────────────────────────────────────────────

/** Actualiza el panel izquierdo y el panel flotante con la lista de eventos activos. */
function actualizarListaEventos() {
    const lista     = document.getElementById('lista-eventos');
    const vacia     = document.getElementById('lista-eventos-vacia');
    const contador  = document.getElementById('eventos-contador');

    // ── Panel flotante ──
    const panelFlotante    = document.getElementById('eventos-panel-flotante');
    const listaFlotante    = document.getElementById('ev-flotante-lista');
    const contadorFlotante = document.getElementById('ev-flotante-contador');

    const activos = eventos.filter(Boolean);
    const esAdmin = window.userRol === 'admin';

    // ── Panel flotante: visible si hay eventos y es admin ──
    if (contadorFlotante) contadorFlotante.textContent = activos.length;
    if (listaFlotante)    listaFlotante.innerHTML      = '';
    if (panelFlotante) {
        const mostrar = activos.length > 0 && esAdmin;
        panelFlotante.style.display = mostrar ? 'flex' : 'none';
        // Reposicionar siempre que cambie visibilidad o contenido
        if (mostrar) setTimeout(reposicionarPanelEventos, 0);
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

    // formato de fecha para el panel
    const fecha = d => d.toLocaleString('es-ES', { 
        day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
    });

    activos.forEach(ev => {
        const nivel = nivelAfluencia(ev.afluencia);
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
                    <button class="obs-item-del" onclick="eliminarEvento(${ev.indice})" title="Eliminar">✕</button>
                </div>
                <div class="obs-item-sub" style="font-size:11px;color:#7f8c8d;">
                    📅 ${fecha(ev.fechaInicio)} -> ${fecha(ev.fechaFin)} · ⏱️ ${ev.duracion}h
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
                    <button onclick="eliminarEvento(${ev.indice})"
                        style="background:none;border:none;color:#aab0b7;font-size:14px;
                               cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;"
                        onmouseover="this.style.color='#e74c3c'"
                        onmouseout="this.style.color='#aab0b7'"
                        title="Eliminar">✕</button>
                </div>
                <div style="font-size:11px;color:#7f8c8d;margin-top:3px;">
                    📅 ${fecha(ev.fechaInicio)} -> ${fecha(ev.fechaFin)} · ⏱️ ${ev.duracion}h
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
        vertices:     ev.vertices.map(v => [v.lon, v.lat]),  // [lon, lat] para GeoJSON
        nombre:       ev.nombre,
        fecha_inicio: ev.fechaInicio.toISOString(),
        fecha_fin:    ev.fechaFin.toISOString(),
        afluencia:    nivelAfluencia(ev.afluencia) * 25,  // nivel->pct: 1->25, 2->50, 3->75, 4->100
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
    eventosExportHandle = null;
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
    eventosExportHandle = null;
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
            eventosExportHandle = handle;
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
    const handle = eventosExportHandle;
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
                    const vertices    = ev.vertices.map(([lon, lat]) => L.latLon(lat, lon));
                    const fechaInicio = new Date(ev.fecha_inicio);
                    const fechaFin    = new Date(ev.fecha_fin);
                    const duracion    = (fechaFin - fechaInicio) / 3600000;
                    const afluencia   = (ev.afluencia ?? 50) / 100;  // pct->0-1, nivelAfluencia() lo discretiza al crear
                    crearEvento(vertices, ev.nombre, fechaInicio, afluencia, duracion);
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
 *   -> Nivel 1 (25%) -> ×1.49
 *   -> Nivel 2 (50%) -> ×2.02
 *   -> Nivel 3 (75%) -> ×4.03
 *   -> Nivel 4 (100%) -> ×100  (prácticamente bloqueado, igual que un obstáculo al 100%)
 *
 * Se expone como window.obtenerPenalizacionEventos para ser llamada desde
 * calcularPesosAristas() en route-manager.js.
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
        if (!puntoDentroDePoligono(midPt, ev.vertices)) continue;

        // Misma fórmula que el backend usa para obstáculos:
        // factor = 1 / (1 - afluencia * 0.99)
        const factor = 1.0 / (1.0 - Math.min(ev.afluencia, 0.99) * 0.99);
        if (factor > factorMax) factorMax = factor;
        console.log(`[event-manager] Evento "${ev.nombre}" activo, factor ${factor} para segmento ${s}->${e}`);
    }

    return factorMax;
};

/**
 * Algoritmo ray-casting para comprobar si un punto está dentro de un polígono.
 * @param {L.LatLng}   punto    - Punto a comprobar
 * @param {L.LatLng[]} vertices - Vértices del polígono
 * @returns {boolean}
 */
function puntoDentroDePoligono(punto, vertices) {
    const x = punto.lon;
    const y = punto.lat;
    let dentro = false;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = vertices[i].lon, yi = vertices[i].lat;
        const xj = vertices[j].lon, yj = vertices[j].lat;
        const intersecta = ((yi > y) !== (yj > y)) &&
                           (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersecta) dentro = !dentro;
    }
    return dentro;
}

// ── Parche sobre calcularRuta ─────────────────────────────────────────────────

/**
 * Extiende calcularPesosAristas para que, después de calcular el peso base
 * de cada arista, lo multiplique por el factor de evento si corresponde.
 *
 * Se aplica monkey-patching sobre la función original de route-manager.js
 * una vez que ambos scripts han cargado.
 *
 * La fecha efectiva se lee de obtenerFechaEfectiva() (route-manager.js).
 */
(function parchearPesosAristas() {
    // Esperar a que route-manager.js haya definido calcularPesosAristas
    const MAX_INTENTOS = 20;
    let intentos = 0;

    function intentarParchear() {
        if (typeof calcularPesosAristas !== 'function') {
            if (++intentos < MAX_INTENTOS) setTimeout(intentarParchear, 150);
            else console.warn('[event-manager] No se pudo parchear calcularPesosAristas.');
            return;
        }

        const original = calcularPesosAristas;

        // Sobreescribir en el scope global para que cualquier llamada global use la versión parcheada.
        const patched = function () {
            const pesos = original();

            // Si no hay eventos activos, devolver sin modificar
            if (!eventos.filter(Boolean).length) return pesos;

            const fechaEfectiva = (typeof obtenerFechaEfectiva === 'function')
                ? obtenerFechaEfectiva()
                : new Date();

            return pesos.map(p => {
                const factorEvento = window.obtenerPenalizacionEventos(p.s, p.e, fechaEfectiva);
                if (factorEvento === 1.0) return p;
                console.log(`[event-manager] Penalizando segmento ${p.s}->${p.e} con factor ${factorEvento}`);
                return {
                    ...p,
                    peso:       p.peso       * factorEvento,
                    tiempo_min: p.tiempo_min * factorEvento,
                    factor_evento: factorEvento,
                };
            });
        };

        window.calcularPesosAristas = calcularPesosAristas = patched;

        console.log('[event-manager] ✅ calcularPesosAristas parcheada con penalización de eventos.');
    }

    setTimeout(intentarParchear, 100);
})();

// ── Nota sobre clicks ────────────────────────────────────────────────────────
// El handler de clic del mapa está en map-widgets.js, que comprueba
// window.modoEvento y llama a window.clicVertice cuando está activo.
// No se registra un listener adicional aquí para evitar dobles llamadas.


// ── Posicionamiento del panel de eventos debajo del de obstáculos ──────────

function reposicionarPanelEventos() {
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

(function observarPanelObstaculos() {
    function iniciar() {
        const obs = document.getElementById('obstaculos-panel-flotante');
        if (!obs) { setTimeout(iniciar, 100); return; }
        new ResizeObserver(reposicionarPanelEventos).observe(obs);
        new MutationObserver(reposicionarPanelEventos)
            .observe(obs, { attributes: true, attributeFilter: ['style'] });
        window.addEventListener('resize', reposicionarPanelEventos);
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
(function parchearToggleEventos() {
    const MAX = 20;
    let intentos = 0;

    function intentar() {
        if (typeof toggleLayerVisibility !== 'function') {
            if (++intentos < MAX) setTimeout(intentar, 150);
            return;
        }
        const orig = toggleLayerVisibility;
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
            return orig(capa, visible);
        };
        console.log('[event-manager] ✅ toggleLayerVisibility parcheada para eventos.');
    }
    setTimeout(intentar, 100);
})();

// ── Refrescar panel izquierdo al cambiar de rol (login/logout) ───────────────
(function observarRol() {
    let rolActual = window.userRol;
    Object.defineProperty(window, '_userRol', {
        get: () => rolActual,
        set: v  => {
            rolActual = v;
            // Actualizar visibilidad de layer-item e import/export sin esperar eventos
            actualizarListaEventos();
        },
        configurable: true,
    });
})();