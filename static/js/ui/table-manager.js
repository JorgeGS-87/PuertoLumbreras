/**
 * table-manager.js  — GeoRuta (refactored)
 * Tabla de atributos estilo ArcGIS Pro con edición completa:
 *   · Celda individual: doble clic sobre cualquier celda → input inline
 *   · Filas: añadir fila nueva, duplicar fila, eliminar filas seleccionadas
 *   · Columnas: añadir columna, renombrar columna, eliminar columna
 *   · Edición masiva: Editar valores → col + filtro + nuevo valor sobre selección o todo
 *   · Consultas SQL simplificado
 */

// ═══════════════════════════════════════════════════════════════
// ESTADO DEL MÓDULO
// ═══════════════════════════════════════════════════════════════
let _tablaCapa     = null;
let _modoEliminar  = false;
let _backupGeoJSON = null;
let _seleccion     = new Set();
let _capaSeleccion = null;
let _subcapaActual = '';

// ═══════════════════════════════════════════════════════════════
// POSICIONAMIENTO (sigue al #map)
// ═══════════════════════════════════════════════════════════════

function _actualizarPosicionPanel() {
    const panel = document.getElementById('table-panel');
    const mapEl = document.getElementById('map');
    if (!panel || !mapEl) return;
    void mapEl.offsetWidth;
    const mapRect = mapEl.getBoundingClientRect();
    panel.style.left  = mapRect.left + 'px';
    panel.style.width = mapRect.width + 'px';
    panel.style.right = 'auto';
}

function _iniciarObservadorMapa() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    if (window.ResizeObserver) {
        new ResizeObserver(() => requestAnimationFrame(_actualizarPosicionPanel)).observe(mapEl);
    }
    if (typeof window.layoutHubSubscribe === 'function') {
        window.layoutHubSubscribe(_actualizarPosicionPanel);
    } else {
        window._layoutHubCallbacks = window._layoutHubCallbacks || [];
        window._layoutHubCallbacks.push(_actualizarPosicionPanel);
    }
    _actualizarPosicionPanel();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _iniciarObservadorMapa);
} else {
    setTimeout(_iniciarObservadorMapa, 0);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS DE DATOS
// ═══════════════════════════════════════════════════════════════

function _getGeo() {
    if (_tablaCapa === 'puntos')    return window.currentPuntosGeoJSON;
    if (_tablaCapa === 'obstaculos') return window._currentObstaculosGeoJSON;
    return window.currentViasGeoJSON;
}

function _setGeo(geo) {
    if (_tablaCapa === 'puntos')    window.currentPuntosGeoJSON = geo;
    else if (_tablaCapa !== 'obstaculos') window.currentViasGeoJSON = geo;
}

function _getFeaturesActivas() {
    const geo = _getGeo();
    if (!geo?.features) return [];
    if (_tablaCapa === 'puntos' && _subcapaActual)
        return geo.features.filter(f => f?.properties?._capa === _subcapaActual);
    return geo.features;
}

// ═══════════════════════════════════════════════════════════════
// ABRIR / CERRAR PANEL
// ═══════════════════════════════════════════════════════════════

function abrirTabla(layerId) {
    const geo = layerId === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo || !Array.isArray(geo.features) || geo.features.length === 0) {
        showNotification('Carga la capa antes de ver su tabla', 'warning');
        return;
    }

    const panel = document.getElementById('table-panel');
    const title = document.getElementById('table-panel-title');

    if (panel.classList.contains('open') && _tablaCapa === layerId) {
        cerrarTabla();
        return;
    }

    _tablaCapa    = layerId;
    _modoEliminar = false;
    _subcapaActual = '';
    _actualizarBtnEditar();

    const nombres = { vias: '🛣️ Red de Vías OSM', puntos: '🪧 Puntos de Interés' };
    if (title) title.textContent = '📋 ' + (nombres[layerId] || layerId);

    // Selector de subcapa para POIs
    const toolbarExtra = document.getElementById('table-subcapa-wrap');
    if (toolbarExtra) toolbarExtra.remove();
    if (layerId === 'puntos') {
        const g = window.currentPuntosGeoJSON;
        const capas = [...new Set((g?.features || []).map(f => f?.properties?._capa).filter(Boolean))].sort();
        if (capas.length > 1) {
            _subcapaActual = capas[0];
            const wrap = document.createElement('div');
            wrap.id = 'table-subcapa-wrap';
            wrap.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 10px;background:#f0f4f8;border-bottom:1px solid #dfe6e9;font-size:12px;';
            wrap.innerHTML = `
                <span style="color:#2c3e50;font-weight:600;white-space:nowrap;">Capa POI:</span>
                <select id="table-subcapa-select" style="flex:1;padding:4px 8px;border-radius:5px;border:1px solid #dfe6e9;font-size:12px;">
                    <option value="">— Todas las capas (${g.features.length} POIs) —</option>
                    ${capas.map(c => `<option value="${c}" ${c === capas[0] ? 'selected' : ''}>${c} (${g.features.filter(f=>f?.properties?._capa===c).length})</option>`).join('')}
                </select>`;
            wrap.querySelector('select').onchange = function() {
                _subcapaActual = this.value;
                _invalidarColsCache();
                limpiarSeleccion();
                updateAttributeTable();
            };
            const toolbar = document.getElementById('table-panel-toolbar');
            if (toolbar) toolbar.insertAdjacentElement('afterend', wrap);
        }
    }

    document.querySelectorAll('.btn-ver-tabla').forEach(b => b.classList.remove('active'));
    const btnActivo = document.getElementById('btn-tabla-' + layerId);
    if (btnActivo) btnActivo.classList.add('active');

    _actualizarPosicionPanel();
    panel.classList.add('open');
    document.body.classList.add('tabla-abierta');
    if (window._userRol === 'admin') document.body.classList.add('admin-tabla-abierta');
    document.getElementById('table-cmd').value = '';
    updateAttributeTable();
}

function cerrarTabla() {
    document.getElementById('table-panel')?.classList.remove('open');
    document.getElementById('table-subcapa-wrap')?.remove();
    document.querySelectorAll('.btn-ver-tabla').forEach(b => b.classList.remove('active'));
    document.body.classList.remove('tabla-abierta');
    document.body.classList.remove('admin-tabla-abierta');
    _tablaCapa     = null;
    _subcapaActual = '';
    _modoEliminar  = false;
    _actualizarBtnEditar();
    limpiarSeleccion();
    window._currentObstaculosGeoJSON = null;
    const btnActivo = document.getElementById('btn-tabla-obstaculos');
    if (btnActivo) btnActivo.classList.remove('active');
    setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 350);
}

// ═══════════════════════════════════════════════════════════════
// MENÚ EDITAR (dropdown)
// ═══════════════════════════════════════════════════════════════

