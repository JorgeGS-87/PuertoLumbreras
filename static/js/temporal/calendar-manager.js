/**
 * calendar-manager.js
 * Gestión del calendario de tipos de día (lectivo / laborable / festivo / evento)
 * y cálculo del coeficiente temporal para el cálculo de rutas.
 *
 * CAMBIOS v2:
 *  - Un día puede tener MÚLTIPLES etiquetas (array).
 *  - Las celdas muestran N colores en gradiente horizontal.
 *  - Por defecto: L-V = ['lectivo', 'laborable'], S-D = ['festivo'].
 *  - Nueva etiqueta: 'evento'.
 *  - Al pulsar un tipo sobre una celda:
 *      · Si el día no tiene ese tipo -> se añade.
 *      · Si ya lo tiene -> se elimina.
 *      · 'reset' -> vacía el array (vuelve a defecto).
 */

// ==================== FESTIVOS FIJOS DE PUERTO LUMBRERAS ====================

/**
 * Festivos oficiales de Puerto Lumbreras (año 2025).
 * Formato: 'MM-DD' — se compara contra mes y día sin importar el año,
 * de modo que aplican a cualquier año mientras no haya edición manual.
 */
const Festivos = new Set([
    '01-01', // Año Nuevo
    '01-06', // Epifanía del Señor
    '03-19', // San José
    '04-02', // Jueves Santo
    '04-03', // Viernes Santo
    '05-01', // Día del Trabajo
    '06-09', // Día de la Región de Murcia
    '07-07', // Festivo local
    '08-15', // Asunción de la Virgen
    '10-07', // Festivo local
    '10-12', // Fiesta Nacional de España
    '12-07', // Día de la Constitución
    '12-08', // Inmaculada Concepción
    '12-25', // Navidad
]);

/** Devuelve true si la fecha es un festivo fijo de Puerto Lumbreras. */
function esFestivoFijo(fecha) {
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return Festivos.has(`${mm}-${dd}`);
}

// ==================== ESTADO ====================

// Tipos de día y sus colores
const TIPOS_DIA = {
    lectivo:   { label: 'Lectivo',   color: '#3498db', emoji: '📚' },
    laborable: { label: 'Laborable', color: '#27ae60', emoji: '💼' },
    festivo:   { label: 'Festivo',   color: '#e74c3c', emoji: '🎉' },
    evento:    { label: 'Evento',    color: '#9b59b6', emoji: '⭐' },
};

// Orden canónico de visualización: azul -> verde -> rojo -> morado
const ORDEN_TIPOS = ['lectivo', 'laborable', 'festivo', 'evento'];

