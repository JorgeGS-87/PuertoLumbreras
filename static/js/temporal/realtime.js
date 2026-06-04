/**
 * realtime.js
 * Comunicación en tiempo real (Socket.IO) + gestión de la capa compartida de obstáculos.
 *
 * CAPA COMPARTIDA:
 *   - window.toggleCapaCompartida()  -> abre/cierra la capa compartida
 *   - Mientras está activa, TODO el sistema de obstáculos opera sobre ella
 *   - Los cambios (crear/mover/eliminar) se emiten por WS y se persisten en BD
 *   - Al recibir un evento WS, el mapa se actualiza en tiempo real
 *   - Al cerrarla, se restaura el modo privado (array `obstaculos` original)
 */

// ==================== BADGE DE ESTADO WS ====================

function actualizarBadgeWS(estado) {
    let badge = document.getElementById('ws-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'ws-badge';
        badge.style.cssText = `
            display:inline-flex;align-items:center;gap:6px;font-size:12px;
            padding:4px 10px;border-radius:12px;font-weight:400;
            letter-spacing:0em;margin-left:6px;transition:background 0.3s,color 0.3s;
        `;
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge?.parentNode) {
            statusBadge.parentNode.insertBefore(badge, statusBadge.nextSibling);
        } else {
            document.querySelector('.header-left')?.appendChild(badge);
        }
    }
    const config = {
        online:  { bg: '#dcfce7', color: '#166534', dot: '#22c55e', label: 'WS·ON' },
        offline:  { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8', label: 'WS·OFF' },
        error:   { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444', label: 'WS·ERR' },
        stub:    { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8', label: 'WS·OFF' },
    };
    const c = config[estado] || config.stub;
    badge.style.background = c.bg;
    badge.style.color      = c.color;
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${c.dot};display:inline-block;"></span>${c.label}`;
    badge.title = {
        online:  'WebSocket conectado — cambios en tiempo real activos',
        offline: 'WebSocket desconectado — reconectando…',
        error:   'Error de conexión WebSocket',
        stub:    typeof io === 'function'
                     ? 'Servidor sin soporte WebSocket — modo solo lectura'
                     : 'Tiempo real no disponible — Socket.IO no cargado',
    }[estado] || '';
}

// ==================== CONEXIÓN SOCKET.IO ====================

window.rt = (function () {

    const ioAvailable = typeof io === 'function';

    if (!_ioAvailable) {
        console.info('[realtime] Socket.IO no disponible — modo stub.');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => actualizarBadgeWS('stub'));
        } else {
            setTimeout(() => actualizarBadgeWS('stub'), 0);
        }
        return { on: () => {}, emit: () => {}, connected: false, stub: true };
    }

    // Badge inicial mientras intenta conectar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => actualizarBadgeWS('stub'));
    } else {
        setTimeout(() => actualizarBadgeWS('stub'), 0);
    }

    const socket = io({
        transports: ['websocket', 'polling'],
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
    });

    let errCount = 0;

    socket.on('connect', function () {
        console.info('[realtime] Conectado — ID:', socket.id);
        errCount = 0;
        rt.connected = true;
        // Si el modo offline está activo, no mostrar WS·ON
        if (window.offlineActivado) {
            actualizarBadgeWS('offline');
        } else {
            actualizarBadgeWS('online');
        }
    });

    socket.on('disconnect', function (reason) {
        console.warn('[realtime] Desconectado:', reason);
        rt.connected = false;
        actualizarBadgeWS('offline');
    });

    socket.on('connect_error', function (err) {
        errCount++;
        console.warn(`[realtime] Error WS (intento ${errCount}):`, err.message);
        actualizarBadgeWS(errCount >= 3 ? 'stub' : 'error');
    });

    // ── Eventos de la capa compartida ────────────────────────────────────────

    socket.on('obs_compartido_nuevo', function (data) {
        console.info('[realtime] obs_compartido_nuevo:', data);
        if (window.capaCompartidaActiva) {
            recibirObstaculoCompartido(data);
        }
    });

    socket.on('obs_compartido_eliminado', function (data) {
        console.info('[realtime] obs_compartido_eliminado:', data);
        if (window.capaCompartidaActiva) {
            eliminarObstaculoCompartidoLocal(data.id);
        }
    });

    socket.on('obs_compartido_actualizado', function (data) {
        console.info('[realtime] obs_compartido_actualizado:', data);
        if (window.capaCompartidaActiva) {
            actualizarObstaculoCompartidoLocal(data);
        }
    });

    const rt = {
        connected: false,
        stub: false,
        handlers: {},
        on(evento, handler) {
            if (!this.handlers[evento]) this.handlers[evento] = [];
            this.handlers[evento].push(handler);
            socket.on(evento, handler);
        },
        emit(evento, datos) {
            socket.emit(evento, datos);
        },
    };

    return rt;
})();