let _modalAccion = null;

function toggleMenuEditar(e) {
    const menu = document.getElementById('edit-menu');
    if (!menu) return;
    if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
    const btn  = document.getElementById('btn-editar');
    const rect = btn.getBoundingClientRect();
    menu.style.top   = (rect.bottom + 4) + 'px';
    menu.style.left  = 'auto';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.display = 'block';
    setTimeout(() => document.addEventListener('click', _cerrarMenuEditar, { once: true }), 0);
}

function _cerrarMenuEditar() {
    const menu = document.getElementById('edit-menu');
    if (menu) menu.style.display = 'none';
}

function _actualizarBtnEditar() {
    const btn = document.getElementById('btn-editar');
    if (!btn) return;
    btn.classList.remove('active');
    btn.textContent = '✏️ Editar';
    btn.onclick = (e) => toggleMenuEditar(e);
}

function _guardarBackupSiNecesario() {
    if (_backupGeoJSON) return;
    const geo = _getGeo();
    _backupGeoJSON = geo ? JSON.parse(JSON.stringify(geo)) : null;
}

function _restaurarBackup() {
    if (!_backupGeoJSON) return;
    _setGeo(_backupGeoJSON);
    if (_tablaCapa === 'vias' && typeof viasData !== 'undefined') {
        viasData.atributos.clear();
        _backupGeoJSON.features.forEach(f => {
            if (f?.properties) Object.keys(f.properties).forEach(k => viasData.atributos.add(k));
        });
        if (typeof populateAttributeDropdownVias === 'function')
            populateAttributeDropdownVias(window.currentViasGeoJSON);
    }
}

// ═══════════════════════════════════════════════════════════════
// MODAL GENÉRICO
// ═══════════════════════════════════════════════════════════════

function cerrarModal() {
    document.getElementById('table-edit-modal').style.display = 'none';
    _modalAccion = null;
}

function confirmarModal() {
    if (typeof _modalAccion === 'function') _modalAccion();
}

