/**
 * route-manager.js
 * Gestión de rutas, obstáculos y cálculo de caminos
 */

let modoObstaculo  = false;
let obstaculosLayer = null;
let obstaculos      = [];
let _obstaculosExportHandle = null;

window.segmentosBloqueadosCapas = [];

// Comprueba si un obsId ya está en uso en la sesión actual.
function _obsIdEnUso(id) {
    return obstaculos.filter(Boolean).some(o => o.obsId === id);
}

// ==================== INSTRUCCIONES EN MAPA ====================

function mostrarInstruccionOrigen() {
    document.getElementById('map').classList.add('cursor-origen');
    document.getElementById('map').classList.remove('cursor-destino');
}

function mostrarInstruccionDestino() {
    document.getElementById('map').classList.remove('cursor-origen');
    document.getElementById('map').classList.add('cursor-destino');
}

function ocultarInstruccion() {
    document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');
}

// ==================== VEHÍCULO ====================

window._vehiculoActual  = 'coche';
window._modoEmergencia  = false;

// Opciones de modo emergencia:
//   _emergVelocidad: true  → respetar velocidad máxima de la vía
//                   false → aplicar +20 km/h
//   _emergGiros:    true  → respetar restricciones de giro normales
//                   false → puede girar libremente (ignora restricciones)
//   _emergSentido:  true  → respetar sentidos de circulación
//                   false → puede circular en sentido contrario
window._emergVelocidad = true;   // por defecto: respeta velocidad (check activado)
window._emergGiros     = true;   // por defecto: respeta giros (check activado)
window._emergSentido   = true;   // por defecto: respeta sentidos (check activado)

function seleccionarVehiculo(tipo) {
    window._vehiculoActual = tipo;
    // Sincronizar todos los botones posibles
    document.getElementById('btn-vehiculo-coche')?.classList.toggle('active',  tipo === 'coche');
    document.getElementById('btn-vehiculo-camion')?.classList.toggle('active', tipo === 'camion');
    document.getElementById('msw-btn-coche')?.classList.toggle('active',  tipo === 'coche');
    document.getElementById('msw-btn-camion')?.classList.toggle('active', tipo === 'camion');

    if (tipo === 'camion') {
        showNotification('🚛 Veh. Pesado activado — pulsa Calcular Ruta', 'info');
    } else {
        showNotification('🚗 Veh. Ligero activado — pulsa Calcular Ruta', 'info');
    }
    // NO recalcular automáticamente
}

function toggleEmergencia() {
    window._modoEmergencia = !window._modoEmergencia;
    const activo = window._modoEmergencia;
    // Sincronizar todos los botones de emergencia
    ['msw-btn-emergencia', 'btn-emergencia'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('active', activo);
        btn.style.background = activo ? '#e74c3c' : '';
        btn.style.color      = activo ? '#fff'    : '';
    });
    // Mostrar u ocultar el dropdown de opciones de emergencia
    const dropdown = document.getElementById('emergencia-opciones-dropdown');
    if (dropdown) dropdown.style.display = activo ? 'block' : 'none';

    if (activo) {
        const msgs = [];
        if (!window._emergVelocidad) msgs.push('velocidad +20 km/h');
        if (!window._emergGiros)     msgs.push('giros libres');
        if (!window._emergSentido)   msgs.push('sentido contrario');
        const detalle = msgs.length ? ' (' + msgs.join(', ') + ')' : ' — velocidad +20 km/h';
        showNotification('🚨 Modo Emergencia activo' + detalle, 'warning');
    } else {
        showNotification('Modo Emergencia desactivado', 'info');
    }
}

function toggleEmergenciaOpcion(opcion) {
    if (opcion === 'velocidad') window._emergVelocidad = !window._emergVelocidad;
    if (opcion === 'giros')     window._emergGiros     = !window._emergGiros;
    if (opcion === 'sentido')   window._emergSentido   = !window._emergSentido;
    // Sincronizar checkboxes
    const chkV = document.getElementById('emerg-chk-velocidad');
    const chkG = document.getElementById('emerg-chk-giros');
    const chkS = document.getElementById('emerg-chk-sentido');
    if (chkV) chkV.checked = window._emergVelocidad;
    if (chkG) chkG.checked = window._emergGiros;
    if (chkS) chkS.checked = window._emergSentido;
}

function invertirPuntos() {
    // Intercambiar objetos latlng
    const tmpLatlng = puntoOrigen;
    puntoOrigen  = puntoDestino;
    puntoDestino = tmpLatlng;

    // Intercambiar marcadores: retirar los actuales y redibujarlos
    if (marcadorOrigen)  map.removeLayer(marcadorOrigen);
    if (marcadorDestino) map.removeLayer(marcadorDestino);
    marcadorOrigen  = null;
    marcadorDestino = null;

    if (puntoOrigen)  marcadorOrigen  = L.marker(puntoOrigen,  { icon: crearIconoMarcador('📍') }).addTo(map);
    if (puntoDestino) marcadorDestino = L.marker(puntoDestino, { icon: crearIconoMarcador('🎯') }).addTo(map);

    // Limpiar la ruta dibujada — ya no es válida tras el intercambio
    if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
    if (window._rutaLayerBordeEmergencia) { map.removeLayer(window._rutaLayerBordeEmergencia); window._rutaLayerBordeEmergencia = null; }
    window.segmentosBloqueadosCapas?.forEach(c => map.removeLayer(c));
    window.segmentosBloqueadosCapas = [];
    document.getElementById('msw-resultados-ruta')?.style.setProperty('display', 'none');

    _actualizarLabels();
    _actualizarLabelsMsw();
    showNotification('↕️ Origen y destino invertidos', 'info');
}
// ==================== WIDGET TIEMPO (Salir ahora / Salir a las / Llegar antes de las) ====================

// Estado del modo de tiempo seleccionado
window._modoTiempo                    = 'ahora';   // 'ahora' | 'salir' | 'llegar'
window._fechaSalida                   = null;      // Date con la fecha/hora seleccionada (null = ahora)
window._rutaCalculadaDuracionMinutos  = null;      // Duración en minutos de la última ruta calculada

function toggleSalirAhoraDropdown() {
    const dd = document.getElementById('salir-ahora-dropdown');
    if (!dd) return;
    const visible = dd.style.display !== 'none';
    dd.style.display = visible ? 'none' : 'block';
    if (!visible) {
        // Cerrar al hacer clic fuera
        setTimeout(() => {
            document.addEventListener('click', _cerrarDropdownSalir, { once: true });
        }, 0);
    }
}

function _cerrarDropdownSalir(e) {
    const dd = document.getElementById('salir-ahora-dropdown');
    if (dd && !dd.contains(e.target)) dd.style.display = 'none';
}

function seleccionarModoTiempo(modo) {
    window._modoTiempo = modo;
    const dd      = document.getElementById('salir-ahora-dropdown');
    const picker  = document.getElementById('salir-datetime-picker');
    const label   = document.getElementById('salir-ahora-label');
    const icon    = document.getElementById('salir-datetime-icon');
    if (dd) dd.style.display = 'none';

    // Marcar item activo en dropdown
    ['ahora','salir','llegar'].forEach(m => {
        const el = document.getElementById('sdrop-' + m);
        if (el) el.style.fontWeight = (m === modo) ? '700' : '400';
    });

    if (modo === 'ahora') {
        window._fechaSalida = null;
        if (label)  label.textContent  = '🕐 Salir ahora';
        if (picker) picker.style.display = 'none';
        _actualizarCoefInfo(new Date());
    } else {
        // Inicializar inputs con fecha/hora actual si no tienen valor
        const horaInput  = document.getElementById('salir-hora-input');
        const fechaInput = document.getElementById('salir-fecha-input');
        const ahora = new Date();

        if (horaInput && !horaInput.value) {
            horaInput.value = ahora.toTimeString().slice(0,5);
        }
        if (fechaInput && !fechaInput.value) {
            fechaInput.value = ahora.toISOString().slice(0,10);
        }

        if (modo === 'salir') {
            if (label) label.textContent = '📅 Salir a las';
            if (icon)  icon.textContent  = '📅';
        } else {
            if (label) label.textContent = '🏁 Llegar antes de las';
            if (icon)  icon.textContent  = '🏁';
        }
        if (picker) picker.style.display = 'block';
        onSalirDatetimeChange();
    }

    if (window._rutaCalculadaDuracionMinutos != null) {
        _mostrarInfoTemporal(window._rutaCalculadaDuracionMinutos);
    }
}

function onSalirDatetimeChange() {
    const horaInput  = document.getElementById('salir-hora-input');
    const fechaInput = document.getElementById('salir-fecha-input');
    if (!horaInput || !fechaInput) return;

    const fechaStr = fechaInput.value || new Date().toISOString().slice(0,10);
    const horaStr  = horaInput.value  || '00:00';
    const fecha    = new Date(`${fechaStr}T${horaStr}:00`);
    if (isNaN(fecha.getTime())) return;

    window._fechaSalida = fecha;
    _actualizarCoefInfo(fecha);

    if (window._rutaCalculadaDuracionMinutos != null) {
        _mostrarInfoTemporal(window._rutaCalculadaDuracionMinutos);
    }
}

function _actualizarCoefInfo(fecha) {
    const infoEl = document.getElementById('salir-coef-info');
    if (!infoEl) return;
    if (typeof obtenerCoeficiente !== 'function') return;

    const info = infoCoeficiente(fecha);
    const pct  = Math.round((info.factor - 1) * 100);
    const signo = pct >= 0 ? '+' : '';
    infoEl.innerHTML = `
        <span style="background:${info.color};color:#fff;border-radius:4px;padding:2px 6px;font-weight:700;">
            ${info.emoji} ${info.tipoLabel}
        </span>
        <span>${info.franjaLabel}</span>
        <span style="font-weight:700;color:${info.factor > 1.1 ? '#e74c3c' : info.factor < 0.95 ? '#27ae60' : '#7f8c8d'};">
            ${signo}${pct}% tiempo
        </span>
    `;
}

/**
 * Devuelve la fecha efectiva de salida según el modo seleccionado.
 * En modo 'ahora' devuelve new Date().
 */
function obtenerFechaEfectiva() {
    if (window._modoTiempo === 'ahora' || !window._fechaSalida) return new Date();
    return window._fechaSalida;
}

// ==================== FLUJO CÓMO LLEGAR ====================

function abrirComoLlegar() {
    // Ocultar widget flotante
    document.getElementById('map-search-widget').style.display = 'none';

    // Abrir panel derecho si estaba colapsado
    const rightPanel = document.getElementById('right-panel');
    if (rightPanel?.classList.contains('collapsed')) toggleRightPanel();

    document.getElementById('rp-ruta')?.style.setProperty('display', 'block');

    modoActual = 'ruta';
    if (!window.camposRutaConfigurados && window.currentViasGeoJSON?.features?.length) {
        if (typeof autodetectarCamposRuta === 'function') autodetectarCamposRuta(window.currentViasGeoJSON);
    }
    // Desactivar modos incompatibles con la selección de puntos
    if (modoObstaculo) desactivarModoObstaculo();
    if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
    mostrarInstruccionOrigen();
    showNotification('Haz clic en el mapa para elegir el origen', 'success');
}

function cerrarComoLlegar() {
    limpiarRuta();
    modoActual = 'navegar';
    document.getElementById('rp-ruta')?.style.setProperty('display', 'none');
    document.getElementById('panel-salir-ahora')?.style.setProperty('display', 'none');
    document.getElementById('panel-obstaculos')?.style.setProperty('display', 'none');
    const btnS = document.getElementById('btn-salir-ahora');
    const btnO = document.getElementById('btn-obstaculos-toggle');
    if (btnS) btnS.textContent = '🕐 Salir ahora ▾';
    if (btnO) btnO.textContent = '🚧 Obstáculos ▾';
    ocultarInstruccion();
    document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');
    if (typeof desactivarModoObstaculo === 'function') desactivarModoObstaculo();

    // Colapsar panel derecho y restaurar widget
    const rightPanel = document.getElementById('right-panel');
    if (rightPanel && !rightPanel.classList.contains('collapsed')) toggleRightPanel();
    document.getElementById('map-search-widget').style.display = 'flex';
}

function toggleSalirAhora() {
    const panel     = document.getElementById('panel-salir-ahora');
    const otroPnl   = document.getElementById('panel-obstaculos');
    if (!panel) return;
    const abierto   = panel.style.display !== 'none';
    panel.style.display    = abierto ? 'none' : 'block';
    if (!abierto) otroPnl.style.display = 'none';
    const btn = document.getElementById('btn-salir-ahora');
    if (btn) btn.textContent = abierto ? '🕐 Salir ahora ▾' : '🕐 Salir ahora ▴';
    if (!abierto && document.getElementById('btn-obstaculos-toggle'))
        document.getElementById('btn-obstaculos-toggle').textContent = '🚧 Obstáculos ▾';
}

function toggleObstaculosPanel() {
    const panel     = document.getElementById('panel-obstaculos');
    const otroPnl   = document.getElementById('panel-salir-ahora');
    if (!panel) return;
    const abierto   = panel.style.display !== 'none';
    panel.style.display    = abierto ? 'none' : 'block';
    if (!abierto) otroPnl.style.display = 'none';
    const btn = document.getElementById('btn-obstaculos-toggle');
    if (btn) btn.textContent = abierto ? '🚧 Obstáculos ▾' : '🚧 Obstáculos ▴';
    if (!abierto && document.getElementById('btn-salir-ahora'))
        document.getElementById('btn-salir-ahora').textContent = '🕐 Salir ahora ▾';
}

// ==================== LABELS ORIGEN / DESTINO ====================

function pedirOrigen() {
    if (!puntoOrigen) {
        // Desactivar modos que interfieren con la selección de punto
        if (modoObstaculo) desactivarModoObstaculo();
        if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
        mostrarInstruccionOrigen();
        window._esperandoOrigen = true;
        window._esperandoDestino = false;
        showNotification('Haz clic en el mapa para elegir el origen', 'info');
    }
}

function pedirDestino() {
    if (puntoOrigen && !puntoDestino) {
        // Desactivar modos que interfieren con la selección de punto
        if (modoObstaculo) desactivarModoObstaculo();
        if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
        mostrarInstruccionDestino();
        window._esperandoDestino = true;
        window._esperandoOrigen = false;
        showNotification('Haz clic en el mapa para elegir el destino', 'info');
    }
}

/** Llamada desde el label MSW de origen: desactiva modos incompatibles inmediatamente. */
function iniciarSeleccionOrigen() {
    if (modoObstaculo) desactivarModoObstaculo();
    if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
    modoActual = 'ruta';
    window._esperandoOrigen  = true;
    window._esperandoDestino = false;
    mostrarInstruccionOrigen();
    showNotification('Haz clic en el mapa para colocar el ORIGEN', 'info');
}

/** Llamada desde el label MSW de destino: desactiva modos incompatibles inmediatamente. */
function iniciarSeleccionDestino() {
    if (modoObstaculo) desactivarModoObstaculo();
    if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
    modoActual = 'ruta';
    window._esperandoDestino = true;
    window._esperandoOrigen  = false;
    mostrarInstruccionDestino();
    showNotification('Haz clic en el mapa para colocar el DESTINO', 'info');
}