// ==================== CAPA COMPARTIDA ====================

/**
 * Estado de la capa compartida.
 * obsCompartidosMap: Map<bd_id, obs> — índice para actualizaciones/eliminaciones rápidas.
 * obstaculosPrivadosBackup: copia del array `obstaculos` privado antes de activar la capa.
 */
window.capaCompartidaActiva      = false;
let obsCompartidosMap            = new Map();  // bd_id -> objeto obs en memoria
let obstaculosPrivadosBackup     = null;

// ── Activar / desactivar ──────────────────────────────────────────────────────

window.toggleCapaCompartida = function () {
    if (window.capaCompartidaActiva) {
        cerrarCapaCompartida();
    } else {
        abrirCapaCompartida();
    }
};

async function abrirCapaCompartida() {
    // Solo usuarios registrados/admin
    const rol = window.userRol || 'invitado';
    if (rol === 'invitado') {
        showNotification('Inicia sesión para acceder a la capa compartida', 'warning');
        return;
    }

    showNotification('⏳ Cargando capa compartida…', 'info');

    // 1. Hacer backup de los obstáculos privados y limpiar el mapa
    obstaculosPrivadosBackup = obstaculos.slice();
    limpiarObstaculos();   // limpia el array global y el mapa

    // 2. Cargar obstáculos compartidos desde BD
    try {
        const r    = await fetch('/api/obstaculos-compartidos');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || r.status);

        window.capaCompartidaActiva = true;
        obsCompartidosMap.clear();

        // Pintar cada obstáculo compartido
        for (const obs of (data.obstaculos || [])) {
            recibirObstaculoCompartido(obs);
        }

        // 3. Activar indicador visual en el botón
        actualizarBotonCompartida(true);

        showNotification(
            `🚧 Capa compartida activa — ${data.obstaculos.length} obstáculo(s)`,
            'success'
        );
    } catch (err) {
        // Restaurar privados si falla
        obstaculos = obstaculosPrivadosBackup || [];
        obstaculosPrivadosBackup = null;
        showNotification('Error al cargar capa compartida: ' + err.message, 'error');
    }
}

function cerrarCapaCompartida() {
    // 1. Limpiar obstáculos compartidos del mapa
    limpiarObstaculos();
    obsCompartidosMap.clear();

    window.capaCompartidaActiva = false;

    // 2. Restaurar obstáculos privados
    if (obstaculosPrivadosBackup) {
        for (const obs of obstaculosPrivadosBackup.filter(Boolean)) {
            // Re-pintar cada obstáculo privado
            crearObstaculo(obs.latlng, obs.obstruccion, obs.obsId, obs.portal || '');
        }
        obstaculosPrivadosBackup = null;
    }

    actualizarBotonCompartida(false);
    showNotification('Capa compartida cerrada — modo privado', 'info');
}

// ── Pintar obstáculo compartido recibido por WS o carga inicial ──────────────

function parseLon(data) {
    return data.lon !== undefined ? data.lon : data.lng;
}

function recibirObstaculoCompartido(data) {
    // Evitar duplicados (el emisor también recibe su propio evento)
    if (obsCompartidosMap.has(data.id)) return;

    const latlng     = L.latLng(data.lat, parseLon(data));
    const obstruccion = data.porcentaje / 100;

    // Usar crearObstaculo normal — el monkey-patch de más abajo redirigirá
    // los eventos WS al crear. Necesitamos el índice ANTES de crear.
    const idxAntes = obstaculos.length;

    // Marcador y círculo directamente (evitamos que crearObstaculo emita WS de vuelta)
    crearObstaculoLocalSilencioso(latlng, obstruccion, data.obs_id, data.portal, data.id);
}