function _abrirModal(titulo, html, accion) {
    _guardarBackupSiNecesario();
    document.getElementById('modal-title').textContent = titulo;
    document.getElementById('modal-body').innerHTML = html;
    _modalAccion = accion;
    document.getElementById('table-edit-modal').style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════════
// ➕ AÑADIR COLUMNA
// ═══════════════════════════════════════════════════════════════

function abrirModalAnadir() {
    _cerrarMenuEditar();
    _abrirModal('➕ Añadir columna', `
        <div class="mbox-row">
            <label>Nombre de la columna</label>
            <input id="m-col-nombre" type="text" placeholder="Ej: daño, estado, prioridad…">
        </div>
        <div class="mbox-row">
            <label>Tipo de dato</label>
            <select id="m-col-tipo">
                <option value="text">text — texto libre</option>
                <option value="int">int — número entero</option>
                <option value="float">float — número decimal</option>
            </select>
        </div>
        <div class="mbox-row">
            <label>Valor por defecto <span style="font-weight:400">(opcional)</span></label>
            <input id="m-col-default" type="text" placeholder="Dejar vacío para null">
            <span class="mbox-hint">Se aplicará a todos los elementos de la capa.</span>
        </div>
    `, _confirmarAnadir);
    setTimeout(() => document.getElementById('m-col-nombre')?.focus(), 50);
}

function _confirmarAnadir() {
    const nombre = document.getElementById('m-col-nombre').value.trim();
    const tipo   = document.getElementById('m-col-tipo').value;
    const defRaw = document.getElementById('m-col-default').value.trim();
    if (!nombre) { showNotification('Escribe un nombre para la columna', 'warning'); return; }

    const geo = _getGeo();
    if (!geo?.features) return;

    let defVal = null;
    if (defRaw !== '') {
        if (tipo === 'int')        defVal = parseInt(defRaw, 10)  || 0;
        else if (tipo === 'float') defVal = parseFloat(defRaw)    || 0.0;
        else                       defVal = defRaw;
    }

    geo.features.forEach(f => { if (f.properties) f.properties[nombre] = defVal; });
    if (_tablaCapa === 'vias' && typeof viasData !== 'undefined') viasData.atributos.add(nombre);
    if (_tablaCapa === 'vias' && typeof populateAttributeDropdownVias === 'function')
        populateAttributeDropdownVias(window.currentViasGeoJSON);

    _invalidarColsCache();
    cerrarModal();
    updateAttributeTable();
    showNotification(`Columna "${nombre}" añadida`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// ✏️ RENOMBRAR COLUMNA
// ═══════════════════════════════════════════════════════════════

function abrirModalRenombrarColumna() {
    _cerrarMenuEditar();
    const geo = _getGeo();
    const cols = _getColsActuales();
    if (!cols.length) { showNotification('No hay columnas para renombrar', 'warning'); return; }

    _abrirModal('🔤 Renombrar columna', `
        <div class="mbox-row">
            <label>Columna a renombrar</label>
            <select id="m-ren-col">${cols.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <div class="mbox-row">
            <label>Nuevo nombre</label>
            <input id="m-ren-nuevo" type="text" placeholder="Escribe el nuevo nombre…">
        </div>
    `, () => {
        const viejo = document.getElementById('m-ren-col').value;
        const nuevo = document.getElementById('m-ren-nuevo').value.trim();
        if (!nuevo) { showNotification('Escribe el nuevo nombre', 'warning'); return; }
        if (nuevo === viejo) { cerrarModal(); return; }

        const g = _getGeo();
        g?.features?.forEach(f => {
            if (!f?.properties) return;
            if (viejo in f.properties) {
                f.properties[nuevo] = f.properties[viejo];
                delete f.properties[viejo];
            }
        });
        if (_tablaCapa === 'vias' && typeof viasData !== 'undefined') {
            viasData.atributos.delete(viejo);
            viasData.atributos.add(nuevo);
            if (typeof populateAttributeDropdownVias === 'function')
                populateAttributeDropdownVias(window.currentViasGeoJSON);
        }
        _invalidarColsCache();
        cerrarModal();
        updateAttributeTable();
        showNotification(`Columna renombrada: "${viejo}" → "${nuevo}"`, 'success');
    });
    setTimeout(() => document.getElementById('m-ren-nuevo')?.focus(), 50);
}

// ═══════════════════════════════════════════════════════════════
// 🗑️ ELIMINAR COLUMNA
// ═══════════════════════════════════════════════════════════════

function dropColumnFromLayer(layerId, col) {
    const geo = layerId === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo || !Array.isArray(geo.features)) return;
    _guardarBackupSiNecesario();
    geo.features.forEach(f => { if (f?.properties) delete f.properties[col]; });
    if (layerId === 'vias' && typeof viasData !== 'undefined') viasData.atributos.delete(col);
    if (layerId === 'vias' && typeof populateAttributeDropdownVias === 'function')
        populateAttributeDropdownVias(window.currentViasGeoJSON);
    _invalidarColsCache();
    updateAttributeTable();
    showNotification(`Columna "${col}" eliminada`, 'info');
    if (layerId === 'vias') _sincronizarViasConServidor();
}

function abrirModalEliminarColumna() {
    _cerrarMenuEditar();
    const cols = _getColsActuales();
    if (!cols.length) { showNotification('No hay columnas para eliminar', 'warning'); return; }

    _abrirModal('🗑️ Eliminar columna', `
        <div class="mbox-row">
            <label>Columna a eliminar</label>
            <select id="m-del-col">${cols.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <span class="mbox-hint" style="color:#e74c3c">⚠️ Esta acción eliminará la columna de todos los elementos. Usa Cancelar para deshacer.</span>
    `, () => {
        const col = document.getElementById('m-del-col').value;
        dropColumnFromLayer(_tablaCapa, col);
        cerrarModal();
    });
}

// ═══════════════════════════════════════════════════════════════
// ✏️ EDITAR VALORES (masivo)
// ═══════════════════════════════════════════════════════════════

function abrirModalEditarValores() {
    _cerrarMenuEditar();
    const geo = _getGeo();
    const cols = _tablaCapa === 'obstaculos' ? ['Nombre', 'Porcentaje'] : _getColsActuales();
    if (!geo?.features?.length) return;

    const optsCols = cols.map(c => `<option value="${c}">${c}</option>`).join('');
    const haySeleccion = _seleccion.size > 0;
    const scopeHint = haySeleccion
        ? `<span class="mbox-hint">Solo a los <strong>${_seleccion.size} elementos seleccionados</strong>.</span>`
        : `<span class="mbox-hint">A <strong>todos</strong> los elementos. Selecciona filas para limitar el alcance.</span>`;

    _abrirModal('✏️ Editar valores', `
        <div class="mbox-row">
            <label>Columna</label>
            <select id="m-edit-col" onchange="actualizarCampoOriginal()">${optsCols}</select>
        </div>
        <div class="mbox-row" id="m-edit-original-row">
            <label>Valor original <span style="font-weight:400">(vacío = aplicar a todos)</span></label>
            <input id="m-edit-original" type="text" placeholder="Ej: 0, None, residential…">
            <span class="mbox-hint" id="m-edit-col-hint"></span>
        </div>
        <div class="mbox-row">
            <label>Nuevo valor</label>
            <input id="m-edit-nuevo" type="text" placeholder="Ej: 50, Sin datos, primary…">
        </div>
        ${scopeHint}
    `, _confirmarEditarValores);
    actualizarCampoOriginal();
}

function actualizarCampoOriginal() {
    const col    = document.getElementById('m-edit-col')?.value;
    const hintEl = document.getElementById('m-edit-col-hint');
    const rowEl  = document.getElementById('m-edit-original-row');
    if (!col || !hintEl || !rowEl) return;

    const geo = _getGeo();
    if (!geo?.features) return;

    const valores = geo.features.map(f => f?.properties?.[col]).filter(v => v !== null && v !== undefined && v !== '');
    if (valores.length === 0) { rowEl.style.display = 'none'; return; }
    rowEl.style.display = '';
    const unicos = [...new Set(valores.map(String))].slice(0, 6);
    hintEl.textContent = 'Valores existentes: ' + unicos.join(', ') + (valores.length > 6 ? '…' : '');
}

function _confirmarEditarValores() {
    const col      = document.getElementById('m-edit-col')?.value;
    const original = document.getElementById('m-edit-original')?.value ?? '';
    const nuevo    = document.getElementById('m-edit-nuevo')?.value ?? '';
    if (!col) return;

    if (_tablaCapa === 'obstaculos') {
        _editarValoresObstaculos(col, original, nuevo);
        return;
    }

    const geo = _getGeo();
    if (!geo?.features) return;

    const colOculta     = document.getElementById('m-edit-original-row')?.style.display === 'none';
    const aplicarATodos = colOculta || original.trim() === '';
    const allFeats      = _getFeaturesActivas();
    const targets       = _seleccion.size > 0
        ? allFeats.filter((_, i) => _seleccion.has(geo.features.indexOf(allFeats[i])))
        : allFeats;

    let count = 0;
    targets.forEach(f => {
        if (!f?.properties) return;
        const matchStr = String(f.properties[col] ?? '');
        if (aplicarATodos || matchStr === original.trim()) {
            const n = Number(nuevo);
            f.properties[col] = (nuevo !== '' && !isNaN(n)) ? n : (nuevo === '' ? null : nuevo);
            count++;
        }
    });

    cerrarModal();
    updateAttributeTable();
    if (_tablaCapa === 'vias') _sincronizarViasConServidor();
    showNotification(`${count} valor(es) actualizado(s) en "${col}"`, 'success');
}

function _editarValoresObstaculos(col, original, nuevo) {
    const geo = window._currentObstaculosGeoJSON;
    if (!geo?.features) return;
    const colOculta     = document.getElementById('m-edit-original-row')?.style.display === 'none';
    const aplicarATodos = colOculta || original.trim() === '';
    const targets = _seleccion.size > 0
        ? geo.features.filter((_, i) => _seleccion.has(i))
        : geo.features;
    let count = 0;
    targets.forEach(f => {
        const p = f.properties;
        if (!aplicarATodos && String(p[col] ?? '') !== original.trim()) return;
        if (col === 'Porcentaje') {
            const num = parseInt(nuevo, 10);
            if (isNaN(num) || num < 0 || num > 100) {
                showNotification('⚠️ El porcentaje debe ser un número entre 0 y 100', 'warning');
                return;
            }
            p.Porcentaje = num;
            const obsRef = f._obsRef;
            if (obsRef) {
                obsRef.obstruccion = num / 100;
                const color = (typeof _colorObs === 'function') ? _colorObs(obsRef.obstruccion) : '#e67e22';
                if (obsRef.circulo) obsRef.circulo.setStyle({ color, fillColor: color });
                obsRef.segmentosBloqueados?.forEach(s => s.setStyle({ color }));
                if (typeof _actualizarListaObstaculos === 'function') _actualizarListaObstaculos();
            }
        } else if (col === 'Nombre') {
            const nuevoId = nuevo.trim() === '' ? null : nuevo.trim();
            p.Nombre = nuevoId ?? p.id;
            p._NombreEsExplicito = nuevoId !== null;
            const obsRef = f._obsRef;
            if (obsRef) {
                obsRef.obsId = nuevoId;
                if (typeof _actualizarListaObstaculos === 'function') _actualizarListaObstaculos();
            }
        }
        count++;
    });
    cerrarModal();
    _renderTablaObstaculos();
    showNotification(`${count} valor(es) actualizado(s) en "${col}"`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// ➕ AÑADIR FILA
// ═══════════════════════════════════════════════════════════════

function abrirModalAnadirFila() {
    _cerrarMenuEditar();
    if (_tablaCapa === 'obstaculos') {
        showNotification('Añade obstáculos desde el mapa', 'info');
        return;
    }
    const geo  = _getGeo();
    if (!geo?.features) return;
    const cols = _getColsActuales();

    const inputsHtml = cols.map(c => `
        <div class="mbox-row">
            <label>${c}</label>
            <input data-col="${c}" type="text" placeholder="null">
        </div>
    `).join('');

    _abrirModal('➕ Añadir fila', `
        <p style="font-size:12px;color:#7f8c8d;margin:0 0 10px">Rellena los campos para el nuevo elemento. Deja en blanco para null.</p>
        ${inputsHtml || '<p style="color:#7f8c8d">No hay columnas. Añade una columna primero.</p>'}
    `, () => {
        const inputs = document.querySelectorAll('#modal-body [data-col]');
        const props  = {};
        inputs.forEach(inp => {
            const v = inp.value.trim();
            const n = Number(v);
            props[inp.dataset.col] = v === '' ? null : (!isNaN(n) ? n : v);
        });
        // Geometría nula → punto en (0,0) — el usuario puede moverlo desde el mapa
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: props,
        };
        geo.features.push(feature);
        _invalidarColsCache();
        cerrarModal();
        updateAttributeTable();
        if (_tablaCapa === 'vias') _sincronizarViasConServidor();
        showNotification('Fila añadida (geometría en [0,0] — actualiza las coordenadas si es necesario)', 'success');
    });
}

// ═══════════════════════════════════════════════════════════════
// 📋 DUPLICAR FILA(S)
// ═══════════════════════════════════════════════════════════════

function duplicarFilasSeleccionadas() {
    _cerrarMenuEditar();
    if (_tablaCapa === 'obstaculos') { showNotification('No disponible para obstáculos', 'info'); return; }
    if (_seleccion.size === 0) { showNotification('Selecciona al menos una fila para duplicar', 'warning'); return; }

    const geo  = _getGeo();
    if (!geo?.features) return;
    _guardarBackupSiNecesario();

    const indices = [..._seleccion].sort((a, b) => a - b);
    const copias  = indices.map(i => JSON.parse(JSON.stringify(geo.features[i])));
    geo.features.push(...copias);

    limpiarSeleccion();
    _invalidarColsCache();
    updateAttributeTable();
    if (_tablaCapa === 'vias') _sincronizarViasConServidor();
    showNotification(`${copias.length} fila(s) duplicadas al final`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// 🗑️ ELIMINAR FILA(S) SELECCIONADAS
// ═══════════════════════════════════════════════════════════════

function eliminarFilasSeleccionadas() {
    _cerrarMenuEditar();
    if (_tablaCapa === 'obstaculos') { showNotification('Elimina obstáculos desde el mapa o la lista lateral', 'info'); return; }
    if (_seleccion.size === 0) { showNotification('Selecciona al menos una fila para eliminar', 'warning'); return; }

    _guardarBackupSiNecesario();
    const geo = _getGeo();
    if (!geo?.features) return;

    const total = _seleccion.size;
    geo.features = geo.features.filter((_, i) => !_seleccion.has(i));

    limpiarSeleccion();
    _invalidarColsCache();
    updateAttributeTable();
    if (_tablaCapa === 'vias') _sincronizarViasConServidor();
    showNotification(`${total} fila(s) eliminadas`, 'info');
}

// ═══════════════════════════════════════════════════════════════
// MODO ELIMINAR COLUMNAS (header con botón ✕)
// ═══════════════════════════════════════════════════════════════

function activarModoEliminarDesdeMenu() {
    _cerrarMenuEditar();
    if (_modoEliminar) return;
    _guardarBackupSiNecesario();
    _modoEliminar = true;
    updateAttributeTable();
}

function _salirModoEliminar() {
    const guardar = confirm('¿Deseas guardar los cambios?\n\n• Aceptar → se aplican\n• Cancelar → se restauran los datos originales');
    if (guardar) {
        if (_tablaCapa === 'vias') _sincronizarViasConServidor();
        showNotification('✅ Cambios guardados', 'success');
    } else {
        _restaurarBackup();
        showNotification('↩️ Cambios descartados', 'info');
    }
    _backupGeoJSON = null;
    _modoEliminar  = false;
    updateAttributeTable();
}

// ═══════════════════════════════════════════════════════════════
// EDICIÓN INLINE DE CELDA (doble clic)
// ═══════════════════════════════════════════════════════════════

/**
 * Convierte una <td> en un input editable inline.
 * Al confirmar (Enter o blur) actualiza la feature en memoria.
 */
function _activarEdicionCelda(td, featureIdx, col) {
    if (td.querySelector('input')) return; // ya editando
    const valorActual = td.textContent;
    const input = document.createElement('input');
    input.type  = 'text';
    input.value = valorActual;
    input.style.cssText = `
        width:100%; box-sizing:border-box;
        border:2px solid #3498db; border-radius:4px;
        padding:2px 6px; font:inherit;
        background:#eaf6ff; outline:none;
    `;

    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const confirmar = () => {
        const nuevoStr = input.value.trim();
        const n = Number(nuevoStr);
        const nuevoVal = nuevoStr === '' ? null : (!isNaN(n) ? n : nuevoStr);

        const geo = _getGeo();
        if (geo?.features?.[featureIdx]?.properties) {
            geo.features[featureIdx].properties[col] = nuevoVal;
        }
        td.textContent = nuevoStr;
        if (_tablaCapa === 'vias') _sincronizarViasConServidor();
    };

    const cancelar = () => { td.textContent = valorActual; };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); confirmar(); input.blur(); }
        if (e.key === 'Escape') { cancelar(); input.blur(); }
    });
    input.addEventListener('blur', () => {
        if (td.contains(input)) confirmar();
    });
}

// ═══════════════════════════════════════════════════════════════
// HABILITACIÓN BOTONES 📋
// ═══════════════════════════════════════════════════════════════

function populateTableLayerSelect() {
    const btnVias   = document.getElementById('btn-tabla-vias');
    const btnPuntos = document.getElementById('btn-tabla-puntos');
    if (btnVias)   btnVias.disabled   = !(window.currentViasGeoJSON?.features?.length   > 0);
    if (btnPuntos) btnPuntos.disabled = !(window.currentPuntosGeoJSON?.features?.length > 0);
    if (_tablaCapa) {
        const geo = _tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
        if (!geo?.features?.length) cerrarTabla();
    }
}

// ═══════════════════════════════════════════════════════════════
// PARSER SQL
// ═══════════════════════════════════════════════════════════════

function parsearSQL(sql, features) {
    if (!sql || !sql.trim()) return { ok: true, rows: features.slice(), total: features.length };
    sql = sql.trim();
    const upperSql = sql.toUpperCase();
    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WHERE') && !upperSql.startsWith('LIMIT')) {
        const q = sql.toLowerCase();
        const rows = features.filter(f =>
            f?.properties && Object.values(f.properties).some(v => String(v ?? '').toLowerCase().includes(q))
        );
        return { ok: true, rows, total: features.length };
    }
    let normalized = sql;
    if (upperSql.startsWith('WHERE') || upperSql.startsWith('LIMIT')) {
        normalized = 'SELECT * FROM _ ' + sql;
    }
    let limit  = null;
    let offset = 0;
    normalized = normalized.replace(/\bLIMIT\s+(\d+)\s*(?:OFFSET\s+(\d+))?/i, (_, l, o) => {
        limit  = parseInt(l, 10);
        offset = o ? parseInt(o, 10) : 0;
        return '';
    });
    const whereMatch = normalized.match(/\bWHERE\s+(.+?)(?:\s*(?:ORDER\s+BY|GROUP\s+BY|LIMIT|$))/is);
    const whereStr   = whereMatch ? whereMatch[1].trim() : null;
    let rows = whereStr ? features.filter(f => _evaluarWhere(f?.properties || {}, whereStr)) : features.slice();
    if (offset > 0) rows = rows.slice(offset);
    if (limit !== null) rows = rows.slice(0, limit);
    return { ok: true, rows, total: features.length };
}

