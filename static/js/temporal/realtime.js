/**
 * realtime.js
 * Comunicación en tiempo real (Socket.IO) + gestión de la capa compartida de obstáculos.
 *
 * CAPA COMPARTIDA:
 *   - window.toggleCapaCompartida()  → abre/cierra la capa compartida
 *   - Mientras está activa, TODO el sistema de obstáculos opera sobre ella
 *   - Los cambios (crear/mover/eliminar) se emiten por WS y se persisten en BD
 *   - Al recibir un evento WS, el mapa se actualiza en tiempo real
 *   - Al cerrarla, se restaura el modo privado (array `obstaculos` original)
 */

// ==================== BADGE DE ESTADO WS ====================

function _actualizarBadgeWS(estado) {
    const config = {
        online:  { bg: '#dcfce7', color: '#166534', dot: '#22c55e', label: 'WS·ON'  },
        offline: { bg: '#fef3c7', color: '#92400e', dot: '#f59e0b', label: 'WS·OFF' },
        error:   { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444', label: 'WS·ERR' },
        stub:    { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8', label: 'WS·OFF' },
    };
    const c = config[estado] || config.stub;

    const title = {
        online:  'WebSocket conectado — tiempo real activo',
        offline: 'WebSocket desconectado — reconectando…',
        error:   'Error de conexión WebSocket',
        stub:    typeof io === 'function'
                     ? 'Servidor sin soporte WebSocket — modo solo lectura'
                     : 'Tiempo real no disponible — Socket.IO no cargado',
    }[estado] || '';

    let badge = document.getElementById('ws-badge');

    if (badge) {
        // Badge ya existente (mobile.html lo tiene pre-creado con sub-elementos)
        badge.style.background = c.bg;
        badge.style.color      = c.color;
        badge.title            = title;
        const dot   = document.getElementById('ws-badge-dot');
        const label = document.getElementById('ws-badge-label');
        if (dot)   dot.style.background = c.dot;
        if (label) label.textContent    = c.label;
    } else {
        // Desktop: crear el badge dinámicamente
        badge = document.createElement('div');
        badge.id = 'ws-badge';
        badge.style.cssText = `
            display:inline-flex;align-items:center;gap:4px;font-size:11px;
            padding:2px 7px;border-radius:10px;font-weight:600;
            letter-spacing:0.02em;margin-left:6px;transition:background 0.3s,color 0.3s;
            background:${c.bg};color:${c.color};
        `;
        badge.title = title;
        badge.innerHTML = `<span id="ws-badge-dot" style="width:6px;height:6px;border-radius:50%;background:${c.dot};display:inline-block;"></span><span id="ws-badge-label">${c.label}</span>`;
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge?.parentNode) {
            statusBadge.parentNode.insertBefore(badge, statusBadge.nextSibling);
        } else {
            document.querySelector('.header-left')?.appendChild(badge);
        }
    }
}

// ==================== CONEXIÓN SOCKET.IO ====================

window._rt = (function () {

    const _ioAvailable = typeof io === 'function';

    if (!_ioAvailable) {
        console.info('[realtime] Socket.IO no disponible — modo stub.');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => _actualizarBadgeWS('stub'));
        } else {
            setTimeout(() => _actualizarBadgeWS('stub'), 0);
        }
        return { on: () => {}, emit: () => {}, connected: false, stub: true };
    }

    // Badge inicial mientras intenta conectar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _actualizarBadgeWS('stub'));
    } else {
        setTimeout(() => _actualizarBadgeWS('stub'), 0);
    }

    const socket = io({
        transports: ['websocket', 'polling'],
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
    });

    let _errCount = 0;

    socket.on('connect', function () {
        console.info('[realtime] Conectado — ID:', socket.id);
        _errCount = 0;
        _rt.connected = true;
        _actualizarBadgeWS('online');
    });

    socket.on('disconnect', function (reason) {
        console.warn('[realtime] Desconectado:', reason);
        _rt.connected = false;
        _actualizarBadgeWS('offline');
    });

    socket.on('connect_error', function (err) {
        _errCount++;
        console.warn(`[realtime] Error WS (intento ${_errCount}):`, err.message);
        _actualizarBadgeWS(_errCount >= 3 ? 'stub' : 'error');
    });

    // ── Eventos de la capa compartida ────────────────────────────────────────

    socket.on('obs_compartido_nuevo', function (data) {
        console.info('[realtime] obs_compartido_nuevo:', data);
        if (window._capaCompartidaActiva) {
            _recibirObstaculoCompartido(data);
        }
    });

    socket.on('obs_compartido_eliminado', function (data) {
        console.info('[realtime] obs_compartido_eliminado:', data);
        if (window._capaCompartidaActiva) {
            _eliminarObstaculoCompartidoLocal(data.id);
        }
    });

    socket.on('obs_compartido_actualizado', function (data) {
        console.info('[realtime] obs_compartido_actualizado:', data);
        if (window._capaCompartidaActiva) {
            _actualizarObstaculoCompartidoLocal(data);
        }
    });

    const _rt = {
        connected: false,
        stub: false,
        _handlers: {},
        on(evento, handler) {
            if (!this._handlers[evento]) this._handlers[evento] = [];
            this._handlers[evento].push(handler);
            socket.on(evento, handler);
        },
        emit(evento, datos) {
            socket.emit(evento, datos);
        },
    };

    return _rt;
})();