function _actualizarLabels() {
    const origenEl  = document.getElementById('rp-origen-label');
    const destinoEl = document.getElementById('rp-destino-label');
    if (origenEl) {
        if (puntoOrigen) {
            origenEl.textContent = `📍 ${puntoOrigen.lat.toFixed(5)}, ${puntoOrigen.lng.toFixed(5)}`;
            origenEl.classList.remove('placeholder');
        } else {
            origenEl.textContent = 'Elige un punto de origen…';
            origenEl.classList.add('placeholder');
        }
    }
    if (destinoEl) {
        if (puntoDestino) {
            destinoEl.textContent = `🎯 ${puntoDestino.lat.toFixed(5)}, ${puntoDestino.lng.toFixed(5)}`;
            destinoEl.classList.remove('placeholder');
        } else {
            destinoEl.textContent = 'Elige un destino…';
            destinoEl.classList.add('placeholder');
        }
    }
}

/**
 * Sincroniza los labels del widget flotante (msw) con los puntos actuales.
 * Se llama siempre que cambia origen o destino desde el mapa.
 */
function _actualizarLabelsMsw() {
    const ol = document.getElementById('msw-origen-label');
    const dl = document.getElementById('msw-destino-label');
    if (ol) {
        if (puntoOrigen) {
            ol.textContent = `📍 ${puntoOrigen.lat.toFixed(5)}, ${puntoOrigen.lng.toFixed(5)}`;
            ol.classList.remove('placeholder');
        } else {
            ol.textContent = 'Elige un punto de origen…';
            ol.classList.add('placeholder');
        }
    }
    if (dl) {
        if (puntoDestino) {
            dl.textContent = `🎯 ${puntoDestino.lat.toFixed(5)}, ${puntoDestino.lng.toFixed(5)}`;
            dl.classList.remove('placeholder');
        } else {
            dl.textContent = 'Elige un destino…';
            dl.classList.add('placeholder');
        }
    }
}

// ==================== NIVELES DE OBSTÁCULO ====================

/**
 * Sistema de 3 niveles de barrera (delta sobre el estado de la vía).
 *
 * Las barreras actúan como INCREMENTOS sobre el estado base de la vía:
 *   Estado de vía: Verde(0) → Amarillo(1) → Naranja(2) → Rojo(3)
 *   Barrera Amarilla (delta=1): sube 1 nivel  → Verde→Amarillo, Amarillo→Naranja, ...
 *   Barrera Naranja  (delta=2): sube 2 niveles → Verde→Naranja, Amarillo→Rojo, ...
 *   Barrera Roja     (delta=3): sube 3 niveles → Verde→Rojo (siempre Rojo)
 *
 * Si varios obstáculos afectan el mismo segmento, sus deltas se acumulan:
 *   estado_final = min(3, sum(deltas))
 *
 * Tabla de estados de vía (resultado final) → obstruccion:
 *   Verde    (0) → 0.00  → factor x1.0   (sin efecto)
 *   Amarillo (1) → 0.33  → factor ≈x1.49 (reducción moderada)
 *   Naranja  (2) → 0.67  → factor ≈x3.0  (reducción severa)
 *   Rojo     (3) → 0.99  → factor ≈x100  (prácticamente bloqueado)
 *
 * El campo `nivel` (1-3) almacenado en cada obstáculo ES el delta.
 */
const NIVELES_OBS = {
    1: { obstruccion: 0.33, color: '#f1c40f', label: 'Nivel Amarillo', desc: 'Precaución'  },
    2: { obstruccion: 0.67, color: '#e67e22', label: 'Nivel Naranja',  desc: 'Peligro'     },
    3: { obstruccion: 0.99, color: '#e74c3c', label: 'Nivel Rojo',     desc: 'Bloqueado'   },
};

/**
 * Tabla de estado de vía (0-3) → obstruccion (0-1).
 * Usada por el backend y por la acumulación de deltas en el frontend.
 */
const _ESTADO_VIA_OBS = [0.00, 0.33, 0.67, 0.99];

/** Convierte un nivel-delta (1-3) a su valor de obstrucción directo
 *  (asume vía en estado base Verde=0). */
function _obstruccionDeNivel(nivel) {
    nivel = Math.max(1, Math.min(3, nivel));
    return NIVELES_OBS[nivel].obstruccion;
}

/** Convierte obstruccion (0-1) al nivel-delta 1-3 más cercano. */
function _nivelObs(obstruccion) {
    const ob = obstruccion ?? 0.33;
    let mejor = 1, mejorDist = Infinity;
    for (const [n, cfg] of Object.entries(NIVELES_OBS)) {
        const d = Math.abs(cfg.obstruccion - ob);
        if (d < mejorDist) { mejorDist = d; mejor = parseInt(n); }
    }
    return mejor;
}

/** Devuelve el color del nivel-delta correspondiente a la obstruccion dada. */
function _colorObs(v) {
    return NIVELES_OBS[_nivelObs(v)].color;
}

// ==================== LISTA DE OBSTÁCULOS ====================

function _nombresViasAfectadas(obs) {
    if (!window.currentViasGeoJSON?.features) return [];
    // 5 m en grados aprox (1° ≈ 111 km)
    const RADIO_DEG  = 5 / 111000;
    const RADIO_DEG2 = RADIO_DEG * RADIO_DEG;
    const oLat = obs.latlng.lat;
    const oLon = obs.latlng.lng;
    const nombres = new Set();

    for (const f of window.currentViasGeoJSON.features) {
        const geom = f.geometry;
        if (geom?.type !== 'LineString') continue;
        const coords = geom.coordinates;
        let encontrado = false;
        for (let i = 0; i < coords.length - 1 && !encontrado; i++) {
            const ax = coords[i][0],   ay = coords[i][1];
            const bx = coords[i+1][0], by = coords[i+1][1];
            // 5 muestras por segmento (suficiente para 5 m de radio)
            for (let j = 0; j <= 4; j++) {
                const t    = j / 4;
                const dLat = (ay + t * (by - ay)) - oLat;
                const dLon = (ax + t * (bx - ax)) - oLon;
                if (dLat * dLat + dLon * dLon <= RADIO_DEG2) {
                    const name = f.properties?.name;
                    if (name) nombres.add(name);
                    encontrado = true;
                    break;
                }
            }
        }
    }
    return [...nombres];
}

function _actualizarListaObstaculos() {
    const lista    = document.getElementById('lista-obstaculos');
    const vacia    = document.getElementById('lista-obstaculos-vacia');
    const contador = document.getElementById('obstaculos-contador');
    if (!lista) return;

    Array.from(lista.querySelectorAll('.obs-item')).forEach(el => el.remove());
    const activos = obstaculos.filter(Boolean);
    if (vacia)    vacia.style.display  = activos.length ? 'none'  : 'block';
    if (contador) contador.textContent = activos.length;

    const chkObs  = document.getElementById('check-obstaculos');
    const descObs = document.getElementById('obstaculos-layer-desc');
    if (chkObs)  chkObs.checked      = activos.length > 0;
    if (descObs) descObs.textContent = activos.length > 0
        ? `${activos.length} obstáculo(s) activo(s)`
        : 'Sin cargar';

    const btnTabla = document.getElementById('btn-tabla-obstaculos');
    if (btnTabla) btnTabla.style.display = '';

    const btnTablaLayer = document.getElementById('btn-tabla-obstaculos-layer');
    if (btnTablaLayer) btnTablaLayer.style.display = '';

    // ── Panel flotante ──
    const panelFlotante   = document.getElementById('obstaculos-panel-flotante');
    const listaFlotante   = document.getElementById('obs-flotante-lista');
    const contadorFlotante = document.getElementById('obs-flotante-contador');
    
    // Mostrar panel solo si hay obstáculos
    const mostrarPanel = activos.length > 0;
    
    if (panelFlotante) panelFlotante.style.display = mostrarPanel ? 'flex' : 'none';
    if (contadorFlotante) contadorFlotante.textContent = activos.length;
    if (listaFlotante) listaFlotante.innerHTML = '';

    activos.forEach(obs => {
        const idx   = obstaculos.indexOf(obs);
        const nivel = _nivelObs(obs.obstruccion ?? 0.5);
        const info  = NIVELES_OBS[nivel];
        const color = info.color;
        const nombres = _nombresViasAfectadas(obs);

        const activosFiltrado = obstaculos.filter(Boolean);
        const numFila = activosFiltrado.indexOf(obs) + 1;
        const obsLabel = obs.obsId !== null ? `#${obs.obsId}` : `#${numFila}`;

        let tituloExtra = '';
        let subtitulo   = '';
        if (nombres.length > 1) {
            tituloExtra = ` <span class="obs-cruce">cruce entre:</span>`;
            subtitulo   = nombres.map(n => `<span class="obs-via">• ${n}</span>`).join('');
        } else if (nombres.length === 1) {
            subtitulo   = `<span class="obs-via">• ${nombres[0]}</span>`;
        }

        const itemHTML = `
            <div class="obs-item-header">
                <div class="obs-item-titulo">
                    <strong>${obsLabel} — <span style="color:${color}">${info.label} (${info.desc})</span></strong>${tituloExtra}
                </div>
                <button class="obs-item-del" onclick="eliminarObstaculo(${idx})" title="Eliminar">✕</button>
            </div>
            <div class="obs-item-sub">${subtitulo}</div>`;

        // Panel lateral (existente)
        const item = document.createElement('div');
        item.className  = 'obs-item';
        item.dataset.idx = idx;
        item.innerHTML  = itemHTML;
        lista.appendChild(item);

        // Panel flotante
        if (listaFlotante) {
            const itemF = document.createElement('div');
            itemF.className  = 'obs-item';
            itemF.dataset.idx = idx;
            itemF.innerHTML  = itemHTML;
            listaFlotante.appendChild(itemF);
        }
    });
}

// ==================== POPUP DE OBSTÁCULO ====================

function _popupHTML(idx) {
    const obs   = obstaculos[idx];
    if (!obs) return '';
    const nivel = _nivelObs(obs.obstruccion ?? 0.5);
    const info  = NIVELES_OBS[nivel];
    const activos = obstaculos.filter(Boolean);
    const numFila = activos.indexOf(obs) + 1;
    const label   = obs.obsId !== null ? `#${obs.obsId}` : `#${numFila}`;

    const botonesNivel = [1,2,3].map(n => {
        const ni = NIVELES_OBS[n];
        const sel = n === nivel;
        return `<button onclick="cambiarNivelObstaculo(${idx},${n})"
            style="flex:1;padding:4px 2px;font-size:11px;font-weight:${sel?'700':'400'};
                   border:2px solid ${sel ? ni.color : '#ddd'};border-radius:4px;
                   background:${sel ? ni.color : '#f8f8f8'};
                   color:${sel ? '#fff' : '#555'};cursor:pointer;">
            ${ni.label}<br><span style="font-size:10px;opacity:.85;">${ni.desc}</span>
        </button>`;
    }).join('');

    return `
        <div style="font-family:var(--font-base,sans-serif);min-width:220px;text-align:center;">
            <strong>🚧 Obstáculo ${label}</strong><br>
            <div style="margin:8px 0 4px;font-size:12px;color:#555;">
                Impacto actual: <strong style="color:${info.color};">${info.label} — ${info.desc}</strong>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:10px;">${botonesNivel}</div>
            <div style="display:flex;gap:6px;margin-top:4px;">
                <button onclick="iniciarMoverObstaculo(${idx})"
                    style="flex:1;padding:5px 4px;background:#3498db;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                    📍 Mover
                </button>
                <button onclick="eliminarObstaculo(${idx})"
                    style="flex:1;padding:5px 4px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                    🗑️ Eliminar
                </button>
            </div>
        </div>`;
}

/** Cambia el nivel de un obstáculo existente (llamado desde botones del popup). */
function cambiarNivelObstaculo(idx, nivel) {
    const obs = obstaculos[idx];
    if (!obs) return;
    nivel = Math.max(1, Math.min(3, nivel));
    const nuevaObs = _obstruccionDeNivel(nivel);
    if (nuevaObs === obs.obstruccion) return;  // sin cambio: no repintar ni notificar
    obs.obstruccion = nuevaObs;
    const color = _colorObs(nuevaObs);
    if (obs.circulo) obs.circulo.setStyle({ color, fillColor: color });
    obs.segmentosBloqueados?.forEach(s => s.setStyle({ color }));
    const info = NIVELES_OBS[nivel];
    obs.marker.bindPopup(_popupHTML(idx), { maxWidth: 240 }).openPopup();
    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
    // Emitir por WS si la capa compartida está activa
    if (window._capaCompartidaActiva && obs._bdId && window._rt?.emit) {
        window._rt.emit('obs_compartido_mover', {
            id: obs._bdId, lat: obs.latlng.lat, lng: obs.latlng.lng,
            nivel: _nivelObs(nuevaObs), portal: obs.portal || '',
        });
    }
    showNotification(`Obstáculo → ${info.label} (${info.desc})`, 'info');
}

/** @deprecated Mantener por compatibilidad con realtime.js que lo parchea */
function _aplicarPctPopup(idx) {
    // No hace nada: la lógica se gestiona vía cambiarNivelObstaculo
}

// ==================== MODAL DE NIVEL AL CREAR OBSTÁCULO ====================

let _latlngPendiente   = null;
let _moverObstaculoIdx = null;

/** Resetea el modal al nivel 1 (Amarillo) y lo muestra */
function _pedirNivelObstaculo(latlng) {
    _latlngPendiente = latlng;

    const titulo  = document.getElementById('obstaculo-titulo');
    const hint    = document.getElementById('obstaculo-id-hint');
    const errEl   = document.getElementById('obstaculo-id-error');

    // Restaurar título
    if (titulo) {
        titulo.contentEditable = 'false';
        titulo.textContent     = '🚧 Nuevo obstáculo';
        titulo.style.background    = '';
        titulo.style.outline       = '';
        titulo.style.cursor        = 'default';
        titulo.style.color         = '';
    }
    if (hint)  hint.style.display  = '';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    // Seleccionar nivel 1 (Amarillo) por defecto
    _seleccionarNivelObs(1);

    document.getElementById('obstaculo-modal').style.display = 'flex';
}

/** Marca visualmente el nivel seleccionado en el modal de creación de obstáculo */
function _seleccionarNivelObs(nivel) {
    window._nivelObstaculoPendiente = nivel;
    const input = document.getElementById('obs-nivel-value');
    if (input) input.value = nivel;
    for (let n = 1; n <= 3; n++) {
        const btn = document.getElementById(`obs-nivel-btn-${n}`);
        if (!btn) continue;
        const info = NIVELES_OBS[n];
        const sel  = n === nivel;
        btn.style.background  = sel ? info.color : '#f8f8f8';
        btn.style.color       = sel ? (n === 1 ? '#333' : '#fff') : '#555';
        btn.style.borderColor = sel ? info.color  : '#ddd';
        btn.style.fontWeight  = sel ? '700' : '400';
        btn.style.transform   = sel ? 'scale(1.06)' : 'scale(1)';
    }
    const desc = document.getElementById('obs-nivel-desc');
    if (desc) {
        const info = NIVELES_OBS[nivel];
        desc.textContent  = `${info.label} — ${info.desc}  (factor x${(1/(1-info.obstruccion*0.99)).toFixed(1)})`;
        desc.style.color  = info.color;
    }
}

// Alias de compatibilidad por si algún script externo llama al nombre antiguo
const _seleccionarNivelModal = _seleccionarNivelObs;

/**
 * Activa la edición inline del título, estilo "renombrar carpeta en Windows":
 * selecciona todo el texto, fondo azul claro, cursor de texto.
 */