function _evaluarWhere(props, whereStr) {
    try {
        const tokens = _tokenizar(whereStr);
        return _parseOr(props, tokens, { pos: 0 });
    } catch (e) { return true; }
}

function _tokenizar(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        if (/\s/.test(str[i])) { i++; continue; }
        if (str[i] === "'" || str[i] === '"') {
            const q = str[i++];
            let s = '';
            while (i < str.length && str[i] !== q) {
                if (str[i] === '\\') i++;
                s += str[i++];
            }
            i++;
            tokens.push({ type: 'STRING', value: s });
            continue;
        }
        if (/[\d.]/.test(str[i]) || (str[i] === '-' && /\d/.test(str[i+1] || ''))) {
            let n = '';
            if (str[i] === '-') n += str[i++];
            while (i < str.length && /[\d.]/.test(str[i])) n += str[i++];
            tokens.push({ type: 'NUMBER', value: parseFloat(n) });
            continue;
        }
        if (str.slice(i, i+2) === '!=') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue; }
        if (str.slice(i, i+2) === '<>') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue; }
        if (str.slice(i, i+2) === '>=') { tokens.push({ type: 'OP', value: '>=' }); i += 2; continue; }
        if (str.slice(i, i+2) === '<=') { tokens.push({ type: 'OP', value: '<=' }); i += 2; continue; }
        if ('=><!()'.includes(str[i])) { tokens.push({ type: 'OP', value: str[i] }); i++; continue; }
        let word = '';
        while (i < str.length && /[^\s=!<>()'",]/.test(str[i])) word += str[i++];
        if (!word) { i++; continue; }
        const upper = word.toUpperCase();
        if (upper === 'AND' || upper === 'OR') tokens.push({ type: upper, value: upper });
        else if (upper === 'LIKE')  tokens.push({ type: 'LIKE',  value: 'LIKE' });
        else if (upper === 'NOT')   tokens.push({ type: 'NOT',   value: 'NOT' });
        else if (upper === 'IS')    tokens.push({ type: 'IS',    value: 'IS' });
        else if (upper === 'NULL')  tokens.push({ type: 'NULL',  value: null });
        else if (upper === 'TRUE')  tokens.push({ type: 'BOOL',  value: true });
        else if (upper === 'FALSE') tokens.push({ type: 'BOOL',  value: false });
        else                        tokens.push({ type: 'IDENT', value: word });
    }
    return tokens;
}