// ==================== CAPA COMPARTIDA ====================

/**
 * Estado de la capa compartida.
 * _obsCompartidosMap: Map<bd_id, obs> — índice para actualizaciones/eliminaciones rápidas.
 * _obstaculosPrivadosBackup: copia del array `obstaculos` privado antes de activar la capa.
 */
window._capaCompartidaActiva      = false;
let _obsCompartidosMap            = new Map();  // bd_id → objeto obs en memoria
let _obstaculosPrivadosBackup     = null;

// ── Activar / desactivar ──────────────────────────────────────────────────────

window.toggleCapaCompartida = function () {
    if (window._capaCompartidaActiva) {
        _cerrarCapaCompartida();
    } else {
        _abrirCapaCompartida();
    }
};

async function _abrirCapaCompartida() {
    // Solo usuarios registrados/admin
    const rol = window._userRol || 'invitado';
    if (rol === 'invitado') {
        showNotification('Inicia sesión para acceder a la capa compartida', 'warning');
        return;
    }

    showNotification('⏳ Cargando capa compartida…', 'info');

    // 1. Hacer backup de los obstáculos privados y limpiar el mapa
    _obstaculosPrivadosBackup = obstaculos.slice();
    limpiarObstaculos();   // limpia el array global y el mapa

    // 2. Cargar obstáculos compartidos desde BD
    try {
        const r    = await fetch('/api/obstaculos-compartidos');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || r.status);

        window._capaCompartidaActiva = true;
        localStorage.setItem('capaCompartidaActiva', '1');
        _obsCompartidosMap.clear();

        // Pintar cada obstáculo compartido
        for (const obs of (data.obstaculos || [])) {
            _recibirObstaculoCompartido(obs);
        }

        // Activar indicador visual en el botón
        _actualizarBotonCompartida(true);

        // Actualizar panel de obstáculos y habilitar botón de tabla
        if (typeof _actualizarListaObstaculos === 'function') _actualizarListaObstaculos();
        if (typeof refrescarTablaObstaculosSiAbierta === 'function') refrescarTablaObstaculosSiAbierta();

        showNotification(
            `🚧 Capa compartida activa — ${data.obstaculos.length} obstáculo(s)`,
            'success'
        );
    } catch (err) {
        // Restaurar privados si falla
        obstaculos = _obstaculosPrivadosBackup || [];
        _obstaculosPrivadosBackup = null;
        showNotification('Error al cargar capa compartida: ' + err.message, 'error');
    }
}