function _activarEdicionTitulo(el) {
    if (!el) return;
    const hint  = document.getElementById('obstaculo-id-hint');
    const errEl = document.getElementById('obstaculo-id-error');

    el.contentEditable = 'true';
    el.textContent     = '';            // limpiar para que escriban directamente
    el.style.background = 'rgba(52,152,219,0.25)';
    el.style.outline    = '2px solid #3498db';
    el.style.cursor     = 'text';
    el.style.color      = '#fff';
    if (hint)  hint.style.display  = 'none';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    el.focus();

    // Enter confirma; Escape cancela y restaura
    el.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') {
            el.textContent     = '🚧 Nuevo obstáculo';
            el.contentEditable = 'false';
            el.style.background = '';
            el.style.outline    = '';
            el.style.cursor     = 'default';
            if (hint) hint.style.display = '';
        }
    };

    // Al perder el foco: validar y actualizar el título
    el.onblur = () => {
        const raw = el.textContent.trim();
        el.contentEditable = 'false';
        el.style.outline   = '';
        el.style.cursor    = 'default';
        el.style.background = '';

        if (raw === '' || raw === '🚧 Nuevo obstáculo') {
            el.textContent = '🚧 Nuevo obstáculo';
            if (hint) hint.style.display = '';
            return;
        }

        // Validar: solo letras, números, guiones y guiones bajos
        if (!/^[\w\-]+$/.test(raw)) {
            if (errEl) { errEl.textContent = 'El ID solo puede contener letras, números, - y _.'; errEl.style.display = 'block'; }
            el.textContent = '🚧 Nuevo obstáculo';
            if (hint) hint.style.display = '';
            return;
        }

        // Comprobar duplicado
        if (_obsIdEnUso(raw)) {
            if (errEl) { errEl.textContent = `El ID "\${raw}" ya está en uso. Elige otro.`; errEl.style.display = 'block'; }
            el.textContent = '🚧 Nuevo obstáculo';
            if (hint) hint.style.display = '';
            return;
        }

        // ID válido → actualizar título con confirmación visual
        el.textContent  = `🚧 Obstáculo #${raw}`;
        if (hint)  hint.style.display  = 'none';
        if (errEl) errEl.style.display = 'none';
    };
}

function cerrarObstaculoModal() {
    document.getElementById('obstaculo-modal').style.display = 'none';
    _latlngPendiente = null;
}

function confirmarObstaculo() {
    const nivelInput = document.getElementById('obs-nivel-value');
    const nivel  = Math.max(1, Math.min(3, parseInt(nivelInput?.value ?? window._nivelObstaculoPendiente ?? 2, 10) || 2));
    const titulo = document.getElementById('obstaculo-titulo');
    const errEl  = document.getElementById('obstaculo-id-error');

    const textoTitulo = titulo?.textContent?.trim() ?? '';
    const matchId     = textoTitulo.match(/^🚧\s*Obstáculo\s*#([\w\-]+)$/);
    let obsId = null;

    if (matchId) {
        const parsed = matchId[1];
        if (_obsIdEnUso(parsed)) {
            if (errEl) { errEl.textContent = `El ID "\${parsed}" ya está en uso. Cambia el título.`; errEl.style.display = 'block'; }
            return;
        }
        obsId = parsed;
    }

    document.getElementById('obstaculo-modal').style.display = 'none';
    if (_latlngPendiente) crearObstaculo(_latlngPendiente, _obstruccionDeNivel(nivel), obsId);
    _latlngPendiente = null;
}

function iniciarMoverObstaculo(idx) {
    _moverObstaculoIdx = idx;
    map.closePopup();
    showNotification('Haz clic en el mapa para colocar el obstáculo en su nueva posición', 'info');
    document.getElementById('map').style.cursor = 'crosshair';
}

// ── Radio de influencia de un obstáculo (metros) ──────────────────────────────
// Debe ser coherente con el valor enviado al backend en el payload de calcular-ruta.
// 20 m permite capturar la calzada aunque el clic caiga en la acera, sin alcanzar
// vías paralelas en calles estrechas típicas de Puerto Lumbreras.
const RADIO_OBSTACULO_M = 7;

// ── Helper compartido: encuentra segmentos de vía dentro de un radio ─────────
// Usa aritmética pura en grados evitando la creación de objetos L.LatLng en
// el bucle interno. 10 muestras por segmento son suficientes para radios ≤ 25 m.
function _segmentosViasEnRadio(latlng, radioMetros) {
    const segs   = [];
    if (!viasLayer) return segs;
    const oLat   = latlng.lat;
    const oLon   = latlng.lng;
    const rDeg   = radioMetros / 111000;
    const rDeg2  = rDeg * rDeg;

    viasLayer.eachLayer(layer => {
        const geom = layer.feature?.geometry;
        if (geom?.type !== 'LineString') return;
        const coords = geom.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
            const ax = coords[i][0],   ay = coords[i][1];
            const bx = coords[i+1][0], by = coords[i+1][1];
            for (let j = 0; j <= 10; j++) {
                const t    = j / 10;
                const dLat = (ay + t * (by - ay)) - oLat;
                const dLon = (ax + t * (bx - ax)) - oLon;
                if (dLat * dLat + dLon * dLon <= rDeg2) {
                    segs.push({ p1: [ay, ax], p2: [by, bx] });
                    break;
                }
            }
        }
    });
    return segs;
}

function _moverObstaculoA(idx, nuevaLatlng) {
    const obs = obstaculos[idx];
    if (!obs) return;

    // Reubicar marcador y círculo
    obs.marker.setLatLng(nuevaLatlng);
    if (obs.circulo) obs.circulo.setLatLng(nuevaLatlng);
    obs.latlng = nuevaLatlng;

    // Eliminar segmentos bloqueados anteriores y recalcular
    obs.segmentosBloqueados?.forEach(s => map.removeLayer(s));
    obs.segmentosBloqueados = [];

    const color = _colorObs(obs.obstruccion ?? 0.5);
    _segmentosViasEnRadio(nuevaLatlng, RADIO_OBSTACULO_M).forEach(({ p1, p2 }) => {
        obs.segmentosBloqueados.push(
            L.polyline([p1, p2], {
                color, weight: 6, opacity: 1,
                dashArray: '10, 10', className: 'via-bloqueada'
            }).addTo(map)
        );
    });

    // Reasignar popup (el índice no cambia)
    obs.marker.bindPopup(_popupHTML(idx), { maxWidth: 240 });

    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();

    const label = obs.obsId !== null ? `#${obs.obsId}` : `fila ${idx + 1}`;
    showNotification(`Obstáculo ${label} movido`, 'success');
}

// ==================== CLICK EN MAPA ====================

map.on('click', function (e) {
    // Si se está esperando origen/destino, tienen prioridad absoluta: cancelar modo evento
    if ((window._esperandoOrigen || window._esperandoDestino) && window._modoEvento) {
        if (typeof desactivarModoEvento === 'function') desactivarModoEvento();
        // no hacer return: continuar para procesar el punto de origen/destino
    }

    // Modo evento: gestionado exclusivamente por map-widgets.js — no procesar aquí
    if (typeof window._eventoClickHandler === 'function' && window._modoEvento) return;

    // Modo mover: reposiciona conservando el objeto completo (ID incluido)
    if (_moverObstaculoIdx !== null) {
        const idx = _moverObstaculoIdx;
        _moverObstaculoIdx = null;
        document.getElementById('map').style.cursor = '';
        _moverObstaculoA(idx, e.latlng);
        return;
    }

    // Si estamos esperando origen o destino, tienen prioridad absoluta sobre el modo obstáculo
    if (window._esperandoOrigen || window._esperandoDestino) {
        if (modoObstaculo) desactivarModoObstaculo();
        if (modoPoi)       desactivarModoPoi();
        if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
    }

    // Nuevo obstáculo: pedir nivel primero (solo si NO estamos esperando origen/destino)
    if (modoObstaculo && !window._esperandoOrigen && !window._esperandoDestino) {
        _pedirNivelObstaculo(e.latlng);
        return;
    }

    // Nuevo POI manual (solo si NO estamos esperando origen/destino)
    if (modoPoi && !window._esperandoOrigen && !window._esperandoDestino) {
        _onMapClickPoi(e.latlng);
        return;
    }

    if (modoActual !== 'ruta') return;

    if (window._esperandoOrigen) {
        window._esperandoOrigen = false;
        if (marcadorOrigen) map.removeLayer(marcadorOrigen);
        // Solo limpiar destino si no estaba previamente fijado (ej. desde "Cómo llegar")
        if (!puntoDestino) {
            if (marcadorDestino) map.removeLayer(marcadorDestino);
            if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
            window.segmentosBloqueadosCapas?.forEach(c => map.removeLayer(c));
            window.segmentosBloqueadosCapas = [];
            marcadorDestino = null;
        }
        puntoOrigen    = e.latlng;
        marcadorOrigen = L.marker(puntoOrigen, { icon: crearIconoMarcador('📍') }).addTo(map);
        _actualizarLabels();
        _actualizarLabelsMsw();
        ocultarInstruccion(); // Ocultar cursor especial después de seleccionar
        showNotification('✅ Origen fijado', 'success');

    } else if (window._esperandoDestino) {
        window._esperandoDestino = false;
        if (marcadorDestino) map.removeLayer(marcadorDestino);
        if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
        window.segmentosBloqueadosCapas?.forEach(c => map.removeLayer(c));
        window.segmentosBloqueadosCapas = [];
        puntoDestino    = e.latlng;
        marcadorDestino = L.marker(puntoDestino, { icon: crearIconoMarcador('🎯') }).addTo(map);
        _actualizarLabels();
        ocultarInstruccion(); // Ya estaba aquí, pero aseguramos consistencia
        document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');
        _actualizarLabelsMsw();
        showNotification('🎯 Destino fijado', 'success');

    } else if (!puntoOrigen) {
        // Desactivar modos incompatibles
        if (modoObstaculo) desactivarModoObstaculo();
        if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
        puntoOrigen    = e.latlng;
        marcadorOrigen = L.marker(puntoOrigen, { icon: crearIconoMarcador('📍') }).addTo(map);
        _actualizarLabels();
        _actualizarLabelsMsw();
        mostrarInstruccionDestino();
        showNotification('✅ Origen seleccionado. Ahora selecciona el destino', 'success');

    } else if (!puntoDestino) {
        // Desactivar modos incompatibles
        if (modoObstaculo) desactivarModoObstaculo();
        if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
        puntoDestino    = e.latlng;
        marcadorDestino = L.marker(puntoDestino, { icon: crearIconoMarcador('🎯') }).addTo(map);
        _actualizarLabels();
        ocultarInstruccion();
        document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');
        _actualizarLabelsMsw();
        showNotification('🎯 Destino seleccionado. Pulsa "Calcular ruta" para continuar', 'info');
    }
});

// ==================== CALCULAR RUTA ====================