function _parseOr(props, tokens, state) {
    let left = _parseAnd(props, tokens, state);
    while (state.pos < tokens.length && tokens[state.pos].type === 'OR') {
        state.pos++;
        const right = _parseAnd(props, tokens, state);
        left = left || right;
    }
    return left;
}

function _parseAnd(props, tokens, state) {
    let left = _parseExpr(props, tokens, state);
    while (state.pos < tokens.length && tokens[state.pos].type === 'AND') {
        state.pos++;
        const right = _parseExpr(props, tokens, state);
        left = left && right;
    }
    return left;
}

function _parseExpr(props, tokens, state) {
    if (state.pos < tokens.length && tokens[state.pos].value === '(') {
        state.pos++;
        const result = _parseOr(props, tokens, state);
        if (state.pos < tokens.length && tokens[state.pos].value === ')') state.pos++;
        return result;
    }
    if (state.pos < tokens.length && tokens[state.pos].type === 'NOT') {
        state.pos++;
        return !_parseExpr(props, tokens, state);
    }
    if (state.pos >= tokens.length || tokens[state.pos].type !== 'IDENT') return true;
    const field = tokens[state.pos++].value;
    const raw   = props[field];
    const val   = (raw === null || raw === undefined) ? null : raw;
    if (state.pos >= tokens.length) return Boolean(val);
    const tok = tokens[state.pos];
    if (tok.type === 'IS') {
        state.pos++;
        const negated = state.pos < tokens.length && tokens[state.pos].type === 'NOT';
        if (negated) state.pos++;
        if (state.pos < tokens.length && tokens[state.pos].type === 'NULL') state.pos++;
        return negated ? val !== null : val === null;
    }
    if (tok.type === 'LIKE') {
        state.pos++;
        const pattern = state.pos < tokens.length ? String(tokens[state.pos++].value) : '';
        const regex   = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return regex.test(String(val ?? ''));
    }
    if (tok.type === 'OP') {
        const op = tok.value; state.pos++;
        const rhs = state.pos < tokens.length ? tokens[state.pos++] : null;
        if (!rhs) return true;
        const rhsVal = rhs.value;
        const lNum = parseFloat(val);
        const rNum = parseFloat(rhsVal);
        const numericOp = !isNaN(lNum) && !isNaN(rNum) && op !== '=';
        if (numericOp) {
            if (op === '>')  return lNum >  rNum;
            if (op === '>=') return lNum >= rNum;
            if (op === '<')  return lNum <  rNum;
            if (op === '<=') return lNum <= rNum;
            if (op === '!=') return lNum !== rNum;
        }
        const lStr = String(val ?? '').toLowerCase();
        const rStr = String(rhsVal ?? '').toLowerCase();
        if (op === '=')  return lStr === rStr;
        if (op === '!=') return lStr !== rStr;
        if (op === '>')  return lStr >   rStr;
        if (op === '>=') return lStr >=  rStr;
        if (op === '<')  return lStr <   rStr;
        if (op === '<=') return lStr <=  rStr;
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════
// SELECCIÓN EN MAPA
// ═══════════════════════════════════════════════════════════════

function _aplicarSeleccion(indices) {
    _seleccion = indices;
    _dibujarResaltados();
    _actualizarInfoSeleccion();
}

function limpiarSeleccion() {
    _seleccion = new Set();
    if (_capaSeleccion && typeof map !== 'undefined') map.removeLayer(_capaSeleccion);
    _capaSeleccion = null;
    _actualizarInfoSeleccion();
}

function _actualizarInfoSeleccion() {
    const infoEl = document.getElementById('table-panel-info');
    if (!infoEl) return;
    const geo = _getGeo();
    const total = geo?.features?.length ?? 0;
    const shown = document.getElementById('table-body')?.querySelectorAll('tr').length ?? 0;
    const sel   = _seleccion.size;
    infoEl.textContent = sel > 0
        ? `${shown} / ${total} elementos  ·  ${sel} seleccionados`
        : `${shown} / ${total} elementos`;
}

function _dibujarResaltados() {
    if (typeof map === 'undefined' || typeof L === 'undefined') return;
    if (_capaSeleccion) map.removeLayer(_capaSeleccion);
    _capaSeleccion = L.layerGroup().addTo(map);

    const geo = _getGeo();
    if (!geo?.features) return;

    const estiloLinea = { color: '#00b4d8', weight: 5, opacity: 1 };
    const estiloPunto = { radius: 10, fillColor: '#00b4d8', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9 };

    _seleccion.forEach(idx => {
        const feature = geo.features[idx];
        if (!feature?.geometry) return;
        const geom = feature.geometry;
        try {
            if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
                L.geoJSON(feature, { style: () => estiloLinea }).addTo(_capaSeleccion);
            } else if (geom.type === 'Point') {
                const [lon, lat] = geom.coordinates;
                L.circleMarker([lat, lon], estiloPunto).addTo(_capaSeleccion);
            } else {
                L.geoJSON(feature, {
                    style: () => ({ ...estiloLinea, fillColor: '#00b4d8', fillOpacity: 0.35 }),
                    pointToLayer: (_, latlng) => L.circleMarker(latlng, estiloPunto),
                }).addTo(_capaSeleccion);
            }
        } catch (e) { /* geometría inválida */ }
    });
}

function _toggleSeleccionFila(idx, shiftKey) {
    if (!shiftKey) {
        if (_seleccion.size === 1 && _seleccion.has(idx)) _aplicarSeleccion(new Set());
        else _aplicarSeleccion(new Set([idx]));
    } else {
        const nueva = new Set(_seleccion);
        if (nueva.has(idx)) nueva.delete(idx);
        else                 nueva.add(idx);
        _aplicarSeleccion(nueva);
    }
}

// ═══════════════════════════════════════════════════════════════
// CACHÉ DE COLUMNAS
// ═══════════════════════════════════════════════════════════════

let _colsCacheKey = null;
let _colsCacheArr = null;

function _invalidarColsCache() { _colsCacheKey = null; _colsCacheArr = null; }

const _POI_COLS_ORDER = ['Nombre', 'Dirección', 'CP', 'Pedanía', 'tipo', 'Teléfono', 'email', 'URL'];

function _getColsActuales() {
    const features = _getFeaturesActivas();
    const cacheKey = `${_tablaCapa}|${_subcapaActual}|${features.length}`;
    if (_colsCacheKey === cacheKey && _colsCacheArr) return _colsCacheArr;

    const cols = new Set();
    for (const f of features) {
        if (f?.properties) Object.keys(f.properties).forEach(k => cols.add(k));
    }
    cols.delete('_capa');

    let arr;
    if (_tablaCapa === 'puntos') {
        const ordered = _POI_COLS_ORDER.filter(c => cols.has(c));
        const rest    = [...cols].filter(c => !_POI_COLS_ORDER.includes(c))
                                  .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        arr = [...ordered, ...rest];
    } else {
        arr = Array.from(cols);
    }

    _colsCacheKey = cacheKey;
    _colsCacheArr = arr;
    return arr;
}

// ═══════════════════════════════════════════════════════════════
// RENDERIZADO DE TABLA
// ═══════════════════════════════════════════════════════════════

function renderAttributeTable(geo, colsArr, featuresToRender) {
    const header = document.getElementById('table-header');
    const body   = document.getElementById('table-body');
    if (!header || !body) return;

    header.innerHTML = '';
    body.innerHTML   = '';

    const layerId = _tablaCapa || '';
    const todasCapas = layerId === 'puntos' && !_subcapaActual;
    let colsToUse = colsArr;

    if (todasCapas && featuresToRender.length > 0) {
        const union = new Set();
        for (const f of featuresToRender) {
            if (f?.properties) Object.keys(f.properties).forEach(k => union.add(k));
        }
        union.delete('_capa');
        const ordered = _POI_COLS_ORDER.filter(c => union.has(c));
        const rest    = [...union].filter(c => !_POI_COLS_ORDER.includes(c))
                                   .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        colsToUse = [...ordered, ...rest];
    }

    if (!colsToUse || colsToUse.length === 0) {
        header.innerHTML = '<tr><th>Sin atributos</th></tr>';
        body.innerHTML   = '<tr><td style="text-align:center;color:#7f8c8d;padding:16px;">Sin atributos en esta capa</td></tr>';
        _actualizarInfoSeleccion();
        return;
    }

    // ── Cabecera ──
    const trh = document.createElement('tr');

    // Columna de selección (checkbox)
    const thChk = document.createElement('th');
    thChk.style.cssText = 'width:28px;text-align:center;padding:4px;';
    const chkAll = document.createElement('input');
    chkAll.type  = 'checkbox';
    chkAll.title = 'Seleccionar/deseleccionar todo';
    chkAll.onchange = () => {
        if (chkAll.checked) {
            const todos = new Set(featuresToRender.map(f => geo.features.indexOf(f)).filter(i => i >= 0));
            _aplicarSeleccion(todos);
        } else {
            _aplicarSeleccion(new Set());
        }
        _repintarSeleccionFilas();
    };
    thChk.appendChild(chkAll);
    trh.appendChild(thChk);

    colsToUse.forEach(c => {
        const th    = document.createElement('th');
        th.style.cssText = 'position:relative;';
        const label = document.createElement('span');
        label.textContent = c;
        th.appendChild(label);

        if (_modoEliminar) {
            const btnDel = document.createElement('button');
            btnDel.textContent = '✕';
            btnDel.title = `Eliminar columna "${c}"`;
            btnDel.style.cssText = 'margin-left:5px;padding:1px 4px;font-size:10px;border:none;border-radius:3px;background:#e74c3c;color:#fff;cursor:pointer;vertical-align:middle;';
            btnDel.onclick = e => { e.stopPropagation(); dropColumnFromLayer(layerId, c); };
            th.appendChild(btnDel);
        } else {
            // Doble clic en cabecera → renombrar columna rápido
            th.title = 'Doble clic para renombrar';
            th.style.cursor = 'pointer';
            th.ondblclick = () => _renombrarColumnaRapido(c, th, colsToUse);
        }
        trh.appendChild(th);
    });
    header.appendChild(trh);

    // ── Filas ──
    const allFeatures = geo.features;
    featuresToRender.forEach(f => {
        const idx = allFeatures.indexOf(f);
        const tr  = document.createElement('tr');
        tr.dataset.featureIdx = idx;

        // Checkboxes de fila
        const tdChk = document.createElement('td');
        tdChk.style.cssText = 'text-align:center;padding:4px;';
        const chk = document.createElement('input');
        chk.type  = 'checkbox';
        chk.checked = _seleccion.has(idx);
        chk.onchange = e => {
            _toggleSeleccionFila(idx, false);
            _repintarSeleccionFilas();
            e.stopPropagation();
        };
        tdChk.appendChild(chk);
        tr.appendChild(tdChk);

        if (_seleccion.has(idx)) {
            tr.style.background    = '#caf0f8';
            tr.style.outline       = '2px solid #00b4d8';
            tr.style.outlineOffset = '-2px';
        }

        tr.onclick = e => {
            if (e.target.tagName === 'INPUT') return;
            _toggleSeleccionFila(idx, e.shiftKey);
            _repintarSeleccionFilas();
        };

        colsToUse.forEach(col => {
            const td = document.createElement('td');
            const v  = f?.properties?.[col];
            td.textContent = v != null ? String(v) : '';
            td.title = 'Doble clic para editar';
            td.style.cursor = 'cell';

            // Edición inline al doble clic
            td.ondblclick = e => {
                e.stopPropagation();
                if (_tablaCapa === 'obstaculos') return; // obstáculos: editar desde modal
                _activarEdicionCelda(td, idx, col);
            };
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });

    _actualizarInfoSeleccion();
}

/** Refresca el estado visual de filas seleccionadas sin re-renderizar todo */
function _repintarSeleccionFilas() {
    const geo = _getGeo();
    const rows = document.querySelectorAll('#table-body tr');
    rows.forEach(row => {
        const idx = parseInt(row.dataset.featureIdx, 10);
        const chk = row.querySelector('input[type=checkbox]');
        if (_seleccion.has(idx)) {
            row.style.background    = '#caf0f8';
            row.style.outline       = '2px solid #00b4d8';
            row.style.outlineOffset = '-2px';
            if (chk) chk.checked = true;
        } else {
            row.style.background    = '';
            row.style.outline       = '';
            row.style.outlineOffset = '';
            if (chk) chk.checked = false;
        }
    });
    _actualizarInfoSeleccion();
}

/** Renombrar columna con mini-input en la propia cabecera */
function _renombrarColumnaRapido(colActual, th, colsToUse) {
    const label = th.querySelector('span');
    if (!label || th.querySelector('input')) return;
    _guardarBackupSiNecesario();

    const input = document.createElement('input');
    input.type  = 'text';
    input.value = colActual;
    input.style.cssText = 'width:90%;border:2px solid #3498db;border-radius:4px;padding:1px 4px;font:inherit;font-size:11px;';
    label.replaceWith(input);
    input.focus();
    input.select();

    const confirmar = () => {
        const nuevo = input.value.trim();
        if (nuevo && nuevo !== colActual) {
            const g = _getGeo();
            g?.features?.forEach(f => {
                if (!f?.properties || !(colActual in f.properties)) return;
                f.properties[nuevo] = f.properties[colActual];
                delete f.properties[colActual];
            });
            if (_tablaCapa === 'vias' && typeof viasData !== 'undefined') {
                viasData.atributos.delete(colActual);
                viasData.atributos.add(nuevo);
                if (typeof populateAttributeDropdownVias === 'function')
                    populateAttributeDropdownVias(window.currentViasGeoJSON);
            }
            _invalidarColsCache();
            updateAttributeTable();
            showNotification(`Columna renombrada: "${colActual}" → "${nuevo}"`, 'success');
        } else {
            const span = document.createElement('span');
            span.textContent = colActual;
            input.replaceWith(span);
        }
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); confirmar(); }
        if (e.key === 'Escape') { const sp = document.createElement('span'); sp.textContent = colActual; input.replaceWith(sp); }
    });
    input.addEventListener('blur', confirmar);
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR TABLA
// ═══════════════════════════════════════════════════════════════

function updateAttributeTable() {
    if (!_tablaCapa) return;
    if (_tablaCapa === 'obstaculos') { _renderTablaObstaculos(); return; }

    const geo = _getGeo();
    if (!geo || !Array.isArray(geo.features) || geo.features.length === 0) {
        document.getElementById('table-header').innerHTML = '<tr><th>Sin datos</th></tr>';
        document.getElementById('table-body').innerHTML   = '<tr><td style="text-align:center;color:#7f8c8d;padding:16px;">Capa sin datos</td></tr>';
        return;
    }

    const features  = _getFeaturesActivas();
    const colsArr   = _getColsActuales();
    const sql       = document.getElementById('table-cmd')?.value || '';
    const result    = parsearSQL(sql, features);

    if (!result.ok) { showNotification('❌ Error en la consulta SQL', 'error'); return; }

    if (sql.trim()) {
        const indices = new Set(result.rows.map(f => geo.features.indexOf(f)).filter(i => i >= 0));
        _aplicarSeleccion(indices);
    }

    renderAttributeTable(geo, colsArr, result.rows);
}

function resetTableFilter() {
    const input = document.getElementById('table-cmd');
    if (input) input.value = '';
    limpiarSeleccion();
    updateAttributeTable();
}

// ═══════════════════════════════════════════════════════════════
// SINCRONIZACIÓN CON SERVIDOR
// ═══════════════════════════════════════════════════════════════

function _sincronizarViasConServidor() {
    const geo = window.currentViasGeoJSON;
    if (!geo) return;
    fetch('/api/actualizar-vias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geo),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) showNotification('⚠️ No se pudo guardar: ' + data.error, 'warning');
        else            showNotification('💾 vias_temp.geojson actualizado', 'success');
    })
    .catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// TABLA DE OBSTÁCULOS
// ═══════════════════════════════════════════════════════════════

function _obstaculosAGeoJSON() {
    if (typeof obstaculos === 'undefined') return null;
    const activos = obstaculos.filter(Boolean);
    if (!activos.length) return null;
    const features = activos.map((obs, rowIdx) => {
        const nombres = (typeof _nombresViasAfectadas === 'function') ? _nombresViasAfectadas(obs) : [];
        const esCruce = nombres.length > 1;
        const id      = rowIdx + 1;
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [obs.latlng.lng, obs.latlng.lat] },
            properties: {
                id,
                Nombre:             obs.obsId !== null ? obs.obsId : id,
                _NombreEsExplicito: obs.obsId !== null,
                coord_lat:          obs.latlng.lat,
                coord_lon:          obs.latlng.lng,
                Nivel:              _nivelObs(obs.obstruccion ?? 0.5),
                NivelDesc:          (typeof NIVELES_OBS !== 'undefined' ? (NIVELES_OBS[_nivelObs(obs.obstruccion ?? 0.5)]?.desc || '') : ''),
                Cruce:              esCruce ? 'Sí' : 'No',
                Calles:             nombres.join(';') || '—',
                Portal:             obs.portal || '',
            },
            _obsRef: obs,
        };
    });
    return { type: 'FeatureCollection', features };
}