/**
 * Crea el obstáculo en el mapa SIN emitir por WebSocket.
 * Se usa para los obstáculos recibidos del servidor.
 */
function crearObstaculoLocalSilencioso(latlng, obstruccion, obsId, portal, bdId) {
    const color  = colorObs(obstruccion);
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'marker-obstaculo',
            html: '<div style="font-size:32px;text-shadow:2px 2px 4px rgba(0,0,0,.7);">🚧</div>',
            iconSize: [32, 32], iconAnchor: [16, 32],
        })
    }).addTo(map);

    const circulo = L.circle(latlng, {
        radius: 5, color, fillColor: color, fillOpacity: 0.25, weight: 2
    }).addTo(map);

    const segmentosBloqueados = segmentosViasEnRadio(latlng, 5).map(({ p1, p2 }) =>
        L.polyline([p1, p2], {
            color, weight: 6, opacity: 1, dashArray: '10, 10', className: 'via-bloqueada'
        }).addTo(map)
    );

    const idx = obstaculos.length;
    const obs = {
        obsId, marker, circulo, latlng, obstruccion,
        segmentosBloqueados, portal: portal || '',
        bdId: bdId,        // id en BD — necesario para WS emit al editar/eliminar
        compartido: true,  // flag para que el monkey-patch sepa que es compartido
    };
    obstaculos.push(obs);
    obsCompartidosMap.set(bdId, obs);

    marker.bindPopup(popupHTML(idx), { maxWidth: 230 });
    marker.on('popupclose', () => aplicarPctPopup(idx));

    actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
}

// ── Recibir actualización de posición/porcentaje ──────────────────────────────

function actualizarObstaculoCompartidoLocal(data) {
    const obs = obsCompartidosMap.get(data.id);
    if (!obs) {
        // Obstáculo que no tenemos (puede que llegara mientras no estábamos suscritos)
        recibirObstaculoCompartido(data);
        return;
    }
    // Actualizar posición si cambió
    if (data.lat !== undefined && (data.lon !== undefined || data.lng !== undefined)) {
        const nuevaLatlng = L.latLng(data.lat, parseLon(data));
        obs.latlng = nuevaLatlng;
        obs.marker.setLatLng(nuevaLatlng);
        if (obs.circulo) obs.circulo.setLatLng(nuevaLatlng);
        obs.segmentosBloqueados?.forEach(s => map.removeLayer(s));
        obs.segmentosBloqueados = segmentosViasEnRadio(nuevaLatlng, 5).map(({ p1, p2 }) =>
            L.polyline([p1, p2], {
                color: colorObs(obs.obstruccion), weight: 6, opacity: 1,
                dashArray: '10, 10', className: 'via-bloqueada'
            }).addTo(map)
        );
    }
    // Actualizar porcentaje si cambió
    if (data.porcentaje !== undefined) {
        obs.obstruccion = data.porcentaje / 100;
        const color = colorObs(obs.obstruccion);
        obs.circulo?.setStyle({ color, fillColor: color });
        obs.segmentosBloqueados?.forEach(s => s.setStyle({ color }));
    }
    actualizarListaObstaculos();
}

// ── Eliminar obstáculo compartido recibido por WS ────────────────────────────

function eliminarObstaculoCompartidoLocal(bdId) {
    const obs = obsCompartidosMap.get(bdId);
    if (!obs) return;
    const idx = obstaculos.indexOf(obs);
    if (idx !== -1) {
        // Limpiar capas del mapa sin emitir WS
        if (obs.marker)  map.removeLayer(obs.marker);
        if (obs.circulo) map.removeLayer(obs.circulo);
        obs.segmentosBloqueados?.forEach(s => map.removeLayer(s));
        obstaculos[idx] = null;
    }
    obsCompartidosMap.delete(bdId);
    actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
}

// ── Visual del botón ──────────────────────────────────────────────────────────

function actualizarBotonCompartida(activo) {
    const btn = document.getElementById('btn-capa-compartida');
    if (!btn) return;
    if (activo) {
        btn.style.background   = '#e67e22';
        btn.style.color        = '#fff';
        btn.style.borderColor  = '#d35400';
        btn.title = 'Capa compartida ACTIVA — pulsa para cerrar';
    } else {
        btn.style.background  = '';
        btn.style.color       = '';
        btn.style.borderColor = '';
        btn.title = 'Abrir capa de obstáculos compartida';
    }
}

