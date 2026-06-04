/**
 * time.js
 * Simulación temporal: aplica congestión visual a vías y puntos de interés
 * según el día de la semana y la hora (100% client-side)
 */

// ==================== ESTADO ====================

let estadoTemporal = {
    dia:    1,    // 1=Lunes … 7=Domingo
    hora:   12,
    activo: false
};

// Capas Leaflet para los elementos temporales
let capaPuntosTemporales = null;
let capaViasTemporales   = null;

// Datos globales para que la ruta pueda penalizar vías temporales
window._momentViasFactores = [];
window.obtenerFactorMomentoParaSegmento = function (s, e) {
    if (!estadoTemporal.activo || !Array.isArray(window._momentViasFactores)) return 1.0;
    if (!s || !e || s.length !== 2 || e.length !== 2) return 1.0;

    const midLat = (s[1] + e[1]) / 2;
    const midLon = (s[0] + e[0]) / 2;
    // Radio de 30m en grados aprox (1° lat ≈ 111km → 30m ≈ 0.00027°)
    const RADIO_DEG2 = 0.00027 * 0.00027 * 2; // tolerancia cuadrática combinada lat+lon
    let factorMax = 1.0;

    for (const via of window._momentViasFactores) {
        const factor = via.factor || 1.0;
        if (factor <= 1.0) continue;

        const coords = via.coords;
        if (!coords || !coords.length) continue;

        outer:
        for (const line of coords) {
            for (let i = 0; i < line.length - 1; i++) {
                const cLat = (line[i][1] + line[i+1][1]) / 2;
                const cLon = (line[i][0] + line[i+1][0]) / 2;
                const dLat = midLat - cLat;
                const dLon = midLon - cLon;
                // distancia² en grados (suficientemente preciso para 30m)
                if (dLat * dLat + dLon * dLon <= RADIO_DEG2) {
                    factorMax = Math.max(factorMax, factor);
                    break outer;
                }
            }
        }
    }

    return factorMax;
};

// ==================== PERÍODOS CRÍTICOS ====================

// Tipos de vía que pueden congestionarse por POIs urbanos
// (excluye: track, path, footway, cycleway, pedestrian, steps, service, living_street, etc.)
const VIAS_URBANAS = new Set([
    'residential', 'unclassified', 'tertiary', 'tertiary_link',
    'secondary', 'secondary_link', 'road',
]);
const VIAS_PRINCIPALES = new Set([
    'primary', 'primary_link', 'trunk', 'trunk_link',
    'motorway', 'motorway_link',
]);

// Devuelve si una vía puede congestionarse según el contexto del POI
// 'urbano'    → solo vías urbanas (colegios, ocio, iglesias)
// 'acceso'    → urbanas + principales (oficinas, polígonos industriales)
function _viaEsCongestionable(highway, modo) {
    if (!highway) return false;
    const hw = String(highway).toLowerCase();
    if (VIAS_URBANAS.has(hw)) return true;
    if (modo === 'acceso' && VIAS_PRINCIPALES.has(hw)) return true;
    return false;
}

const PERIODOS_CRITICOS = {
    colegios: {
        dias: [1, 2, 3, 4, 5],
        horarios: [
            { inicio: 8,    fin: 9,    intensidad: 'alta'  },  // Entrada mañana
            { inicio: 13.5, fin: 14.5, intensidad: 'media' },  // Salida mediodía
            { inicio: 17,   fin: 17.5, intensidad: 'alta'  },  // Salida tarde
        ],
        tipos:     ['colegio', 'school', 'college', 'kindergarten', 'university', 'educación'],
        color:     '#FF6B35',
        radioVias: 80,   // solo calles muy cercanas al colegio
        modoVias:  'urbano',
    },
    iglesias: {
        dias: [7],
        horarios: [
            { inicio: 10, fin: 13, intensidad: 'media' },
        ],
        tipos:     ['iglesia', 'church', 'chapel', 'cathedral', 'parroquia'],
        color:     '#9B59B6',
        radioVias: 100,
        modoVias:  'urbano',
    },
    oficinas: {
        dias: [1, 2, 3, 4, 5],
        horarios: [
            { inicio: 7.5, fin: 9,    intensidad: 'alta'  },
            { inicio: 14,  fin: 15,   intensidad: 'media' },
            { inicio: 18,  fin: 19.5, intensidad: 'alta'  },
        ],
        tipos:     ['office', 'oficina', 'commercial', 'industrial', 'ayuntamiento'],
        color:     '#3498DB',
        radioVias: 150,  // oficinas pueden afectar vías de acceso
        modoVias:  'acceso',
    },
    ocio: {
        dias: [5, 6, 7],
        horarios: [
            { inicio: 20, fin: 24, intensidad: 'alta'  },
            { inicio: 12, fin: 15, intensidad: 'media' },
        ],
        tipos:     ['restaurant', 'bar', 'pub', 'cafe', 'cinema', 'theatre', 'restaurante', 'cafetería'],
        color:     '#E74C3C',
        radioVias: 60,   // radio pequeño, solo la calle inmediata
        modoVias:  'urbano',
    },
};