const _OBS_COLS = ['id', 'Nombre', 'coord_lat', 'coord_lon', 'Nivel', 'NivelDesc', 'Cruce', 'Calles', 'Portal'];

function abrirTablaObstaculos() {
    const geo = _obstaculosAGeoJSON();
    if (!geo || !geo.features.length) {
        showNotification('No hay obstáculos para mostrar', 'warning');
        return;
    }
    const panel = document.getElementById('table-panel');
    const title = document.getElementById('table-panel-title');
    if (panel.classList.contains('open') && _tablaCapa === 'obstaculos') { cerrarTabla(); return; }

    _tablaCapa    = 'obstaculos';
    _modoEliminar = false;

    const puedeEditar = (window._userRol === 'registrado' || window._userRol === 'admin');
    const btnEditar   = document.getElementById('btn-editar');
    if (btnEditar) btnEditar.style.display = puedeEditar ? '' : 'none';

    if (title) title.textContent = '📋 Obstáculos';
    document.querySelectorAll('.btn-ver-tabla').forEach(b => b.classList.remove('active'));
    const btnActivo = document.getElementById('btn-tabla-obstaculos');
    if (btnActivo) btnActivo.classList.add('active');

    window._currentObstaculosGeoJSON = geo;
    _actualizarPosicionPanel();
    panel.classList.add('open');
    document.body.classList.add('tabla-abierta');
    document.getElementById('table-cmd').value = '';
    _renderTablaObstaculos();
}

