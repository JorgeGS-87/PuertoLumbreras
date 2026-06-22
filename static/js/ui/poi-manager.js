// =============================================================================
// js/ui/poi-manager.js
// Reemplaza la lógica de POIs de main.js para añadir:
//   · Geocodificación inversa automática (Nominatim) → Dirección + CP
//   · Tipo libre con datalist persistido en localStorage
//   · Campos: Nombre*, Tipo*, Pedanía, Teléfono, Email, URL (opcionales)
//   · Guardado permanente en POIs.shp mediante POST /api/pois/añadir
// Debe cargarse DESPUÉS de main.js (ya que sobreescribe sus funciones POI).
// =============================================================================

(function () {

// ─────────────────────────── TIPOS ──────────────────────────────────────────
const _TIPOS_KEY  = 'poi_tipos_extra';
const _TIPOS_BASE = [
    'Centros Escolares', 'Iglesia / Templo', 'Oficina / Servicio público',
    'Restaurantes', 'Farmacia', 'Gasolinera', 'Monumento',
    'Ocio / Entretenimiento', 'Comercio', 'Sanitario / Hospital',
    'Deportivo', 'Transporte', 'Otro',
];

function _cargarTiposExtra() {
    try { return JSON.parse(localStorage.getItem(_TIPOS_KEY) || '[]'); } catch { return []; }
}
function _guardarTipoNuevo(tipo) {
    if (!tipo) return;
    const norm = tipo.trim();
    const todos = [..._TIPOS_BASE, ..._cargarTiposExtra()];
    if (todos.some(t => t.toLowerCase() === norm.toLowerCase())) return;
    const extras = _cargarTiposExtra();
    extras.push(norm);
    try { localStorage.setItem(_TIPOS_KEY, JSON.stringify(extras)); } catch {}
}
function _getTodosLosTipos() {
    return [..._TIPOS_BASE, ..._cargarTiposExtra()];
}
function _actualizarDatalist() {
    const dl = document.getElementById('poi-tipo-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    _getTodosLosTipos().forEach(t => {
        const o = document.createElement('option'); o.value = t; dl.appendChild(o);
    });
}

// ─────────────────────────── ESTADO ─────────────────────────────────────────
let _latlng      = null;   // L.LatLng del punto elegido
let _direccion   = '';     // resultado Nominatim
let _cp          = '';     // código postal Nominatim
let _geoCtrl     = null;   // AbortController en vuelo
let _markerTemp  = null;   // marcador temporal en el mapa mientras se elige punto
let _modoActivo  = false;  // true = esperando clic en mapa

// ─────────────────────────── MODO COLOCACIÓN ────────────────────────────────

/**
 * Activa el modo «añadir POI»: el cursor cambia y el siguiente clic en el
 * mapa abre el modal con las coordenadas.
 * Sobreescribe activarModoPoi() que define main.js.
 */
window.activarModoPoi = function () {
    if (_modoActivo) { _cancelarModo(); return; }   // toggle off

    // Desactivar otros modos si están activos
    if (typeof window.desactivarModoObstaculo === 'function' && typeof modoObstaculo !== 'undefined' && modoObstaculo) window.desactivarModoObstaculo();
    if (typeof window.desactivarModoEvento    === 'function' && window._modoEvento)  window.desactivarModoEvento();

    _modoActivo = true;

    // Estilo cursor
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.cursor = 'crosshair';

    // Botón activo
    const btn = document.getElementById('msw-btn-poi') || document.querySelector('[onclick*="activarModoPoi"]');
    if (btn) btn.classList.add('obs-activo', 'active');

    // Registrar el handler de clic en el mapa usando la misma convención que
    // event-manager.js: window._eventoClickHandler + window._modoEvento
    window._modoEvento = 'poi';
    window._eventoClickHandler = function (e) {
        _onMapClick(e.latlng);
    };
};

function _cancelarModo() {
    _modoActivo = false;
    window._modoEvento = null;
    window._eventoClickHandler = null;

    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.cursor = '';

    const btn = document.getElementById('msw-btn-poi') || document.querySelector('[onclick*="activarModoPoi"]');
    if (btn) btn.classList.remove('obs-activo', 'active');

    if (_markerTemp && typeof map !== 'undefined') { map.removeLayer(_markerTemp); _markerTemp = null; }
}

/** Se llama desde cerrarPoiModal para salir del modo limpiamente. */
window.cancelarModoPoi = _cancelarModo;

// ─────────────────────────── CLIC EN MAPA ───────────────────────────────────

function _onMapClick(latlng) {
    _cancelarModo();   // salir del modo inmediatamente

    _latlng    = latlng;
    _direccion = '';
    _cp        = '';

    // Marcador temporal
    if (typeof map !== 'undefined') {
        if (_markerTemp) map.removeLayer(_markerTemp);
        _markerTemp = L.marker(latlng, {
            icon: L.divIcon({
                className: '',
                html: '<div style="font-size:24px;filter:drop-shadow(1px 2px 4px rgba(0,0,0,.6));">🪧</div>',
                iconSize: [24, 24], iconAnchor: [12, 24]
            }),
            zIndexOffset: 600
        }).addTo(map);
    }

    // Limpiar modal
    ['poi-nombre-input','poi-tipo-input','poi-pedania-input',
     'poi-telefono-input','poi-email-input','poi-url-input'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    _elem('poi-error',           el => { el.style.display = 'none'; el.textContent = ''; });
    _elem('poi-direccion-info',  el => el.style.display = 'none');
    _elem('poi-direccion-texto', el => el.textContent   = 'Obteniendo dirección…');

    _actualizarDatalist();

    const modal = document.getElementById('poi-modal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('poi-nombre-input')?.focus(), 80);
    }

    // Geocodificación en segundo plano
    _geocodificar(latlng.lat, latlng.lng);
}

// ─────────────────────────── GEOCODIFICACIÓN ────────────────────────────────

async function _geocodificar(lat, lng) {
    if (_geoCtrl) _geoCtrl.abort();
    _geoCtrl = new AbortController();

    _elem('poi-direccion-info',  el => el.style.display = 'block');
    _elem('poi-direccion-texto', el => el.textContent   = 'Obteniendo dirección…');

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const res = await fetch(url, { signal: _geoCtrl.signal, headers: { 'Accept-Language': 'es' } });
        const d   = await res.json();
        const a   = d.address || {};

        const calle  = a.road || a.pedestrian || a.path || a.suburb || '';
        const numero = a.house_number || 'S/N';
        _direccion = calle ? `${calle.toUpperCase()}, ${numero}` : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        _cp        = a.postcode || '';

        _elem('poi-direccion-texto', el =>
            el.textContent = `${_direccion}${_cp ? ' · CP ' + _cp : ''}`
        );
    } catch (e) {
        if (e.name === 'AbortError') return;
        _direccion = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        _cp        = '';
        _elem('poi-direccion-texto', el => el.textContent = `📍 ${_direccion}`);
    }
}

// ─────────────────────────── CERRAR MODAL ───────────────────────────────────

window.cerrarPoiModal = function () {
    const modal = document.getElementById('poi-modal');
    if (modal) modal.style.display = 'none';
    if (_geoCtrl)    { _geoCtrl.abort(); _geoCtrl = null; }
    if (_markerTemp && typeof map !== 'undefined') { map.removeLayer(_markerTemp); _markerTemp = null; }
    _latlng = null;
    _cancelarModo();
};

// ─────────────────────────── CONFIRMAR ──────────────────────────────────────

window.confirmarPoi = async function () {
    const nombre   = _val('poi-nombre-input');
    const tipo     = _val('poi-tipo-input');
    const pedania  = _val('poi-pedania-input');
    const telefono = _val('poi-telefono-input');
    const email    = _val('poi-email-input');
    const url      = _val('poi-url-input');

    // Validación
    if (!nombre) { _error('El nombre es obligatorio.'); document.getElementById('poi-nombre-input')?.focus(); return; }
    if (!tipo)   { _error('El tipo es obligatorio.');   document.getElementById('poi-tipo-input')?.focus();   return; }
    _elem('poi-error', el => el.style.display = 'none');

    // Persistir tipo nuevo
    _guardarTipoNuevo(tipo);

    const lat = _latlng?.lat ?? 0;
    const lng = _latlng?.lng ?? 0;

    const props = {
        Nombre:    nombre,
        tipo:      tipo,
        Dirección: _direccion || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        CP:        _cp || '',
        Pedanía:   pedania,
        Teléfono:  telefono,
        email:     email,
        URL:       url,
    };

    // Cerrar modal primero (UX fluida)
    const modal = document.getElementById('poi-modal');
    if (modal) modal.style.display = 'none';
    if (_geoCtrl) { _geoCtrl.abort(); _geoCtrl = null; }
    _latlng = null;
    _cancelarModo();

    // 1) Guardar en shapefile (servidor)
    const ok = await _guardarEnServidor(lat, lng, props);

    // 2) Añadir a la capa en memoria (función original de main.js si existe)
    if (typeof window._añadirPoiACapaMemoria === 'function') {
        window._añadirPoiACapaMemoria(lat, lng, props);
    } else {
        _añadirGeoJSONLocal(lat, lng, props);
    }

    if (ok) {
        if (typeof showNotification === 'function')
            showNotification(`✅ "${nombre}" guardado en POIs.shp`, 'success');
    } else {
        if (typeof showNotification === 'function')
            showNotification(`⚠️ "${nombre}" añadido en sesión (no se pudo guardar en disco)`, 'warning');
    }
};

// ─────────────────────────── GUARDADO EN SERVIDOR ───────────────────────────

async function _guardarEnServidor(lat, lng, props) {
    try {
        const res = await fetch('/api/pois/añadir', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ lat, lng, propiedades: props }),
        });
        if (!res.ok) { console.error('[poi-manager] Error HTTP', res.status, await res.text()); return false; }
        return true;
    } catch (e) {
        console.error('[poi-manager] Error de red:', e);
        return false;
    }
}