function calcularRuta(forzar = false) {
    if (!puntoOrigen || !puntoDestino) return;

    // Si no hay configuración manual ni autodetectada, intentar autodetectar ahora
    if (!window.camposRutaConfigurados && window.currentViasGeoJSON?.features?.length) {
        if (typeof autodetectarCamposRuta === 'function') autodetectarCamposRuta(window.currentViasGeoJSON);
    }

    // Si sigue sin estar configurado y el usuario puede hacerlo, abrir modal
    if (!window.camposRutaConfigurados && window._userRol !== 'invitado') {
        showNotification('⚙️ Configura los atributos de ruta antes de calcular', 'warning');
        abrirConfigCamposRuta(true);
        return;
    }

    mostrarProgreso('Analizando obstáculos...', 20);

    // Limpiar nulls del array de obstáculos
    obstaculos = obstaculos.filter(Boolean);

    const obstaculosActivos = obstaculos.filter(Boolean).map(obs => ({
        lat:         obs.latlng.lat,
        lon:         obs.latlng.lng,
        radio:       RADIO_OBSTACULO_M,
        nivel:       _nivelObs(obs.obstruccion ?? 0.33),   // delta 1-3 (Amarillo/Naranja/Rojo)
        obstruccion: obs.obstruccion ?? 0.33
    }));

    // Calcular pesos — puede lanzar error si los campos configurados son inválidos
    let pesos;
    try {
        pesos = _calcularPesosAristas();
    } catch (err) {
        ocultarProgreso();
        showNotification('❌ ' + err.message, 'error');
        return;
    }

    // Coeficiente temporal según día y hora de salida
    const fechaEfectiva = (typeof obtenerFechaEfectiva === 'function')
        ? obtenerFechaEfectiva()
        : new Date();
    const coefTemporal = (typeof obtenerCoeficiente === 'function')
        ? obtenerCoeficiente(fechaEfectiva)
        : 1.0;

    // Construir el array de pesos a enviar al backend.
    // OPTIMIZACIÓN: el backend ya tiene los pesos base del grafo calculados en Python.
    // Solo enviamos los segmentos que se desvían del valor base:
    //   - Momento activo → todos los segmentos con factor > 1.0
    //   - Sin Momento    → array vacío (el backend usa sus propios pesos base)
    // Los obstáculos se envían por separado y el backend los penaliza en su propio grafo.
    let pesosEnvio = [];
    if (window.estadoTemporal?.activo && Array.isArray(pesos)) {
        // Solo los segmentos cuyo peso difiere del base por el factor Momento
        pesosEnvio = pesos.filter(p => p.peso !== p.pesoBase);
    }
    // Si hay eventos activos (penalizados por event-manager), incluirlos también
    if (Array.isArray(pesos)) {
        const conEvento = pesos.filter(p => p.factor_evento && p.factor_evento > 1.0);
        if (conEvento.length) {
            const setS = new Set(pesosEnvio.map(p => `${p.s}`));
            conEvento.forEach(p => { if (!setS.has(`${p.s}`)) pesosEnvio.push(p); });
        }
    }

    const payload = {
        origen:          { lat: puntoOrigen.lat,  lon: puntoOrigen.lng  },
        destino:         { lat: puntoDestino.lat, lon: puntoDestino.lng },
        obstaculos:      forzar ? [] : obstaculosActivos,
        pesos:           pesosEnvio,
        coef_temporal:   coefTemporal,
        momento_activo:  window.estadoTemporal?.activo || false,
        momento_dia:     window.estadoTemporal?.dia     || 1,
        momento_hora:    window.estadoTemporal?.hora    || 12,
        modo_tiempo:     window._modoTiempo || 'ahora',
        tipo_vehiculo:   window._vehiculoActual || 'coche',
        emergencia:      window._modoEmergencia || false,
        emerg_velocidad: window._emergVelocidad !== false,   // true → respetar veloc. máx
        emerg_giros:     window._emergGiros     !== false,   // true → respetar restricc. giro
        emerg_sentido:   window._emergSentido   !== false,   // true → respetar sentido circulación
    };

    setTimeout(() => mostrarProgreso('Buscando nodos cercanos...', 40), 200);
    setTimeout(() => mostrarProgreso('Calculando ruta óptima...',   60), 400);

    fetch('/api/calcular-ruta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => { mostrarProgreso('Procesando respuesta...', 80); return r.json(); })
    .then(data => {
        mostrarProgreso('Finalizando...', 95);

        if (data.error) {
            ocultarProgreso();
            showNotification('❌ ' + data.error, 'error');
            return;
        }

        // Si la ruta pasa por obstáculos → avisar pero siempre dibujar
        if (data.usa_obstaculos && !forzar) {
            showNotification('⚠️ La ruta óptima atraviesa ' + data.segmentos_penalizados_usados + ' tramo(s) con obstáculos', 'warning');
        }

        // Dibujar ruta
        // Eliminar SIEMPRE las capas anteriores antes de crear las nuevas
        if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
        if (window._rutaLayerBordeEmergencia) { map.removeLayer(window._rutaLayerBordeEmergencia); window._rutaLayerBordeEmergencia = null; }
        // Eliminar capa del historial si estaba visible
        if (typeof historialLimpiarCapaMapa === 'function') historialLimpiarCapaMapa();

        const esCamion     = (window._vehiculoActual === 'camion');
        const esEmergencia = (window._modoEmergencia === true);

        // Colores de ruta:
        //   Veh. Ligero  → azul corporativo  #85c9f7
        //   Veh. Pesado  → azul oscuro       #2980b9
        // En modo emergencia se añade borde rojo mediante doble capa
        const colorRuta = esCamion ? '#2980b9' : '#85c9f7';
        const pesoRuta  = esCamion ? 7 : 5;

        // Si hay emergencia, dibujar primero una capa más gruesa roja como borde
        if (esEmergencia) {
            const bordeEmergencia = L.geoJSON(data.ruta, {
                style: function() {
                    return { color: '#e74c3c', weight: pesoRuta + 4, opacity: 0.9 };
                }
            }).addTo(map);
            bordeEmergencia.eachLayer(function(l) {
                if (l._path) {
                    l._path.setAttribute('stroke', '#e74c3c');
                    l._path.setAttribute('stroke-width', String(pesoRuta + 4));
                    l._path.setAttribute('stroke-opacity', '0.9');
                    l._path.style.stroke        = '#e74c3c';
                    l._path.style.strokeWidth   = (pesoRuta + 4) + 'px';
                    l._path.style.strokeOpacity = '0.9';
                }
            });
            window._rutaLayerBordeEmergencia = bordeEmergencia;
        }

        rutaLayer = L.geoJSON(data.ruta, {
            style: function() {
                return { color: colorRuta, weight: pesoRuta, opacity: 0.85 };
            }
        }).addTo(map);

        // Forzar el color directamente en el SVG por si algún CSS lo sobreescribe
        rutaLayer.eachLayer(function(l) {
            if (l._path) {
                l._path.setAttribute('stroke', colorRuta);
                l._path.setAttribute('stroke-width', String(pesoRuta));
                l._path.setAttribute('stroke-opacity', '0.85');
                l._path.style.stroke        = colorRuta;
                l._path.style.strokeWidth   = pesoRuta + 'px';
                l._path.style.strokeOpacity = '0.85';
            }
        });

        // Limpiar y dibujar segmentos bloqueados
        window.segmentosBloqueadosCapas.forEach(c => map.removeLayer(c));
        window.segmentosBloqueadosCapas = [];
        if (data.segmentos_bloqueados?.length) {
            const colorSeg = (forzar && data.usa_obstaculos) ? '#27ae60' : '#e74c3c';
            data.segmentos_bloqueados.forEach(seg => {
                const line = L.polyline(
                    [[seg.start.lat, seg.start.lon], [seg.end.lat, seg.end.lon]],
                    { color: colorSeg, weight: 6, opacity: 1, dashArray: '10, 10', className: 'via-bloqueada' }
                ).addTo(map);
                window.segmentosBloqueadosCapas.push(line);
            });
        }

        map.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });

        // Actualizar panel de estadísticas (IDs del panel derecho clásico)
        const props = data.ruta?.properties ?? {};
        window._rutaCalculadaDuracionMinutos = props.tiempo_minutos ?? null;
        _setText('ruta-distancia',           props.distancia_km            ?? '-');
        _setText('ruta-nodos',               props.num_nodos               ?? '-');
        _setText('ruta-tiempo',              _fmtTiempo(props.tiempo_minutos));
        _setText('ruta-horas',               _fmtTiempo(props.tiempo_minutos));
        _setText('ruta-velocidad',           props.velocidad_promedio_km_h  ?? '-');
        _setText('ruta-velocidad-ponderada', props.velocidad_promedio_ponderada?.toFixed(1) ?? '-');
        // Tipo de vía dominante: calculado en frontend cruzando la ruta con el GeoJSON
        const tipoViaDominante = _calcularTipoViaDominante(data.ruta?.geometry?.coordinates);
        _setText('ruta-tipo-via', tipoViaDominante ?? '—');
        document.getElementById('ruta-info')?.style.setProperty('display', 'block');

        // ── Actualizar también los IDs del panel MSW inline ──
        _setText('msw-tiempo-minutos', _fmtTiempo(props.tiempo_minutos));
        _setText('msw-distancia-km',   props.distancia_km?.toFixed(2)   ?? '—');
        _setText('msw-velocidad',      props.velocidad_promedio_km_h    ?? '—');
        _setText('msw-tipo-via',       tipoViaDominante                 ?? '—');
        const msrEl = document.getElementById('msw-resultados-ruta');
        if (msrEl) msrEl.style.display = 'block';

        // ── Registrar ruta en el historial del usuario ──
        if (typeof historialRegistrarRuta === 'function') {
            historialRegistrarRuta({
                origen_label:   `${puntoOrigen.lat.toFixed(5)}, ${puntoOrigen.lng.toFixed(5)}`,
                destino_label:  `${puntoDestino.lat.toFixed(5)}, ${puntoDestino.lng.toFixed(5)}`,
                tiempo_min:     props.tiempo_minutos ?? null,
                distancia_km:   props.distancia_km   ?? null,
                vehiculo:       window._modoEmergencia ? 'emergencia' : (window._vehiculoActual || 'coche'),
                origen_coords:  [puntoOrigen.lat,  puntoOrigen.lng],
                destino_coords: [puntoDestino.lat, puntoDestino.lng],
                geojson_ruta:   data.ruta ?? null,
            });
        }

        // ── Info de eventos activos que afectan la ruta ──
        _mostrarInfoEventosEnRuta(data.ruta?.geometry?.coordinates, props);

        // ── Info de obstáculos que afectan la ruta ──
        _mostrarInfoObstaculosEnRuta(data.ruta?.geometry?.coordinates, props);

        // Mostrar info temporal según el modo seleccionado
        _mostrarInfoTemporal(props.tiempo_minutos ?? 0);

        const warningDiv = document.getElementById('ruta-warning');
        const btnForzar  = document.getElementById('btn-forzar-ruta');
        if (forzar && data.usa_obstaculos) {
            if (warningDiv) {
                warningDiv.style.display = 'block';
                warningDiv.innerHTML = `
                    <strong>✅ RUTA CALCULADA CON OBSTÁCULOS</strong><br>
                    La ruta atraviesa ${data.segmentos_penalizados_usados} segmento(s) bloqueado(s).<br>
                    <span style="color:#27ae60;">●</span> Verde = Tramos obstaculizados que atraviesa
                `;
            }
            if (btnForzar) btnForzar.style.display = 'none';
            showNotification(`✅ Ruta: ${data.segmentos_penalizados_usados} tramo(s) bloqueado(s)`, 'success');
        } else {
            if (warningDiv) warningDiv.style.display = 'none';
            if (btnForzar)  btnForzar.style.display  = 'none';
            showNotification('✅ Ruta calculada evitando obstáculos', 'success');
        }

        ocultarProgreso();
    })
    .catch(err => {
        ocultarProgreso();
        showNotification('Error al calcular ruta', 'error');
        console.error('calcularRuta error:', err);
    });
}

// ==================== PROGRESO ====================

function mostrarProgreso(texto, porcentaje) {
    // Dirige el progreso solo al widget inline; el contenedor legacy se mantiene oculto
    const fill = document.getElementById('msw-progreso-fill');
    const text = document.getElementById('msw-progreso-text');
    const wrap = document.getElementById('msw-progreso-inline');
    const btn  = document.getElementById('msw-btn-calcular');
    if (wrap) wrap.style.display = 'block';
    if (btn)  btn.style.display  = 'none';
    if (fill) fill.style.width   = porcentaje + '%';
    if (text) text.textContent   = texto;
    // Mantener IDs legacy sin mostrarlos (por compatibilidad con el MutationObserver del widget)
    const fillL = document.getElementById('progress-fill');
    const textL = document.getElementById('progress-text');
    if (fillL) fillL.style.width = porcentaje + '%';
    if (textL) textL.textContent = texto;
}

function ocultarProgreso() {
    setTimeout(() => {
        const wrap = document.getElementById('msw-progreso-inline');
        const btn  = document.getElementById('msw-btn-calcular');
        if (wrap) wrap.style.display = 'none';
        if (btn)  btn.style.display  = 'flex';
    }, 500);
}

// ==================== LIMPIAR RUTA ====================

function limpiarRuta() {
    if (marcadorOrigen)  map.removeLayer(marcadorOrigen);
    if (marcadorDestino) map.removeLayer(marcadorDestino);
    if (rutaLayer)       map.removeLayer(rutaLayer);
    if (window._rutaLayerBordeEmergencia) { map.removeLayer(window._rutaLayerBordeEmergencia); window._rutaLayerBordeEmergencia = null; }
    // Eliminar también la capa pintada desde el historial
    if (typeof historialLimpiarCapaMapa === 'function') historialLimpiarCapaMapa();

    window.segmentosBloqueadosCapas.forEach(c => map.removeLayer(c));
    window.segmentosBloqueadosCapas = [];

    puntoOrigen = puntoDestino = marcadorOrigen = marcadorDestino = rutaLayer = null;
    window._rutaCalculadaDuracionMinutos = null;
    _actualizarLabels();

    document.getElementById('ruta-info')?.style.setProperty('display', 'none');
    document.getElementById('ruta-warning')?.style.setProperty('display', 'none');
    document.getElementById('btn-forzar-ruta')?.style.setProperty('display', 'none');
    document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');

    // Limpiar también el panel MSW de resultados inline
    const msrEl = document.getElementById('msw-resultados-ruta');
    if (msrEl) msrEl.style.display = 'none';
    ['msw-tiempo-minutos','msw-distancia-km','msw-velocidad','msw-tipo-via'].forEach(id => _setText(id, '—'));
    const infoTempEl = document.getElementById('msw-info-temporal');
    if (infoTempEl) infoTempEl.innerHTML = '';

    showNotification('Ruta limpiada', 'info');
}

// ==================== OBSTÁCULOS ====================

function activarModoObstaculo() {
    modoObstaculo = !modoObstaculo;
    const btn      = document.getElementById('btn-obstaculo');
    const btnPanel = document.getElementById('btn-obstaculo-panel');
    const mswBtn   = document.getElementById('msw-btn-obstaculo');
    if (modoObstaculo) {
        // Cancelar selección de origen/destino si estaba activa
        const habiaCancelando = window._esperandoDestino || window._esperandoOrigen;
        if (habiaCancelando) {
            window._esperandoDestino = false;
            window._esperandoOrigen  = false;
            ocultarInstruccion();
        }
        // Desactivar modo evento si estaba activo
        const habiaEvento = typeof desactivarModoEvento === 'function' && window._modoEvento;
        if (habiaEvento) desactivarModoEvento();
        // Desactivar modo POI si estaba activo
        if (modoPoi) desactivarModoPoi();
        if (btn)      { btn.classList.add('obstaculo-activo'); btn.textContent = '🚧 Modo Obstáculo ACTIVO'; }
        if (btnPanel) { btnPanel.classList.add('obstaculo-activo'); btnPanel.textContent = '🚧 Activo'; }
        if (mswBtn)   { mswBtn.classList.add('obs-activo'); mswBtn.classList.add('active'); mswBtn.textContent = '🚧 Obstáculos'; }
        document.getElementById('map').classList.add('modo-obstaculo');
        showNotification(
            (habiaCancelando || habiaEvento)
                ? '🚧 Modo anterior cancelado — Modo Obstáculo activo. Haz clic para colocar obstáculos'
                : 'Haz clic en el mapa para colocar obstáculos',
            'info'
        );
    } else {
        if (btn)      { btn.classList.remove('obstaculo-activo'); btn.textContent = '🚧 Crear Obstáculo'; }
        if (btnPanel) { btnPanel.classList.remove('obstaculo-activo'); btnPanel.textContent = '🚧 Colocar'; }
        if (mswBtn)   { mswBtn.classList.remove('obs-activo'); mswBtn.classList.remove('active'); mswBtn.textContent = '🚧 Obstáculos'; }
        document.getElementById('map').classList.remove('modo-obstaculo');
        showNotification('Modo obstáculo desactivado', 'info');
    }
}

function desactivarModoObstaculo() {
    modoObstaculo = false;
    const btn      = document.getElementById('btn-obstaculo');
    const btnPanel = document.getElementById('btn-obstaculo-panel');
    const mswBtn   = document.getElementById('msw-btn-obstaculo');
    if (btn)      { btn.classList.remove('obstaculo-activo'); btn.textContent = '🚧 Crear Obstáculo'; }
    if (btnPanel) { btnPanel.classList.remove('obstaculo-activo'); btnPanel.textContent = '🚧 Colocar'; }
    if (mswBtn)   { mswBtn.classList.remove('obs-activo'); mswBtn.classList.remove('active'); mswBtn.textContent = '🚧 Obstáculos'; }
    document.getElementById('map').classList.remove('modo-obstaculo');
}

/**
 * Comprueba si un obsId ya está en uso en la sesión actual.
 */
function _obsIdEnUso(id) {
    return obstaculos.filter(Boolean).some(o => o.obsId === id);
}

/**
 * Crea un obstáculo en el mapa.
 * @param {L.LatLng} latlng
 * @param {number}   obstruccion  0-1
 * @param {number|null} obsId     ID explícito, o null si el usuario no asignó uno.
 *                                Los obstáculos sin ID muestran su num de fila (dinámico).
 * @param {string}   portal       Dirección postal de referencia, ej. "Calle Mayor 5" (opcional).
 */
function crearObstaculo(latlng, obstruccion = 0.5, obsId = null, portal = '') {
    const color = _colorObs(obstruccion);

    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'marker-obstaculo',
            html: '<div style="font-size:32px;text-shadow:2px 2px 4px rgba(0,0,0,.7);">🚧</div>',
            iconSize: [32, 32], iconAnchor: [16, 32]
        })
    }).addTo(map);

    const circulo = L.circle(latlng, {
        radius: RADIO_OBSTACULO_M, color, fillColor: color, fillOpacity: 0.25, weight: 2
    }).addTo(map);

    // Usar el helper optimizado (sin L.latLng en el bucle interno)
    const segmentosBloqueados = _segmentosViasEnRadio(latlng, RADIO_OBSTACULO_M).map(({ p1, p2 }) =>
        L.polyline([p1, p2], {
            color, weight: 6, opacity: 1,
            dashArray: '10, 10', className: 'via-bloqueada'
        }).addTo(map)
    );

    const idx  = obstaculos.length;
    const obs  = { obsId, marker, circulo, latlng, obstruccion, segmentosBloqueados, portal: portal || '' };
    obstaculos.push(obs);

    marker.bindPopup(_popupHTML(idx), { maxWidth: 240 });
    marker.on('popupclose', () => _aplicarPctPopup(idx));

    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
    const label = obsId !== null ? `#${obsId}` : `sin ID`;
    const _nInfo = NIVELES_OBS[_nivelObs(obstruccion)];
    showNotification(`Obstáculo ${label} — ${_nInfo.label} (${_nInfo.desc}) creado — ${segmentosBloqueados.length} segmento(s) afectado(s)`, 'success');
}

function eliminarObstaculo(index) {
    const obs = obstaculos[index];
    if (!obs) return;
    map.removeLayer(obs.marker);
    if (obs.circulo) map.removeLayer(obs.circulo);
    obs.segmentosBloqueados?.forEach(s => map.removeLayer(s));
    obstaculos[index] = null;
    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
    showNotification(`Obstáculo ${obs.obsId !== null ? '#' + obs.obsId : '(sin ID)'} eliminado`, 'info');
}