// Coeficientes por tipo de día y franja horaria
const COEFICIENTES = {
    lectivo: [
        { inicio: 0,   fin: 6,   factor: 0.85, label: 'Madrugada'       },
        { inicio: 6,   fin: 7.5, factor: 1.3,  label: 'Entrada mañana'  },
        { inicio: 7.5, fin: 9,   factor: 1.6,  label: 'Hora punta ↑'   },
        { inicio: 9,   fin: 13,  factor: 1.1,  label: 'Mañana'          },
        { inicio: 13,  fin: 14.5,factor: 1.5,  label: 'Salida mediodía' },
        { inicio: 14.5,fin: 17,  factor: 1.05, label: 'Tarde'           },
        { inicio: 17,  fin: 18,  factor: 1.6,  label: 'Hora punta ↓'   },
        { inicio: 18,  fin: 21,  factor: 1.1,  label: 'Tarde-noche'     },
        { inicio: 21,  fin: 24,  factor: 0.9,  label: 'Noche'           },
    ],
    laborable: [
        { inicio: 0,    fin: 6,   factor: 0.8,  label: 'Madrugada'       },
        { inicio: 6,    fin: 8,   factor: 1.2,  label: 'Entrada trabajo' },
        { inicio: 8,    fin: 9,   factor: 1.4,  label: 'Hora punta ↑'   },
        { inicio: 9,    fin: 14,  factor: 1.05, label: 'Mañana'          },
        { inicio: 14,   fin: 16,  factor: 1.3,  label: 'Hora comida'     },
        { inicio: 16,   fin: 18,  factor: 1.05, label: 'Tarde'           },
        { inicio: 18,   fin: 19.5,factor: 1.4,  label: 'Hora punta ↓'  },
        { inicio: 19.5, fin: 21,  factor: 1.1,  label: 'Tarde-noche'    },
        { inicio: 21,   fin: 24,  factor: 0.85, label: 'Noche'           },
    ],
    festivo: [
        { inicio: 0,  fin: 6,  factor: 0.8,  label: 'Madrugada'       },
        { inicio: 6,  fin: 10, factor: 0.9,  label: 'Mañana tranquila' },
        { inicio: 10, fin: 13, factor: 1.2,  label: 'Actividad ocio'  },
        { inicio: 13, fin: 16, factor: 1.2,  label: 'Comida'          },
        { inicio: 16, fin: 20, factor: 1.0,  label: 'Tarde'           },
        { inicio: 20, fin: 24, factor: 1.2,  label: 'Noche ocio'      },
    ],
    evento: [
        { inicio: 0,  fin: 6,  factor: 0.8,  label: 'Madrugada'  },
        { inicio: 6,  fin: 10, factor: 1.0,  label: 'Mañana'     },
        { inicio: 10, fin: 14, factor: 1.5,  label: 'Evento'     },
        { inicio: 14, fin: 18, factor: 1.5,  label: 'Evento'     },
        { inicio: 18, fin: 22, factor: 1.3,  label: 'Post-evento'},
        { inicio: 22, fin: 24, factor: 1.0,  label: 'Noche'      },
    ],
};

/**
 * Calendario en memoria — solo excepciones al defecto.
 * Formato: { 'YYYY-MM-DD': ['laborable', 'lectivo', ...] }
 * Si la clave no existe -> el día es defecto (L-V: lectivo+laborable, S-D: []).
 * Solo aparecen festivos, eventos puntuales, o días con etiquetas modificadas.
 */
let calendarioDias = {};

// Referencia al mes/año que muestra el modal
let calModalAno  = new Date().getFullYear();
let calModalMes = new Date().getMonth(); // 0-based

// ==================== CARGA DESDE SERVIDOR ====================

// ==================== PERSISTENCIA LOCAL ====================
// Clave para localStorage (se guarda toda la estructura de calendarioDias)
const ClaveLS = 'calendarioDias_v2';

function cargarDesdeLocalStorage() {
    try {
        const raw = localStorage.getItem(ClaveLS);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        calendarioDias = {};
        for (const [k, v] of Object.entries(parsed)) {
            calendarioDias[k] = Array.isArray(v) ? v : [v];
        }
        console.info('Calendario cargado desde localStorage.');
        return true;
    } catch (e) {
        console.warn('Error leyendo localStorage:', e);
        return false;
    }
}

function guardarEnLocalStorage() {
    try {
        localStorage.setItem(ClaveLS, JSON.stringify(calendarioDias));
    } catch (e) {
        console.warn('No se pudo guardar en localStorage:', e);
    }
}

async function cargarCalendario() {
    try {
        const r = await fetch('/api/calendario');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();

        // Compatibilidad: el servidor puede devolver arrays o strings (v1)
        const raw = data.dias || {};
        calendarioDias = {};
        for (const [k, v] of Object.entries(raw)) {
            // Compatibilidad v1: string -> array; preservar arrays vacíos (= sin etiquetas)
            calendarioDias[k] = Array.isArray(v) ? v : [v];
        }
        // Sincronizar localStorage con los datos del servidor
        guardarEnLocalStorage();
    } catch (e) {
        console.warn('No se pudo cargar el calendario desde el servidor, intentando localStorage…', e);
        if (!cargarDesdeLocalStorage()) {
            calendarioDias = {};
        }
    }
}

