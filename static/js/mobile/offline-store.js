/**
 * offline-store.js
 * Gestión de persistencia local con IndexedDB.
 * Almacena:
 *   - El grafo de vías cacheado (para Dijkstra offline)
 *   - Obstáculos creados sin conexión (cola de sincronización)
 *   - Obstáculos confirmados (ya sincronizados con el servidor)
 */

const OfflineStore = (() => {
    const DB_NAME    = 'georuta-offline';
    const DB_VERSION = 1;
    let _db = null;

    // ── Apertura / creación de la BD ─────────────────────────────────────────
    function _open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = e => {
                const db = e.target.result;

                // Grafo cacheado (una sola entrada: key='grafo')
                if (!db.objectStoreNames.contains('cache')) {
                    db.createObjectStore('cache', { keyPath: 'key' });
                }

                // Cola de obstáculos pendientes de sincronizar
                if (!db.objectStoreNames.contains('cola_obstaculos')) {
                    const s = db.createObjectStore('cola_obstaculos', {
                        keyPath: 'localId', autoIncrement: true
                    });
                    s.createIndex('sincronizado', 'sincronizado', { unique: false });
                }
            };

            req.onsuccess = e => { _db = e.target.result; resolve(_db); };
            req.onerror   = e => reject(e.target.error);
        });
    }

    // ── Helper genérico de transacción ───────────────────────────────────────
    function _tx(storeName, modo, fn) {
        return _open().then(db => new Promise((resolve, reject) => {
            const tx    = db.transaction(storeName, modo);
            const store = tx.objectStore(storeName);
            const req   = fn(store);
            if (req && req.onsuccess !== undefined) {
                req.onsuccess = e => resolve(e.target.result);
                req.onerror   = e => reject(e.target.error);
            } else {
                tx.oncomplete = () => resolve(req);
                tx.onerror    = e  => reject(e.target.error);
            }
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CACHÉ DEL GRAFO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Guarda el GeoJSON de vías en IndexedDB para uso offline.
     * @param {Object} geojson  FeatureCollection de vías
     */
    function guardarGrafo(geojson) {
        return _tx('cache', 'readwrite', store =>
            store.put({ key: 'grafo', data: geojson, ts: Date.now() })
        );
    }

    /**
     * Recupera el GeoJSON de vías guardado. Devuelve null si no existe.
     */
    function cargarGrafo() {
        return _tx('cache', 'readonly', store => store.get('grafo'))
            .then(entry => entry ? entry.data : null);
    }

    /**
     * Guarda metadatos del grafo (timestamp, número de features).
     */
    function guardarMetaGrafo(meta) {
        return _tx('cache', 'readwrite', store =>
            store.put({ key: 'grafo-meta', ...meta, ts: Date.now() })
        );
    }

    function cargarMetaGrafo() {
        return _tx('cache', 'readonly', store => store.get('grafo-meta'))
            .then(entry => entry || null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COLA DE OBSTÁCULOS (offline → sincronización pendiente)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Añade un obstáculo a la cola pendiente de sincronizar.
     * @param {Object} obs  { lat, lng, obstruccion, obsId, nivel }
     * @returns {Promise<number>} localId asignado
     */
    function encolarObstaculo(obs) {
        return _tx('cola_obstaculos', 'readwrite', store =>
            store.add({
                ...obs,
                sincronizado: false,
                creadoEn:     Date.now(),
            })
        );
    }

    /**
     * Devuelve todos los obstáculos pendientes (sincronizado=false).
     */
    function obtenerPendientes() {
        return _open().then(db => new Promise((resolve, reject) => {
            const tx      = db.transaction('cola_obstaculos', 'readonly');
            const req     = tx.objectStore('cola_obstaculos').getAll();
            req.onsuccess = e => resolve((e.target.result || []).filter(r => !r.sincronizado));
            req.onerror   = e => reject(e.target.error);
        }));
    }

    /**
     * Devuelve TODOS los obstáculos (pendientes y sincronizados).
     */
    function obtenerTodos() {
        return _open().then(db => new Promise((resolve, reject) => {
            const tx      = db.transaction('cola_obstaculos', 'readonly');
            const req     = tx.objectStore('cola_obstaculos').getAll();
            req.onsuccess = e => resolve(e.target.result);
            req.onerror   = e => reject(e.target.error);
        }));
    }

    /**
     * Marca un obstáculo como sincronizado (ya subido al servidor).
     * @param {number} localId
     * @param {string|number} obsIdServidor  ID asignado por el servidor
     */
    function marcarSincronizado(localId, obsIdServidor) {
        return _open().then(db => new Promise((resolve, reject) => {
            const tx    = db.transaction('cola_obstaculos', 'readwrite');
            const store = tx.objectStore('cola_obstaculos');
            const req   = store.get(localId);
            req.onsuccess = e => {
                const entry = e.target.result;
                if (!entry) { resolve(); return; }
                entry.sincronizado    = true;
                entry.sincronizadoEn  = Date.now();
                entry.obsIdServidor   = obsIdServidor;
                store.put(entry);
                resolve();
            };
            req.onerror = e => reject(e.target.error);
            tx.onerror  = e => reject(e.target.error);
        }));
    }

    /**
     * Elimina un obstáculo de la cola local (cuando el servidor lo borra).
     * @param {number} localId
     */
    function eliminarLocal(localId) {
        return _tx('cola_obstaculos', 'readwrite', store => store.delete(localId));
    }

    /**
     * Vacía la cola de obstáculos completamente.
     */
    function limpiarCola() {
        return _tx('cola_obstaculos', 'readwrite', store => store.clear());
    }

    // ── API pública ──────────────────────────────────────────────────────────
    return {
        // Grafo
        guardarGrafo,
        cargarGrafo,
        guardarMetaGrafo,
        cargarMetaGrafo,
        // Cola de obstáculos
        encolarObstaculo,
        obtenerPendientes,
        obtenerTodos,
        marcarSincronizado,
        eliminarLocal,
        limpiarCola,
    };
})();

window.OfflineStore = OfflineStore;