function limpiarObstaculos() {
    obstaculos.forEach(obs => {
        if (!obs) return;
        if (obs.marker)  map.removeLayer(obs.marker);
        if (obs.circulo) map.removeLayer(obs.circulo);
        obs.segmentosBloqueados?.forEach(s => map.removeLayer(s));
    });
    obstaculos = [];
    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
    showNotification('Todos los obstáculos eliminados', 'info');
}

// ==================== EXPORTAR / IMPORTAR (backend → QGIS) ====================

async function exportarObstaculos(options = {}) {
    const activos = obstaculos.filter(Boolean);
    if (!activos.length) { showNotification('No hay obstáculos que exportar', 'info'); return; }

    const payload = activos.map((obs, i) => ({
        lat:            obs.latlng.lat,
        lon:            obs.latlng.lng,
        id:             obs.obsId !== null ? obs.obsId : (i + 1),
        nivel:          _nivelObs(obs.obstruccion ?? 0.33),
        nivel_label:    NIVELES_OBS[_nivelObs(obs.obstruccion ?? 0.33)].label,
        vias_afectadas: _nombresViasAfectadas(obs).join(', '),
        fecha_creacion: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }));

    try {
        if (!options.fileHandle) {
            showNotification('Debes pulsar 📁 y elegir ubicación antes de exportar.', 'warning');
            return;
        }
        const formato = options.formato || 'gpkg';
        showNotification(`⏳ Generando ${formato === 'shp' ? 'shapefile ZIP' : 'GeoPackage'}...`, 'info');
        const resp = await fetch('/api/exportar-obstaculos', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ obstaculos: payload, formato }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showNotification('Error: ' + (err.error || resp.status), 'error');
            return;
        }
        const blob = await resp.blob();
        const success = await guardarBlobEnHandle(blob, options.fileHandle);
        if (!success) return;
        const ext = formato === 'shp' ? '.zip' : `.${formato}`;
        showNotification(`${activos.length} obstáculo(s) exportado(s) como ${ext}`, 'success');
    } catch (err) {
        showNotification('Error al exportar: ' + err.message, 'error');
    }
}

/**
 * Importa obstáculos desde un .gpkg respetando los IDs del archivo.
 * Si hay conflictos de ID con la sesión actual, pide al usuario un nuevo ID
 * para cada conflicto. El usuario también puede cancelar obstáculos concretos.
 */
function importarObstaculos(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    input.value = '';

    showNotification('⏳ Importando obstáculos...', 'info');
    fetch('/api/importar-obstaculos', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showNotification('Error: ' + data.error, 'error'); return; }
            _resolverImportacion(data.obstaculos);
        })
        .catch(err => showNotification('Error al importar: ' + err.message, 'error'));
}

/**
 * Exporta obstáculos como CSV.
 */
async function exportarObstaculosCSV(options = {}) {
    const activos = obstaculos.filter(Boolean);
    if (!activos.length) { showNotification('No hay obstáculos que exportar', 'info'); return; }

    const payload = activos.map((obs, i) => {
        const viasAfectadas = _nombresViasAfectadas(obs);
        const escruce = viasAfectadas.length > 1;
        const nivel   = _nivelObs(obs.obstruccion ?? 0.33);
        return {
            id:           i + 1,
            Nombre:       obs.obsId !== null ? obs.obsId : `${i + 1}`,
            coord_lat:    obs.latlng.lat,
            coord_lon:    obs.latlng.lng,
            Nivel:        nivel,
            Nivel_label:  NIVELES_OBS[nivel].label,
            Cruce:        escruce ? 'Sí' : 'No',
            Calles:       viasAfectadas.join('; '),
            Portal:       obs.portal ?? ''
        };
    });

    try {
        if (!options.fileHandle) {
            showNotification('Debes pulsar 📁 y elegir ubicación antes de exportar.', 'warning');
            return;
        }
        showNotification('⏳ Generando CSV...', 'info');
        const resp = await fetch('/api/exportar-obstaculos-csv', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ obstaculos: payload }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showNotification('Error: ' + (err.error || resp.status), 'error');
            return;
        }
        const blob = await resp.blob();
        const success = await guardarBlobEnHandle(blob, options.fileHandle);
        if (!success) return;
        showNotification(`${activos.length} obstáculo(s) exportado(s) como .csv`, 'success');
    } catch (err) {
        showNotification('Error al exportar: ' + err.message, 'error');
    }
}

function importarObstaculosConFormato() {
    document.getElementById('file-obstaculos-import')?.click();
}

function importarObstaculosDesdeArchivo(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const nombre = file.name.toLowerCase();
    if (nombre.endsWith('.csv')) {
        importarObstaculosCSV(input);
        return;
    }
    if (nombre.endsWith('.gpkg') || nombre.endsWith('.geojson') || nombre.endsWith('.zip') || nombre.endsWith('.shp')) {
        importarObstaculos(input);
        return;
    }
    input.value = '';
    showNotification('Formato no soportado. Usa .gpkg, .geojson, .csv, .zip o .shp', 'warning');
}

function abrirModalExportacionObstaculos() {
    const modal = document.getElementById('export-obstaculos-modal');
    const formatoSelect = document.getElementById('export-formato-select');
    const filepathInput = document.getElementById('export-filepath-input');
    if (!modal || !formatoSelect || !filepathInput) return;
    const fecha = new Date().toISOString().slice(0,10);
    formatoSelect.value = 'gpkg';
    filepathInput.value = `obstaculos_${fecha}.gpkg`;
    _obstaculosExportHandle = null;
    modal.style.display = 'flex';
    setTimeout(() => formatoSelect.focus(), 80);
}

function cerrarModalExportacionObstaculos() {
    const modal = document.getElementById('export-obstaculos-modal');
    if (modal) modal.style.display = 'none';
}

function cambiarFormatoExportacionObstaculos() {
    const formatoSelect = document.getElementById('export-formato-select');
    const filepathInput = document.getElementById('export-filepath-input');
    if (!formatoSelect || !filepathInput) return;
    let valor = filepathInput.value.trim();
    if (!valor) valor = `obstaculos_${new Date().toISOString().slice(0,10)}.${formatoSelect.value === 'shp' ? 'zip' : formatoSelect.value}`;
    valor = valor.replace(/\.(gpkg|csv|zip)$/i, '');
    filepathInput.value = `${valor}.${formatoSelect.value === 'shp' ? 'zip' : formatoSelect.value}`;
    _obstaculosExportHandle = null;
}

