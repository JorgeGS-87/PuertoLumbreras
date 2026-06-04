/**
 * session-persistence.js
 * Persistencia de obstáculos por sesión de usuario.
 *
 * Funcionamiento:
 *  - Al cerrar sesión (cerrarSesion en auth.js) se intercepta y pregunta si guardar.
 *  - beforeunload: intenta guardar silenciosamente (para cierres inesperados).
 *  - Al iniciar sesión y cargar el mapa (init en auth.js) se comprueba si hay
 *    un guardado recuperado y se ofrece restaurarlo.
 *
 * Dependencias: auth.js (window._userRol, cerrarSesion),
 *               route-manager.js (obstaculos, crearObstaculo / _reconstruirObstaculoDesdeData),
 *               ui-controls.js (showNotification), map-config.js (map)
 *
 * API endpoints añadidos en app.py:
 *   POST /api/sesion/guardar-obstaculos    → guarda la sesión actual
 *   GET  /api/sesion/recuperar-obstaculos  → devuelve la última sesión guardada
 *   POST /api/sesion/confirmar-recuperado  → marca la sesión como confirmada (borra el flag)
 */

// ==================== GUARDAR ====================

/**
 * Serializa los obstáculos activos del mapa y los envía al servidor.
 * @param {boolean} [silencioso=false]  Si true no muestra notificación al usuario.
 * @returns {Promise<boolean>}  true si se guardó con éxito.
 */
async function sesionGuardarObstaculos(silencioso = false) {
    if (!['registrado', 'admin'].includes(window._userRol)) return false;

    // obstaculos está definido en route-manager.js como array global
    const lista = (typeof obstaculos !== 'undefined' ? obstaculos : []).filter(Boolean);

    const payload = lista.map(obs => ({
        lat:         obs.latlng?.lat ?? obs.lat,
        lng:         obs.latlng?.lng ?? obs.lng,
        obstruccion: obs.obstruccion ?? 0.5,
        obsId:       obs.obsId ?? null,
        portal:      obs.portal ?? '',
    }));

    try {
        const r = await fetch('/api/sesion/guardar-obstaculos', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ obstaculos: payload })
        });
        const ok = r.ok;
        if (!silencioso) {
            showNotification(ok ? '✅ Sesión guardada correctamente' : '❌ Error al guardar sesión', ok ? 'success' : 'error');
        }
        return ok;
    } catch (e) {
        if (!silencioso) showNotification('❌ Error de red al guardar sesión', 'error');
        console.warn('sesionGuardarObstaculos error:', e);
        return false;
    }
}

// ==================== RECUPERAR ====================

/**
 * Comprueba si el servidor tiene una sesión guardada pendiente de confirmar
 * y, si la hay, muestra el diálogo de recuperación al usuario.
 * Se llama desde auth.js tras aplicar permisos.
 */
async function sesionComprobarRecuperacion() {
    if (!['registrado', 'admin'].includes(window._userRol)) return;

    try {
        const r    = await fetch('/api/sesion/recuperar-obstaculos');
        if (!r.ok) return;
        const data = await r.json();
        if (!data.pendiente || !data.obstaculos?.length) return;

        // Hay sesión guardada sin confirmar → mostrar diálogo
        _mostrarDialogoRecuperacion(data.obstaculos, data.guardado_en);
    } catch (e) {
        console.warn('sesionComprobarRecuperacion error:', e);
    }
}

/**
 * Muestra el modal de recuperación de sesión.
 * @param {Array}  obstaculosGuardados
 * @param {string} fechaGuardado  - ISO string
 */