// ==================== CONSULTA ====================

/**
 * Devuelve el array de tipos para una fecha dada.
 * Defecto: L-V -> ['laborable', 'lectivo'], S-D -> ['festivo']
 */
function tiposDia(fecha) {
    const key = fechaKey(fecha);
    // Si la clave existe, fue editada manualmente (prevalece sobre cualquier defecto)
    if (key in calendarioDias) return calendarioDias[key];
    // Festivo fijo de Puerto Lumbreras -> siempre festivo
    if (esFestivoFijo(fecha)) return ['festivo'];
    // Sin clave -> defecto según día de la semana
    const dow = fecha.getDay(); // 0=dom, 6=sab
    return (dow === 0 || dow === 6) ? ['festivo'] : ['lectivo', 'laborable'];
}

/**
 * Compatibilidad v1: devuelve el primer tipo del día (string).
 */
function tipoDia(fecha) {
    return tiposDia(fecha)[0];
}

/**
 * Devuelve el factor de coeficiente para una fecha y hora dadas.
 * Si el día tiene varios tipos, promedia los factores.
 */
function obtenerCoeficiente(fecha) {
    const tipos = tiposDia(fecha);
    const hora  = fecha.getHours() + fecha.getMinutes() / 60;
    if (!tipos || tipos.length === 0) return 1.0;
    let suma = 0;
    for (const tipo of tipos) {
        const table = COEFICIENTES[tipo] || COEFICIENTES.laborable;
        const entry = table.find(e => hora >= e.inicio && hora < e.fin);
        suma += entry ? entry.factor : 1.0;
    }
    return suma / tipos.length;
}

/**
 * Devuelve info legible sobre el coeficiente actual.
 */
function infoCoeficiente(fecha) {
    const tipos  = tiposDia(fecha);
    const tipo   = tipos[0];
    const hora   = fecha.getHours() + fecha.getMinutes() / 60;
    const table  = COEFICIENTES[tipo] || COEFICIENTES.laborable;
    const entry  = table.find(e => hora >= e.inicio && hora < e.fin) || { factor: 1.0, label: 'Normal' };
    const config = TIPOS_DIA[tipo] || TIPOS_DIA.lectivo;
    return {
        tipos,
        tipo,
        factor:      obtenerCoeficiente(fecha),
        franjaLabel: entry.label,
        tipoLabel:   tipos.map(t => TIPOS_DIA[t]?.label || t).join(' + '),
        emoji:       config.emoji,
        color:       config.color,
    };
}

// ==================== HELPERS VISUALES ====================

/**
 * Devuelve el innerHTML para una celda con N colores.
 * Usa franjas absolutas + overflow:hidden en el contenedor para que
 * el border-radius recorte limpiamente sin artefactos en los extremos.
 */
function colorCeldaMultiple(tipos, numero) {
    const colors = (tipos && tipos.length > 0)
        ? tipos.map(t => TIPOS_DIA[t]?.color || '#cccccc')
        : ['#bdc3c7'];

    const strips = colors.map((c, i) => {
        const pct  = 100 / colors.length;
        const left = (i * pct).toFixed(4);
        const w    = pct.toFixed(4);
        return `<div style="position:absolute;top:0;bottom:0;left:${left}%;width:${w}%;background:${c};"></div>`;
    }).join('');

    return `${strips}<span style="position:relative;z-index:1;color:#fff;font-size:12px;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.35);">${numero}</span>`;
}

