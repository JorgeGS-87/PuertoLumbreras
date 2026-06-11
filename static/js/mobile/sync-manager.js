/**
 * sync-manager.js
 * Orquestador offline-first para GeoRuta.
 *
 * Responsabilidades:
 *   1. Detectar si el servidor Flask está disponible.
 *   2. Interceptar calcularRuta(): servidor si hay conexión, DijkstraOffline si no.
 *   3. Interceptar crearObstaculo(): guardar en IndexedDB si está offline.
 *   4. Al recuperar conexión: sincronizar obstáculos pendientes con el servidor.
 *   5. Mostrar badge de estado (🟢 online / 🔴 offline) en la UI.
 */

const SyncManager = (() => {

    // ── Estado ───────────────────────────────────────────────────────────────
    let _online          = true;   // ¿Servidor accesible?
    let _sincronizando   = false;
    let _checkInterval   = null;
    const CHECK_MS       = 8000;   // Comprobar cada 8 segundos
    const PING_ENDPOINT  = '/api/auth/me';

    // ── Badge de estado ──────────────────────────────────────────────────────

    function _actualizarBadge(online) {
        const dot = document.getElementById('network-dot');
        if (!dot) return;

        dot.style.display    = 'block';
        dot.style.width      = '10px';
        dot.style.height     = '10px';
        dot.style.borderRadius = '50%';
        dot.style.position   = 'fixed';
        dot.style.bottom     = '72px';   // encima de la bottom nav
        dot.style.right      = '12px';
        dot.style.zIndex     = '9000';
        dot.style.boxShadow  = '0 1px 4px rgba(0,0,0,0.4)';
        dot.title = online ? 'Conectado al servidor' : 'Modo offline — rutas calculadas localmente';

        if (online) {
            dot.style.background = '#27ae60';
            dot.style.animation  = 'none';
        } else {
            dot.style.background = '#e74c3c';
            // Pulso suave para que sea visible
            dot.style.animation  = 'offlinePulse 2s infinite';
            _inyectarAnimacion();
        }
    }

    function _inyectarAnimacion() {
        if (document.getElementById('__sync-anim')) return;
        const style = document.createElement('style');
        style.id = '__sync-anim';
        style.textContent = `
            @keyframes offlinePulse {
                0%,100% { opacity: 1; transform: scale(1); }
                50%      { opacity: 0.5; transform: scale(1.3); }
            }
        `;
        document.head.appendChild(style);
    }

    // ── Detección de conectividad ────────────────────────────────────────────

    async function _ping() {
        try {
            const r = await fetch(PING_ENDPOINT, {
                method: 'GET',
                // Timeout corto para no bloquear la UI
                signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
            });
            return r.status < 500;
        } catch {
            return false;
        }
    }

    async function _comprobarConexion() {
        const estaba  = _online;
        _online       = await _ping();
        _actualizarBadge(_online);

        if (!estaba && _online) {
            // Acaba de recuperar conexión
            console.info('[SyncManager] 🟢 Conexión recuperada — sincronizando...');
            if (typeof showNotification === 'function')
                showNotification('🟢 Conexión recuperada — sincronizando datos...', 'success');
            await sincronizarPendientes();
        } else if (estaba && !_online) {
            // Acaba de perder conexión
            console.info('[SyncManager] 🔴 Sin conexión — modo offline activado');
            if (typeof showNotification === 'function')
                showNotification('🔴 Sin conexión — modo offline activado', 'warning');
        }
    }

    // ── Inicialización ───────────────────────────────────────────────────────

    async function inicializar() {
        // Comprobar estado inicial
        await _comprobarConexion();

        // Inicializar motor Dijkstra offline en segundo plano
        if (window.DijkstraOffline) {
            DijkstraOffline.inicializar().then(() => {
                if (DijkstraOffline.estaListo())
                    console.info('[SyncManager] Motor offline listo');
            });
        }

        // Polling periódico
        _checkInterval = setInterval(_comprobarConexion, CHECK_MS);

        // Eventos nativos del navegador (complementarios al ping)
        window.addEventListener('online',  () => _comprobarConexion());
        window.addEventListener('offline', () => {
            _online = false;
            _actualizarBadge(false);
        });

        // Interceptar calcularRuta cuando esté cargado route-manager.js
        _parcharCalcularRuta();

        // Interceptar crearObstaculo cuando esté disponible
        _parcharCrearObstaculo();

        console.info('[SyncManager] Inicializado');
    }

    // ── Intercepción de calcularRuta ─────────────────────────────────────────

    /**
     * Sustituye la función global calcularRuta() por una versión que decide
     * automáticamente si usar el servidor o el motor offline.
     */
    function _parcharCalcularRuta() {
        // Esperar a que route-manager.js haya definido calcularRuta
        const _orig = window.calcularRuta;
        if (typeof _orig !== 'function') {
            setTimeout(_parcharCalcularRuta, 200);
            return;
        }

        window.calcularRuta = async function(forzar = false) {
            // Ping rápido siempre — fuente de verdad en el momento de calcular
            const servidorVivo = await _ping();
            _online = servidorVivo;
            _actualizarBadge(servidorVivo);

            if (servidorVivo) {
                return _orig.call(this, forzar);
            }

            // Sin conexión: Dijkstra local
            console.warn('[SyncManager] Servidor no alcanzable — usando Dijkstra offline');
            if (typeof showNotification === 'function')
                showNotification('🔴 Sin conexión — calculando ruta localmente', 'warning');

            // Sin conexión: Dijkstra local
            if (!window.DijkstraOffline?.estaListo()) {
                if (typeof showNotification === 'function')
                    showNotification('⚠️ Motor offline no disponible. Conecta al servidor al menos una vez.', 'warning');
                return;
            }

            if (!window.puntoOrigen || !window.puntoDestino) return;

            // Construir el mismo payload que el original
            const obstaculosActivos = (window.obstaculos || []).filter(Boolean).map(obs => ({
                lat:         obs.latlng.lat,
                lon:         obs.latlng.lng,
                radio:       5,
                obstruccion: obs.obstruccion ?? 0.5,
            }));

            // Obtener obstáculos pendientes de IndexedDB también
            const pendientes = await OfflineStore.obtenerPendientes().catch(() => []);
            const todosObs   = [
                ...obstaculosActivos,
                ...pendientes.map(p => ({ lat: p.lat, lon: p.lng, radio: 5, obstruccion: p.obstruccion })),
            ];

            const fechaEfectiva = typeof obtenerFechaEfectiva === 'function' ? obtenerFechaEfectiva() : new Date();
            const coefTemporal  = typeof obtenerCoeficiente   === 'function' ? obtenerCoeficiente(fechaEfectiva) : 1.0;

            const payload = {
                origen:         { lat: puntoOrigen.lat,  lon: puntoOrigen.lng  },
                destino:        { lat: puntoDestino.lat, lon: puntoDestino.lng },
                obstaculos:     forzar ? [] : todosObs,
                tipo_vehiculo:  window._vehiculoActual  || 'coche',
                emergencia:     window._modoEmergencia  || false,
                emerg_velocidad: window._emergVelocidad !== false,
                emerg_giros:    window._emergGiros      !== false,
                emerg_sentido:  window._emergSentido    !== false,
                coef_temporal:  coefTemporal,
            };

            if (typeof mostrarProgreso === 'function') mostrarProgreso('Calculando ruta offline…', 50);

            const data = DijkstraOffline.calcularRuta(payload);

            if (typeof ocultarProgreso === 'function') ocultarProgreso();

            if (!data || data.error) {
                if (typeof showNotification === 'function')
                    showNotification('❌ ' + (data?.error || 'Error offline'), 'error');
                return;
            }

            // Reusar el renderizado del resultado existente en route-manager.js
            _mostrarResultadoOffline(data);
        };

        console.info('[SyncManager] calcularRuta() interceptada para modo offline');
    }

    /**
     * Dibuja la ruta en el mapa usando las variables globales de route-manager.js.
     * Reutiliza el mismo flujo de renderizado que el servidor.
     */
    function _mostrarResultadoOffline(data) {
        try {
            // Eliminar ruta anterior
            if (window.rutaLayer) { map.removeLayer(window.rutaLayer); window.rutaLayer = null; }
            if (window._rutaLayerBordeEmergencia) {
                map.removeLayer(window._rutaLayerBordeEmergencia);
                window._rutaLayerBordeEmergencia = null;
            }

            const esEmergencia = window._modoEmergencia === true;
            const esCamion     = window._vehiculoActual === 'camion';

            const color = esEmergencia ? '#e74c3c' : esCamion ? '#2980b9' : '#85c9f7';
            const weight = esEmergencia || esCamion ? 6 : 5;

            const coords = data.geojson.features[0].geometry.coordinates.map(c => [c[1], c[0]]);

            if (esEmergencia) {
                window._rutaLayerBordeEmergencia = L.polyline(coords, {
                    color: '#c0392b', weight: weight + 4, opacity: 0.6
                }).addTo(map);
            }

            window.rutaLayer = L.polyline(coords, {
                color, weight, opacity: 0.85
            }).addTo(map);

            map.fitBounds(window.rutaLayer.getBounds(), { padding: [30, 30] });

            // Mostrar resumen (reutiliza el panel existente si está disponible)
            const resPanel = document.getElementById('msw-resultados-ruta');
            if (resPanel) {
                resPanel.style.display = 'block';
                const dEl = document.getElementById('msw-ruta-distancia');
                const tEl = document.getElementById('msw-ruta-tiempo');
                const vEl = document.getElementById('msw-ruta-velocidad');
                if (dEl) dEl.textContent = data.distancia_km.toFixed(2) + ' km';
                if (tEl) tEl.textContent = _formatearTiempo(data.tiempo_minutos);
                if (vEl) vEl.textContent = data.velocidad_media.toFixed(0) + ' km/h';
            }

            if (typeof showNotification === 'function')
                showNotification(`📍 Ruta offline: ${data.distancia_km.toFixed(2)} km · ${_formatearTiempo(data.tiempo_minutos)} (calculada localmente)`, 'info');

            window._rutaCalculadaDuracionMinutos = data.tiempo_minutos;

        } catch (err) {
            console.error('[SyncManager] Error al mostrar resultado offline:', err);
        }
    }

    function _formatearTiempo(minutos) {
        if (minutos < 1) return Math.round(minutos * 60) + ' s';
        if (minutos < 60) return Math.round(minutos) + ' min';
        const h = Math.floor(minutos / 60);
        const m = Math.round(minutos % 60);
        return `${h} h ${m} min`;
    }

    // ── Intercepción de crearObstaculo ───────────────────────────────────────

    function _parcharCrearObstaculo() {
        const _origCrear = window.crearObstaculo;
        if (typeof _origCrear !== 'function') {
            setTimeout(_parcharCrearObstaculo, 200);
            return;
        }

        window.crearObstaculo = async function(latlng, obstruccion, obsId) {
            if (_online) {
                // Con conexión: comportamiento normal
                return _origCrear.call(this, latlng, obstruccion, obsId);
            }

            // Sin conexión: guardar en IndexedDB y dibujar localmente
            const obs = {
                lat:        latlng.lat,
                lng:        latlng.lng,
                obstruccion: obstruccion ?? 0.5,
                obsId:      obsId || null,
                nivel:      _nivelDeObstruccion(obstruccion),
            };

            const localId = await OfflineStore.encolarObstaculo(obs).catch(() => null);

            // Llamar al original para que dibuje el marcador en el mapa
            // (crearObstaculo solo dibuja localmente, no hace fetch si _online=false)
            _origCrear.call(this, latlng, obstruccion, obsId);

            if (typeof showNotification === 'function')
                showNotification('🚧 Obstáculo guardado offline — se sincronizará al recuperar conexión', 'warning');

            console.info('[SyncManager] Obstáculo encolado offline, localId:', localId);
        };

        console.info('[SyncManager] crearObstaculo() interceptada para modo offline');
    }

    function _nivelDeObstruccion(p) {
        if (p <= 0.25) return 1;
        if (p <= 0.50) return 2;
        if (p <= 0.75) return 3;
        return 4;
    }

    // ── Sincronización al recuperar conexión ─────────────────────────────────

    /**
     * Sube al servidor todos los obstáculos pendientes en IndexedDB.
     */
    async function sincronizarPendientes() {
        if (_sincronizando) return;
        _sincronizando = true;

        try {
            const pendientes = await OfflineStore.obtenerPendientes();
            if (pendientes.length === 0) {
                _sincronizando = false;
                return;
            }

            console.info(`[SyncManager] Sincronizando ${pendientes.length} obstáculo(s)...`);
            let ok = 0, err = 0;

            for (const obs of pendientes) {
                try {
                    const resp = await fetch('/api/obstaculos/sesion', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            obstaculos: [{
                                lat:        obs.lat,
                                lon:        obs.lng,
                                obstruccion: obs.obstruccion,
                                obsId:      obs.obsId,
                            }],
                            accion: 'añadir',
                        }),
                    });

                    if (resp.ok) {
                        const data = await resp.json();
                        await OfflineStore.marcarSincronizado(obs.localId, data.obsId || obs.obsId);
                        ok++;
                    } else {
                        err++;
                        console.warn('[SyncManager] Error al sincronizar obs:', obs.localId, resp.status);
                    }
                } catch (e) {
                    err++;
                    console.warn('[SyncManager] Fallo de red al sincronizar obs:', obs.localId);
                }
            }

            if (ok > 0 && typeof showNotification === 'function')
                showNotification(`✅ ${ok} obstáculo(s) sincronizado(s) con el servidor`, 'success');
            if (err > 0 && typeof showNotification === 'function')
                showNotification(`⚠️ ${err} obstáculo(s) no pudieron sincronizarse`, 'warning');

        } catch (e) {
            console.error('[SyncManager] Error en sincronización:', e);
        }

        _sincronizando = false;
    }

    // ── Cachear grafo cuando el servidor lo sirve ─────────────────────────────

    /**
     * Llamar cuando se recibe el GeoJSON de vías del servidor.
     * Actualiza la caché de IndexedDB para uso offline.
     */
    async function cachearGrafo(geojson) {
        if (window.DijkstraOffline) {
            await DijkstraOffline.actualizarCacheGrafo(geojson);
        }
    }

    /** Devuelve true si el servidor está accesible. */
    function estaOnline() { return _online; }

    // ── API pública ──────────────────────────────────────────────────────────
    return {
        inicializar,
        estaOnline,
        sincronizarPendientes,
        cachearGrafo,
    };
})();

window.SyncManager = SyncManager;

// Auto-inicializar en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    SyncManager.inicializar();
});