// ==================== MONKEY-PATCH DE crearObstaculo / eliminarObstaculo ====================
/**
 * Cuando la capa compartida está activa, interceptamos crearObstaculo,
 * eliminarObstaculo y moverObstaculoA para emitir los eventos WS
 * y asignar el bdId al obstáculo recién creado.
 */

(function parchearObstaculos() {
    function intentar() {
        if (typeof crearObstaculo !== 'function' || typeof eliminarObstaculo !== 'function') {
            setTimeout(intentar, 150);
            return;
        }

        // ── crearObstaculo ──
        const origCrear = crearObstaculo;
        window.crearObstaculo = function (latlng, obstruccion, obsId, portal) {
            if (!window.capaCompartidaActiva) {
                return origCrear.apply(this, arguments);
            }
            // Emitir al servidor; el servidor responde con obs_compartido_nuevo
            // que incluirá el bdId. Mientras tanto creamos localmente con bdId=null
            // y lo actualizamos cuando llegue la confirmación.
            rt.emit('obs_compartido_crear', {
                obs_id:     obsId || null,
                lat:        latlng.lat,
                lon:        latlng.lng,
                lng:        latlng.lng,
                porcentaje: Math.round(obstruccion * 100),
                portal:     portal || '',
            });
            // La creación visual la hace recibirObstaculoCompartido cuando
            // el servidor nos devuelve obs_compartido_nuevo (incluido a nosotros mismos)
        };

        // ── eliminarObstaculo ──
        const origEliminar = eliminarObstaculo;
        window.eliminarObstaculo = function (index) {
            if (!window.capaCompartidaActiva) {
                return origEliminar.apply(this, arguments);
            }
            const obs = obstaculos[index];
            if (!obs) return;
            if (obs.bdId) {
                // Emitir al servidor; la eliminación visual la gestiona obs_compartido_eliminado
                rt.emit('obs_compartido_eliminar', { id: obs.bdId });
            } else {
                // Sin bdId (raro): eliminar solo localmente
                origEliminar.apply(this, arguments);
            }
        };

        // ── limpiarObstaculos ──
        const origLimpiar = limpiarObstaculos;
        window.limpiarObstaculos = function () {
            if (!window.capaCompartidaActiva) {
                return origLimpiar.apply(this, arguments);
            }
            // Emitir eliminación de cada obstáculo compartido
            obstaculos.filter(Boolean).forEach(obs => {
                if (obs.bdId) rt.emit('obs_compartido_eliminar', { id: obs.bdId });
            });
            // Limpiar visualmente de inmediato (no esperamos confirmación WS)
            origLimpiar.apply(this, arguments);
            obsCompartidosMap.clear();
        };

        // ── moverObstaculoA ──
        const origMover = window.moverObstaculoA || function(){};
        window.moverObstaculoA = function (idx, nuevaLatlng) {
            origMover.apply(this, arguments);
            if (!window.capaCompartidaActiva) return;
            const obs = obstaculos[idx];
            if (!obs || !obs.bdId) return;
            rt.emit('obs_compartido_mover', {
                id:         obs.bdId,
                lat:        nuevaLatlng.lat,
                lon:        nuevaLatlng.lng,
                lng:        nuevaLatlng.lng,
                porcentaje: Math.round((obs.obstruccion || 0.5) * 100),
                portal:     obs.portal || '',
            });
        };

        // ── aplicarPctPopup (cambio de % desde popup) ──
        const origAplicarPct = window.aplicarPctPopup || function(){};
        window.aplicarPctPopup = function (idx) {
            origAplicarPct.apply(this, arguments);
            if (!window.capaCompartidaActiva) return;
            const obs = obstaculos[idx];
            if (!obs || !obs.bdId) return;
            rt.emit('obs_compartido_mover', {
                id:         obs.bdId,
                lat:        obs.latlng.lat,
                lon:        obs.latlng.lng,
                lng:        obs.latlng.lng,
                porcentaje: Math.round((obs.obstruccion || 0.5) * 100),
                portal:     obs.portal || '',
            });
        };

        console.log('[realtime] ✅ Obstáculos parcheados para capa compartida.');
    }
    setTimeout(intentar, 200);
})();