function _mostrarDialogoRecuperacion(obstaculosGuardados, fechaGuardado) {
    // Crear modal si no existe
    let modal = document.getElementById('sesion-recovery-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sesion-recovery-modal';
        modal.innerHTML = `
            <div class="srm-overlay">
                <div class="srm-box">
                    <div class="srm-icon">🔄</div>
                    <h3 class="srm-titulo">Sesión recuperada</h3>
                    <p class="srm-desc" id="srm-desc"></p>
                    <div class="srm-btns">
                        <button class="srm-btn srm-btn-primary" id="srm-btn-restaurar">
                            ✅ Restaurar obstáculos
                        </button>
                        <button class="srm-btn srm-btn-secondary" id="srm-btn-descartar">
                            🗑️ Descartar y continuar
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        _injectSesionCSS();
    }

    // Texto descriptivo
    const fecha = fechaGuardado
        ? new Date(fechaGuardado).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
        : 'desconocida';
    document.getElementById('srm-desc').textContent =
        `Se encontró una sesión guardada el ${fecha} con ${obstaculosGuardados.length} obstáculo${obstaculosGuardados.length !== 1 ? 's' : ''}. ¿Deseas restaurarlos?`;

    modal.style.display = 'flex';

    // Botón restaurar
    document.getElementById('srm-btn-restaurar').onclick = async () => {
        modal.style.display = 'none';
        const creados = await _restaurarObstaculos(obstaculosGuardados);
        await fetch('/api/sesion/confirmar-recuperado', { method: 'POST' });
        if (creados > 0) {
            showNotification(`✅ ${creados} obstáculos restaurados`, 'success');
        } else {
            showNotification('⚠️ La sesión guardada tenía datos inválidos y no se pudo restaurar', 'warning');
        }
    };

    // Botón descartar
    document.getElementById('srm-btn-descartar').onclick = async () => {
        modal.style.display = 'none';
        await fetch('/api/sesion/confirmar-recuperado', { method: 'POST' });
        showNotification('Sesión anterior descartada', 'info');
    };
}

/**
 * Restaura los obstáculos en el mapa llamando a la función de route-manager.js.
 * @param {Array} lista
 */
async function _restaurarObstaculos(lista) {
    let creados = 0;
    let saltados = 0;

    for (const obs of lista) {
        // Validar que lat/lng sean números válidos antes de llamar a Leaflet
        const lat = parseFloat(obs.lat);
        const lng = parseFloat(obs.lng);

        if (isNaN(lat) || isNaN(lng)) {
            console.warn('[SesionPersist] obstáculo con coordenadas inválidas, saltando:', obs);
            saltados++;
            continue;
        }

        if (typeof crearObstaculo === 'function') {
            const latlng      = L.latLng(lat, lng);
            const obstruccion = obs.obstruccion ?? 0.5;
            const obsId       = obs.obsId ?? null;
            const portal      = obs.portal ?? '';
            crearObstaculo(latlng, obstruccion, obsId, portal);
            creados++;
        }

        await new Promise(res => setTimeout(res, 20));
    }

    if (saltados > 0) {
        console.warn(`[SesionPersist] ${saltados} obstáculos saltados por datos inválidos (sesión antigua corrupta)`);
    }
    return creados;
}

// ==================== CERRAR SESIÓN CON CONFIRMACIÓN ====================

/**
 * Envuelve la función cerrarSesion original de auth.js para interceptarla.
 * Esto se llama UNA VEZ al cargar el módulo.
 */
function _parchearCerrarSesion() {
    if (typeof cerrarSesion !== 'function') return;

    const _cerrarSesionOriginal = cerrarSesion;

    window.cerrarSesion = async function () {
        // Solo preguntar si hay obstáculos activos y el usuario puede guardar
        const lista = (typeof obstaculos !== 'undefined' ? obstaculos : []).filter(Boolean);
        const puedeGuardar = ['registrado', 'admin'].includes(window._userRol);

        if (!puedeGuardar || lista.length === 0) {
            // Sin obstáculos o sin permisos → cerrar directamente
            return _cerrarSesionOriginal();
        }

        // Mostrar diálogo de confirmación
        _mostrarDialogoGuardarAlSalir(async (guardar) => {
            if (guardar) await sesionGuardarObstaculos(true);
            _cerrarSesionOriginal();
        });
    };
}

/**
 * Muestra un modal preguntando si guardar antes de salir.
 * @param {function(boolean)} callback  - recibe true si el usuario quiere guardar
 */
function _mostrarDialogoGuardarAlSalir(callback) {
    let modal = document.getElementById('sesion-save-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sesion-save-modal';
        modal.innerHTML = `
            <div class="srm-overlay">
                <div class="srm-box">
                    <div class="srm-icon">💾</div>
                    <h3 class="srm-titulo">¿Guardar cambios?</h3>
                    <p class="srm-desc">Tienes obstáculos activos en el mapa. ¿Deseas guardar tu sesión antes de salir para recuperarlos la próxima vez?</p>
                    <div class="srm-btns">
                        <button class="srm-btn srm-btn-primary" id="ssm-btn-guardar">💾 Guardar y salir</button>
                        <button class="srm-btn srm-btn-secondary" id="ssm-btn-salir">🚪 Salir sin guardar</button>
                        <button class="srm-btn srm-btn-cancel" id="ssm-btn-cancelar">✕ Cancelar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        _injectSesionCSS();
    }

    modal.style.display = 'flex';

    document.getElementById('ssm-btn-guardar').onclick = () => {
        modal.style.display = 'none';
        callback(true);
    };
    document.getElementById('ssm-btn-salir').onclick = () => {
        modal.style.display = 'none';
        callback(false);
    };
    document.getElementById('ssm-btn-cancelar').onclick = () => {
        modal.style.display = 'none';
        // No hacer nada — el usuario cancela el cierre de sesión
    };
}