// ─────────────────────────── AÑADIR A MEMORIA ───────────────────────────────

function _añadirGeoJSONLocal(lat, lng, props) {
    // Añadir al GeoJSON en memoria
    if (window.currentPuntosGeoJSON?.features) {
        window.currentPuntosGeoJSON.features.push({
            type: 'Feature',
            geometry:   { type: 'Point', coordinates: [lng, lat] },
            properties: { ...props, _capa: props.tipo },
        });
    }

    // Añadir marcador a la capa Leaflet si existe
    if (typeof puntosLayer !== 'undefined' && puntosLayer && typeof L !== 'undefined') {
        const marker = L.circleMarker([lat, lng], {
            radius: 6, fillColor: '#e67e22', color: '#fff',
            weight: 1.5, opacity: 1, fillOpacity: 0.9
        });
        marker.feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { ...props, _capa: props.tipo } };
        if (typeof _bindPoiPopup === 'function') _bindPoiPopup(marker);
        else marker.bindPopup(`<b>${props.Nombre}</b><br>${props.tipo}`);
        puntosLayer.addLayer(marker);
    }

    // Actualizar contador y tabla
    _elem('pois-flotante-contador', el => {
        el.textContent = (parseInt(el.textContent || '0') + 1).toString();
    });
    if (typeof window.updateAttributeTable    === 'function') window.updateAttributeTable();
    if (typeof window.populateTableLayerSelect === 'function') window.populateTableLayerSelect();
}

