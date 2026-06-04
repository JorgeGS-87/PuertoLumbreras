/**
 * legend-manager.js
 * Gestión de leyendas para vías y puntos de interés
 */

// ==================== HELPERS INTERNOS ====================

function _buildLegendItems(ul, values, colorFn) {
    ul.innerHTML = '';
    values.forEach(v => {
        const li  = document.createElement('li');
        li.className = 'legend-item';
        const sw  = document.createElement('div');
        sw.className        = 'legend-swatch';
        sw.style.background = colorFn(v);
        const txt = document.createElement('div');
        txt.textContent = v;
        li.appendChild(sw);
        li.appendChild(txt);
        ul.appendChild(li);
    });
}

function _getUniqueValues(features, attribute) {
    const values = new Set();
    for (const f of features) {
        const v = f?.properties?.[attribute];
        values.add((v === undefined || v === null || v === '') ? 'Desconocido' : String(v));
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function _buildDropdown(sel, cols, onChangeFn) {
    sel.innerHTML = '';
    if (!cols.length) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">— Sin atributos —</option>';
        return;
    }
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— Selecciona un atributo —';
    sel.appendChild(defaultOpt);
    cols.forEach(c => {
        const o = document.createElement('option');
        o.value = o.textContent = c;
        sel.appendChild(o);
    });
    sel.disabled = false;
    sel.onchange = () => onChangeFn(sel.value);
    const ul = document.getElementById('legend-list');
    if (ul) ul.innerHTML = '';
}

// ==================== VÍAS ====================

function populateAttributeDropdownVias(geojson) {
    const sel = document.getElementById('vias-attribute-select');
    if (!sel) return;

    if (!geojson?.features?.length) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">— Capa no cargada —</option>';
        return;
    }

    window.currentViasGeoJSON = geojson;

    // Leer columnas dinámicamente del GeoJSON en memoria (sin hardcode)
    const set = new Set();
    geojson.features.forEach(f => f?.properties && Object.keys(f.properties).forEach(k => set.add(k)));
    const cols = Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    _buildDropdown(sel, cols, attr => {
        viasAttrColors = {};
        updateViasAttributeLegend(attr);
    });
}

function updateViasAttributeLegend(attribute) {
    const ul = document.getElementById('legend-list');
    if (!ul) return;

    if (!attribute) {
        ul.innerHTML = '';
        recolorViasByAttribute(null);
        return;
    }

    const geojson = window.currentViasGeoJSON;
    if (!geojson?.features?.length) {
        ul.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">No hay datos</li>';
        return;
    }

    const values = _getUniqueValues(geojson.features, attribute);
    if (!values.length) {
        ul.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">Sin valores para este atributo</li>';
        recolorViasByAttribute(null);
        return;
    }

    _buildLegendItems(ul, values, assignColorForVia);
    recolorViasByAttribute(attribute);
}

function recolorViasByAttribute(attribute) {
    if (!viasLayer) return;
    if (!attribute) {
        viasLayer.setStyle(obtenerEstiloVia);
        return;
    }
    viasLayer.setStyle(feature => {
        const val = feature?.properties?.[attribute];
        const key = (val === null || val === undefined || val === '') ? 'Desconocido' : String(val);
        return { color: assignColorForVia(key), weight: 2, opacity: 0.9 };
    });
}

// ==================== PUNTOS DE INTERÉS ====================

function populateAttributeDropdownPuntos(geojson) {
    const sel = document.getElementById('puntos-attribute-select');
    if (!sel) return;

    if (!geojson?.features?.length) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">— Capa no cargada —</option>';
        return;
    }

    window.currentPuntosGeoJSON = geojson;

    const set = new Set();
    geojson.features.forEach(f => f?.properties && Object.keys(f.properties).forEach(k => set.add(k)));
    const cols = Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    _buildDropdown(sel, cols, attr => {
        puntosAttrColors = {};
        updatePuntosAttributeLegend(attr);
    });
}

function updatePuntosAttributeLegend(attribute) {
    const ul = document.getElementById('legend-list');
    if (!ul) return;

    if (!attribute) {
        ul.innerHTML = '';
        recolorPuntosByAttribute(null);
        return;
    }

    const geojson = window.currentPuntosGeoJSON;
    if (!geojson?.features?.length) {
        ul.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">No hay datos</li>';
        return;
    }

    const values = _getUniqueValues(geojson.features, attribute);
    if (!values.length) {
        ul.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">Sin valores para este atributo</li>';
        recolorPuntosByAttribute(null);
        return;
    }

    _buildLegendItems(ul, values, assignColorForPunto);
    recolorPuntosByAttribute(attribute);
}

function recolorPuntosByAttribute(attribute) {
    if (!window.puntosLayer) return;

    // Los circleMarker no tienen setStyle() global como L.geoJSON:
    // hay que iterar cada capa individualmente.
    window.puntosLayer.eachLayer(layer => {
        if (!attribute) {
            // Restaurar color original asignado por _capa
            const capa  = layer.feature?.properties?._capa || 'desconocido';
            layer.setStyle({ fillColor: assignColorForPunto(capa), color: '#fff' });
            return;
        }
        const val   = layer.feature?.properties?.[attribute];
        const key   = (val === null || val === undefined || val === '') ? 'Desconocido' : String(val);
        layer.setStyle({ fillColor: assignColorForPunto(key), color: '#fff' });
    });
}