function _cerrarCapaCompartida() {
    // Guardar backup ANTES de limpiar (limpiarObstaculos resetea el array)
    const backup = (_obstaculosPrivadosBackup || []).filter(Boolean);
    _obstaculosPrivadosBackup = null;

    // 1. Limpiar obstáculos compartidos del mapa sin notificación de spam
    obstaculos.forEach(obs => {
        if (!obs) return;
        if (obs.marker)  window.map.removeLayer(obs.marker);
        if (obs.circulo) window.map.removeLayer(obs.circulo);
        obs.segmentosBloqueados?.forEach(s => window.map.removeLayer(s));
    });
    obstaculos = [];
    _obsCompartidosMap.clear();
    if (typeof _actualizarListaObstaculos === 'function') _actualizarListaObstaculos();

    window._capaCompartidaActiva = false;
    localStorage.removeItem('capaCompartidaActiva');

    // 2. Restaurar obstáculos privados
    for (const obs of backup) {
        // Garantizar que latlng es un L.LatLng válido (puede ser objeto plano tras backup)
        const ll = (obs.latlng && typeof obs.latlng.lat === 'number')
            ? L.latLng(obs.latlng.lat, obs.latlng.lng)
            : (obs.lat != null ? L.latLng(obs.lat, obs.lng) : null);
        if (!ll) continue;
        crearObstaculo(ll, obs.obstruccion ?? 0.5, obs.obsId ?? null, obs.portal || '');
    }

    _actualizarBotonCompartida(false);
    showNotification('Capa compartida cerrada — modo privado', 'info');
}

// ── Pintar obstáculo compartido recibido por WS o carga inicial ──────────────

function _recibirObstaculoCompartido(data) {
    // Evitar duplicados (el emisor también recibe su propio evento)
    if (_obsCompartidosMap.has(data.id)) return;

    const latlng      = L.latLng(data.lat, data.lng);
    const obstruccion = data.obstruccion ?? 0.5;  // el servidor siempre envía obstruccion (0-1)

    // Marcador y círculo directamente (evitamos que crearObstaculo emita WS de vuelta)
    _crearObstaculoLocalSilencioso(latlng, obstruccion, data.obs_id, data.portal, data.id);
}

/**
 * Crea el obstáculo en el mapa SIN emitir por WebSocket.
 * Se usa para los obstáculos recibidos del servidor.
 */
function _crearObstaculoLocalSilencioso(latlng, obstruccion, obsId, portal, bdId) {
    const color  = _colorObs(obstruccion);
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'marker-obstaculo',
            html: '<div style="font-size:32px;text-shadow:2px 2px 4px rgba(0,0,0,.7);">🚧</div>',
            iconSize: [32, 32], iconAnchor: [16, 32],
        })
    }).addTo(window.map);

    const circulo = L.circle(latlng, {
        radius: 5, color, fillColor: color, fillOpacity: 0.25, weight: 2
    }).addTo(window.map);

    const segmentosBloqueados = _segmentosViasEnRadio(latlng, 5).map(({ p1, p2 }) =>
        L.polyline([p1, p2], {
            color, weight: 6, opacity: 1, dashArray: '10, 10', className: 'via-bloqueada'
        }).addTo(window.map)
    );

    const idx = obstaculos.length;
    const obs = {
        obsId, marker, circulo, latlng, obstruccion,
        segmentosBloqueados, portal: portal || '',
        _bdId: bdId,        // id en BD — necesario para WS emit al editar/eliminar
        _compartido: true,  // flag para que el monkey-patch sepa que es compartido
    };
    obstaculos.push(obs);
    _obsCompartidosMap.set(bdId, obs);

    marker.bindPopup(_popupHTML(idx), { maxWidth: 230 });
    marker.on('popupclose', () => _aplicarPctPopup(idx));

    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
}

// ── Recibir actualización de posición/nivel ────────────────────────────────