// ─────────────────────────── LIMPIAR POIS MANUALES ──────────────────────────
// Preservar la función original de main.js; solo la sobreescribimos si no existe.
if (typeof window.limpiarPoisManuales !== 'function') {
    window.limpiarPoisManuales = function () {
        if (!confirm('¿Eliminar todos los POIs manuales de esta sesión?')) return;
        if (window.currentPuntosGeoJSON?.features) {
            window.currentPuntosGeoJSON.features = window.currentPuntosGeoJSON.features.filter(
                f => !f.properties?._esManual
            );
        }
        if (typeof puntosLayer !== 'undefined' && puntosLayer) puntosLayer.clearLayers();
        _elem('pois-flotante-contador', el => el.textContent = '0');
        if (typeof window.updateAttributeTable === 'function') window.updateAttributeTable();
    };
}

// ─────────────────────────── HELPERS ────────────────────────────────────────

function _val(id)  { return (document.getElementById(id)?.value || '').trim(); }
function _elem(id, fn) { const el = document.getElementById(id); if (el) fn(el); }
function _error(msg) {
    _elem('poi-error', el => { el.textContent = msg; el.style.display = 'block'; });
}

console.log('[poi-manager] ✅ Cargado — geocodificación, tipos libres y guardado en shapefile.');

})();