/** @deprecated solo para compatibilidad con toggleDia visual update */
function colorCelda(tipos) {
    if (!tipos || tipos.length === 0) return { bg: '#bdc3c7', color: '#fff' };
    const colors = tipos.map(t => TIPOS_DIA[t]?.color || '#cccccc');
    if (colors.length === 1) return { bg: colors[0], color: '#fff' };
    const pct = 100 / colors.length;
    const stops = [];
    colors.forEach((c, i) => {
        stops.push(`${c} ${(i * pct).toFixed(2)}%`);
        stops.push(`${c} ${((i + 1) * pct).toFixed(2)}%`);
    });
    return { bg: `linear-gradient(to right, ${stops.join(', ')})`, color: '#fff' };
}

/**
 * Devuelve el tooltip para una celda.
 */
function nombreCelda(tipos, isDefault) {
    const labels = tipos.map(t => TIPOS_DIA[t]?.label || t).join(' + ');
    return isDefault ? `${labels} (defecto)` : labels;
}

// ==================== MODAL DE EDICIÓN (solo admin) ====================

function abrirCalendario() {
    let modal = document.getElementById('cal-modal');
    if (!modal) {
        modal = crearModalCalendario();
        document.body.appendChild(modal);
    }
    calModalAno  = new Date().getFullYear();
    calModalMes = new Date().getMonth();
    modal.style.display = 'flex';
    renderCalModal();
}

function cerrarCalendario() {
    const modal = document.getElementById('cal-modal');
    if (modal) modal.style.display = 'none';
}

