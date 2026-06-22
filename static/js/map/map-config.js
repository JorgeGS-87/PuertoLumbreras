/**
 * map-config.js
 * Configuración inicial del mapa y variables globales
 */

// Variables globales
const mapOptions = {
    center: [37.55980075138512, -1.8103973775466737],
    zoom: 18,
    minZoom: 9,
    maxBounds: [
        [37.35, -2.35],   // SW — esquina suroeste de Murcia
        [38.75, -0.65]    // NE — esquina noreste de Murcia
    ],
    maxBoundsViscosity: 0.85,
};

if (window.isMobile) {
    mapOptions.zoomControl = false;
}

window.map = L.map('map', mapOptions);

let viasLayer       = null;
let rutaLayer       = null;
let marcadorOrigen  = null;
let marcadorDestino = null;
let modoActual      = 'navegar';
let puntoOrigen     = null;
let puntoDestino    = null;

// Capas base
const capaOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
});

const capaPNOA = L.tileLayer(
    'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible' +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    {
        attribution: '© Instituto Geográfico Nacional de España',
        maxZoom: 19
    }
);

// Mapa Topográfico Nacional (IGN)
const capaIGNTopo = L.tileLayer(
    'https://www.ign.es/wmts/mapa-raster?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=MTN&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible' +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    {
        attribution: '© Instituto Geográfico Nacional de España — MTN',
        maxZoom: 18
    }
);

// OpenTopoMap (relieve / curvas de nivel)
const capaTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap contributors',
    maxZoom: 17,
    subdomains: 'abc'
});

// ESRI World Topo Map
const capaEsriTopo = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri — Source: Esri, USGS, NOAA', maxZoom: 19 }
);

// ESRI World Street Map
const capaEsriCalles = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri — Source: Esri, HERE, Garmin', maxZoom: 19 }
);

// ESRI World Imagery (satélite)
const capaEsriSatelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19 }
);

// CartoDB Voyager
const capaCartoVoyager = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19,
        subdomains: 'abcd'
    }
);

// Capa offline: tesela transparente 1x1 px — sin contenido de fondo
const capaOffline = L.tileLayer(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    { attribution: 'Sin conexión — modo offline' }
);

// ── Modo offline ─────────────────────────────────────────────────────────────

/**
 * Activa el modo offline visual (ejecuta solo una vez gracias al flag _offlineActivado).
 *
 * Problema 1 — Fondo verde del mapa:
 *   Leaflet 1.9.4 añade mix-blend-mode:plus-lighter a las teselas (.leaflet-tile).
 *   Cuando la tesela es el PNG transparente 1x1 (cuyo pixel es negro #000),
 *   ese blend-mode interactúa con el canvas interno y produce verde eléctrico.
 *   Solución: inyectar un <style> con ID#map para máxima especificidad
 *   + setProperty('background','#ffffff','important') en el contenedor.
 *
 * Problema 2 — indicadorEstado OFFLINE verde:
 *   El color verde estaba hardcodeado en .status-indicadorEstado { background:#27ae60 }
 *   dentro de styles.css. Ahora styles.css arranca en gris neutro (#7f8c8d)
 *   y esta función lo cambia a naranja cuando no hay red.
 */
function activarModoOffline() {
    if (window._offlineActivado) return;
    window._offlineActivado = true;

    // La tesela offline es transparente 1x1; Leaflet la renderiza con
    // mix-blend-mode:plus-lighter causando verde. Solución definitiva:
    // ocultar el tile-pane completo y dejar fondo blanco limpio.
    const estilosOffline = document.createElement('style');
    estilosOffline.id = 'offline-map-style';
    estilosOffline.textContent =
        '#map .leaflet-container { background: #ffffff !important; }\n' +
        '#map .leaflet-tile-pane { display: none !important; }';
    document.head.appendChild(estilosOffline);

    // Forzar fondo blanco también inline
    const contenedor = map.getContainer();
    if (contenedor) contenedor.style.setProperty('background', '#ffffff', 'important');

    // indicadorEstado -> naranja
    const indicadorEstado = document.querySelector('.status-badge');
    const textoEstado    = document.getElementById('serverStatus');
    const puntoEstado   = document.getElementById('network-dot');
    if (indicadorEstado) indicadorEstado.style.background = '#64748b';
    if (textoEstado)    textoEstado.textContent          = 'OFFLINE';
    if (puntoEstado)   puntoEstado.style.background    = 'rgba(255,255,255,0.8)';

    // Sin red → WS tampoco puede estar conectado
    if (typeof _actualizarBadgeWS === 'function') _actualizarBadgeWS('offline');
}