async function explorarRutaExportacionObstaculos() {
    const formatoSelect = document.getElementById('export-formato-select');
    const filepathInput = document.getElementById('export-filepath-input');
    if (!formatoSelect || !filepathInput) return;
    const formato = formatoSelect.value;
    const sugerido = filepathInput.value.trim() || `obstaculos_${new Date().toISOString().slice(0,10)}.${formato}`;

    if (window.showSaveFilePicker) {
        try {
            const types = formato === 'csv'
                ? [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
                : formato === 'shp'
                    ? [{ description: 'Shapefile ZIP', accept: { 'application/zip': ['.zip'] } }]
                    : [{ description: 'GeoPackage', accept: { 'application/geopackage+sqlite3': ['.gpkg'] } }];

            const handle = await window.showSaveFilePicker({
                suggestedName: sugerido,
                types,
                excludeAcceptAllOption: true,
            });
            _obstaculosExportHandle = handle;
            filepathInput.value = handle.name || sugerido;
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
        }
        return;
    }

    showNotification('El navegador no admite exploración de archivos directa. Escribe un nombre de archivo válido y presiona Exportar.', 'warning');
}

function obtenerNombreArchivoExportacion() {
    const filepathInput = document.getElementById('export-filepath-input');
    const formatoSelect = document.getElementById('export-formato-select');
    const formato = formatoSelect?.value || 'csv';
    let nombre = filepathInput?.value.trim() || '';
    if (!nombre) nombre = `obstaculos_${new Date().toISOString().slice(0,10)}.${formato === 'shp' ? 'zip' : formato}`;
    if (!/\.(gpkg|csv|zip)$/i.test(nombre)) nombre = `${nombre}.${formato === 'shp' ? 'zip' : formato}`;
    nombre = nombre.replace(/[\\/:*?"<>|]+/g, '_');
    return nombre;
}

async function confirmarExportacionObstaculos() {
    const formato = document.getElementById('export-formato-select')?.value || 'gpkg';
    const filename = obtenerNombreArchivoExportacion();
    const handle = _obstaculosExportHandle;
    if (!handle) {
        showNotification('Debes seleccionar ubicación con 📁 antes de exportar.', 'warning');
        return;
    }
    cerrarModalExportacionObstaculos();
    if (formato === 'csv') {
        await exportarObstaculosCSV({ fileHandle: handle, filename });
    } else {
        await exportarObstaculos({ fileHandle: handle, filename, formato });
    }
}

async function guardarBlobEnHandle(blob, fileHandle) {
    if (!fileHandle) return false;
    try {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
    } catch (err) {
        console.error('Guardar archivo con handle falló:', err);
        showNotification('No se pudo guardar el archivo en la ruta seleccionada', 'error');
        return false;
    }
}

function importarObstaculosConFormato() {
    document.getElementById('file-obstaculos-import')?.click();
}

function importarObstaculosDesdeArchivo(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const nombre = file.name.toLowerCase();
    if (nombre.endsWith('.csv')) {
        importarObstaculosCSV(input);
        return;
    }
    if (nombre.endsWith('.gpkg') || nombre.endsWith('.geojson') || nombre.endsWith('.zip') || nombre.endsWith('.shp')) {
        importarObstaculos(input);
        return;
    }
    input.value = '';
    showNotification('Formato no soportado. Usa .gpkg, .geojson, .csv, .zip o .shp', 'warning');
}

function exportarObstaculosConFormato() {
    abrirModalExportacionObstaculos();
}

/**
 * Importa obstáculos desde un archivo CSV.
 */
function importarObstaculosCSV(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    input.value = '';

    showNotification('⏳ Importando obstáculos desde CSV...', 'info');
    fetch('/api/importar-obstaculos-csv', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showNotification('Error: ' + data.error, 'error'); return; }
            if (data.avisos?.length) {
                data.avisos.forEach(av => showNotification('⚠️ ' + av, 'warning'));
            }
            _resolverImportacion(data.obstaculos);
        })
        .catch(err => showNotification('Error al importar: ' + err.message, 'error'));
}

/**
 * Recibe el array crudo del backend y gestiona los conflictos de ID uno a uno.
 * Cuando todos están resueltos, llama a _aplicarImportacion.
 */
function _resolverImportacion(obsArray) {
    // Normalizar: cada elemento tendrá { lat, lon, obstruccion, id, nombre }
    const pendientes = obsArray.map(o => {
        // Acepta nivel directo (1-3) o valor de obstruccion (0-1) directo.
        // Archivos legacy con campo 'pct' (sistema antiguo de porcentajes) se mapean
        // al nivel más cercano para mantener compatibilidad de importación.
        let obstruccion;
        if (o.nivel !== undefined && o.nivel !== null) {
            const nivel = Math.max(1, Math.min(3, parseInt(o.nivel, 10) || 1));
            obstruccion = _obstruccionDeNivel(nivel);
        } else if (o.obstruccion !== undefined && o.obstruccion !== null) {
            // Valor directo 0-1: snapear al nivel más cercano
            obstruccion = _obstruccionDeNivel(_nivelObs(parseFloat(o.obstruccion)));
        } else {
            obstruccion = 0.33; // Amarillo por defecto
        }
        return {
            lat: o.lat,
            lon: o.lon,
            obstruccion,
            id:  (o.id !== null && o.id !== undefined && String(o.id).trim() !== '' && String(o.id).trim() !== 'None')
                 ? String(o.id).trim()
                 : null,
            nombre: (o.Nombre ?? o.nombre) || null,
            cruce: o.Cruce || o.cruce || 'No',
            calles: o.Calles || o.calles || '',
            portal: o.portal || o.Portal || ''
        };
    });

    // Resolver conflictos iterativamente
    _resolverSiguienteConflicto(pendientes, 0, []);
}

function _resolverSiguienteConflicto(pendientes, idx, resueltos) {
    // Fin: todos procesados → aplicar
    if (idx >= pendientes.length) {
        _aplicarImportacion(resueltos);
        return;
    }

    const obs = pendientes[idx];
    const idAUsar = obs.nombre || obs.id;

    // Sin ID en el gpkg → importar sin ID fijo
    if (idAUsar === null) {
        resueltos.push({ ...obs, id: null });
        _resolverSiguienteConflicto(pendientes, idx + 1, resueltos);
        return;
    }

    // Sin conflicto → mantener el ID / Nombre
    if (!_obsIdEnUso(idAUsar) && !resueltos.some(r => (r.nombre || r.id) === idAUsar)) {
        resueltos.push(obs);
        _resolverSiguienteConflicto(pendientes, idx + 1, resueltos);
        return;
    }

    // CONFLICTO: pedir nuevo Nombre/ID al usuario
    _mostrarModalConflictoId(obs, pendientes, idx, resueltos);
}

function _mostrarModalConflictoId(obs, pendientes, idx, resueltos) {
    // Sugerir un nombre libre basado en el Nombre/ID en conflicto
    const usados = new Set(obstaculos.filter(Boolean).map(o => o.obsId).filter(id => id !== null));
    const actual = obs.nombre || obs.id;
    let sugerido = actual ? `${actual}_2` : 'nuevo_nombre';
    let n = 2; while (usados.has(sugerido) || resueltos.some(r => (r.nombre || r.id) === sugerido)) { n++; sugerido = `${actual}_${n}`; }

    // Reutilizar el modal genérico de edición (mbox)
    const modalEl   = document.getElementById('table-edit-modal');
    const titleEl   = document.getElementById('modal-title');
    const bodyEl    = document.getElementById('modal-body');
    const confirmEl = document.getElementById('modal-confirm');
    const cancelEl  = modalEl?.querySelector('.mbox-btn-cancel');
    if (!modalEl) return;

    titleEl.textContent = '⚠️ Conflicto de nombre al importar';
    bodyEl.innerHTML = `
        <div class="mbox-row">
            <p style="font-size:13px;color:#555;margin-bottom:10px;">
                El obstáculo <strong>${actual}</strong> del archivo ya existe en el mapa.<br>
                Cambia el Nombre antes de importarlo, o cancela este obstáculo.
            </p>
            <label>Nuevo Nombre</label>
            <input id="conflict-id-input" type="text" value="${sugerido}"
                style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
            <div id="conflict-id-error" style="color:#e74c3c;font-size:12px;margin-top:4px;display:none;"></div>
        </div>
        <div class="mbox-row" style="font-size:12px;color:#7f8c8d;">
            Obstáculo: ${NIVELES_OBS[_nivelObs(obs.obstruccion ?? 0.33)]?.label ?? 'Nivel Amarillo'} · (${obs.lat.toFixed(5)}, ${obs.lon.toFixed(5)})
        </div>
    `;

    // Botón confirmar → validar y continuar
    confirmEl.textContent = '✅ Aplicar Nombre';
    confirmEl.onclick = () => {
        const input = document.getElementById('conflict-id-input');
        const nuevoNombre = (input?.value ?? '').trim();
        const errorEl = document.getElementById('conflict-id-error');

        if (!nuevoNombre || !/^[\w\-]+$/.test(nuevoNombre)) {
            if (errorEl) { errorEl.textContent = 'Introduce un Nombre válido (letras, números, - o _).'; errorEl.style.display = 'block'; }
            return;
        }
        if (_obsIdEnUso(nuevoNombre) || resueltos.some(r => (r.nombre || r.id) === nuevoNombre)) {
            if (errorEl) { errorEl.textContent = `El Nombre "${nuevoNombre}" ya está en uso. Elige otro.`; errorEl.style.display = 'block'; }
            return;
        }

        modalEl.style.display = 'none';
        resueltos.push({ ...obs, nombre: nuevoNombre });
        _resolverSiguienteConflicto(pendientes, idx + 1, resueltos);
    };

    // Botón cancelar → saltar este obstáculo
    if (cancelEl) {
        cancelEl.textContent = '🗑️ Omitir este obstáculo';
        cancelEl.onclick = () => {
            modalEl.style.display = 'none';
            // Restaurar texto original del botón cancelar para uso posterior
            cancelEl.textContent = 'Cancelar';
            cancelEl.onclick     = () => cerrarModal();
            _resolverSiguienteConflicto(pendientes, idx + 1, resueltos);
        };
    }

    modalEl.style.display = 'flex';
}

function _aplicarImportacion(resueltos) {
    if (!resueltos.length) {
        showNotification('No se importó ningún obstáculo', 'info');
        return;
    }
    resueltos.forEach(obs => {
        // Usar el Nombre del CSV si existe, sino usar el id
        const obsId = obs.nombre || obs.id;
        crearObstaculo(L.latLng(obs.lat, obs.lon), obs.obstruccion ?? 0.5, obsId, obs.portal || '');
    });
    showNotification(`${resueltos.length} obstáculo(s) importado(s)`, 'success');
}


// ==================== CONFIGURACIÓN DE CAMPOS DE RUTA ====================

// Inicializar estado global de campos
if (!window.camposRuta) window.camposRuta = { velocidad: null, carriles: null, tipo: null };
if (!window.camposRutaConfigurados) window.camposRutaConfigurados = false;

// ==================== AUTODETECCIÓN DE CAMPOS ====================

/**
 * Intenta detectar automáticamente los campos de velocidad, carriles y tipo
 * a partir de los nombres de columna del GeoJSON. Se llama desde layer-manager.js
 * justo después de cargar la capa de vías.
 */
function autodetectarCamposRuta(geojson) {
    if (!geojson?.features?.length) return;

    const cols = new Set();
    geojson.features.forEach(f => {
        if (f?.properties) Object.keys(f.properties).forEach(k => cols.add(k.toLowerCase()));
    });

    // Candidatos ordenados por preferencia
    const candidatosVel  = ['maxspeed', 'speed', 'velocidad', 'vel_max', 'speed_limit'];
    const candidatosCarr = ['lanes', 'carriles', 'num_lanes', 'lane_count'];
    const candidatosTipo = ['highway', 'tipo', 'road_type', 'fclass', 'type'];

    // Buscar en las propiedades reales (case-insensitive → recuperar nombre original)
    const propsSample = geojson.features[0]?.properties || {};
    const keysOrig    = Object.keys(propsSample);

    function encontrar(candidatos) {
        for (const c of candidatos) {
            const found = keysOrig.find(k => k.toLowerCase() === c);
            if (found) return found;
        }
        return null;
    }

    const vel  = encontrar(candidatosVel);
    const carr = encontrar(candidatosCarr);
    const tipo = encontrar(candidatosTipo);

    if (vel && carr) {
        window.camposRuta = { velocidad: vel, carriles: carr, tipo: tipo };
        window.camposRutaConfigurados = true;
        console.log(`✅ Campos autodetectados — velocidad: ${vel}, carriles: ${carr}, tipo: ${tipo || '(ninguno)'}`);
    }
}


function abrirConfigCamposRuta(desdeFlujoRuta = false) {
    if (window._userRol === 'invitado') {
        showNotification('Regístrate para configurar los campos de ruta', 'warning');
        return;
    }
    const geo = window.currentViasGeoJSON;
    if (!geo?.features?.length) {
        showNotification('Carga la capa de Vías antes de configurar los campos', 'warning');
        return;
    }

    // Recoger columnas disponibles en la capa
    const cols = new Set();
    geo.features.forEach(f => {
        if (f?.properties) Object.keys(f.properties).forEach(k => cols.add(k));
    });
    const colsArr = Array.from(cols).sort();

    // Opción especial "ninguno / usar defecto"
    const opcionNone = '<option value="">(usar valor por defecto)</option>';
    const opciones   = colsArr.map(c => `<option value="${c}">${c}</option>`).join('');
    const optsAll    = opcionNone + opciones;

    // Poblar selectores y preseleccionar valor actual
    ['velocidad', 'carriles', 'tipo'].forEach(campo => {
        const sel = document.getElementById('crm-' + campo);
        if (!sel) return;
        sel.innerHTML = optsAll;
        sel.value = window.camposRuta[campo] || '';
    });

    // Recordar si el modal se abrió dentro del flujo de "Cómo llegar" para,
    // al cerrarlo, retomar (o no) el cursor de selección de origen/destino
    window._configCamposDesdeFlujoRuta = !!desdeFlujoRuta;

    document.getElementById('campos-ruta-modal').style.display = 'flex';
}

function cerrarConfigCamposRuta() {
    document.getElementById('campos-ruta-modal').style.display = 'none';

    // Solo retomar el cursor de "elegir origen" si el modal se abrió desde
    // el flujo de cálculo de ruta; si se abrió desde el panel de capas, no
    // hay ninguna selección de punto en curso que retomar.
    if (window._configCamposDesdeFlujoRuta) {
        mostrarInstruccionOrigen();
    }

    if (!window.camposRutaConfigurados) {
        // No había config previa: usar defaults silenciosamente
        window.camposRuta = { velocidad: null, carriles: null, tipo: null };
        showNotification('Modo rutas activado (usando valores por defecto)', 'info');
    }
}

function guardarConfigCamposRuta() {
    const colVelocidad = document.getElementById('crm-velocidad')?.value || null;
    const colCarriles  = document.getElementById('crm-carriles')?.value  || null;
    const colTipo      = document.getElementById('crm-tipo')?.value      || null;

    // Velocidad y carriles son obligatorios
    if (!colVelocidad) {
        showNotification('⚠️ El campo de Velocidad máxima es obligatorio', 'warning');
        return;
    }
    if (!colCarriles) {
        showNotification('⚠️ El campo de Nº de carriles es obligatorio', 'warning');
        return;
    }

    // Validar tipos leyendo los valores reales de la capa
    const geo = window.currentViasGeoJSON;
    const muestra = geo?.features?.slice(0, 20) ?? [];   // muestra de 20 features

    const errorVel  = _validarCampoNumerico(muestra, colVelocidad);
    const errorCarr = _validarCampoNumerico(muestra, colCarriles);
    const errorTipo = colTipo ? _validarCampoTexto(muestra, colTipo) : null;

    if (errorVel) {
        showNotification(`❌ Velocidad máxima — ${errorVel}`, 'error');
        return;
    }
    if (errorCarr) {
        showNotification(`❌ Nº de carriles — ${errorCarr}`, 'error');
        return;
    }
    if (errorTipo) {
        showNotification(`❌ Tipo de vía — ${errorTipo}`, 'error');
        return;
    }

    window.camposRuta = { velocidad: colVelocidad, carriles: colCarriles, tipo: colTipo };
    window.camposRutaConfigurados = true;
    document.getElementById('campos-ruta-modal').style.display = 'none';

    const partes = [];
    if (window.camposRuta.velocidad) partes.push(`velocidad→${window.camposRuta.velocidad}`);
    if (window.camposRuta.carriles)  partes.push(`carriles→${window.camposRuta.carriles}`);
    if (window.camposRuta.tipo)      partes.push(`tipo→${window.camposRuta.tipo}`);
    const resumen = partes.length ? partes.join(', ') : 'valores por defecto';
    // Invalidar caché de pesos: la configuración de campos ha cambiado
    _invalidarPesosCache();
    showNotification('✅ Configuración guardada: ' + resumen, 'success');

    // Solo retomar el cursor de "elegir origen" si el modal se abrió desde
    // el flujo de cálculo de ruta; si se abrió desde el panel de capas, no
    // hay ninguna selección de punto en curso que retomar.
    if (window._configCamposDesdeFlujoRuta) {
        mostrarInstruccionOrigen();
    }
}


// ==================== VALIDACIÓN DE CAMPOS ====================

/**
 * Comprueba que el campo 'col' en la muestra de features sea numérico.
 * Devuelve un mensaje de error si falla, o null si es válido.
 */
function _validarCampoNumerico(muestra, col) {
    const valores = muestra
        .map(f => f?.properties?.[col])
        .filter(v => v !== null && v !== undefined && v !== '');

    if (valores.length === 0)
        return `El atributo "${col}" no existe en la capa o todos sus valores están vacíos.`;

    const invalidos = valores.filter(v => isNaN(parseFloat(String(v))));
    if (invalidos.length > 0) {
        const ejemplos = [...new Set(invalidos.map(String))].slice(0, 3).join(', ');
        return `El atributo "${col}" contiene valores no numéricos: ${ejemplos}… Selecciona una columna numérica.`;
    }
    return null;
}

/**
 * Comprueba que el campo 'col' sea de tipo texto (no puramente numérico).
 * Devuelve un mensaje de error si falla, o null si es válido.
 */
function _validarCampoTexto(muestra, col) {
    const valores = muestra
        .map(f => f?.properties?.[col])
        .filter(v => v !== null && v !== undefined && v !== '');

    if (valores.length === 0)
        return `El atributo "${col}" no existe en la capa o todos sus valores están vacíos.`;

    const todosNumericos = valores.every(v => !isNaN(parseFloat(String(v))) && String(v).trim() !== '');
    if (todosNumericos) {
        const ejemplos = [...new Set(valores.map(String))].slice(0, 3).join(', ');
        return `El atributo "${col}" parece numérico (valores: ${ejemplos}…). Tipo de vía debería ser texto (ej: residential, primary…).`;
    }
    return null;
}

// ==================== HELPERS PRIVADOS ====================

function _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/**
 * Formatea una duración en minutos a una cadena legible con segundos.
 * Ejemplos:
 *   0.083 min → "5 s"
 *   1.5   min → "1 min 30 s"
 *   75    min → "1 h 15 min"
 *   90.5  min → "1 h 30 min 30 s"
 *
 * @param {number} minutos - Duración en minutos (puede ser decimal)
 * @returns {string}
 */
function _fmtTiempo(minutos) {
    if (minutos == null || isNaN(minutos)) return '—';
    const totalSeg = Math.round(minutos * 60);
    const h   = Math.floor(totalSeg / 3600);
    const m   = Math.floor((totalSeg % 3600) / 60);
    const s   = totalSeg % 60;
    if (h > 0) {
        return s > 0
            ? `${h} h ${m} min ${s} s`
            : `${h} h ${m} min`;
    }
    if (m > 0) {
        return s > 0
            ? `${m} min ${s} s`
            : `${m} min`;
    }
    return `${s} s`;
}
// ==================== CÁLCULO DE PESOS EN FRONTEND ====================

/**
 * Recorre el GeoJSON de vías y calcula el peso de cada arista según los
 * campos configurados por el usuario. Si un campo no está configurado,
 * usa el valor por defecto.
 *
 * Devuelve un array de { s:[lon,lat], e:[lon,lat], peso, tiempo_min }
 * listo para enviar al backend.
 */
// ── Caché de pesos base ────────────────────────────────────────────────────
// Los pesos base (haversine + velocidad + carriles + tipo) son estáticos:
// solo cambian cuando se carga una nueva capa de vías o se modifica la
// configuración de campos. Se invalidan explícitamente en esos momentos.
let _pesosBaseCache      = null;   // Array de { s, e, pesoBase, tiempoMin }
let _pesosBaseCacheKey   = null;   // Fingerprint para detectar cambios

function _invalidarPesosCache() {
    _pesosBaseCache    = null;
    _pesosBaseCacheKey = null;
}

// Exponer para que layer-manager.js y guardarConfigCamposRuta puedan invalidar
window.invalidarPesosCache = _invalidarPesosCache;

function _calcularPesosAristas() {
    const geo = window.currentViasGeoJSON;
    if (!geo?.features?.length) throw new Error('No hay capa de vías cargada.');

    const campos   = window.camposRuta || {};
    const factores = window.factoresVia || {};

    // ── Clave de caché: número de features + configuración de campos ──────
    const cacheKey = `${geo.features.length}|${campos.velocidad}|${campos.carriles}|${campos.tipo}`;

    if (_pesosBaseCache && _pesosBaseCacheKey === cacheKey) {
        // Caché válida: solo aplicar factores de Momento si están activos
        if (!window.estadoTemporal?.activo) return _pesosBaseCache;

        // Aplicar factor Momento sobre los pesos base cacheados
        return _pesosBaseCache.map(p => {
            const fm = (typeof window.obtenerFactorMomentoParaSegmento === 'function')
                ? window.obtenerFactorMomentoParaSegmento(p.s, p.e)
                : 1.0;
            if (fm === 1.0) return p;
            return { s: p.s, e: p.e, peso: p.pesoBase * fm, tiempo_min: p.tiempoMin * fm };
        });
    }

    // ── Calcular pesos base desde cero ────────────────────────────────────
    const base = [];

    for (const feature of geo.features) {
        const props = feature?.properties || {};
        const geom  = feature?.geometry;
        if (!geom) continue;

        const rawSpeed = campos.velocidad ? props[campos.velocidad] : (props.maxspeed ?? props.speed ?? 50);
        const rawLanes = campos.carriles  ? props[campos.carriles]  : (props.lanes    ?? props.num_lanes ?? 1);
        const rawTipo  = campos.tipo      ? props[campos.tipo]      : (props.highway  ?? null);

        const velocidad = _parsearVelocidad(rawSpeed) ?? 50;
        const carriles  = _parsearCarriles(rawLanes)  ?? 1;

        const fLanes = carriles >= 3 ? 0.8 : (carriles === 2 ? 0.9 : 1.0);
        const fTipo  = (rawTipo && factores[String(rawTipo)]) ? factores[String(rawTipo)] : 1.0;

        const lines = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
        for (const line of lines) {
            for (let i = 0; i < line.length - 1; i++) {
                const s         = line[i];
                const e         = line[i + 1];
                const distKm    = _haversineKm(s[1], s[0], e[1], e[0]);
                const tiempoMin = distKm / velocidad * 60;
                const pesoBase  = tiempoMin * fTipo * fLanes;
                base.push({ s, e, pesoBase, tiempoMin,
                             peso: pesoBase, tiempo_min: tiempoMin });
            }
        }
    }

    // Guardar en caché
    _pesosBaseCache    = base;
    _pesosBaseCacheKey = cacheKey;

    // Aplicar factor Momento si está activo
    if (!window.estadoTemporal?.activo) return base;

    return base.map(p => {
        const fm = (typeof window.obtenerFactorMomentoParaSegmento === 'function')
            ? window.obtenerFactorMomentoParaSegmento(p.s, p.e)
            : 1.0;
        if (fm === 1.0) return p;
        return { s: p.s, e: p.e, peso: p.pesoBase * fm, tiempo_min: p.tiempoMin * fm };
    });
}

function _parsearVelocidad(val) {
    if (val === null || val === undefined || val === '') return null;
    const n = parseFloat(String(val).replace(/[^\d.]/g, ''));
    return isNaN(n) || n <= 0 ? null : Math.min(Math.max(n, 5), 200);
}

function _parsearCarriles(val) {
    if (val === null || val === undefined || val === '') return null;
    const n = parseInt(String(val), 10);
    return isNaN(n) || n <= 0 ? null : n;
}

function _haversineKm(lat1, lon1, lat2, lon2) {
    const R  = 6371;
    const d1 = (lat2 - lat1) * Math.PI / 180;
    const d2 = (lon2 - lon1) * Math.PI / 180;
    const a  = Math.sin(d1/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(d2/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ==================== PREVISUALIZACIÓN DE VALORES PROBLEMÁTICOS ====================

/**
 * Al seleccionar un campo, muestra los valores vacíos/null con borde naranja
 * directamente en el select, y lista cuántos elementos tienen ese problema.
 */
function previsualizarCampo(tipo) {
    const selectId  = 'crm-' + tipo;
    const previewId = 'crm-preview-' + tipo;
    const sel       = document.getElementById(selectId);
    const previewEl = document.getElementById(previewId);
    if (!sel || !previewEl) return;

    const col = sel.value;
    if (!col) {
        sel.style.borderColor = '';
        previewEl.innerHTML   = '';
        return;
    }

    const geo = window.currentViasGeoJSON;
    if (!geo?.features?.length) return;

    // Contar elementos con valor vacío, null, 0 o NaN según el tipo
    let vacios = 0;
    let total  = geo.features.length;

    geo.features.forEach(f => {
        const v = f?.properties?.[col];
        const esProblematico = (v === null || v === undefined || v === '' || v === 'None' || v === 'NaN' ||
            (tipo === 'velocidad' && (parseFloat(v) <= 0 || isNaN(parseFloat(v)))) ||
            (tipo === 'carriles'  && (parseInt(v)   <= 0 || isNaN(parseInt(v)))));
        if (esProblematico) vacios++;
    });

    if (vacios > 0) {
        sel.style.borderColor   = '#e67e22';
        sel.style.boxShadow     = '0 0 0 2px rgba(230,126,34,0.25)';
        const pct = Math.round(vacios / total * 100);
        previewEl.innerHTML = `
            <span class="crm-preview-warn">
                ⚠️ ${vacios} de ${total} elementos (${pct}%) tienen valores vacíos o inválidos en <strong>${col}</strong>.
                Se usará el valor por defecto para esos elementos.
            </span>`;
    } else {
        sel.style.borderColor = '#2ecc71';
        sel.style.boxShadow   = '0 0 0 2px rgba(46,204,113,0.25)';
        previewEl.innerHTML   = `<span class="crm-preview-ok">✅ Todos los elementos tienen valor válido en <strong>${col}</strong>.</span>`;
    }
}

// ── Caché del índice de tipo de vía (se invalida junto con _pesosBaseCache) ──
let _tipoViaSegmentosCache    = null;
let _tipoViaCacheKey          = null;

// Extender la invalidación global para incluir este índice
const _invalidarPesosCacheOrig = window.invalidarPesosCache || function(){};
window.invalidarPesosCache = function () {
    _invalidarPesosCacheOrig();
    _tipoViaSegmentosCache = null;
    _tipoViaCacheKey       = null;
};

// ==================== TIPO DE VÍA DOMINANTE ====================

/**
 * Dado el array de coordenadas [lon,lat] de la ruta calculada,
 * busca en el GeoJSON de vías qué feature es más cercana a cada
 * segmento y acumula el valor de su campo "tipo". Devuelve el más frecuente.
 * El índice de segmentos se cachea entre llamadas.
 */
function _calcularTipoViaDominante(coordsRuta) {
    const campTipo = window.camposRuta?.tipo;
    if (!campTipo) return null;

    const geo = window.currentViasGeoJSON;
    if (!geo?.features?.length || !coordsRuta?.length) return null;

    // ── Caché del índice de segmentos ──────────────────────────────────────
    const cacheKey = `${geo.features.length}|${campTipo}`;
    if (!_tipoViaSegmentosCache || _tipoViaCacheKey !== cacheKey) {
        const idx = [];
        for (const feature of geo.features) {
            const tipo = feature?.properties?.[campTipo];
            if (tipo === null || tipo === undefined) continue;
            const tipoStr = String(tipo);
            const geom    = feature.geometry;
            const lines   = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
            for (const line of lines) {
                for (let i = 0; i < line.length - 1; i++) {
                    const midLon = (line[i][0] + line[i+1][0]) / 2;
                    const midLat = (line[i][1] + line[i+1][1]) / 2;
                    idx.push({ midLon, midLat, tipo: tipoStr });
                }
            }
        }
        _tipoViaSegmentosCache = idx;
        _tipoViaCacheKey       = cacheKey;
    }

    const segmentos = _tipoViaSegmentosCache;
    if (!segmentos.length) return null;

    // ── Contar tipo dominante en la ruta ───────────────────────────────────
    const conteo = {};
    for (let i = 0; i < coordsRuta.length - 1; i++) {
        const midLon = (coordsRuta[i][0] + coordsRuta[i+1][0]) / 2;
        const midLat = (coordsRuta[i][1] + coordsRuta[i+1][1]) / 2;

        let minDist = Infinity;
        let tipoMasCercano = null;
        for (const seg of segmentos) {
            const dLon = midLon - seg.midLon;
            const dLat = midLat - seg.midLat;
            const d    = dLon * dLon + dLat * dLat;
            if (d < minDist) { minDist = d; tipoMasCercano = seg.tipo; }
        }

        if (tipoMasCercano) conteo[tipoMasCercano] = (conteo[tipoMasCercano] || 0) + 1;
    }

    if (!Object.keys(conteo).length) return null;
    return Object.entries(conteo).sort((a, b) => b[1] - a[1])[0][0];
}

// ==================== INFO TEMPORAL EN RESULTADO ====================

function _mostrarInfoTemporal(tiempoMinutos) {
    // Buscar o crear el div de info temporal dentro de ruta-info
    let infoDiv = document.getElementById('ruta-temporal-info');
    if (!infoDiv) {
        const rutaInfo = document.getElementById('ruta-info');
        if (!rutaInfo) return;
        infoDiv = document.createElement('div');
        infoDiv.id = 'ruta-temporal-info';
        infoDiv.style.cssText = 'margin-top:8px;padding:8px;border-radius:6px;font-size:12px;';
        rutaInfo.appendChild(infoDiv);
    }

    const modo   = window._modoTiempo || 'ahora';
    const fecha  = obtenerFechaEfectiva();
    const coef   = (typeof obtenerCoeficiente === 'function') ? obtenerCoeficiente(fecha) : 1.0;
    const info   = (typeof infoCoeficiente === 'function') ? infoCoeficiente(fecha) : null;

    // El backend ya devuelve el tiempo real de la ruta, con el coeficiente
    // temporal y penalizaciones aplicadas. Aquí solo usamos esa duración para
    // calcular la hora de salida/llegada.
    const tiempoAjustado = tiempoMinutos;

    const _fmt = d => {
        const h = String(d.getHours()).padStart(2,'0');
        const m = String(d.getMinutes()).padStart(2,'0');
        return `${h}:${m}`;
    };
    const _fmtFecha = d => {
        const dias  = ['dom','lun','mar','mié','jue','vie','sáb'];
        return `${dias[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
    };

    if (modo === 'ahora') {
        const llegada = new Date(fecha.getTime() + tiempoAjustado * 60000);
        infoDiv.style.background = info ? info.color + '18' : '#f0f0f0';
        infoDiv.style.border     = `1px solid ${info?.color || '#ccc'}`;
        infoDiv.innerHTML = info ? `
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="background:${info.color};color:#fff;border-radius:4px;padding:1px 7px;font-weight:700;">
                    ${info.emoji} ${info.tipoLabel}
                </span>
                <span style="color:#555;">${info.franjaLabel} · x${coef.toFixed(2)}</span>
            </div>
            <div style="margin-top:5px;color:#2c3e50;">
                🚀 Salida: <strong>${_fmt(fecha)}</strong> &nbsp;
                🏁 Llegada estimada: <strong>${_fmt(llegada)}</strong>
                <span style="color:#7f8c8d;"> (${_fmtFecha(llegada)})</span>
            </div>
        ` : '';

    } else if (modo === 'salir') {
        const llegada = new Date(fecha.getTime() + tiempoAjustado * 60000);
        infoDiv.style.background = '#eaf4fb';
        infoDiv.style.border     = '1px solid #3498db';
        infoDiv.innerHTML = info ? `
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="background:${info.color};color:#fff;border-radius:4px;padding:1px 7px;font-weight:700;">
                    ${info.emoji} ${info.tipoLabel}
                </span>
                <span style="color:#555;">${info.franjaLabel} · x${coef.toFixed(2)}</span>
            </div>
            <div style="margin-top:5px;color:#2c3e50;">
                📅 Salida: <strong>${_fmt(fecha)} ${_fmtFecha(fecha)}</strong><br>
                🏁 Llegada estimada: <strong>${_fmt(llegada)}</strong>
                <span style="color:#7f8c8d;"> (${_fmtFecha(llegada)})</span>
            </div>
        ` : '';

    } else if (modo === 'llegar') {
        // Retroceder en el tiempo: hora de salida = llegada deseada - tiempo ajustado
        const salidaMs  = fecha.getTime() - tiempoAjustado * 60000;
        const horaSalida = new Date(salidaMs);
        infoDiv.style.background = '#fef9e7';
        infoDiv.style.border     = '1px solid #f39c12';
        infoDiv.innerHTML = info ? `
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="background:${info.color};color:#fff;border-radius:4px;padding:1px 7px;font-weight:700;">
                    ${info.emoji} ${info.tipoLabel}
                </span>
                <span style="color:#555;">${info.franjaLabel} · x${coef.toFixed(2)}</span>
            </div>
            <div style="margin-top:5px;color:#2c3e50;">
                🏁 Quieres llegar: <strong>${_fmt(fecha)} ${_fmtFecha(fecha)}</strong><br>
                🚀 Debes salir como tarde: <strong style="color:#e67e22;font-size:14px;">${_fmt(horaSalida)}</strong>
                <span style="color:#7f8c8d;"> (${_fmtFecha(horaSalida)})</span>
            </div>
        ` : '';
    }
}
// ==================== INFO DE EVENTOS EN RUTA ====================

/**
 * Muestra en el panel MSW qué eventos activos afectan a la ruta calculada
 * y cuánto la penalizan, usando window.obtenerPenalizacionEventos de event-manager.js.
 *
 * @param {number[][]} coordsRuta  - Array [[lon,lat], ...] de la ruta
 * @param {number}     tiempoBase  - Tiempo base en minutos (sin penalización de eventos)
 */
function _mostrarInfoEventosEnRuta(coordsRuta, props) {
    const infoEl = document.getElementById('msw-info-temporal');
    if (!infoEl) return;
    if (typeof window.obtenerPenalizacionEventos !== 'function') return;
    if (!coordsRuta?.length) return;

    const fechaEfectiva = (typeof obtenerFechaEfectiva === 'function')
        ? obtenerFechaEfectiva()
        : new Date();

    let factorMax = 1.0;
    let eventosAfectantes = 0;
    for (let i = 0; i < coordsRuta.length - 1; i++) {
        const f = window.obtenerPenalizacionEventos(coordsRuta[i], coordsRuta[i + 1], fechaEfectiva);
        if (f > factorMax) factorMax = f;
        if (f > 1.0) eventosAfectantes++;
    }

    // Limpiar bloque previo en cualquier caso
    const evDivOld = document.getElementById('ruta-evento-info');
    if (evDivOld) evDivOld.remove();

    if (factorMax <= 1.0) return;

    const tiempoBase = typeof props?.tiempo_minutos_base === 'number'
        ? props.tiempo_minutos_base
        : props?.tiempo_minutos ?? 0;
    const tiempoReal  = props?.tiempo_minutos ?? 0;
    const tiempoExtra = (typeof props?.tiempo_extra_eventos === 'number')
        ? _fmtTiempo(props.tiempo_extra_eventos)
        : _fmtTiempo(Math.max(0, tiempoReal - tiempoBase) / 60);
    const color = factorMax >= 3.5 ? '#e74c3c' : factorMax >= 2 ? '#f39c12' : '#8e44ad';

    const evDiv = document.createElement('div');
    evDiv.id = 'ruta-evento-info';
    evDiv.style.cssText = `margin-top:8px;padding:8px;border-radius:6px;font-size:12px;
        background:${color}18;border:1px solid ${color};`;
    evDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="background:${color};color:#fff;border-radius:4px;padding:1px 7px;font-weight:700;">
                🎪 Evento activo
            </span>
            <span style="color:${color};font-weight:700;">x${factorMax.toFixed(1)} tráfico (+${tiempoExtra})</span>
        </div>
        <div style="color:#555;">
            ${eventosAfectantes} tramo(s) de la ruta atraviesan una zona de evento.<br>
            Factor de impacto: x${factorMax.toFixed(2)} · +${tiempoExtra}
        </div>`;
    infoEl.insertAdjacentElement('afterend', evDiv);
}

function _mostrarInfoObstaculosEnRuta(coordsRuta, props) {
    const infoEl = document.getElementById('msw-info-temporal');
    if (!infoEl) return;
    if (!coordsRuta?.length) return;

    // Limpiar bloque previo
    const obsDivOld = document.getElementById('ruta-obstaculo-info');
    if (obsDivOld) obsDivOld.remove();

    let obstaculosAfectantes = 0;
    let factorMax = 1.0;
    const activos = obstaculos.filter(Boolean);
    if (!activos.length) return;

    // Pre-calcular radio² en grados para cada obstáculo (evita _haversineKm en el bucle)
    const obsPrep = activos.map(obs => ({
        lat:         obs.latlng.lat,
        lon:         obs.latlng.lng,
        rDeg2:       Math.pow((obs.radio || RADIO_OBSTACULO_M) / 111000, 2),
        obstruccion: Math.min(obs.obstruccion || 1.0, 0.99),
    }));

    for (let i = 0; i < coordsRuta.length - 1; i++) {
        const midLat = (coordsRuta[i][1] + coordsRuta[i+1][1]) / 2;
        const midLon = (coordsRuta[i][0] + coordsRuta[i+1][0]) / 2;

        for (const o of obsPrep) {
            const dLat = midLat - o.lat;
            const dLon = midLon - o.lon;
            if (dLat * dLat + dLon * dLon <= o.rDeg2) {
                const factor = 1.0 / (1.0 - o.obstruccion * 0.99);
                if (factor > factorMax) factorMax = factor;
                obstaculosAfectantes++;
                break; // solo contar una vez por segmento
            }
        }
    }

    if (factorMax <= 1.0) return;

    const tiempoBase  = props?.tiempo_minutos ?? 0;
    const tiempoExtra = (typeof props?.tiempo_extra_obstaculos === 'number')
        ? _fmtTiempo(props.tiempo_extra_obstaculos)
        : _fmtTiempo(tiempoBase * (factorMax - 1) / factorMax / 60);
    // Derivar el nivel de color del factor máximo encontrado
    const nivelMax  = factorMax >= 50 ? 3 : factorMax >= 2.5 ? 2 : 1;
    const nivelInfo = NIVELES_OBS[nivelMax];
    const color     = nivelInfo.color;

    const obsDiv = document.createElement('div');
    obsDiv.id = 'ruta-obstaculo-info';
    obsDiv.style.cssText = `margin-top:8px;padding:8px;border-radius:6px;font-size:12px;
        background:${color}18;border:1px solid ${color};`;
    obsDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="background:${color};color:${nivelMax === 1 ? '#333' : '#fff'};border-radius:4px;padding:1px 7px;font-weight:700;">
                🚧 ${nivelInfo.label}
            </span>
            <span style="color:${color};font-weight:700;">x${factorMax.toFixed(1)} (+${tiempoExtra})</span>
        </div>
        <div style="color:#555;">
            ${obstaculosAfectantes} tramo(s) de la ruta atraviesan una zona de obstáculo.<br>
            Factor de impacto: x${factorMax.toFixed(2)}
        </div>`;
    infoEl.insertAdjacentElement('afterend', obsDiv);
}

// ==================== POI MANAGER ====================
// Gestión de Puntos de Interés manuales:
// colocación individual desde el panel izquierdo,
// importar/exportar capa y limpieza.

let modoPoi          = false;
let poisManuales     = [];       // { latlng, nombre, tipo, poiId, marker, idx }
let _poiExportHandle = null;
let _poiLatlngPendiente = null;

// ── Colores por tipo de POI ───────────────────────────────────────────
const _POI_TIPO_CONFIG = {
    colegio:  { color: '#e67e22', emoji: '🏫' },
    iglesia:  { color: '#8e44ad', emoji: '⛪' },
    oficina:  { color: '#2980b9', emoji: '🏢' },
    ocio:     { color: '#e74c3c', emoji: '🎭' },
    otro:     { color: '#27ae60', emoji: '📍' },
};

function _poiConfig(tipo) {
    const t = (tipo || '').toLowerCase();
    for (const [key, cfg] of Object.entries(_POI_TIPO_CONFIG)) {
        if (t.includes(key)) return cfg;
    }
    return _POI_TIPO_CONFIG.otro;
}

// ── Activar / desactivar modo POI ─────────────────────────────────────
function activarModoPoi() {
    modoPoi = !modoPoi;
    const btn = document.getElementById('btn-colocar-poi');
    if (modoPoi) {
        // Desactivar otros modos conflictivos
        if (modoObstaculo)                                     desactivarModoObstaculo();
        if (typeof desactivarModoEvento === 'function' && window._modoEvento) desactivarModoEvento();
        if (window._esperandoOrigen || window._esperandoDestino) {
            window._esperandoOrigen  = false;
            window._esperandoDestino = false;
            ocultarInstruccion();
        }
        if (btn) { btn.classList.add('obstaculo-activo'); btn.textContent = '🪧 Modo POI ACTIVO'; }
        document.getElementById('map').classList.add('modo-obstaculo');
        showNotification('Haz clic en el mapa para colocar un POI', 'info');
    } else {
        if (btn) { btn.classList.remove('obstaculo-activo'); btn.textContent = '🪧 Añadir POI'; }
        document.getElementById('map').classList.remove('modo-obstaculo');
        showNotification('Modo POI desactivado', 'info');
    }
}

function desactivarModoPoi() {
    modoPoi = false;
    const btn = document.getElementById('btn-colocar-poi');
    if (btn) { btn.classList.remove('obstaculo-activo'); btn.textContent = '🪧 Añadir POI'; }
    document.getElementById('map').classList.remove('modo-obstaculo');
}

// ── Click en el mapa cuando modo POI activo ──────────────────────────
// Se engancha en el map-click handler global (en map-config.js).
// Exportamos window._modoPoiActivo para que map-config pueda comprobarlo.
Object.defineProperty(window, '_modoPoiActivo', { get: () => modoPoi });

function _onMapClickPoi(latlng) {
    if (!modoPoi) return false;
    _poiLatlngPendiente = latlng;
    _abrirModalPoi();
    return true;   // consumido
}
// Registro: añadir al dispatcher global si existe, o exponer globalmente
window._onMapClickPoi = _onMapClickPoi;

// ── Modal de creación de POI ──────────────────────────────────────────
function _abrirModalPoi() {
    const modal  = document.getElementById('poi-modal');
    if (!modal) return;
    // Reset campos
    const inNombre = document.getElementById('poi-nombre-input');
    const selTipo  = document.getElementById('poi-tipo-select');
    const inId     = document.getElementById('poi-id-input');
    const errEl    = document.getElementById('poi-id-error');
    if (inNombre) inNombre.value = '';
    if (selTipo)  selTipo.value  = 'otro';
    if (inId)     inId.value     = '';
    if (errEl)    { errEl.textContent = ''; errEl.style.display = 'none'; }
    modal.style.display = 'flex';
    setTimeout(() => inNombre && inNombre.focus(), 80);
}

function cerrarPoiModal() {
    document.getElementById('poi-modal').style.display = 'none';
    _poiLatlngPendiente = null;
}

function confirmarPoi() {
    const latlng  = _poiLatlngPendiente;
    if (!latlng) return;

    const nombre  = (document.getElementById('poi-nombre-input')?.value || '').trim() || 'POI sin nombre';
    const tipo    = document.getElementById('poi-tipo-select')?.value || 'otro';
    const poiIdRaw = (document.getElementById('poi-id-input')?.value || '').trim();
    const errEl   = document.getElementById('poi-id-error');

    // Validar ID si se puso
    let poiId = poiIdRaw || null;
    if (poiId) {
        if (!/^[\w\-]+$/.test(poiId)) {
            if (errEl) { errEl.textContent = 'El ID solo puede contener letras, números, - y _.'; errEl.style.display = 'block'; }
            return;
        }
        if (_poiIdEnUso(poiId)) {
            if (errEl) { errEl.textContent = `El ID "${poiId}" ya está en uso.`; errEl.style.display = 'block'; }
            return;
        }
    }

    document.getElementById('poi-modal').style.display = 'none';
    _poiLatlngPendiente = null;
    _crearPoiEnMapa(latlng, nombre, tipo, poiId);
}

function _poiIdEnUso(id) {
    return poisManuales.filter(Boolean).some(p => p.poiId === id);
}

// ── Crear POI en mapa + sincronizar con backend ───────────────────────
function _crearPoiEnMapa(latlng, nombre, tipo, poiId) {
    const cfg   = _poiConfig(tipo);
    const idx   = poisManuales.length;

    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<div style="
                background:${cfg.color};color:#fff;border-radius:50%;
                width:30px;height:30px;display:flex;align-items:center;
                justify-content:center;font-size:15px;
                border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
                cursor:pointer;">${cfg.emoji}</div>`,
            iconSize:   [30, 30],
            iconAnchor: [15, 15],
        }),
        zIndexOffset: 600,
    });

    const poi = { latlng, nombre, tipo, poiId, marker, idx };
    poisManuales.push(poi);

    marker.bindPopup(_poiPopupHTML(idx), { maxWidth: 220 });
    marker.addTo(map);

    // Sincronizar con backend (fire-and-forget; si falla, el POI permanece en cliente)
    fetch('/api/añadir-poi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: latlng.lat, lon: latlng.lng, nombre, tipo, poi_id: poiId }),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) showNotification('⚠️ Error al guardar POI en servidor: ' + data.error, 'warning');
    })
    .catch(() => {});

    _actualizarListaPois();
    showNotification(`POI "${nombre}" colocado`, 'success');
}

