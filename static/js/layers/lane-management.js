/**
 * lane-management.js
 * Normalización y clasificación de vías
 */

// Estado global de vías
let viasData = {
    features:      [],
    atributos:     new Set(),
    clasificacion: {},
    tiposVia:      new Set(),
    carriles:      {}
};

// ==================== NORMALIZACIÓN ====================

function normalizarLanes(valor) {
    if (valor === null || valor === undefined || valor === '') return 1;
    if (typeof valor === 'string' && ['none', 'nan', 'null', 'n/a'].includes(valor.toLowerCase())) return 1;
    const n = parseInt(valor, 10);
    return isNaN(n) || n < 1 ? 1 : n;
}

function normalizarMaxspeed(valor, highway = null) {
    if (highway?.toLowerCase() === 'residential') return 30;
    if (valor === null || valor === undefined || valor === '') return 50;
    if (typeof valor === 'string' && ['none', 'nan', 'null', 'n/a'].includes(valor.toLowerCase())) return 50;

    let speed;
    if (typeof valor === 'string') {
        const m = valor.match(/\d+/);
        if (!m) return 50;
        speed = parseInt(m[0], 10);
    } else {
        speed = parseInt(valor, 10);
    }
    if (isNaN(speed) || speed < 10) return 50;
    return Math.min(speed, 120);
}

// ==================== PROCESADO ====================

function obtenerTipoVia(properties) {
    if (!properties) return 'default';
    const hw = properties.highway || properties.HIGHWAY || properties.type || properties.TYPE;
    return hw ? String(hw).toLowerCase() : 'default';
}

function obtenerNumeroCarriles(properties) {
    if (!properties) return 1;
    const lanes = properties.lanes || properties.LANES || properties.num_lanes || properties.NUM_LANES;
    if (typeof lanes === 'number' && lanes >= 1) return lanes;
    return normalizarLanes(lanes);
}

function procesarVias(geojson) {
    if (!geojson?.features) return null;

    viasData.features = geojson.features;
    viasData.atributos.clear();
    viasData.tiposVia.clear();
    viasData.clasificacion = {};
    viasData.carriles = {};

    geojson.features.forEach(feature => {
        if (!feature.properties) return;

        const p       = feature.properties;
        const highway = obtenerTipoVia(p);

        p.lanes    = normalizarLanes(p.lanes);
        p.maxspeed = normalizarMaxspeed(p.maxspeed, highway);

        Object.keys(p).forEach(k => viasData.atributos.add(k));
        viasData.tiposVia.add(highway);

        if (p.lanes > 0) {
            if (!viasData.carriles[p.lanes]) viasData.carriles[p.lanes] = [];
            viasData.carriles[p.lanes].push(feature);
        }
    });

    return viasData;
}

// ==================== CONSULTAS ====================

function clasificarViasPorAtributo(atributo) {
    const clasificacion = {};
    viasData.features.forEach(feature => {
        if (!feature.properties) return;
        let valor = feature.properties[atributo];
        valor = (valor === null || valor === undefined || valor === '') ? 'Desconocido' : String(valor);
        if (!clasificacion[valor]) clasificacion[valor] = [];
        clasificacion[valor].push(feature);
    });
    viasData.clasificacion[atributo] = clasificacion;
    return clasificacion;
}

function obtenerEstadisticasVias() {
    const stats = {
        total:                viasData.features.length,
        atributos:            Array.from(viasData.atributos),
        tiposVia:             Array.from(viasData.tiposVia),
        distribucionCarriles: {},
        velocidades:          { min: Infinity, max: -Infinity, promedio: 0 },
        carriles:             { min: Infinity, max: -Infinity, promedio: 0 }
    };

    for (const [n, vias] of Object.entries(viasData.carriles)) {
        stats.distribucionCarriles[n] = vias.length;
    }

    let sumaVel = 0, sumaCarr = 0, count = viasData.features.length;
    viasData.features.forEach(f => {
        if (!f.properties) return;
        const speed = f.properties.maxspeed || 50;
        const lanes = f.properties.lanes    || 1;
        stats.velocidades.min = Math.min(stats.velocidades.min, speed);
        stats.velocidades.max = Math.max(stats.velocidades.max, speed);
        stats.carriles.min    = Math.min(stats.carriles.min,    lanes);
        stats.carriles.max    = Math.max(stats.carriles.max,    lanes);
        sumaVel  += speed;
        sumaCarr += lanes;
    });

    if (count > 0) {
        stats.velocidades.promedio = Math.round(sumaVel  / count * 100) / 100;
        stats.carriles.promedio    = Math.round(sumaCarr / count * 100) / 100;
    }

    return stats;
}

function obtenerViasPorCarriles(numCarriles) {
    return viasData.carriles[numCarriles] || [];
}

function obtenerAtributosVias() {
    return Array.from(viasData.atributos).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}