// ==================== INICIALIZACIÓN ====================

function inicializarSistemaTemporal() {
    capaPuntosTemporales = L.layerGroup().addTo(map);
    capaViasTemporales   = L.layerGroup().addTo(map);

    const ahora = new Date();
    estadoTemporal.dia  = ahora.getDay() || 7;
    estadoTemporal.hora = ahora.getHours() + ahora.getMinutes() / 60;
}

// ==================== SIMULACIÓN ====================

function aplicarSimulacionTemporal() {
    if (!estadoTemporal.activo) return;

    // Verificar que las capas temporales están inicializadas
    if (!capaPuntosTemporales || !capaViasTemporales) {
        console.warn('⚠️ Capas temporales no inicializadas, inicializando ahora...');
        inicializarSistemaTemporal();
    }

    limpiarCapasTemporales();

    _progresoSim(5, 'Buscando POIs activos...');

    setTimeout(() => {
        // ── Paso 1: construir mapa de factor máximo por vía ──────────────────
        const factorPorVia   = new Map();
        const puntosResaltar = [];
        const _factorInterno = (intensidad) =>
            intensidad === 'alta' ? 1.6 : intensidad === 'media' ? 1.3 : 1.1;

        for (const [tipo, config] of Object.entries(PERIODOS_CRITICOS)) {
            if (!config.dias.includes(estadoTemporal.dia)) continue;
            const horarioActivo = config.horarios.find(h =>
                estadoTemporal.hora >= h.inicio && estadoTemporal.hora <= h.fin
            );
            if (!horarioActivo) continue;

            const puntos = encontrarPuntosDeInteresPorTipo(config.tipos);
            puntos.forEach(punto => {
                puntosResaltar.push({ punto, config, horario: horarioActivo });
                const viasProximas = encontrarViasProximas(punto.latlng, config.radioVias);
                viasProximas.forEach(via => {
                    const factor = _factorInterno(horarioActivo.intensidad);
                    const prev   = factorPorVia.get(via.layer);
                    if (!prev || factor > prev.factor) {
                        factorPorVia.set(via.layer, {
                            factor,
                            fuentes: [{ tipo, nombre: punto.nombre, intensidad: horarioActivo.intensidad }],
                        });
                    } else if (factor === prev.factor) {
                        prev.fuentes.push({ tipo, nombre: punto.nombre, intensidad: horarioActivo.intensidad });
                    }
                });
            });
        }

        _progresoSim(40, 'Propagando congestión a vías vecinas...');

        // ── Paso 1b: propagar congestión a vías próximas (degradado) ────────────
        // Para cada vía ya afectada, buscamos vías cercanas que NO estén
        // en factorPorVia y les asignamos un factor atenuado por distancia.
        // Radio de propagación = radioVias * 1.5 del POI más influyente.
        // Factor propagado = factor_origen * (1 - dist/radio_propagacion) * 0.6
        // → el vecino más cercano puede llegar a ×(factor*0.6), el más lejano a ×1.0
        const RADIO_PROPAGACION_MULTIPLIER = 1.8;  // radio extra respecto al del POI
        const ATENUACION_VECINO            = 0.55; // qué fracción del factor llega al vecino

        if (viasLayer) {
            // ── Optimización: aritmética pura en grados, sin crear objetos L.LatLng ──
            // 1° lat ≈ 111 km → 1 m ≈ 9e-6°. Usamos distancia cuadrática en grados.

            // Radio máximo de propagación en GRADOS²
            let radioMaxPOI = 60;
            for (const [, config] of Object.entries(PERIODOS_CRITICOS)) {
                if (config.dias.includes(estadoTemporal.dia)) {
                    radioMaxPOI = Math.max(radioMaxPOI, config.radioVias || 60);
                }
            }
            const radioPropagacionM  = radioMaxPOI * RADIO_PROPAGACION_MULTIPLIER;
            const radioDeg           = radioPropagacionM / 111000; // metros → grados aprox
            const radioDeg2          = radioDeg * radioDeg;        // cuadrado para evitar sqrt

            // Colectar centroides de vías afectadas como {lat, lon, factor}
            const viasAfectadasGeo = [];
            factorPorVia.forEach((info, layer) => {
                const coords = layer.feature?.geometry?.coordinates;
                if (!coords || !coords.length) return;
                // Punto medio de la primera línea
                const linea = Array.isArray(coords[0][0]) ? coords[0] : coords;
                const mid   = linea[Math.floor(linea.length / 2)];
                if (!mid) return;
                viasAfectadasGeo.push({ lat: mid[1], lon: mid[0], factor: info.factor });
            });

            viasLayer.eachLayer(layer => {
                if (factorPorVia.has(layer)) return;

                const hw = layer.feature?.properties?.highway;
                if (!_viaEsCongestionable(hw, 'urbano') && !_viaEsCongestionable(hw, 'acceso')) return;

                const coords = layer.feature?.geometry?.coordinates;
                if (!coords || !coords.length) return;
                const linea   = Array.isArray(coords[0][0]) ? coords[0] : coords;
                const mid     = linea[Math.floor(linea.length / 2)];
                if (!mid) return;
                const cLat = mid[1], cLon = mid[0];

                let mejorFactor = 1.0;
                for (const af of viasAfectadasGeo) {
                    const dLat = cLat - af.lat;
                    const dLon = cLon - af.lon;
                    const dist2 = dLat * dLat + dLon * dLon;
                    if (dist2 > radioDeg2) continue;
                    const t = 1 - Math.sqrt(dist2) / radioDeg;
                    const factorVecino = 1.0 + (af.factor - 1.0) * t * ATENUACION_VECINO;
                    if (factorVecino > mejorFactor) mejorFactor = factorVecino;
                }
                if (mejorFactor > 1.02) {
                    factorPorVia.set(layer, { factor: mejorFactor, fuentes: [], _propagada: true });
                }
            });
        }

        _progresoSim(55, 'Coloreando vías...');

        // ── Paso 2: recolorear viasLayer con setStyle ─────────────────────
        // Estrategia:
        //   a) Añadir el factor como propiedad temporal al feature para poder
        //      usar viasLayer.setStyle(fn) en un único barrido (más rápido que
        //      eachLayer + setStyle individual para las no-afectadas).
        //   b) bindTooltip solo en vías directamente afectadas (no propagadas),
        //      que son pocas. Las propagadas y las libres no necesitan tooltip.
        if (viasLayer) {
            window._momentViasFactores = [];

            // a) Marcar factores en los features para setStyle batch
            viasLayer.eachLayer(layer => {
                const info    = factorPorVia.get(layer);
                if (!info) {
                    if (layer.feature) layer.feature._simFactor = null;
                    return;
                }
                if (layer.feature) {
                    layer.feature._simFactor    = info.factor;
                    layer.feature._simPropagada = info._propagada || false;
                }
                const geom = layer.feature?.geometry;
                if (geom?.type === 'LineString') {
                    window._momentViasFactores.push({ coords: [geom.coordinates], factor: info.factor });
                } else if (geom?.type === 'MultiLineString') {
                    window._momentViasFactores.push({ coords: geom.coordinates, factor: info.factor });
                }
            });

            // b) Un único setStyle batch para todas las vías (no afectadas incluidas)
            viasLayer.setStyle(feature => {
                const factor    = feature?._simFactor ?? 1.0;
                const afectada  = factor > 1.0;
                const propagada = feature?._simPropagada || false;
                const color     = _colorPorFactor(factor);
                return {
                    color,
                    weight:  afectada ? Math.max(propagada ? 1 : 2, Math.round((factor - 1) * (propagada ? 4 : 7))) : 2,
                    opacity: afectada ? (propagada ? 0.55 : 0.85) : 0.25,
                };
            });

            // c) Tooltips solo en vías directamente afectadas (nunca en propagadas ni libres)
            viasLayer.eachLayer(layer => {
                const info = factorPorVia.get(layer);
                if (!info || info._propagada) {
                    // Quitar tooltip anterior si lo había (sin llamar unbindTooltip en cada vía libre)
                    if (layer._tooltip) layer.unbindTooltip();
                    return;
                }
                const factor   = info.factor;
                const color    = _colorPorFactor(factor);
                const etiqueta = _etiquetaFactor(factor);
                const fuentes  = info.fuentes.map(f => `${f.nombre} (${f.tipo})`).join(', ');
                layer.bindTooltip(
                    `<strong style="color:${color}">● ${etiqueta}</strong><br>` +
                    `Factor: ×${factor.toFixed(2)}<br>` +
                    `<span style="color:#555;font-size:11px;">${fuentes}</span>`
                );
            });

            // Limpiar marcadores temporales de feature
            viasLayer.eachLayer(layer => {
                if (layer.feature) {
                    delete layer.feature._simFactor;
                    delete layer.feature._simPropagada;
                }
            });
        }

        _progresoSim(90, 'Marcando puntos de interés...');

        setTimeout(() => {
            const puntosAfectados  = puntosResaltar.length;
            const viasDirectas     = [...factorPorVia.values()].filter(i => !i._propagada).length;
            const viasPropagadas   = [...factorPorVia.values()].filter(i =>  i._propagada).length;
            const viasAfectadas    = factorPorVia.size;

            actualizarEstadisticasTiempo(puntosAfectados, viasAfectadas);
            _actualizarLeyendaTrafico();
            _progresoSim(100, 'Listo');
            setTimeout(() => _ocultarProgresoSim(), 800);

            const { dia, hora } = estadoTemporal;
            const hh = Math.floor(hora);
            const mm = Math.round((hora % 1) * 60).toString().padStart(2, '0');
            showNotification(
                `Simulación activa: ${obtenerNombreDiaCompleto(dia)} ${hh}:${mm}h — ${puntosAfectados} POIs, ${viasDirectas} vías congestionadas + ${viasPropagadas} adyacentes`,
                'success'
            );
        }, 0);

    }, 50);
}