function _poiPopupHTML(idx) {
    const poi = poisManuales[idx];
    if (!poi) return '';
    const cfg   = _poiConfig(poi.tipo);
    const label = poi.poiId ? `#${poi.poiId}` : `#${idx + 1}`;
    return `
        <div style="font-family:var(--font-base,sans-serif);min-width:180px;text-align:center;">
            <strong>${cfg.emoji} ${poi.nombre}</strong>
            <div style="font-size:11px;color:#777;margin:4px 0;">
                Tipo: ${poi.tipo || 'otro'} &nbsp;·&nbsp; ${label}
            </div>
            <div style="display:flex;gap:6px;margin-top:8px;">
                <button onclick="eliminarPoiManual(${idx})"
                    style="flex:1;padding:5px 4px;background:#e74c3c;color:#fff;
                           border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                    🗑️ Eliminar
                </button>
            </div>
        </div>`;
}

// ── Eliminar POI manual ───────────────────────────────────────────────
function eliminarPoiManual(idx) {
    const poi = poisManuales[idx];
    if (!poi) return;

    if (poi.marker) map.removeLayer(poi.marker);
    poisManuales[idx] = null;

    // Sincronizar con backend
    const body = poi.poiId ? { poi_id: poi.poiId } : { idx };
    fetch('/api/eliminar-poi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {});

    map.closePopup();
    _actualizarListaPois();
    showNotification('POI eliminado', 'info');
}

// ── Limpiar todos los POIs manuales ──────────────────────────────────
function limpiarPoisManuales() {
    poisManuales.filter(Boolean).forEach(p => { if (p.marker) map.removeLayer(p.marker); });
    poisManuales = [];
    fetch('/api/limpiar-pois-manuales', { method: 'POST' }).catch(() => {});
    _actualizarListaPois();
    showNotification('POIs manuales eliminados', 'info');
}

// ── Actualizar panel flotante y descriptor de capa ───────────────────
function _actualizarListaPois() {
    const activos = poisManuales.filter(Boolean);

    // Descriptor en panel de capas
    const desc = document.getElementById('pois-manuales-desc');
    if (desc) desc.textContent = activos.length > 0
        ? `${activos.length} POI(s) manual(es)`
        : 'Sin añadir';

    // Botón importar/exportar: mostrar solo si registrado+
    const ieBar = document.getElementById('pois-import-export-top');
    if (ieBar) ieBar.style.display = '';   // siempre visible (ya está controlado por rol)

    // Panel flotante
    const panel    = document.getElementById('pois-panel-flotante');
    const lista    = document.getElementById('pois-flotante-lista');
    const contador = document.getElementById('pois-flotante-contador');

    if (panel)    panel.style.display    = activos.length > 0 ? 'flex' : 'none';
    if (contador) contador.textContent   = activos.length;
    if (lista)    lista.innerHTML        = '';

    activos.forEach(poi => {
        const idx = poisManuales.indexOf(poi);
        const cfg = _poiConfig(poi.tipo);
        const label = poi.poiId ? `#${poi.poiId}` : `#${idx + 1}`;

        const item = document.createElement('div');
        item.className = 'obs-item';
        item.dataset.idx = idx;
        item.innerHTML = `
            <div class="obs-item-header">
                <div class="obs-item-titulo">
                    <strong>${cfg.emoji} ${label}</strong>
                    <span style="color:${cfg.color};font-size:11px;margin-left:4px;">${poi.nombre}</span>
                </div>
                <button class="obs-item-del" onclick="eliminarPoiManual(${idx})" title="Eliminar">✕</button>
            </div>
            <div class="obs-item-sub">
                <span class="obs-via">• ${poi.tipo || 'otro'}</span>
            </div>`;
        if (lista) lista.appendChild(item);
    });
}

// ── Importar POIs ─────────────────────────────────────────────────────
function importarPoisConFormato() {
    document.getElementById('file-pois-import')?.click();
}

function importarPoisDesdeArchivo(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const nombre = file.name.toLowerCase();
    const formatos = ['.gpkg', '.geojson', '.csv', '.zip', '.shp'];
    if (!formatos.some(f => nombre.endsWith(f))) {
        input.value = '';
        showNotification('Formato no soportado. Usa .gpkg, .geojson, .csv, .zip o .shp', 'warning');
        return;
    }
    const formData = new FormData();
    formData.append('file', file);
    input.value = '';

    showNotification('⏳ Importando POIs...', 'info');
    fetch('/api/importar-pois', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showNotification('Error: ' + data.error, 'error'); return; }
            showNotification(`${data.importados} POI(s) importado(s)`, 'success');
            // Recargar la capa de puntos de interés para ver los nuevos en el mapa
            if (typeof cargarCapaPuntos === 'function') cargarCapaPuntos();
            else if (typeof window.recargarPuntosInteres === 'function') window.recargarPuntosInteres();
        })
        .catch(err => showNotification('Error al importar: ' + err.message, 'error'));
}