function crearModalCalendario() {
    const modal = document.createElement('div');
    modal.id = 'cal-modal';
    modal.style.cssText = `
        position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);
        display:flex;align-items:center;justify-content:center;
    `;

    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.4);
                    width:580px;max-width:98vw;overflow:hidden;">

            <!-- Cabecera -->
            <div style="background:#2c3e50;color:#fff;padding:16px 20px;display:flex;
                        align-items:center;justify-content:space-between;">
                <span style="font-weight:700;font-size:15px;">📅 Editar Calendario</span>
                <button onclick="cerrarCalendario()" style="background:none;border:none;color:#fff;
                        font-size:20px;cursor:pointer;line-height:1;">✕</button>
            </div>

            <!-- Instrucción -->
            <div style="padding:8px 16px 4px;font-size:11px;color:#7f8c8d;background:#f8f9fa;
                        border-bottom:1px solid #e8e8e8;">
                Selecciona una o varias etiquetas y haz clic en los días. Pulsa el mismo tipo para quitarlo.
            </div>

            <!-- Botones de tipo -->
            <div style="display:flex;gap:8px;padding:10px 16px;background:#f8f9fa;
                        border-bottom:1px solid #e0e0e0;flex-wrap:nowrap;align-items:center;">
                ${Object.entries(TIPOS_DIA).map(([k, v]) => `
                    <button onclick="window.calTipoSeleccionado='${k}'; actualizarTipoActivo();"
                        id="cal-tipo-${k}"
                        style="display:flex;align-items:center;gap:5px;padding:5px 10px;
                               border:2px solid ${v.color};border-radius:20px;cursor:pointer;
                               background:#fff;font-size:12px;font-weight:600;color:${v.color};
                               transition:all 0.15s;">
                        ${v.emoji} ${v.label}
                    </button>
                `).join('')}
                <button onclick="window.calTipoSeleccionado='reset'; actualizarTipoActivo();"
                    id="cal-tipo-reset"
                    style="display:flex;align-items:center;gap:5px;padding:5px 10px;
                           border:2px solid #95a5a6;border-radius:20px;cursor:pointer;
                           background:#fff;font-size:12px;font-weight:600;color:#95a5a6;">
                    🔄 Defecto
                </button>
            </div>

            <!-- Navegación mes -->
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 16px;border-bottom:1px solid #eee;">
                <button onclick="_calNavMes(-1)" style="background:none;border:none;font-size:18px;
                        cursor:pointer;color:#2c3e50;">‹</button>
                <span id="cal-mes-label" style="font-weight:700;font-size:14px;color:#2c3e50;"></span>
                <button onclick="_calNavMes(1)"  style="background:none;border:none;font-size:18px;
                        cursor:pointer;color:#2c3e50;">›</button>
            </div>

            <!-- Cabecera días de la semana -->
            <div style="display:grid;grid-template-columns:repeat(7,1fr);
                        padding:8px 12px 0;gap:2px;">
                ${['L','M','X','J','V','S','D'].map(d =>
                    `<div style="text-align:center;font-size:11px;font-weight:700;
                                 color:#7f8c8d;padding:4px 0;">${d}</div>`
                ).join('')}
            </div>

            <!-- Grid días del mes -->
            <div id="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);
                        padding:4px 12px 12px;gap:3px;"></div>

            <!-- Acciones -->
            <div style="display:flex;gap:8px;padding:12px 16px;background:#f8f9fa;
                        border-top:1px solid #eee;justify-content:flex-end;">
                <button onclick="_limpiarCalendario()"
                    style="padding:8px 14px;background:#e74c3c;color:#fff;border:none;
                           border-radius:6px;cursor:pointer;font-size:12px;">
                    🗑️ Limpiar todo
                </button>
                <button id="cal-guardar-btn" onclick="_guardarCalendario()"
                    style="padding:8px 14px;background:#27ae60;color:#fff;border:none;
                           border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">
                    💾 Guardar
                </button>
            </div>
        </div>
    `;

    modal.addEventListener('click', e => { if (e.target === modal) cerrarCalendario(); });
    window.calTipoSeleccionado = 'lectivo';
    return modal;
}

function calNavMes(delta) {
    calModalMes += delta;
    if (calModalMes > 11) { calModalMes = 0;  calModalAno++; }
    if (calModalMes < 0)  { calModalMes = 11; calModalAno--; }
    renderCalModal();
}

function actualizarTipoActivo() {
    [...Object.keys(TIPOS_DIA), 'reset'].forEach(k => {
        const btn = document.getElementById('cal-tipo-' + k);
        if (!btn) return;
        const sel   = window.calTipoSeleccionado === k;
        const color = TIPOS_DIA[k]?.color || '#95a5a6';
        btn.style.background = sel ? color : '#fff';
        btn.style.color      = sel ? '#fff' : color;
    });
}

function renderCalModal() {
    const label = document.getElementById('cal-mes-label');
    const grid  = document.getElementById('cal-grid');
    if (!label || !grid) return;

    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    label.textContent = `${meses[calModalMes]} ${calModalAno}`;

    const primerDia = new Date(calModalAno, calModalMes, 1);
    const offset    = (primerDia.getDay() + 6) % 7; // lunes primero
    const diasMes   = new Date(calModalAno, calModalMes + 1, 0).getDate();
    const hoy       = fechaKey(new Date());

    grid.innerHTML = '';

    // Celdas vacías antes del primer día
    for (let i = 0; i < offset; i++) {
        grid.appendChild(document.createElement('div'));
    }

    for (let d = 1; d <= diasMes; d++) {
        const fecha     = new Date(calModalAno, calModalMes, d);
        const key       = fechaKey(fecha);
        const isDefault = !(key in calendarioDias);
        const tipos     = isDefault ? tiposDia(fecha) : calendarioDias[key];

        const { bg, color } = colorCelda(tipos);
        const title = nombreCelda(tipos, isDefault);

        const cell = document.createElement('div');
        cell.style.cssText = `
            position:relative;overflow:hidden;
            text-align:center;padding:6px 2px;border-radius:6px;cursor:pointer;
            border:2px solid ${key === hoy ? '#f39c12' : 'transparent'};
            transition:opacity 0.12s;user-select:none;min-height:28px;
            display:flex;align-items:center;justify-content:center;
        `;
        // Crear fondo con franjas para múltiples tipos
        cell.innerHTML = colorCeldaMultiple(tipos, d);
        cell.title = title;
        cell.addEventListener('click', () => toggleDia(key, cell, fecha));
        grid.appendChild(cell);
    }

    actualizarTipoActivo();
}

/**
 * Toggle de etiqueta en una celda:
 *  - 'reset'       -> eliminar array completo (vuelve a defecto).
 *  - tipo presente -> eliminarlo del array.
 *  - tipo ausente  -> añadirlo al array.
 */
function toggleDia(key, cell, fecha) {
    const tipo = window.calTipoSeleccionado;

    if (tipo === 'reset') {
        // Volver al defecto real -> eliminar la clave (no guardar nada)
        delete calendarioDias[key];
    } else {
        // Partir del estado actual: si no hay clave, usar el defecto como base
        let arr = (key in calendarioDias)
            ? [...calendarioDias[key]]
            : [...tiposDia(fecha)]; // copia del defecto para editar desde él

        const idx = arr.indexOf(tipo);
        if (idx >= 0) {
            // Ya tiene este tipo -> quitarlo
            arr.splice(idx, 1);
        } else {
            // No lo tiene -> añadirlo
            arr.push(tipo);
        }

        // Ordenar según el orden canónico: lectivo -> laborable -> festivo -> evento
        arr.sort((a, b) => {
            const ia = ORDEN_TIPOS.indexOf(a);
            const ib = ORDEN_TIPOS.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });

        // Solo guardar si el resultado se desvía del defecto
        if (esDefecto(fecha, arr)) {
            delete calendarioDias[key]; // coincide con el defecto -> no es excepción
        } else {
            calendarioDias[key] = arr;
        }
    }

    // Actualizar visual de la celda
    const isDefault = !(key in calendarioDias);
    const tipos     = isDefault ? tiposDia(fecha) : calendarioDias[key];

    cell.innerHTML = colorCeldaMultiple(tipos, new Date(key + 'T12:00:00').getDate());
    cell.title = nombreCelda(tipos, isDefault);
}

async function guardarCalendario() {
    const btn = document.getElementById('cal-guardar-btn');
    if (btn) { btn.textContent = '⏳ Guardando…'; btn.disabled = true; }

    // Guardar siempre en localStorage primero (persistencia garantizada sin servidor)
    guardarEnLocalStorage();

    let servidorOk = false;
    try {
        const r = await fetch('/api/calendario', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ dias: calendarioDias }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        servidorOk = true;
    } catch (e) {
        console.warn('No se pudo guardar en el servidor (guardado en localStorage):', e);
    }

    const msg = servidorOk
        ? '✅ Calendario guardado correctamente'
        : '✅ Calendario guardado localmente';
    showNotification(msg, 'success');

    if (btn) {
        btn.textContent = '✅ Guardado';
        btn.style.background = '#1e8449';
        btn.disabled = false;
        // Volver al estado normal tras 2 segundos sin cerrar el modal
        setTimeout(() => {
            btn.textContent = '💾 Guardar';
            btn.style.background = '#27ae60';
        }, 2000);
    }
}

function limpiarCalendario() {
    if (!confirm('¿Eliminar todas las asignaciones personalizadas? Se volverán a los valores por defecto (L-V: Lectivo + Laborable, S-D: sin etiquetas).')) return;
    calendarioDias = {};
    renderCalModal();
}

// ==================== HELPERS ====================

function fechaKey(fecha) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Comprueba si un array de tipos coincide exactamente con el defecto
 * para esa fecha (L-V -> ['lectivo','laborable'], S-D -> []).
 */
function esDefecto(fecha, arr) {
    const dow = fecha.getDay(); // 0=dom, 6=sab
    // Festivo fijo -> defecto es ['festivo']
    if (esFestivoFijo(fecha)) {
        return arr.length === 1 && arr[0] === 'festivo';
    }
    const defecto = (dow === 0 || dow === 6) ? [] : ['lectivo', 'laborable'];
    if (arr.length !== defecto.length) return false;
    return defecto.every((t, i) => t === arr[i]);
}

// ==================== INIT ====================
cargarCalendario();