// ── Barra de progreso de simulación ──────────────────────────────────────────
function _progresoSim(pct, texto) {
    let bar = document.getElementById('sim-progress-bar');
    if (!bar) {
        // Crear barra si no existe, dentro del panel de momento
        const container = document.querySelector('.momento-section') || document.body;
        const wrap = document.createElement('div');
        wrap.id = 'sim-progress-wrap';
        wrap.style.cssText = 'margin:8px 0;display:none;';
        wrap.innerHTML = `
            <div style="font-size:11px;color:#7f8c8d;margin-bottom:4px;" id="sim-progress-label">Calculando...</div>
            <div style="background:#ecf0f1;border-radius:6px;height:8px;overflow:hidden;">
                <div id="sim-progress-bar" style="height:100%;background:#3498db;width:0%;
                     transition:width 0.3s ease;border-radius:6px;"></div>
            </div>
        `;
        // Insertar antes de los botones Activar/Desactivar
        const botonera = container.querySelector('.botonera');
        if (botonera) botonera.parentNode.insertBefore(wrap, botonera);
        else container.appendChild(wrap);
        bar = document.getElementById('sim-progress-bar');
    }

    const wrap  = document.getElementById('sim-progress-wrap');
    const label = document.getElementById('sim-progress-label');
    if (wrap)  wrap.style.display  = 'block';
    if (bar)   bar.style.width     = pct + '%';
    if (label) label.textContent   = texto || '';

    // Color según progreso
    if (bar) {
        bar.style.background = pct < 50 ? '#3498db' : pct < 90 ? '#f39c12' : '#27ae60';
    }
}

