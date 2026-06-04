/**
 * legend-manager.js
 * Gestión de leyendas para vías y puntos de interés
 */

// ==================== HELPERS INTERNOS ====================

// Construye los elementos de la leyenda
function dibujarLeyenda(listaLeyenda, valoresUnicos, obtenerColor) {
    // Limpiar leyenda previa
    listaLeyenda.innerHTML = '';
    // Crea nueva leyenda
    valoresUnicos.forEach(v => {
        // 
        const itemLeyenda  = document.createElement('li'); 
        itemLeyenda.className = 'legend-item';
        const boxColor  = document.createElement('div');
        boxColor.className        = 'legend-swatch'; // Cuadrado de color
        boxColor.style.background = obtenerColor(v);
        const textoLeyenda = document.createElement('div');
        textoLeyenda.textContent = v;
        itemLeyenda.appendChild(boxColor);
        itemLeyenda.appendChild(textoLeyenda);
        listaLeyenda.appendChild(itemLeyenda);
    });
}

// Obtiene los valores únicos de un atributo en un conjunto de features, normalizando nulos/vacíos a 'Desconocido'
function obtenerValoresUnicos(features, atributo) {
    const values = new Set();
    for (const f of features) {
        const v = f?.properties?.[atributo];
        values.add((v === undefined || v === null || v === '') ? 'Desconocido' : String(v));
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

// Construye el desplegable de atributos
function desplegableLeyenda(selector, atributoOpt, alcambiar) {
    selector.innerHTML = '';
    if (!atributoOpt.length) {
        selector.disabled = true;
        selector.innerHTML = '<option value="">— Sin atributos —</option>';
        return;
    }
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— Selecciona un atributo —';
    selector.appendChild(defaultOpt);
    atributoOpt.forEach(c => { 
        const opcion = document.createElement('option'); 
        opcion.value = opcion.textContent = c;
        selector.appendChild(opcion);
    });
    selector.disabled = false;
    selector.onchange = () => alcambiar(selector.value);
    const listaLeyenda = document.getElementById('legend-list');
    if (listaLeyenda) listaLeyenda.innerHTML = '';
}

// ==================== VÍAS ====================

function cargarListaVias(geojson) {
    const selector = document.getElementById('vias-attribute-select');
    if (!selector) return;

    if (!geojson?.features?.length) {
        selector.disabled = true;
        selector.innerHTML = '<option value="">— Capa no cargada —</option>';
        return;
    }

    window.currentViasGeoJSON = geojson;

    // Leer columnas dinámicamente del GeoJSON en memoria (sin hardcode)
    const atributosEncontrados = new Set();
    geojson.features.forEach(f => f?.properties && Object.keys(f.properties).forEach(k => atributosEncontrados.add(k)));
    const atributoOpt = Array.from(atributosEncontrados).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    desplegableLeyenda(selector, atributoOpt, atributoSeleccionado => {
        viasAttrColors = {};
        actualizarLeyendaVias(atributoSeleccionado);
    });
}

function actualizarLeyendaVias(atributo) {
    const listaLeyenda = document.getElementById('legend-list');
    if (!listaLeyenda) return;

    if (!atributo) {
        listaLeyenda.innerHTML = '';
        recolorearViasPorAtributo(null);
        return;
    }

    const geojson = window.currentViasGeoJSON;
    if (!geojson?.features?.length) {
        listaLeyenda.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">No hay datos</li>';
        return;
    }

    const values = obtenerValoresUnicos(geojson.features, atributo);
    if (!values.length) {
        listaLeyenda.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">Sin valores para este atributo</li>';
        recolorearViasPorAtributo(null);
        return;
    }

    dibujarLeyenda(listaLeyenda, values, colorVia);
    recolorearViasPorAtributo(atributo);
}

function recolorearViasPorAtributo(atributo) {
    if (!viasLayer) return;
    if (!atributo) {
        viasLayer.setStyle(obtenerEstiloVia);
        return;
    }
    viasLayer.setStyle(feature => {
        const valor = feature?.properties?.[atributo];
        const suColor = (valor === null || valor === undefined || valor === '') ? 'Desconocido' : String(valor);
        return { color: colorVia(suColor), weight: 2, opacity: 0.9 };
    });
}

// ==================== PUNTOS DE INTERÉS ====================

function atributosPOI(geojson) {
    const selector = document.getElementById('puntos-attribute-select');
    if (!selector) return;

    if (!geojson?.features?.length) {
        selector.disabled = true;
        selector.innerHTML = '<option value="">— Capa no cargada —</option>';
        return;
    }

    window.currentPuntosGeoJSON = geojson;

    const atributosEncontrados = new Set();
    geojson.features.forEach(f => f?.properties && Object.keys(f.properties).forEach(k => atributosEncontrados.add(k)));
    const atributoOpt = Array.from(atributosEncontrados).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    desplegableLeyenda(selector, atributoOpt, atributoSeleccionado => {
        puntosAttrColors = {};
        actualizarLeyendaPuntos(atributoSeleccionado);
    });
}

function actualizarLeyendaPuntos(atributo) {
    const listaLeyenda = document.getElementById('legend-list');
    if (!listaLeyenda) return;

    if (!atributo) {
        listaLeyenda.innerHTML = '';
        recolorearPuntosPorAtributo(null);
        return;
    }

    const geojson = window.currentPuntosGeoJSON;
    if (!geojson?.features?.length) {
        listaLeyenda.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">No hay datos</li>';
        return;
    }

    const values = obtenerValoresUnicos(geojson.features, atributo);
    if (!values.length) {
        listaLeyenda.innerHTML = '<li class="legend-item" style="color:#7f8c8d;">Sin valores para este atributo</li>';
        recolorearPuntosPorAtributo(null);
        return;
    }

    dibujarLeyenda(listaLeyenda, values, colorPunto);
    recolorearPuntosPorAtributo(atributo);
}

function recolorearPuntosPorAtributo(atributo) {
    if (!window.puntosLayer) return;

    // Los circleMarker no tienen setStyle() global como L.geoJSON:
    // hay que iterar cada capa individualmente.
    window.puntosLayer.eachLayer(marcador => {
        if (!atributo) {
            // Restaurar color original asignado por capa
            const capa  = marcador.feature?.properties?.capa || 'desconocido';
            marcador.setStyle({ fillColor: colorPunto(capa), color: '#fff' });
            return;
        }
        const valor  = marcador.feature?.properties?.[atributo];
        const suColor   = (valor === null || valor === undefined || valor === '') ? 'Desconocido' : String(valor);
        marcador.setStyle({ fillColor: colorPunto(suColor), color: '#fff' });
    });
}