// Arrancar siempre con OSM (aprovecha caché del navegador si existe).
// capaOffline solo se activa cuando una tesela OSM falla al cargar.
capaOSM.addTo(map);

capaOSM.on('tileerror', function () {
    if (map.hasLayer(capaOSM)) {
        map.removeLayer(capaOSM);
        capaOffline.addTo(map);
        activarModoOffline();
    }
});

// ── Control de capas base ────────────────────────────────────────────────────
// Posición 'topleft' para que Leaflet lo añada con los controles de zoom;
// map-widgets.js lo mueve después a #map-controls.
const capasBase = {
    '🗺️ OpenStreetMap':     capaOSM,
    '🛰️ PNOA (IGN)':        capaPNOA,
    '🗺️ Mapa Topo. (IGN)':  capaIGNTopo,
    '🏔️ OpenTopoMap':       capaTopo,
    '🏞️ Topográfico (ESRI)': capaEsriTopo,
    '🛣️ Calles (ESRI)':     capaEsriCalles,
    '🛰️ Satélite (ESRI)':   capaEsriSatelite,
    '🧭 CartoDB Voyager':    capaCartoVoyager,
};
const controlCapas = L.control.layers(capasBase, null, { position: 'topleft', collapsed: false });
controlCapas.addTo(map);

map.zoomControl.setPosition('bottomleft');

// ── Iconos de marcadores ─────────────────────────────────────────────────────

function obtenerTamanoIcono() {
    const zoom       = map.getZoom();
    const tamanoBase = 18;
    const factor     = Math.pow(1.25, zoom - 13);
    const tamano     = Math.max(12, Math.min(32, tamanoBase * factor));
    return Math.round(tamano);
}

function crearIconoMarcador(emoji) {
    const tamano = obtenerTamanoIcono();
    return L.divIcon({
        className:  'marker-custom',
        html:       '<div style="font-size:' + tamano + 'px;line-height:1;">' + emoji + '</div>',
        iconSize:   [tamano, tamano],
        iconAnchor: [tamano / 2, tamano]
    });
}

map.on('zoomend', function () {
    if (marcadorOrigen)  marcadorOrigen.setIcon(crearIconoMarcador('📍'));
    if (marcadorDestino) marcadorDestino.setIcon(crearIconoMarcador('🎯'));
});

// ── Estado del servidor ──────────────────────────────────────────────────────
// Flask siempre es local -> si responde OK el servidor está levantado.
// El indicadorEstado arranca en gris (styles.css) y aquí se colorea según el resultado.

fetch('/api/status')
    .then(function (r) {
        if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status));
        return r.json().catch(function () { return {}; });
    })
    .then(function () {
        // Solo ONLINE si el modo offline no se ha activado ya por falta de teselas
        if (!window._offlineActivado) {
            var indicadorEstado = document.querySelector('.status-badge');
            var textoEstado    = document.getElementById('serverStatus');
            var puntoEstado   = document.getElementById('network-dot');
            if (indicadorEstado) indicadorEstado.style.background = '#27ae60';
            if (textoEstado)    textoEstado.textContent          = 'ONLINE';
            if (puntoEstado)   puntoEstado.style.background    = 'rgba(255,255,255,0.8)';
        }
        if (typeof showNotification === 'function')
            showNotification('Servidor conectado correctamente', 'success');
    })
    .catch(function (error) {
        var indicadorEstado = document.querySelector('.status-badge');
        var textoEstado    = document.getElementById('serverStatus');
        var puntoEstado   = document.getElementById('network-dot');
        if (indicadorEstado) indicadorEstado.style.background = '#e74c3c';
        if (textoEstado)    textoEstado.textContent          = 'ERROR';
        if (puntoEstado)   puntoEstado.style.background    = 'rgba(255,255,255,0.8)';
        if (typeof showNotification === 'function')
            showNotification('Error al conectar con el servidor', 'error');
        console.error('Error al comprobar /api/status:', error);
    });