function _ocultarProgresoSim() {
    const wrap = document.getElementById('sim-progress-wrap');
    if (wrap) wrap.style.display = 'none';
}

// ── Escala de color por factor ────────────────────────────────────────────────
// 1.0 = verde fluido, 1.3 = amarillo moderado, 1.6+ = rojo congestionado
function _colorPorFactor(factor) {
    if (factor <= 1.05) return '#27ae60';       // Verde: fluido
    if (factor <= 1.15) return '#2ecc71';       // Verde claro
    if (factor <= 1.25) return '#f1c40f';       // Amarillo: moderado
    if (factor <= 1.35) return '#f39c12';       // Naranja suave
    if (factor <= 1.45) return '#e67e22';       // Naranja
    if (factor <= 1.55) return '#e74c3c';       // Rojo: congestionado
    return '#c0392b';                           // Rojo oscuro: muy congestionado
}

function _etiquetaFactor(factor) {
    if (factor <= 1.05) return 'Fluido';
    if (factor <= 1.2)  return 'Leve';
    if (factor <= 1.35) return 'Moderado';
    if (factor <= 1.5)  return 'Denso';
    return 'Muy congestionado';
}

function _actualizarLeyendaTrafico() {
    // Mostrar leyenda de tráfico en el panel de simulación
    let leyenda = document.getElementById('leyenda-trafico-sim');
    if (!leyenda) {
        const stats = document.getElementById('stats-tiempo');
        if (!stats) return;
        leyenda = document.createElement('div');
        leyenda.id = 'leyenda-trafico-sim';
        leyenda.style.cssText = 'margin-top:10px;padding:10px;background:#fff;border-radius:6px;border:1px solid #e0e0e0;font-size:11px;';
        stats.parentNode.insertBefore(leyenda, stats.nextSibling);
    }
    leyenda.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;color:#2c3e50;">🎨 Leyenda de tráfico</div>
        ${[
            ['#27ae60', 'Fluido (×1.0)'],
            ['#f1c40f', 'Moderado (×1.25)'],
            ['#e67e22', 'Denso (×1.45)'],
            ['#e74c3c', 'Congestionado (×1.55+)'],
        ].map(([c, l]) => `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                <div style="width:28px;height:5px;background:${c};border-radius:3px;"></div>
                <span style="color:#555;">${l}</span>
            </div>
        `).join('')}
        <div style="margin-top:6px;color:#95a5a6;font-size:10px;">
            Grosor de línea proporcional al factor de congestión
        </div>
    `;
    leyenda.style.display = 'block';
}

function desactivarSimulacionTemporal() {
    estadoTemporal.activo = false;
    limpiarCapasTemporales();

    // Restaurar el estilo original de todas las vías en un único setStyle batch
    if (viasLayer) {
        viasLayer.setStyle(obtenerEstiloVia);
        // Quitar tooltips de tráfico SOLO en las capas que realmente tienen uno
        // (evita 5000+ llamadas a unbindTooltip en vías sin tooltip)
        viasLayer.eachLayer(l => { if (l._tooltip) l.unbindTooltip(); });
    }

    window._momentViasFactores = [];

    actualizarEstadisticasTiempo(0, 0);
    const leyenda = document.getElementById('leyenda-trafico-sim');
    if (leyenda) leyenda.style.display = 'none';
    _ocultarProgresoSim();
    showNotification('Simulación temporal desactivada', 'info');
}

// ==================== BÚSQUEDA EN CAPAS ====================

function encontrarPuntosDeInteresPorTipo(tipos) {
    const encontrados = [];
    if (!window.puntosLayer) return encontrados;

    window.puntosLayer.eachLayer(layer => {
        if (!layer.feature?.properties) return;
        const props = layer.feature.properties;

        const tipoPunto = (
            props.tipo       ||
            props.amenity    ||
            props.building   ||
            props.denCorta   ||
            props.tipo_centr ||
            ''
        ).toLowerCase();

        const coincide = tipos.some(t => {
            const tb = t.toLowerCase();
            return tipoPunto.includes(tb)
                || (tipoPunto.includes('colegio')  && tb === 'school')
                || (tipoPunto.includes('iglesia')  && tb === 'church')
                || (tipoPunto.includes('oficina')  && tb === 'office');
        });

        if (coincide) {
            encontrados.push({
                layer:      layer,
                latlng:     layer.getLatLng(),
                tipo:       tipoPunto,
                nombre:     props.denLarga || props.name || props.nombre || props.denominacion || 'Sin nombre',
                properties: props,
            });
        }
    });

    return encontrados;
}

function encontrarViasProximas(centro, radioMetros, modoVias) {
    const proximas = [];
    if (!viasLayer) return proximas;

    // Convertir radio a grados una sola vez (sin crear L.LatLng en el bucle interno)
    // 1 grado lat ≈ 111 km → radio_deg = radioMetros / 111000
    const cLat  = centro.lat;
    const cLon  = centro.lng;
    const rDeg  = radioMetros / 111000;
    const rDeg2 = rDeg * rDeg; // comparar dist² evita sqrt en el caso más frecuente

    viasLayer.eachLayer(layer => {
        const props   = layer.feature?.properties || {};
        const highway = props.highway || props.HIGHWAY || props.type || '';

        if (!_viaEsCongestionable(highway, modoVias || 'urbano')) return;

        const coords = layer.feature?.geometry?.coordinates;
        if (!coords?.length) return;

        // 5 muestras por segmento en vez de 11: suficiente para segmentos cortos urbanos
        for (let i = 0; i < coords.length - 1; i++) {
            const ax = coords[i][0],   ay = coords[i][1];
            const bx = coords[i+1][0], by = coords[i+1][1];
            for (let j = 0; j <= 4; j++) {
                const t    = j / 4;
                const dLat = (ay + t * (by - ay)) - cLat;
                const dLon = (ax + t * (bx - ax)) - cLon;
                if (dLat * dLat + dLon * dLon <= rDeg2) {
                    proximas.push({ layer, properties: props });
                    return; // salir del eachLayer para esta capa
                }
            }
        }
    });

    return proximas;
}

// ==================== RESALTADO VISUAL ====================

function resaltarPuntoInteres(punto, color, intensidad) {
    const opacidad = intensidad === 'alta' ? 0.9 : 0.6;
    const radius   = intensidad === 'alta' ? 15  : 12;

    const marker = L.circleMarker(punto.latlng, {
        radius,
        fillColor:   color,
        color:       '#fff',
        weight:      3,
        opacity:     1,
        fillOpacity: opacidad,
        className:   'pulsing-marker',
    });

    marker.bindTooltip(`
        <strong>${punto.nombre}</strong><br>
        Tipo: ${punto.tipo}<br>
        Ocupación: ${intensidad === 'alta' ? 'Alta' : 'Media'}<br>
        ${obtenerNombreDia(estadoTemporal.dia)} ${_horaStr(estadoTemporal.hora)}
    `);

    capaPuntosTemporales.addLayer(marker);
}

function resaltarVia(via, color, intensidad) {
    const coords = via.layer.feature?.geometry?.coordinates;
    if (!coords) return;

    const line = L.polyline(
        coords.map(c => [c[1], c[0]]),
        {
            color,
            weight:    intensidad === 'alta' ? 5 : 3,
            opacity:   intensidad === 'alta' ? 0.8 : 0.5,
            dashArray: '10, 5',
            className: 'via-congestionada',
        }
    );

    line.bindTooltip(`<strong>Vía congestionada</strong><br>Intensidad: ${intensidad === 'alta' ? 'Alta' : 'Media'}`);
    capaViasTemporales.addLayer(line);
}

function limpiarCapasTemporales() {
    capaPuntosTemporales?.clearLayers();
    capaViasTemporales?.clearLayers();
}

// ==================== CONTROLES UI ====================

function establecerHoraActual() {
    const ahora = new Date();
    estadoTemporal.dia  = ahora.getDay() || 7;
    estadoTemporal.hora = ahora.getHours() + ahora.getMinutes() / 60;

    const sliderHora = document.getElementById('slider-hora');
    const selectDia  = document.getElementById('select-dia');
    if (sliderHora) sliderHora.value = estadoTemporal.hora;
    if (selectDia)  selectDia.value  = estadoTemporal.dia;

    actualizarDisplayHora();
    if (estadoTemporal.activo) aplicarSimulacionTemporal();

    showNotification(
        `Hora establecida: ${obtenerNombreDiaCompleto(estadoTemporal.dia)} ${_horaStr(estadoTemporal.hora)}`,
        'info'
    );
}

function actualizarDisplayHora() {
    const display = document.getElementById('display-hora');
    if (display) {
        display.textContent = _horaStr(estadoTemporal.hora);
        display.style.transform = 'scale(1.1)';
        setTimeout(() => { display.style.transform = 'scale(1)'; }, 150);
    }
    actualizarContextoMomento();
}

function actualizarContextoMomento() {
    const contextoDiv = document.getElementById('contexto-momento');
    const textoDiv    = document.getElementById('texto-contexto');
    if (!contextoDiv || !textoDiv) return;

    const { dia, hora } = estadoTemporal;

    const periodos = [
        { min: 0,  max: 6,  nombre: 'Madrugada', clase: 'madrugada' },
        { min: 6,  max: 12, nombre: 'Mañana',    clase: 'manana'    },
        { min: 12, max: 20, nombre: 'Tarde',      clase: 'tarde'     },
        { min: 20, max: 25, nombre: 'Noche',      clase: 'noche'     },
    ];
    const periodo = periodos.find(p => hora >= p.min && hora < p.max) || periodos[3];

    contextoDiv.classList.remove('madrugada', 'manana', 'tarde', 'noche');
    contextoDiv.classList.add(periodo.clase);

    const iconos = { colegios: '🏫', iglesias: '⛪', oficinas: '🏢', ocio: '🍽️' };
    const descripciones = {
        colegios: 'Colegios con alta ocupación',
        iglesias: 'Misas dominicales en curso',
        oficinas: 'Actividad en oficinas',
        ocio:     'Zonas de ocio activas',
    };

    const activas = [];
    for (const [tipo, config] of Object.entries(PERIODOS_CRITICOS)) {
        if (!config.dias.includes(dia)) continue;
        const activo = config.horarios.find(h => hora >= h.inicio && hora <= h.fin);
        if (activo) activas.push(`${iconos[tipo]} ${descripciones[tipo]}`);
    }

    textoDiv.innerHTML =
        `<strong>${obtenerNombreDiaCompleto(dia)} ${periodo.nombre}</strong><br>` +
        (activas.length ? activas.join('<br>') : '⚪ Baja actividad urbana');
}

function actualizarEstadisticasTiempo(puntos, vias) {
    const container = document.getElementById('stats-tiempo');
    if (!container) return;

    if (puntos === 0 && vias === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `
        <strong>⏱️ Simulación temporal activa:</strong><br>
        <span style="color:#e74c3c;">Puntos de interés ocupados: ${puntos}</span><br>
        <span style="color:#e67e22;">Vías congestionadas: ${vias}</span>
    `;
}

// ==================== HELPERS ====================

function obtenerNombreDia(num) {
    return ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'][num] || '';
}

function obtenerNombreDiaCompleto(num) {
    return ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][num] || '';
}

function _horaStr(hora) {
    const hh = Math.floor(hora).toString().padStart(2, '0');
    const mm = Math.round((hora % 1) * 60).toString().padStart(2, '0');
    return `${hh}:${mm}h`;
}

// ==================== EXPORTS ====================

if (typeof window !== 'undefined') {
    window.inicializarSistemaTemporal    = inicializarSistemaTemporal;
    window.aplicarSimulacionTemporal     = aplicarSimulacionTemporal;
    window.desactivarSimulacionTemporal  = desactivarSimulacionTemporal;
    window.establecerHoraActual          = establecerHoraActual;
    window.estadoTemporal                = estadoTemporal;
}

// ==================== AUTO-INIT ====================
// Se auto-inicializa en cuanto el mapa de Leaflet esté disponible,
// sin depender de que index.html llame a inicializarSistemaTemporal().

(function _autoInitTemporal() {
    function _tryInit() {
        if (typeof map !== 'undefined' && map && typeof map.addLayer === 'function') {
            inicializarSistemaTemporal();
        } else {
            setTimeout(_tryInit, 100);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _tryInit);
    } else {
        _tryInit();
    }
})();