function _actualizarObstaculoCompartidoLocal(data) {
    const obs = _obsCompartidosMap.get(data.id);
    if (!obs) {
        // Obstáculo que no tenemos (puede que llegara mientras no estábamos suscritos)
        _recibirObstaculoCompartido(data);
        return;
    }
    // Actualizar posición si cambió
    if (data.lat !== undefined && data.lng !== undefined) {
        const nuevaLatlng = L.latLng(data.lat, data.lng);
        obs.latlng = nuevaLatlng;
        obs.marker.setLatLng(nuevaLatlng);
        if (obs.circulo) obs.circulo.setLatLng(nuevaLatlng);
        obs.segmentosBloqueados?.forEach(s => window.map.removeLayer(s));
        obs.segmentosBloqueados = _segmentosViasEnRadio(nuevaLatlng, 5).map(({ p1, p2 }) =>
            L.polyline([p1, p2], {
                color: _colorObs(obs.obstruccion), weight: 6, opacity: 1,
                dashArray: '10, 10', className: 'via-bloqueada'
            }).addTo(window.map)
        );
    }
    // Actualizar obstruccion si cambió
    if (data.obstruccion !== undefined) {
        obs.obstruccion = data.obstruccion;
        const color = _colorObs(obs.obstruccion);
        obs.circulo?.setStyle({ color, fillColor: color });
        obs.segmentosBloqueados?.forEach(s => s.setStyle({ color }));
    }
    _actualizarListaObstaculos();
}

// ── Eliminar obstáculo compartido recibido por WS ────────────────────────────

function _eliminarObstaculoCompartidoLocal(bdId) {
    const obs = _obsCompartidosMap.get(bdId);
    if (!obs) return;
    const idx = obstaculos.indexOf(obs);
    if (idx !== -1) {
        // Limpiar capas del mapa sin emitir WS
        if (obs.marker)  window.map.removeLayer(obs.marker);
        if (obs.circulo) window.map.removeLayer(obs.circulo);
        obs.segmentosBloqueados?.forEach(s => window.map.removeLayer(s));
        obstaculos[idx] = null;
    }
    _obsCompartidosMap.delete(bdId);
    _actualizarListaObstaculos();
    if (typeof window.refrescarTablaObstaculosSiAbierta === 'function')
        window.refrescarTablaObstaculosSiAbierta();
}

// ── Visual del botón ──────────────────────────────────────────────────────────