// ── Exportar POIs ─────────────────────────────────────────────────────
function exportarPoisConFormato() {
    const modal = document.getElementById('export-pois-modal');
    if (!modal) {
        // Fallback: exportar directo como gpkg con descarga automática
        _exportarPoisDirecto('gpkg');
        return;
    }
    const activos = poisManuales.filter(Boolean);
    if (!activos.length) { showNotification('No hay POIs manuales que exportar', 'info'); return; }
    _poiExportHandle = null;
    const fiInput  = document.getElementById('export-pois-filepath');
    const fmtSel   = document.getElementById('export-pois-formato');
    if (fmtSel)  fmtSel.value  = 'gpkg';
    if (fiInput) fiInput.value = `pois_${new Date().toISOString().slice(0,10)}.gpkg`;
    modal.style.display = 'flex';
}

function cerrarModalExportPois() {
    const modal = document.getElementById('export-pois-modal');
    if (modal) modal.style.display = 'none';
    _poiExportHandle = null;
}

function cambiarFormatoExportPois() {
    const fmt = document.getElementById('export-pois-formato')?.value || 'gpkg';
    const fi  = document.getElementById('export-pois-filepath');
    if (!fi) return;
    let val = fi.value.replace(/\.(gpkg|csv|zip)$/i, '');
    fi.value = `${val}.${fmt === 'shp' ? 'zip' : fmt}`;
    _poiExportHandle = null;
}

async function explorarRutaExportPois() {
    const fmt      = document.getElementById('export-pois-formato')?.value || 'gpkg';
    const fi       = document.getElementById('export-pois-filepath');
    const sugerido = fi?.value.trim() || `pois_${new Date().toISOString().slice(0,10)}.${fmt}`;
    if (window.showSaveFilePicker) {
        try {
            const types = fmt === 'csv'
                ? [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
                : fmt === 'shp'
                    ? [{ description: 'Shapefile ZIP', accept: { 'application/zip': ['.zip'] } }]
                    : [{ description: 'GeoPackage', accept: { 'application/geopackage+sqlite3': ['.gpkg'] } }];
            const handle = await window.showSaveFilePicker({ suggestedName: sugerido, types, excludeAcceptAllOption: true });
            _poiExportHandle = handle;
            if (fi) fi.value = handle.name || sugerido;
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
        }
        return;
    }
    showNotification('El navegador no admite exploración directa. Escribe un nombre y pulsa Exportar.', 'warning');
}

async function confirmarExportacionPois() {
    const fmt    = document.getElementById('export-pois-formato')?.value || 'gpkg';
    const handle = _poiExportHandle;
    if (!handle) { showNotification('Debes seleccionar ubicación con 📁 antes de exportar.', 'warning'); return; }
    cerrarModalExportPois();
    await _exportarPoisConHandle(handle, fmt);
}

async function _exportarPoisConHandle(fileHandle, formato) {
    showNotification(`⏳ Exportando POIs como ${formato}...`, 'info');
    try {
        const resp = await fetch('/api/exportar-pois', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formato }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showNotification('Error: ' + (err.error || resp.status), 'error');
            return;
        }
        const blob = await resp.blob();
        if (typeof guardarBlobEnHandle === 'function') {
            await guardarBlobEnHandle(blob, fileHandle);
        } else {
            // Fallback: descarga del navegador
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = fileHandle.name || `pois.${formato}`;
            a.click();
            URL.revokeObjectURL(url);
        }
        showNotification(`POIs exportados como .${formato === 'shp' ? 'zip' : formato}`, 'success');
    } catch (err) {
        showNotification('Error al exportar: ' + err.message, 'error');
    }
}

async function _exportarPoisDirecto(formato) {
    showNotification(`⏳ Exportando POIs...`, 'info');
    try {
        const resp = await fetch('/api/exportar-pois', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formato }),
        });
        if (!resp.ok) { const e = await resp.json().catch(()=>({})); showNotification('Error: '+(e.error||resp.status),'error'); return; }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `pois_${new Date().toISOString().slice(0,10)}.${formato === 'shp' ? 'zip' : formato}`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('POIs exportados', 'success');
    } catch (err) {
        showNotification('Error al exportar: ' + err.message, 'error');
    }
}

// ── Integración con el click global del mapa ─────────────────────────
// El click del mapa es gestionado por el handler principal (línea ~802)
// que ya incluye: if (modoPoi) { _onMapClickPoi(e.latlng); return; }
// No se necesita un listener adicional aquí.