// ==================== GUARDADO DE EMERGENCIA (beforeunload) ====================

/**
 * Intenta guardar la sesión usando sendBeacon (no bloquea el cierre del navegador).
 * sendBeacon garantiza el envío aunque la página esté cerrándose.
 */
function _guardarEmergencia() {
    if (!['registrado', 'admin'].includes(window._userRol)) return;

    const lista = (typeof obstaculos !== 'undefined' ? obstaculos : []).filter(Boolean);
    if (!lista.length) return;

    const payload = JSON.stringify({
        obstaculos: lista.map(obs => ({
            lat:         obs.latlng?.lat ?? obs.lat,
            lng:         obs.latlng?.lng ?? obs.lng,
            obstruccion: obs.obstruccion ?? 0.5,
            obsId:       obs.obsId ?? null,
            portal:      obs.portal ?? '',
        }))
    });

    // navigator.sendBeacon funciona durante el evento unload/beforeunload
    if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/sesion/guardar-obstaculos', blob);
    }
}

window.addEventListener('beforeunload', _guardarEmergencia);

// ==================== INIT ====================

/**
 * Punto de entrada del módulo.
 * Se llama desde auth.js justo después de _aplicarPermisos().
 */
function initSesionPersistencia() {
    _parchearCerrarSesion();
    // La comprobación de recuperación se dispara con un pequeño delay
    // para asegurarse de que el mapa y los layers ya están inicializados.
    setTimeout(sesionComprobarRecuperacion, 1500);
}

// ==================== CSS INYECTADO ====================

function _injectSesionCSS() {
    if (document.getElementById('sesion-persist-style')) return;
    const st = document.createElement('style');
    st.id = 'sesion-persist-style';
    st.textContent = `
/* Overlay de fondo */
#sesion-recovery-modal,
#sesion-save-modal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 9999;
    align-items: center;
    justify-content: center;
}

/* Caja de diálogo */
.srm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: srm-fadein 0.2s ease;
}
@keyframes srm-fadein {
    from { opacity: 0; }
    to   { opacity: 1; }
}
.srm-box {
    background: #fff;
    border-radius: 14px;
    padding: 28px 32px 24px;
    max-width: 380px;
    width: 90%;
    box-shadow: 0 16px 48px rgba(0,0,0,0.22);
    text-align: center;
    animation: srm-slidein 0.22s ease;
}
@keyframes srm-slidein {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
}
.srm-icon {
    font-size: 36px;
    margin-bottom: 10px;
    display: block;
}
.srm-titulo {
    font-size: 16px;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 8px;
}
.srm-desc {
    font-size: 13px;
    color: #64748b;
    line-height: 1.55;
    margin: 0 0 20px;
}
.srm-btns {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.srm-btn {
    border: none;
    border-radius: 8px;
    padding: 10px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
}
.srm-btn:active { transform: scale(0.97); }
.srm-btn-primary {
    background: linear-gradient(135deg, #1d4ed8, #3b82f6);
    color: #fff;
}
.srm-btn-primary:hover { opacity: 0.9; }
.srm-btn-secondary {
    background: #f1f5f9;
    color: #475569;
}
.srm-btn-secondary:hover { background: #e2e8f0; }
.srm-btn-cancel {
    background: none;
    color: #94a3b8;
    font-size: 12px;
    padding: 6px;
}
.srm-btn-cancel:hover { color: #64748b; }
    `;
    document.head.appendChild(st);
}