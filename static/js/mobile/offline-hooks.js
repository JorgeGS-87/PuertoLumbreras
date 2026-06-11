/**
 * offline-hooks.js
 * Ganchos que conectan los módulos offline con el código existente.
 *
 * Este fichero no modifica layer-manager.js ni route-manager.js:
 * los engancha desde fuera usando monkey-patching suave sobre fetch
 * y sobre las funciones globales de carga de capas.
 *
 * Incluir DESPUÉS de: offline-store.js, dijkstra-offline.js, sync-manager.js
 * Incluir ANTES de:   layer-manager.js, route-manager.js
 */

(function () {
    'use strict';

    // ── 1. Interceptar la respuesta de /api/vias para cachear el GeoJSON ─────
    //
    // Cuando layer-manager.js llama a fetch('/api/vias') y recibe el GeoJSON,
    // lo pasamos a SyncManager.cachearGrafo() en segundo plano.
    // No bloqueamos ni modificamos la respuesta original.

    const _fetchOriginal = window.fetch.bind(window);

    window.fetch = async function (input, init) {
        const url    = typeof input === 'string' ? input : input?.url || '';
        const resp   = await _fetchOriginal(input, init);

        // Solo interceptar GET de la capa de vías
        if (
            (url === '/api/vias' || url.startsWith('/api/vias?')) &&
            (!init || !init.method || init.method === 'GET') &&
            resp.ok
        ) {
            // Clonar antes de que layer-manager.js consuma el body
            const clone = resp.clone();
            clone.json().then(geojson => {
                if (geojson && geojson.type === 'FeatureCollection') {
                    SyncManager.cachearGrafo(geojson).catch(() => {});
                }
            }).catch(() => {});
        }

        return resp;
    };

    // ── 2. Badge: mostrar estado offline en el dot de la topbar ──────────────
    //
    // El elemento #network-dot ya existe en mobile.html con display:none.
    // SyncManager lo activa y colorea. Solo necesitamos asegurarnos
    // de que esté disponible cuando SyncManager arranque.
    // (No hay nada que hacer aquí: el DOM ya lo tiene.)

    // ── 3. Exponer OfflineStore.obtenerTodos para debug en consola ───────────
    window._debugOffline = {
        pendientes: () => OfflineStore.obtenerPendientes(),
        todos:      () => OfflineStore.obtenerTodos(),
        grafoMeta:  () => OfflineStore.cargarMetaGrafo(),
        dijkstraOk: () => DijkstraOffline.estaListo(),
        online:     () => SyncManager.estaOnline(),
        forzarSync: () => SyncManager.sincronizarPendientes(),
    };

    console.info('[offline-hooks] Ganchos offline instalados');
})();