function _renderTablaObstaculos() {
    const geo = _obstaculosAGeoJSON();
    window._currentObstaculosGeoJSON = geo;

    const header = document.getElementById('table-header');
    const body   = document.getElementById('table-body');
    const infoEl = document.getElementById('table-panel-info');
    if (!header || !body) return;

    header.innerHTML = '';
    body.innerHTML   = '';

    if (!geo || !geo.features.length) {
        header.innerHTML = '<tr><th>Sin obstáculos</th></tr>';
        body.innerHTML   = '<tr><td style="text-align:center;color:#7f8c8d;padding:16px;">No hay obstáculos creados</td></tr>';
        if (infoEl) infoEl.textContent = '';
        return;
    }

    const trh = document.createElement('tr');
    _OBS_COLS.forEach(c => {
        const th = document.createElement('th');
        th.textContent = c;
        trh.appendChild(th);
    });
    header.appendChild(trh);

    geo.features.forEach((f, idx) => {
        const p  = f.properties;
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Click para centrar en el mapa';
        tr.onclick = () => {
            const [lon, lat] = f.geometry.coordinates;
            if (typeof map !== 'undefined') map.setView([lat, lon], 17, { animate: true });
        };

        _OBS_COLS.forEach(col => {
            const td  = document.createElement('td');
            const val = p[col];
            if (col === 'id') {
                td.textContent = val;
                td.style.cssText = 'color:#95a5a6;text-align:center;font-weight:500;';
            } else if (col === 'Nombre') {
                const esExplicito = p._NombreEsExplicito;
                td.textContent = String(val);
                td.style.cssText = `font-weight:600;color:${esExplicito?'#2c3e50':'#95a5a6'};background:${esExplicito?'#fffde7':'#f4f4f4'};`;
                td.title = 'Usa Editar → Editar valores para modificar';
            } else if (col === 'coord_lat' || col === 'coord_lon') {
                td.textContent = val != null ? Number(val).toFixed(6) : '';
                td.style.cssText = 'text-align:right;font-family:monospace;color:#555;';
            } else {
                td.textContent = val != null ? String(val) : '';
            }
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });

    if (infoEl) infoEl.textContent = `${geo.features.length} obstáculo(s)`;
}

window.refrescarTablaObstaculosSiAbierta = function() {
    if (_tablaCapa === 'obstaculos') _renderTablaObstaculos();
};

// ═══════════════════════════════════════════════════════════════
// EXPORTAR AL SCOPE GLOBAL (compatibilidad con HTML inline)
// ═══════════════════════════════════════════════════════════════

window.abrirTabla                   = abrirTabla;
window.cerrarTabla                  = cerrarTabla;
window.abrirTablaObstaculos         = abrirTablaObstaculos;
window.updateAttributeTable         = updateAttributeTable;
window.resetTableFilter             = resetTableFilter;
window.populateTableLayerSelect     = populateTableLayerSelect;
window.limpiarSeleccion             = limpiarSeleccion;
window.dropColumnFromLayer          = dropColumnFromLayer;

// Menú Editar
window.toggleMenuEditar             = toggleMenuEditar;
window.abrirModalAnadir             = abrirModalAnadir;
window.abrirModalAnadirFila         = abrirModalAnadirFila;
window.abrirModalEditarValores      = abrirModalEditarValores;
window.abrirModalEliminarColumna    = abrirModalEliminarColumna;
window.abrirModalRenombrarColumna   = abrirModalRenombrarColumna;
window.duplicarFilasSeleccionadas   = duplicarFilasSeleccionadas;
window.eliminarFilasSeleccionadas   = eliminarFilasSeleccionadas;
window.activarModoEliminarDesdeMenu = activarModoEliminarDesdeMenu;
window.actualizarCampoOriginal      = actualizarCampoOriginal;

// Modal
window.cerrarModal                  = cerrarModal;
window.confirmarModal               = confirmarModal;