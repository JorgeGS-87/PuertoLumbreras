/**
 * symbology.js
 * Simbología y colores para vías y puntos de interés
 */

// ==================== ESTADO DE COLOR DINÁMICO ====================

let _viasAttrIndex   = 0;
let viasAttrColors   = {};
let _puntosAttrIndex = 0;
let puntosAttrColors = {};

// ==================== SIMBOLOGÍA DE VÍAS ====================

const simbologiaVias = {
    'motorway':       { color: '#B66963', weight: 5.25, dashArray: null },
    'motorway_link':  { color: '#B66963', weight: 2.25, dashArray: null },
    'trunk':          { color: '#CE8B4F', weight: 3.75, dashArray: null },
    'trunk_link':     { color: '#CE8B4F', weight: 2.25, dashArray: null },
    'primary':        { color: '#CE8B4F', weight: 3,    dashArray: null },
    'primary_link':   { color: '#CE8B4F', weight: 1.5,  dashArray: null },
    'secondary':      { color: '#E7B92E', weight: 2.25, dashArray: null },
    'secondary_link': { color: '#E7B92E', weight: 1.13, dashArray: null },
    'tertiary':       { color: '#BDB58B', weight: 2.25, dashArray: null },
    'tertiary_link':  { color: '#BDB58B', weight: 1.13, dashArray: null },
    'unclassified':   { color: '#C7C5BD', weight: 1.5,  dashArray: null },
    'road':           { color: '#C7C5BD', weight: 1.5,  dashArray: null },
    'residential':    { color: '#C7C5BD', weight: 1.5,  dashArray: null },
    'living_street':  { color: '#C7C5BD', weight: 1.13, dashArray: null },
    'service':        { color: '#C7C5BD', weight: 1.5,  dashArray: null },
    'services':       { color: '#C7C5BD', weight: 1.5,  dashArray: null },
    'construction':   { color: '#C7C5BD', weight: 1.5,  dashArray: '4.5, 3, 1.5, 3, 1.5, 3' },
    'footway':        { color: '#45812B', weight: 0.75, dashArray: null },
    'pedestrian':     { color: '#45812B', weight: 0.75, dashArray: null },
    'steps':          { color: '#45812B', weight: 0.75, dashArray: null },
    'path':           { color: '#A8987C', weight: 0.75, dashArray: '2.25, 1.5' },
    'track':          { color: '#A8987C', weight: 1.13, dashArray: '1.13, 2.26' },
    'cycleway':       { color: '#5B75A7', weight: 0.75, dashArray: null },
    'default':        { color: '#D6D6D6', weight: 0.9,  dashArray: null },
};

const viasAttrPalette = [
    '#7f8c8d', '#2ca02c', '#ff7f0e', '#1f77b4',
    '#d62728', '#9467bd', '#8c564b', '#e377c2',
];

const puntosAttrPalette = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#95a5a6', '#34495e', '#16a085',
    '#27ae60', '#2980b9', '#8e44ad', '#c0392b', '#d35400',
];

// ==================== ASIGNACIÓN DE COLORES ====================

function assignColorForVia(val) {
    if (val === null || val === undefined) return simbologiaVias['default'].color;
    const norm = String(val).trim().toLowerCase();
    if (!norm) return simbologiaVias['default'].color;

    // Coincidencia exacta con tipo de vía conocido
    if (Object.prototype.hasOwnProperty.call(simbologiaVias, norm)) {
        return simbologiaVias[norm].color;
    }
    // Coincidencia parcial (ej. "motorway_junction")
    for (const k of Object.keys(simbologiaVias)) {
        if (norm.includes(k)) return simbologiaVias[k].color;
    }

    // Valor desconocido → color dinámico de la paleta
    if (viasAttrColors[norm]) return viasAttrColors[norm];
    const color = viasAttrPalette[_viasAttrIndex % viasAttrPalette.length];
    viasAttrColors[norm] = color;
    _viasAttrIndex++;
    return color;
}

function assignColorForPunto(value) {
    const key = value ? String(value) : 'Desconocido';
    if (puntosAttrColors[key]) return puntosAttrColors[key];
    const color = puntosAttrPalette[_puntosAttrIndex % puntosAttrPalette.length];
    puntosAttrColors[key] = color;
    _puntosAttrIndex++;
    return color;
}

// ==================== ESTILOS LEAFLET ====================

function obtenerEstiloVia(feature) {
    const highway = feature?.properties?.highway;
    const estilo  = simbologiaVias[highway] || simbologiaVias['default'];
    return {
        color:     estilo.color,
        weight:    estilo.weight,
        opacity:   0.9,
        dashArray: estilo.dashArray,
    };
}

// ==================== POPUP DE PUNTOS ====================

function crearPopupPunto(properties) {
    const tipo   = properties.tipo       || properties.tipo_centr || properties.denCorta ||
                   properties.amenity    || properties.building   || 'Punto de interés';
    const nombre = properties.denLarga   || properties.name       || properties.nombre   ||
                   properties.denominacion || 'Sin nombre';

    return `
        <div style="font-family:sans-serif;min-width:180px;">
            <div style="font-size:14px;font-weight:600;color:#2c3e50;
                        margin-bottom:6px;border-bottom:2px solid #3498db;padding-bottom:4px;">
                📍 ${tipo}
            </div>
            <div style="font-size:13px;color:#34495e;">
                <strong>${nombre}</strong>
            </div>
        </div>
    `;
}