function _actualizarBotonCompartida(activo) {
    // Botón desktop
    const btn = document.getElementById('btn-capa-compartida');
    if (btn) {
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
    // Botón mobile
    const btnM = document.getElementById('btn-capa-compartida-mobile');
    const descM = document.getElementById('compartida-layer-desc');
    if (btnM) {
        btnM.textContent       = activo ? 'Desactivar' : 'Activar';
        btnM.style.background  = activo ? '#e67e22'  : '#ebf5fb';
        btnM.style.color       = activo ? '#fff'     : '#2980b9';
        btnM.style.borderColor = activo ? '#d35400'  : '#3498db';
    }
    if (descM) {
        descM.textContent = activo ? 'ACTIVA — tiempo real' : 'Requiere sesión';
        descM.style.color = activo ? '#e67e22' : '';
    }
}

// ==================== MONKEY-PATCH DE crearObstaculo / eliminarObstaculo ====================
/**
 * Cuando la capa compartida está activa, interceptamos crearObstaculo,
 * eliminarObstaculo y _moverObstaculoA para emitir los eventos WS
 * y asignar el bdId al obstáculo recién creado.
 */

(function _parchearObstaculos() {
    function _intentar() {
        if (typeof crearObstaculo !== 'function' || typeof eliminarObstaculo !== 'function') {
            setTimeout(_intentar, 150);
            return;
        }

        // ── crearObstaculo ──
        const _origCrear = crearObstaculo;
        window.crearObstaculo = function (latlng, obstruccion, obsId, portal) {
            if (!window._capaCompartidaActiva) {
                return _origCrear.apply(this, arguments);
            }
            // Emitir al servidor; el servidor responde con obs_compartido_nuevo
            // que incluirá el bdId. Mientras tanto creamos localmente con bdId=null
            // y lo actualizamos cuando llegue la confirmación.
            _rt.emit('obs_compartido_crear', {
                obs_id:  obsId || null,
                lat:     latlng.lat,
                lng:     latlng.lng,
                nivel:   _nivelObs(obstruccion),  // nivel 1-4, que es lo que guarda el servidor
                portal:  portal || '',
            });
            // La creación visual la hace _recibirObstaculoCompartido cuando
            // el servidor nos devuelve obs_compartido_nuevo (incluido a nosotros mismos)
        };

        // ── eliminarObstaculo ──
        const _origEliminar = eliminarObstaculo;
        window.eliminarObstaculo = function (index) {
            if (!window._capaCompartidaActiva) {
                return _origEliminar.apply(this, arguments);
            }
            const obs = obstaculos[index];
            if (!obs) return;
            if (obs._bdId) {
                // Emitir al servidor; la eliminación visual la gestiona obs_compartido_eliminado
                _rt.emit('obs_compartido_eliminar', { id: obs._bdId });
            } else {
                // Sin bdId (raro): eliminar solo localmente
                _origEliminar.apply(this, arguments);
            }
        };

        // ── limpiarObstaculos ──
        const _origLimpiar = limpiarObstaculos;
        window.limpiarObstaculos = function () {
            if (!window._capaCompartidaActiva) {
                return _origLimpiar.apply(this, arguments);
            }
            // Emitir eliminación de cada obstáculo compartido
            obstaculos.filter(Boolean).forEach(obs => {
                if (obs._bdId) _rt.emit('obs_compartido_eliminar', { id: obs._bdId });
            });
            // Limpiar visualmente de inmediato (no esperamos confirmación WS)
            _origLimpiar.apply(this, arguments);
            _obsCompartidosMap.clear();
        };

        // ── _moverObstaculoA ──
        const _origMover = window._moverObstaculoA || function(){};
        window._moverObstaculoA = function (idx, nuevaLatlng) {
            _origMover.apply(this, arguments);
            if (!window._capaCompartidaActiva) return;
            const obs = obstaculos[idx];
            if (!obs || !obs._bdId) return;
            _rt.emit('obs_compartido_mover', {
                id:     obs._bdId,
                lat:    nuevaLatlng.lat,
                lng:    nuevaLatlng.lng,
                nivel:  _nivelObs(obs.obstruccion || 0.5),
                portal: obs.portal || '',
            });
        };

        // ── cambiarNivelObstaculo (cambio de nivel desde popup o lista) ──
        const _origCambiarNivel = window.cambiarNivelObstaculo || function(){};
        window.cambiarNivelObstaculo = function (idx, nivel) {
            _origCambiarNivel.apply(this, arguments);
            if (!window._capaCompartidaActiva) return;
            const obs = obstaculos[idx];
            if (!obs || !obs._bdId) return;
            _rt.emit('obs_compartido_mover', {
                id:     obs._bdId,
                lat:    obs.latlng.lat,
                lng:    obs.latlng.lng,
                nivel:  nivel,  // ya viene como 1-4 desde el caller
                portal: obs.portal || '',
            });
        };

        console.log('[realtime] ✅ Obstáculos parcheados para capa compartida.');
    }
    setTimeout(_intentar, 200);
})();

// ==================== AUTO-REACTIVAR CAPA COMPARTIDA AL RECARGAR ====================

// Si el usuario recargó la página con la capa compartida activa, reactivarla automáticamente.
// Espera a que window._userRol esté disponible (lo pone auth.js) antes de intentarlo.
(function _autoReactivarCapaCompartida() {
    if (localStorage.getItem('capaCompartidaActiva') !== '1') return;

    let _intentos = 0;
    function _intentarReactivar() {
        _intentos++;
        const rol = window._userRol;

        // Aún no está listo — reintentar hasta 20 veces (10 s total)
        if (!rol && _intentos < 20) {
            setTimeout(_intentarReactivar, 500);
            return;
        }

        if (!['registrado', 'admin'].includes(rol)) {
            // Sesión expirada o invitado → limpiar el flag
            localStorage.removeItem('capaCompartidaActiva');
            return;
        }

        if (!window._capaCompartidaActiva) {
            console.info('[realtime] Reactivando capa compartida tras recarga…');
            window.toggleCapaCompartida();
        }
    }

    // Primer intento tras 1 s (mapa ya inicializado normalmente)
    setTimeout(_intentarReactivar, 1000);
})();