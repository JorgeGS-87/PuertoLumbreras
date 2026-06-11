/**
 * dijkstra-offline.js
 * Motor de routing en el navegador para modo sin conexión.
 *
 * Reimplementa la lógica de calcular_ruta() de app.py en JavaScript puro,
 * usando el GeoJSON de vías cacheado en IndexedDB por offline-store.js.
 *
 * Paridad con el servidor:
 *   ✅ Haversine para distancias
 *   ✅ Factores por tipo de vía (FACTORES_VIA)
 *   ✅ Factor por número de carriles
 *   ✅ Tiempo extra por ángulo de giro
 *   ✅ Penalización de obstáculos: factor = 1 / (1 - p * 0.99)
 *   ✅ Tipos de vía prohibidos (peatonal/ciclista)
 *   ✅ Modo emergencia: velocidad +20 km/h
 *   ✅ Modo emergencia: contramano (×3 penalización)
 *   ✅ Tipo de vehículo: restricción de ángulo de giro para camión
 *   ⚠️  Modo Momento (POIs temporales): omitido — requiere datos de POIs en caché
 *       (se añadirá en fase 2 si se cachean los POIs)
 */

const DijkstraOffline = (() => {

    // ── Constantes (igual que app.py) ───────────────────────────────────────
    const FACTORES_VIA = {
        motorway:       0.6,
        motorway_link:  0.7,
        trunk:          0.65,
        trunk_link:     0.75,
        primary:        0.8,
        primary_link:   0.9,
        secondary:      0.9,
        secondary_link: 1.0,
        tertiary:       1.0,
        tertiary_link:  1.1,
        residential:    1.1,
        living_street:  1.3,
        service:        1.2,
        unclassified:   1.2,
        road:           1.2,
    };

    const TIPOS_PROHIBIDOS = new Set([
        'footway', 'pedestrian', 'path', 'cycleway',
        'steps', 'track', 'bridleway',
    ]);

    const TIPOS_CONTRAMANO_EXCLUIDOS = new Set([
        'motorway', 'motorway_link', 'trunk', 'trunk_link',
    ]);

    const ANGULO_MAX_COCHE  = 140;
    const ANGULO_MAX_CAMION = 120;
    const MAX_ITER          = 15;

    // ── Estado interno ───────────────────────────────────────────────────────
    let _grafo    = null;   // Map<nodoKey, Map<nodoKey, edgeAttrs>>
    let _nodos    = null;   // Array<[lon, lat]>
    let _cargando = false;
    let _listo    = false;

    // ── Utilidades geométricas ───────────────────────────────────────────────

    /** Distancia en metros (Haversine). Igual que distanciaLatLon() de app.py. */
    function haversine(lat1, lon1, lat2, lon2) {
        const R  = 6371000;
        const φ1 = lat1 * Math.PI / 180,  φ2 = lat2 * Math.PI / 180;
        const dφ = (lat2 - lat1) * Math.PI / 180;
        const dλ = (lon2 - lon1) * Math.PI / 180;
        const a  = Math.sin(dφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** Ángulo de giro en grados en el nodo B dado el tramo A→B→C. */
    function anguloGiro(A, B, C) {
        // Vectores BA y BC
        const v1 = [B[0] - A[0], B[1] - A[1]];
        const v2 = [C[0] - B[0], C[1] - B[1]];
        const dot = v1[0]*v2[0] + v1[1]*v2[1];
        const m1  = Math.sqrt(v1[0]**2 + v1[1]**2);
        const m2  = Math.sqrt(v2[0]**2 + v2[1]**2);
        if (m1 === 0 || m2 === 0) return 0;
        const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
        return Math.acos(cos) * 180 / Math.PI;
    }

    /** Tiempo extra en minutos por ángulo de giro (igual que _tiempo_curva_minutos). */
    function tiempoCurva(angulo, maxspeed) {
        if (angulo < 15)  return 0;
        if (angulo < 45)  return 0.05;
        if (angulo < 90)  return 0.10 + (maxspeed > 50 ? 0.05 : 0);
        if (angulo < 120) return 0.20 + (maxspeed > 50 ? 0.10 : 0);
        return 0.35 + (maxspeed > 50 ? 0.15 : 0);
    }

    /** Parsea el atributo oneway de OSM. */
    function parsearOneway(val, junction) {
        if (junction === 'roundabout') return 'forward';
        if (!val || val === 'no' || val === 'false') return 'both';
        if (val === 'yes' || val === 'true' || val === '1') return 'forward';
        if (val === '-1' || val === 'reverse') return 'backward';
        return 'both';
    }

    // ── Clave de nodo ────────────────────────────────────────────────────────
    // Usamos un string redondeado a 7 decimales para evitar errores de float.
    function nKey(lon, lat) {
        return `${lon.toFixed(7)},${lat.toFixed(7)}`;
    }

    // ── Construcción del grafo ───────────────────────────────────────────────

    /**
     * Construye el grafo dirigido a partir del GeoJSON de vías.
     * Equivalente a crear_grafo() en app.py.
     */
    function _construirGrafo(geojson) {
        // grafo: Map<nKey, Map<nKey, {weight, distancia_km, tiempo_minutos, peso_base, maxspeed, lanes, highway, u, v}>>
        const grafo = new Map();
        const nodos = new Map();   // nKey → [lon, lat]

        function addEdge(s, e, attrs) {
            const ks = nKey(s[0], s[1]);
            const ke = nKey(e[0], e[1]);
            if (!grafo.has(ks)) grafo.set(ks, new Map());
            grafo.get(ks).set(ke, { ...attrs, u: s, v: e });
            nodos.set(ks, s);
            nodos.set(ke, e);
        }

        for (const feat of geojson.features) {
            const p = feat.properties || {};
            let maxspeed = parseInt(p.maxspeed) || 50;
            maxspeed     = Math.max(10, Math.min(120, maxspeed));
            let lanes    = parseInt(p.lanes) || 1;
            lanes        = Math.max(1, lanes);
            const highway  = p.highway || 'unclassified';
            const junction = p.junction || null;
            const oneway   = parsearOneway(p.oneway, junction);

            if (TIPOS_PROHIBIDOS.has(highway)) continue;
            if (highway === 'motorway' || highway === 'motorway_link') {
                // Las autopistas son siempre forward si no se especifica
            }

            const factor  = FACTORES_VIA[highway] || 1.2;
            const fLanes  = lanes >= 3 ? 0.8 : lanes === 2 ? 0.9 : 1.0;

            const geom = feat.geometry;
            if (!geom) continue;
            const lineas = geom.type === 'LineString'
                ? [geom.coordinates]
                : geom.coordinates;   // MultiLineString

            for (const coords of lineas) {
                for (let i = 0; i < coords.length - 1; i++) {
                    const s = coords[i];     // [lon, lat]
                    const e = coords[i + 1];
                    const dist_km = haversine(s[1], s[0], e[1], e[0]) / 1000;
                    const tiempo  = dist_km / maxspeed * 60;

                    let tCurva = 0;
                    if (i > 0) {
                        const prev  = coords[i - 1];
                        const ang   = anguloGiro(prev, s, e);
                        tCurva = tiempoCurva(ang, maxspeed);
                    }

                    const tiempoTotal = tiempo + tCurva;
                    const peso        = tiempoTotal * factor * fLanes;

                    const attrs = {
                        weight:          peso,
                        distancia_km:    dist_km,
                        tiempo_minutos:  tiempoTotal,
                        peso_base:       peso,
                        maxspeed,
                        lanes,
                        highway,
                    };

                    if (oneway === 'forward') {
                        addEdge(s, e, attrs);
                    } else if (oneway === 'backward') {
                        addEdge(e, s, attrs);
                    } else {
                        addEdge(s, e, attrs);
                        addEdge(e, s, { ...attrs });
                    }
                }
            }
        }

        return { grafo, nodos };
    }

    // ── Penalización de obstáculos ───────────────────────────────────────────

    /**
     * Aplica penalización de obstáculos al grafo copiado.
     * factor = 1 / (1 - obstruccion * 0.99)
     */
    function _penalizarObstaculos(grafo, obstaculos) {
        if (!obstaculos || obstaculos.length === 0) return;
        const RADIO_DEG = 5 / 111000;  // 5 m en grados

        for (const [ks, vecinos] of grafo) {
            for (const [ke, edge] of vecinos) {
                const midLon = (edge.u[0] + edge.v[0]) / 2;
                const midLat = (edge.u[1] + edge.v[1]) / 2;
                let factorMax = 1.0;
                for (const obs of obstaculos) {
                    const dist = haversine(midLat, midLon, obs.lat, obs.lon);
                    const radio = obs.radio || 5;
                    if (dist <= radio) {
                        const p = obs.obstruccion || 0.5;
                        const f = 1 / (1 - p * 0.99);
                        factorMax = Math.max(factorMax, f);
                    }
                }
                if (factorMax > 1.0) {
                    edge.weight         *= factorMax;
                    edge.tiempo_minutos *= factorMax;
                }
            }
        }
    }

    // ── Nodo más cercano ─────────────────────────────────────────────────────

    function _nodoCercano(nodos, lon, lat) {
        let mejorKey  = null;
        let mejorDist = Infinity;
        for (const [k, coords] of nodos) {
            const d = haversine(lat, lon, coords[1], coords[0]);
            if (d < mejorDist) { mejorDist = d; mejorKey = k; }
        }
        return mejorKey;
    }

    // ── Dijkstra con heap mínimo (binary heap) ───────────────────────────────

    /**
     * MinHeap simple para [prioridad, nKey].
     */
    class MinHeap {
        constructor() { this._data = []; }
        push(item) {
            this._data.push(item);
            this._bubbleUp(this._data.length - 1);
        }
        pop() {
            const top  = this._data[0];
            const last = this._data.pop();
            if (this._data.length > 0) {
                this._data[0] = last;
                this._siftDown(0);
            }
            return top;
        }
        get size() { return this._data.length; }
        _bubbleUp(i) {
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (this._data[parent][0] <= this._data[i][0]) break;
                [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
                i = parent;
            }
        }
        _siftDown(i) {
            const n = this._data.length;
            while (true) {
                let smallest = i;
                const l = 2*i+1, r = 2*i+2;
                if (l < n && this._data[l][0] < this._data[smallest][0]) smallest = l;
                if (r < n && this._data[r][0] < this._data[smallest][0]) smallest = r;
                if (smallest === i) break;
                [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
                i = smallest;
            }
        }
    }

    /**
     * Dijkstra estándar sobre el grafo.
     * Devuelve { path: [nKey, ...], dist: Map<nKey, float> } o null si no hay ruta.
     */
    function _dijkstra(grafo, origen, destino) {
        const dist  = new Map();
        const prev  = new Map();
        const heap  = new MinHeap();

        dist.set(origen, 0);
        heap.push([0, origen]);

        while (heap.size > 0) {
            const [d, u] = heap.pop();
            if (d > (dist.get(u) ?? Infinity)) continue;
            if (u === destino) break;

            const vecinos = grafo.get(u);
            if (!vecinos) continue;

            for (const [v, edge] of vecinos) {
                const nd = d + edge.weight;
                if (nd < (dist.get(v) ?? Infinity)) {
                    dist.set(v, nd);
                    prev.set(v, u);
                    heap.push([nd, v]);
                }
            }
        }

        if (!dist.has(destino)) return null;

        // Reconstruir camino
        const path = [];
        let cur    = destino;
        while (cur !== undefined) {
            path.unshift(cur);
            cur = prev.get(cur);
        }
        return { path, dist };
    }

    /**
     * Dijkstra con restricción de ángulo de giro (iterativo, igual que app.py).
     * Bloquea temporalmente las aristas con giro excesivo y reintenta.
     */
    function _dijkstraConGiros(grafo, nodos, origenKey, destinoKey, anguloMax) {
        const bloqueadas = new Set();

        for (let iter = 0; iter < MAX_ITER; iter++) {
            const resultado = _dijkstra(grafo, origenKey, destinoKey);
            if (!resultado) return null;

            const { path } = resultado;
            let girosProblema = false;

            for (let i = 1; i < path.length - 1; i++) {
                const a = nodos.get(path[i - 1]);
                const b = nodos.get(path[i]);
                const c = nodos.get(path[i + 1]);
                if (!a || !b || !c) continue;

                const ang = anguloGiro(a, b, c);
                if (ang > anguloMax) {
                    // Bloquear temporalmente esta arista con peso muy alto
                    const edge = grafo.get(path[i])?.get(path[i + 1]);
                    if (edge) {
                        const pesoOriginal = edge.weight;
                        edge.weight = pesoOriginal * 1000;
                        bloqueadas.add({ key: path[i] + '->' + path[i + 1], edge, pesoOriginal });
                        girosProblema = true;
                    }
                }
            }

            if (!girosProblema) {
                // Restaurar pesos y devolver
                for (const b of bloqueadas) b.edge.weight = b.pesoOriginal;
                return resultado;
            }
        }

        // Restaurar pesos aunque se hayan agotado iteraciones
        for (const b of bloqueadas) b.edge.weight = b.pesoOriginal;
        return _dijkstra(grafo, origenKey, destinoKey);
    }

    // ── Aplicar modo emergencia ──────────────────────────────────────────────

    function _aplicarEmergencia(grafo, nodos, opciones) {
        // Velocidad +20 km/h
        if (!opciones.emerg_velocidad) {
            for (const [, vecinos] of grafo) {
                for (const [, edge] of vecinos) {
                    const spd = edge.maxspeed || 50;
                    const f   = spd / (spd + 20);
                    edge.weight         *= f;
                    edge.tiempo_minutos *= f;
                }
            }
        }

        // Contramano: añadir aristas inversas con ×3 de penalización
        if (!opciones.emerg_sentido) {
            const nuevas = [];
            for (const [ks, vecinos] of grafo) {
                for (const [ke, edge] of vecinos) {
                    if (!grafo.get(ke)?.has(ks)) {
                        if (!TIPOS_CONTRAMANO_EXCLUIDOS.has(edge.highway)) {
                            nuevas.push([ke, ks, {
                                ...edge,
                                weight:         edge.weight * 3,
                                tiempo_minutos: edge.tiempo_minutos * 3,
                                contramano:     true,
                                u: edge.v,
                                v: edge.u,
                            }]);
                        }
                    }
                }
            }
            for (const [ke, ks, attrs] of nuevas) {
                if (!grafo.has(ke)) grafo.set(ke, new Map());
                grafo.get(ke).set(ks, attrs);
            }
        }
    }

    // ── Serializar resultado como GeoJSON ────────────────────────────────────

    function _rutaAGeoJSON(path, grafo, nodos) {
        const coords          = path.map(k => nodos.get(k));
        let distancia_km      = 0;
        let tiempo_minutos    = 0;
        const tiposVia        = new Map();

        for (let i = 0; i < path.length - 1; i++) {
            const edge = grafo.get(path[i])?.get(path[i + 1]);
            if (edge) {
                distancia_km   += edge.distancia_km    || 0;
                tiempo_minutos += edge.tiempo_minutos  || 0;
                const hw = edge.highway || 'unclassified';
                tiposVia.set(hw, (tiposVia.get(hw) || 0) + (edge.distancia_km || 0));
            }
        }

        // Tipo de vía dominante
        let tipoDominante = 'unclassified';
        let maxDist       = 0;
        for (const [hw, d] of tiposVia) {
            if (d > maxDist) { maxDist = d; tipoDominante = hw; }
        }

        const velocidad_media = tiempo_minutos > 0
            ? (distancia_km / (tiempo_minutos / 60))
            : 0;

        return {
            geojson: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: coords },
                    properties: {}
                }]
            },
            distancia_km:   Math.round(distancia_km   * 1000) / 1000,
            tiempo_minutos: Math.round(tiempo_minutos * 10)   / 10,
            velocidad_media: Math.round(velocidad_media * 10) / 10,
            tipo_via_dominante: tipoDominante,
            offline: true,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // API PÚBLICA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Inicializa el motor: carga el grafo desde IndexedDB.
     * Llamar una vez al arrancar la app.
     */
    async function inicializar() {
        if (_listo || _cargando) return;
        _cargando = true;
        try {
            const geojson = await OfflineStore.cargarGrafo();
            if (!geojson) {
                console.info('[DijkstraOffline] No hay grafo en caché — modo offline no disponible todavía.');
                _cargando = false;
                return;
            }
            console.info('[DijkstraOffline] Construyendo grafo desde caché…');
            const { grafo, nodos } = _construirGrafo(geojson);
            _grafo  = grafo;
            _nodos  = nodos;
            _listo  = true;
            console.info(`[DijkstraOffline] ✅ Grafo listo: ${_nodos.size} nodos`);
        } catch (err) {
            console.error('[DijkstraOffline] Error al inicializar:', err);
        }
        _cargando = false;
    }

    /**
     * Actualiza el grafo cacheado cuando hay conexión con el servidor.
     * Llamar cuando se carga la capa de vías.
     * @param {Object} geojson  FeatureCollection de vías
     */
    async function actualizarCacheGrafo(geojson) {
        try {
            await OfflineStore.guardarGrafo(geojson);
            await OfflineStore.guardarMetaGrafo({
                features: geojson.features?.length || 0,
            });
            // Reconstruir grafo en memoria si ya está inicializado
            const { grafo, nodos } = _construirGrafo(geojson);
            _grafo = grafo;
            _nodos = nodos;
            _listo = true;
            console.info(`[DijkstraOffline] ✅ Caché de grafo actualizada: ${_nodos.size} nodos`);
        } catch (err) {
            console.warn('[DijkstraOffline] No se pudo cachear el grafo:', err);
        }
    }

    /** Devuelve true si el motor está listo para calcular. */
    function estaListo() { return _listo; }

    /**
     * Calcula una ruta offline.
     * Recibe el mismo payload que /api/calcular-ruta.
     *
     * @param {Object} payload  { origen, destino, obstaculos, tipo_vehiculo, emergencia,
     *                            emerg_velocidad, emerg_giros, emerg_sentido }
     * @returns {Object|null}  Resultado compatible con la respuesta del servidor, o null si no hay ruta.
     */
    function calcularRuta(payload) {
        if (!_listo) {
            return { error: 'Motor offline no inicializado. Conecta al servidor al menos una vez para cachear el grafo.' };
        }

        const {
            origen,
            destino,
            obstaculos       = [],
            tipo_vehiculo    = 'coche',
            emergencia       = false,
            emerg_velocidad  = true,
            emerg_giros      = true,
            emerg_sentido    = true,
            coef_temporal    = 1.0,
        } = payload;

        try {
            // Clonar el grafo para no modificar el original
            const grafo = new Map();
            for (const [k, vecinos] of _grafo) {
                grafo.set(k, new Map());
                for (const [ke, edge] of vecinos) {
                    grafo.get(k).set(ke, { ...edge });
                }
            }

            // Penalizar obstáculos
            _penalizarObstaculos(grafo, obstaculos);

            // Coeficiente temporal (solo escala el tiempo mostrado, igual que servidor)
            if (coef_temporal !== 1.0) {
                const coef = Math.max(0.5, Math.min(3.0, coef_temporal));
                for (const [, vecinos] of grafo) {
                    for (const [, edge] of vecinos) {
                        edge.weight         *= coef;
                        edge.tiempo_minutos *= coef;
                    }
                }
            }

            // Modo emergencia
            if (emergencia) {
                _aplicarEmergencia(grafo, _nodos, { emerg_velocidad, emerg_sentido });
            }

            // Nodos más cercanos
            const origenKey  = _nodoCercano(_nodos, origen.lon,  origen.lat);
            const destinoKey = _nodoCercano(_nodos, destino.lon, destino.lat);

            if (!origenKey || !destinoKey) {
                return { error: 'No se encontraron nodos cercanos al origen o destino.' };
            }

            // Ángulo máximo de giro
            let anguloMax = 180;
            let aplicarGiros = false;
            if (tipo_vehiculo === 'camion') {
                anguloMax    = ANGULO_MAX_CAMION;
                aplicarGiros = true;
            } else if (!emergencia || emerg_giros) {
                anguloMax    = ANGULO_MAX_COCHE;
                aplicarGiros = true;
            }

            // Dijkstra
            const resultado = aplicarGiros
                ? _dijkstraConGiros(grafo, _nodos, origenKey, destinoKey, anguloMax)
                : _dijkstra(grafo, origenKey, destinoKey);

            if (!resultado) {
                return { error: 'No se encontró ruta entre los puntos seleccionados.' };
            }

            return _rutaAGeoJSON(resultado.path, grafo, _nodos);

        } catch (err) {
            console.error('[DijkstraOffline] Error al calcular ruta:', err);
            return { error: 'Error interno del motor offline: ' + err.message };
        }
    }

    return { inicializar, actualizarCacheGrafo, estaListo, calcularRuta };
})();

window.DijkstraOffline = DijkstraOffline;
