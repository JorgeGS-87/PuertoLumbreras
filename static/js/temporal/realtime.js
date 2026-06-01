/**
 * realtime.js
 * Cimientos de comunicación en tiempo real con flask-socketio.
 *
 * Este módulo es SOLO la base de la infraestructura.
 * No implementa ninguna lógica de negocio concreta sobre qué capa
 * se sincroniza — eso se decidirá cuando el proyecto esté en GitHub.
 *
 * Lo que hace ahora:
 *  - Conecta con el servidor WebSocket (Socket.IO) al cargar la página.
 *  - Expone window._rt como objeto público con métodos emit/on.
 *  - Escucha eventos de ejemplo (obstaculo_creado, obstaculo_eliminado)
 *    que el servidor puede emitir y los traduce a acciones del mapa.
 *  - Muestra un badge de estado de conexión WS en el header.
 *
 * Para activar en app.py:
 *   pip install flask-socketio eventlet
 *   Ver app_socketio_patch.py incluido en este paquete.
 *
 * Para añadir un nuevo evento sincronizado en el futuro:
 *   1. Backend:  socketio.emit('nombre_evento', datos)
 *   2. Frontend: _rt.on('nombre_evento', handler)
 */

// ==================== CONEXIÓN ====================

/**
 * Objeto público de tiempo real.
 * Se inicializa con el cliente Socket.IO si está disponible.
 * Si no (librería no cargada o servidor sin soporte), queda en modo stub
 * para no romper el resto del código.
 */
window._rt = (function () {

    // ── Comprobar si Socket.IO está cargado ──────────────────────────────────
    // La librería se carga desde el servidor Flask (ver instrucciones de integración).
    // Si no está disponible, el módulo actúa como stub silencioso.
    const _ioAvailable = typeof io === 'function';

    if (!_ioAvailable) {
        console.info('[realtime] Socket.IO no disponible — módulo en modo stub.');
        _actualizarBadgeWS('stub');
        return {
            on:   () => {},
            emit: () => {},
            connected: false,
            stub: true,
        };
    }

    // ── Crear conexión ───────────────────────────────────────────────────────
    const socket = io({
        transports:        ['websocket', 'polling'],
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
    });

    // ==================== EVENTOS DE CONEXIÓN ====================

    socket.on('connect', function () {
        console.info('[realtime] Conectado al servidor WebSocket — ID:', socket.id);
        _actualizarBadgeWS('online');
    });

    socket.on('disconnect', function (reason) {
        console.warn('[realtime] Desconectado:', reason);
        _actualizarBadgeWS('offline');
    });

    socket.on('connect_error', function (err) {
        console.warn('[realtime] Error de conexión WS:', err.message);
        _actualizarBadgeWS('error');
    });

    // ==================== EVENTOS DE DATOS (ejemplos base) ====================
    // Estos manejadores son los HOOKS que se activarán cuando el servidor
    // emita cambios en tiempo real. Por ahora solo loguean; la lógica real
    // se añadirá por módulo en el futuro.

    /**
     * Ejemplo: el servidor notifica que un obstáculo fue creado por otro usuario.
     * Payload esperado: { lat, lng, porcentaje, id_etiqueta, radio, usuario }
     */
    socket.on('obstaculo_creado', function (data) {
        console.info('[realtime] obstaculo_creado:', data);
        // TODO: llamar a crearObstaculo(data.lat, data.lng, data.porcentaje, data.id_etiqueta)
        // cuando se decida qué capa se sincroniza.
        _rt._handlers['obstaculo_creado']?.forEach(fn => fn(data));
    });

    /**
     * Ejemplo: el servidor notifica que un obstáculo fue eliminado.
     * Payload esperado: { id_etiqueta } o { lat, lng }
     */
    socket.on('obstaculo_eliminado', function (data) {
        console.info('[realtime] obstaculo_eliminado:', data);
        // TODO: llamar a eliminarObstaculoPorId(data.id_etiqueta) cuando esté implementado.
        _rt._handlers['obstaculo_eliminado']?.forEach(fn => fn(data));
    });

    /**
     * Hook genérico: cualquier módulo puede suscribirse a cualquier evento futuro.
     * Ejemplo de uso en otro módulo:
     *   _rt.on('ruta_calculada', (data) => { ... });
     */

    // ==================== API PÚBLICA ====================

    const _rt = {
        connected: false,
        stub:      false,

        /** Registro interno de handlers por evento */
        _handlers: {},

        /**
         * Suscribirse a un evento del servidor.
         * @param {string}   evento
         * @param {function} handler
         */
        on(evento, handler) {
            if (!this._handlers[evento]) this._handlers[evento] = [];
            this._handlers[evento].push(handler);
            socket.on(evento, handler);
        },

        /**
         * Emitir un evento al servidor.
         * @param {string} evento
         * @param {*}      datos
         */
        emit(evento, datos) {
            socket.emit(evento, datos);
        },
    };

    // Actualizar flag connected cuando cambia el estado
    socket.on('connect',    () => { _rt.connected = true;  });
    socket.on('disconnect', () => { _rt.connected = false; });

    return _rt;

})();

// ==================== BADGE DE ESTADO WS ====================

/**
 * Actualiza el badge de estado WebSocket en el header.
 * Crea el elemento si no existe (se añade junto al badge ONLINE/OFFLINE).
 *
 * @param {'online'|'offline'|'error'|'stub'} estado
 */
function _actualizarBadgeWS(estado) {
    let badge = document.getElementById('ws-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'ws-badge';
        badge.title = 'Estado WebSocket (tiempo real)';
        badge.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 10px;
            font-weight: 600;
            letter-spacing: 0.02em;
            margin-left: 6px;
            transition: background 0.3s, color 0.3s;
        `;
        // Insertar junto al badge de estado del servidor
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge?.parentNode) {
            statusBadge.parentNode.insertBefore(badge, statusBadge.nextSibling);
        } else {
            document.querySelector('.header-left')?.appendChild(badge);
        }
    }

    const config = {
        online:  { bg: '#dcfce7', color: '#166534', dot: '#22c55e', label: 'WS' },
        offline: { bg: '#fef3c7', color: '#92400e', dot: '#f59e0b', label: 'WS' },
        error:   { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444', label: 'WS' },
        stub:    { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8', label: 'WS·OFF' },
    };
    const c = config[estado] || config.stub;

    badge.style.background = c.bg;
    badge.style.color      = c.color;
    badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${c.dot};display:inline-block;"></span>${c.label}`;
    badge.title = {
        online:  'WebSocket conectado — cambios en tiempo real activos',
        offline: 'WebSocket desconectado — reconectando…',
        error:   'Error de conexión WebSocket',
        stub:    'Tiempo real no disponible — Socket.IO no cargado',
    }[estado] || '';
}
