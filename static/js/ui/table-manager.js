/**
 * table-manager.js
 * Tabla de atributos en panel inferior (estilo ArcGIS Pro)
 * Consultas en SQL simplificado
 */

// Estado del módulo
let tablaCapa       = null;
let modoEliminar    = false;
let backupGeoJSON   = null;   // copia antes de entrar en modo eliminar
let seleccion       = new Set();  // índices de features seleccionadas
let capaSeleccion   = null;       // layerGroup Leaflet con los resaltados

// ==================== POSICIONAMIENTO (sigue al #map) ====================

function actualizarPosicionPanel() {
    const panel = document.getElementById('table-panel');
    const mapEl = document.getElementById('map');
    if (!panel || !mapEl) return;

    // Forzar reflow para obtener coordenadas actualizadas tras cambios de layout
    void mapEl.offsetWidth;
    const mapRect = mapEl.getBoundingClientRect();
    panel.style.left  = mapRect.left + 'px';
    panel.style.width = mapRect.width + 'px';
    panel.style.right = 'auto';
}

function iniciarObservadorMapa() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // Observar solo el #map (para cuando la tabla abre/cierra y el mapa cambia alto)
    if (window.ResizeObserver) {
        new ResizeObserver(() => requestAnimationFrame(actualizarPosicionPanel)).observe(mapEl);
    }

    // Suscribirse al hub central de layout para reaccionar al panel izquierdo y resize
    // El hub (ui-controls.js) ya observa #left-panel, body.class y window resize.
    if (typeof window.layoutHubSubscribe === 'function') {
        window.layoutHubSubscribe(actualizarPosicionPanel);
    } else {
        // Hub aún no inicializado (carga tardía): registrar callback pendiente
        window.layoutHubCallbacks = window.layoutHubCallbacks || [];
        window.layoutHubCallbacks.push(actualizarPosicionPanel);
    }

    actualizarPosicionPanel();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarObservadorMapa);
} else {
    setTimeout(iniciarObservadorMapa, 0);
}

// ==================== ABRIR / CERRAR PANEL ====================

function abrirTabla(layerId) {
    const geo = layerId === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo || !Array.isArray(geo.features) || geo.features.length === 0) {
        showNotification('Carga la capa antes de ver su tabla', 'warning');
        return;
    }

    const panel = document.getElementById('table-panel');
    const title = document.getElementById('table-panel-title');

    if (panel.classList.contains('open') && tablaCapa === layerId) {
        cerrarTabla();
        return;
    }

    tablaCapa    = layerId;
    modoEliminar = false;
    actualizarBtnEditar();

    const nombres = { vias: '🛣️ Red de Vías OSM', puntos: '🪧 Puntos de Interés' };
    if (title) title.textContent = '📋 ' + (nombres[layerId] || layerId);

    document.querySelectorAll('.btn-ver-tabla').forEach(b => b.classList.remove('active'));
    const btnActivo = document.getElementById('btn-tabla-' + layerId);
    if (btnActivo) btnActivo.classList.add('active');

    actualizarPosicionPanel();
    panel.classList.add('open');
    document.body.classList.add('tabla-abierta');
    if (window.userRol === 'admin') document.body.classList.add('admin-tabla-abierta');
    document.getElementById('table-cmd').value = '';
    updateAttributeTable();
}

function cerrarTabla() {
    document.getElementById('table-panel')?.classList.remove('open');
    document.querySelectorAll('.btn-ver-tabla').forEach(b => b.classList.remove('active'));
    document.body.classList.remove('tabla-abierta');
    document.body.classList.remove('admin-tabla-abierta');
    tablaCapa    = null;
    modoEliminar = false;
    actualizarBtnEditar();
    limpiarSeleccion();
    setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 350);
}

// ==================== MENÚ EDITAR ====================

let modalAccion = null;

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
    setTimeout(() => document.addEventListener('click', cerrarMenuEditar, { once: true }), 0);
}

function cerrarMenuEditar() {
    const menu = document.getElementById('edit-menu');
    if (menu) menu.style.display = 'none';
}

function activarModoEliminarDesdeMenu() {
    cerrarMenuEditar();
    if (modoEliminar) return;
    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    backupGeoJSON = geo ? JSON.parse(JSON.stringify(geo)) : null;
    modoEliminar  = true;
    actualizarBtnEditar();
    updateAttributeTable();
}

function salirModoEliminar() {
    const guardar = confirm('¿Deseas guardar los cambios en las columnas?\n\n• Aceptar -> se aplican\n• Cancelar -> se restauran las columnas originales');
    if (guardar) {
        if (tablaCapa === 'vias') sincronizarViasConServidor();
        showNotification('✅ Cambios guardados', 'success');
    } else {
        restaurarBackup();
        showNotification('↩️ Cambios descartados', 'info');
    }
    backupGeoJSON = null;
    modoEliminar  = false;
    actualizarBtnEditar();
    updateAttributeTable();
}

function actualizarBtnEditar() {
    const btn = document.getElementById('btn-editar');
    if (!btn) return;
    if (modoEliminar) {
        btn.classList.add('active');
        btn.textContent = '✕ Cancelar';
        btn.onclick     = () => salirModoEliminar();
    } else {
        btn.classList.remove('active');
        btn.textContent = '✏️ Editar';
        btn.onclick     = (e) => toggleMenuEditar(e);
    }
}

function restaurarBackup() {
    if (!backupGeoJSON) return;
    if (tablaCapa === 'puntos') {
        window.currentPuntosGeoJSON = backupGeoJSON;
    } else {
        window.currentViasGeoJSON = backupGeoJSON;
        if (typeof viasData !== 'undefined') {
            viasData.atributos.clear();
            backupGeoJSON.features.forEach(f => {
                if (f?.properties) Object.keys(f.properties).forEach(k => viasData.atributos.add(k));
            });
        }
        if (typeof cargarListaVias === 'function')
            cargarListaVias(window.currentViasGeoJSON);
    }
}

function guardarBackupSiNecesario() {
    if (backupGeoJSON) return;
    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    backupGeoJSON = geo ? JSON.parse(JSON.stringify(geo)) : null;
}

// ==================== MODAL AÑADIR COLUMNA ====================

function abrirModalAnadir() {
    cerrarMenuEditar();
    guardarBackupSiNecesario();
    document.getElementById('modal-title').textContent = '➕ Añadir columna';
    document.getElementById('modal-body').innerHTML = `
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
            <label>Valor por defecto <span style="font-weight:400;text-transform:none">(opcional)</span></label>
            <input id="m-col-default" type="text" placeholder="Dejar vacío para null">
            <span class="mbox-hint">Se aplicará a todos los elementos de la capa.</span>
        </div>
    `;
    modalAccion = confirmarAnadir;
    document.getElementById('table-edit-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('m-col-nombre')?.focus(), 50);
}

function confirmarAnadir() {
    const nombre = document.getElementById('m-col-nombre').value.trim();
    const tipo   = document.getElementById('m-col-tipo').value;
    const defRaw = document.getElementById('m-col-default').value.trim();
    if (!nombre) { showNotification('Escribe un nombre para la columna', 'warning'); return; }

    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo?.features) return;

    let defVal = null;
    if (defRaw !== '') {
        if (tipo === 'int')        defVal = parseInt(defRaw, 10)  || 0;
        else if (tipo === 'float') defVal = parseFloat(defRaw)    || 0.0;
        else                       defVal = defRaw;
    }

    geo.features.forEach(f => { if (f.properties) f.properties[nombre] = defVal; });
    if (tablaCapa === 'vias' && typeof viasData !== 'undefined') viasData.atributos.add(nombre);
    if (tablaCapa === 'vias' && typeof cargarListaVias === 'function')
        cargarListaVias(window.currentViasGeoJSON);

    cerrarModal();
    updateAttributeTable();
    showNotification(`Columna "${nombre}" añadida`, 'success');
}

// ==================== MODAL EDITAR VALORES ====================

function abrirModalEditarValores() {
    cerrarMenuEditar();
    guardarBackupSiNecesario();

    let geo, colsArr;
    if (tablaCapa === 'obstaculos') {
        geo = window.currentObstaculosGeoJSON;
        colsArr = ['Nombre', 'Porcentaje'];
    } else {
        geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
        const cols = new Set();
        geo?.features?.forEach(f => { if (f?.properties) Object.keys(f.properties).forEach(k => cols.add(k)); });
        colsArr = Array.from(cols);
    }
    if (!geo?.features?.length) return;

    const optsCols = colsArr.map(c => `<option value="${c}">${c}</option>`).join('');

    const haySeleccion = seleccion.size > 0;
    const scopeHint = haySeleccion
        ? `<span class="mbox-hint">Se aplicará solo a los <strong>${seleccion.size} elementos seleccionados</strong>.</span>`
        : `<span class="mbox-hint">Se aplicará a <strong>todos</strong> los elementos. Selecciona filas en la tabla para limitar el alcance.</span>`;

    document.getElementById('modal-title').textContent = '✏️ Editar valores';
    document.getElementById('modal-body').innerHTML = `
        <div class="mbox-row">
            <label>Columna</label>
            <select id="m-edit-col" onchange="actualizarCampoOriginal()">${optsCols}</select>
        </div>
        <div class="mbox-row" id="m-edit-original-row">
            <label>Valor original <span style="font-weight:400;text-transform:none">(vacío = aplicar a todos)</span></label>
            <input id="m-edit-original" type="text" placeholder="Ej: 0, None, residential…">
            <span class="mbox-hint" id="m-edit-col-hint"></span>
        </div>
        <div class="mbox-row">
            <label>Nuevo valor</label>
            <input id="m-edit-nuevo" type="text" placeholder="Ej: 50, Sin datos, primary…">
        </div>
        ${scopeHint}
    `;
    modalAccion = confirmarEditarValores;
    document.getElementById('table-edit-modal').style.display = 'flex';
    actualizarCampoOriginal();
}

function actualizarCampoOriginal() {
    const col    = document.getElementById('m-edit-col')?.value;
    const hintEl = document.getElementById('m-edit-col-hint');
    const rowEl  = document.getElementById('m-edit-original-row');
    if (!col || !hintEl || !rowEl) return;

    const geo = tablaCapa === 'obstaculos'
        ? window.currentObstaculosGeoJSON
        : (tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON);
    if (!geo?.features) return;

    const valores = geo.features.map(f => f?.properties?.[col]).filter(v => v !== null && v !== undefined && v !== '');
    if (valores.length === 0) {
        rowEl.style.display = 'none';
        return;
    }
    rowEl.style.display = '';
    const unicos = [...new Set(valores.map(String))].slice(0, 6);
    hintEl.textContent  = 'Valores existentes: ' + unicos.join(', ') + (valores.length > 6 ? '…' : '');
}

function confirmarEditarValores() {
    const col      = document.getElementById('m-edit-col')?.value;
    const original = document.getElementById('m-edit-original')?.value ?? '';
    const nuevo    = document.getElementById('m-edit-nuevo')?.value ?? '';
    if (!col) return;

    if (tablaCapa === 'obstaculos') {
        const geo = window.currentObstaculosGeoJSON;
        if (!geo?.features) return;
        const colOculta     = document.getElementById('m-edit-original-row')?.style.display === 'none';
        const aplicarATodos = colOculta || original.trim() === '';
        const targets = seleccion.size > 0
            ? geo.features.filter((_, i) => seleccion.has(i))
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
                const obsRef = f.obsRef;
                if (obsRef) {
                    obsRef.obstruccion = num / 100;
                    const color = (typeof colorObs === 'function') ? colorObs(obsRef.obstruccion) : '#e67e22';
                    if (obsRef.circulo) obsRef.circulo.setStyle({ color, fillColor: color });
                    obsRef.segmentosBloqueados?.forEach(s => s.setStyle({ color }));
                    if (typeof actualizarListaObstaculos === 'function') actualizarListaObstaculos();
                }
            } else if (col === 'Nombre') {
                const nuevoId = nuevo.trim() === '' ? null : nuevo.trim();
                p.Nombre = nuevoId ?? p.id;
                p.NombreEsExplicito = nuevoId !== null;
                const obsRef = f.obsRef;
                if (obsRef) {
                    obsRef.obsId = nuevoId;
                    if (typeof actualizarListaObstaculos === 'function') actualizarListaObstaculos();
                }
            }
            count++;
        });
        cerrarModal();
        renderTablaObstaculos();
        showNotification(`${count} valor(es) actualizado(s) en "${col}"`, 'success');
        return;
    }

    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo?.features) return;

    const colOculta    = document.getElementById('m-edit-original-row')?.style.display === 'none';
    const aplicarATodos = colOculta || original.trim() === '';
    const targets      = seleccion.size > 0
        ? geo.features.filter((_, i) => seleccion.has(i))
        : geo.features;

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
    if (tablaCapa === 'vias') sincronizarViasConServidor();
    showNotification(`${count} valor(es) actualizado(s) en "${col}"`, 'success');
}

// ==================== HELPERS MODAL ====================

function cerrarModal() {
    document.getElementById('table-edit-modal').style.display = 'none';
    modalAccion = null;
}

function confirmarModal() {
    if (typeof modalAccion === 'function') modalAccion();
}


// ==================== ELIMINAR COLUMNA ====================

function dropColumnFromLayer(layerId, col) {
    const geo = layerId === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo || !Array.isArray(geo.features)) return;

    geo.features.forEach(f => { if (f?.properties) delete f.properties[col]; });

    if (layerId === 'vias' && typeof viasData !== 'undefined') viasData.atributos.delete(col);
    if (layerId === 'vias' && typeof cargarListaVias === 'function')
        cargarListaVias(window.currentViasGeoJSON);

    updateAttributeTable();
    showNotification(`Columna "${col}" eliminada`, 'info');
    if (layerId === 'vias') sincronizarViasConServidor();
}

function sincronizarViasConServidor() {
    const geo = window.currentViasGeoJSON;
    if (!geo) return;
    fetch('/api/actualizar-vias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geo),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) showNotification('⚠️ No se pudo guardar: ' + data.error, 'warning');
        else            showNotification('💾 vias_temp.geojson actualizado', 'success');
    })
    .catch(() => {});
}

// ==================== HABILITACIÓN BOTONES 📋 ====================

function atributosTabla() {
    const btnVias   = document.getElementById('btn-tabla-vias');
    const btnPuntos = document.getElementById('btn-tabla-puntos');
    if (btnVias)   btnVias.disabled   = !(window.currentViasGeoJSON?.features?.length   > 0);
    if (btnPuntos) btnPuntos.disabled = !(window.currentPuntosGeoJSON?.features?.length > 0);
    if (tablaCapa) {
        const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
        if (!geo?.features?.length) cerrarTabla();
    }
}

// ==================== PARSER SQL ====================
/**
 * SQL soportado:
 *   SELECT * FROM capa [WHERE <condición>] [LIMIT n] [OFFSET n]
 *   SELECT * FROM capa   (sin WHERE -> todos, con LIMIT por defecto 100)
 *   <condición> ::= <expr> { AND|OR <expr> }
 *   <expr>      ::= campo = 'valor'
 *                 | campo != 'valor'
 *                 | campo > | >= | < | <= número
 *                 | campo LIKE '%patrón%'
 *                 | campo IS NULL
 *                 | campo IS NOT NULL
 *   También acepta consultas sin SELECT, solo la cláusula WHERE:
 *     WHERE highway = 'residential'
 *   Y consultas de solo LIMIT:
 *     LIMIT 50
 */

function parsearSQL(sql, features) {
    if (!sql || !sql.trim()) return { ok: true, rows: features.slice(0, 100), total: features.length };

    sql = sql.trim();

    // ── Normalizar: permitir escribir sólo la cláusula WHERE o LIMIT ──
    const upperSql = sql.toUpperCase();
    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WHERE') && !upperSql.startsWith('LIMIT')) {
        // Tratar como búsqueda libre en todos los campos (retrocompatibilidad)
        const q = sql.toLowerCase();
        const rows = features.filter(f =>
            f?.properties && Object.values(f.properties).some(v => String(v ?? '').toLowerCase().includes(q))
        );
        return { ok: true, rows, total: features.length };
    }

    // Si empieza por WHERE o LIMIT, anteponer SELECT ficticio para el parser
    let normalized = sql;
    if (upperSql.startsWith('WHERE') || upperSql.startsWith('LIMIT')) {
        normalized = 'SELECT * FROM  ' + sql;
    }

    // ── Extraer LIMIT y OFFSET ──
    let limit  = null;
    let offset = 0;
    normalized = normalized.replace(/\bLIMIT\s+(\d+)\s*(?:OFFSET\s+(\d+))?/i, (_, l, o) => {
        limit  = parseInt(l, 10);
        offset = o ? parseInt(o, 10) : 0;
        return '';
    });

    // ── Extraer cláusula WHERE ──
    const whereMatch = normalized.match(/\bWHERE\s+(.+?)(?:\s*(?:ORDER\s+BY|GROUP\s+BY|LIMIT|$))/is);
    const whereStr   = whereMatch ? whereMatch[1].trim() : null;

    // ── Filtrar ──
    let rows = whereStr ? features.filter(f => evaluarWhere(f?.properties || {}, whereStr)) : features.slice();

    // ── Aplicar OFFSET y LIMIT ──
    if (offset > 0) rows = rows.slice(offset);
    if (limit  !== null) rows = rows.slice(0, limit);
    else if (!whereStr)  rows = rows.slice(0, 100); // defecto sin WHERE

    return { ok: true, rows, total: features.length };
}

/**
 * Evalúa una cláusula WHERE completa (soporta AND / OR con precedencia estándar).
 * No usa eval() — es un parser recursivo de tokens.
 */
function evaluarWhere(props, whereStr) {
    try {
        const tokens = tokenizar(whereStr);
        const result = parseOr(props, tokens, { pos: 0 });
        return result;
    } catch (e) {
        return true; // Si hay error de sintaxis, dejar pasar la fila
    }
}

// ── Tokenizador ──
function tokenizar(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        // Espacios
        if (/\s/.test(str[i])) { i++; continue; }

        // Cadena entre comillas simples o dobles
        if (str[i] === "'" || str[i] === '"') {
            const q = str[i++];
            let s = '';
            while (i < str.length && str[i] !== q) {
                if (str[i] === '\\') i++;
                s += str[i++];
            }
            i++; // cerrar comilla
            tokens.push({ type: 'STRING', value: s });
            continue;
        }

        // Números
        if (/[\d.]/.test(str[i]) || (str[i] === '-' && /\d/.test(str[i+1] || ''))) {
            let n = '';
            if (str[i] === '-') n += str[i++];
            while (i < str.length && /[\d.]/.test(str[i])) n += str[i++];
            tokens.push({ type: 'NUMBER', value: parseFloat(n) });
            continue;
        }

        // Operadores multicarácter
        if (str.slice(i, i+2) === '!=') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue; }
        if (str.slice(i, i+2) === '<>') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue; }
        if (str.slice(i, i+2) === '>=') { tokens.push({ type: 'OP', value: '>=' }); i += 2; continue; }
        if (str.slice(i, i+2) === '<=') { tokens.push({ type: 'OP', value: '<=' }); i += 2; continue; }
        if ('=><!()'  .includes(str[i])) { tokens.push({ type: 'OP', value: str[i] }); i++; continue; }

        // Palabras clave e identificadores
        let word = '';
        while (i < str.length && /[^\s=!<>()'",]/.test(str[i])) word += str[i++];
        if (!word) { i++; continue; }

        const upper = word.toUpperCase();
        if (upper === 'AND' || upper === 'OR')       tokens.push({ type: upper,    value: upper });
        else if (upper === 'LIKE')                    tokens.push({ type: 'LIKE',   value: 'LIKE' });
        else if (upper === 'NOT')                     tokens.push({ type: 'NOT',    value: 'NOT' });
        else if (upper === 'IS')                      tokens.push({ type: 'IS',     value: 'IS' });
        else if (upper === 'NULL')                    tokens.push({ type: 'NULL',   value: null });
        else if (upper === 'TRUE')                    tokens.push({ type: 'BOOL',   value: true });
        else if (upper === 'FALSE')                   tokens.push({ type: 'BOOL',   value: false });
        else                                          tokens.push({ type: 'IDENT',  value: word });
    }
    return tokens;
}

// ── Parser de expresiones (OR menor precedencia, AND mayor) ──

function parseOr(props, tokens, state) {
    let left = parseAnd(props, tokens, state);
    while (state.pos < tokens.length && tokens[state.pos].type === 'OR') {
        state.pos++;
        const right = parseAnd(props, tokens, state);
        left = left || right;
    }
    return left;
}

function parseAnd(props, tokens, state) {
    let left = parseExpr(props, tokens, state);
    while (state.pos < tokens.length && tokens[state.pos].type === 'AND') {
        state.pos++;
        const right = parseExpr(props, tokens, state);
        left = left && right;
    }
    return left;
}

function parseExpr(props, tokens, state) {
    // Paréntesis
    if (state.pos < tokens.length && tokens[state.pos].value === '(') {
        state.pos++;
        const result = parseOr(props, tokens, state);
        if (state.pos < tokens.length && tokens[state.pos].value === ')') state.pos++;
        return result;
    }

    // NOT
    if (state.pos < tokens.length && tokens[state.pos].type === 'NOT') {
        state.pos++;
        return !_parseExpr(props, tokens, state);
    }

    // Identificador (campo)
    if (state.pos >= tokens.length || tokens[state.pos].type !== 'IDENT') return true;
    const field = tokens[state.pos++].value;
    const raw   = props[field];
    const val   = (raw === null || raw === undefined) ? null : raw;

    if (state.pos >= tokens.length) return Boolean(val);

    const tok = tokens[state.pos];

    // IS NULL / IS NOT NULL
    if (tok.type === 'IS') {
        state.pos++;
        const negated = state.pos < tokens.length && tokens[state.pos].type === 'NOT';
        if (negated) state.pos++;
        if (state.pos < tokens.length && tokens[state.pos].type === 'NULL') state.pos++;
        return negated ? val !== null : val === null;
    }

    // LIKE
    if (tok.type === 'LIKE') {
        state.pos++;
        const pattern = state.pos < tokens.length ? String(tokens[state.pos++].value) : '';
        const regex   = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return regex.test(String(val ?? ''));
    }

    // Operadores de comparación = != > >= < <=
    if (tok.type === 'OP') {
        const op = tok.value; state.pos++;
        const rhs = state.pos < tokens.length ? tokens[state.pos++] : null;
        if (!rhs) return true;
        const rhsVal = rhs.value;

        // Comparación numérica si ambos lados son números
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
        // Comparación de cadena
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

// ==================== SELECCIÓN EN MAPA ====================

/**
 * Aplica un Set de índices como selección activa y los resalta en el mapa.
 */
function aplicarSeleccion(indices) {
    seleccion = indices;
    dibujarResaltados();
    actualizarInfoSeleccion();
}

function limpiarSeleccion() {
    seleccion = new Set();
    if (capaSeleccion && typeof map !== 'undefined') {
        map.removeLayer(capaSeleccion);
    }
    capaSeleccion = null;
    actualizarInfoSeleccion();
}

function actualizarInfoSeleccion() {
    const infoEl = document.getElementById('table-panel-info');
    if (!infoEl) return;
    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    const total = geo?.features?.length ?? 0;
    const shown = document.getElementById('table-body')?.querySelectorAll('tr').length ?? 0;
    const sel   = seleccion.size;
    infoEl.textContent = sel > 0
        ? `${shown} / ${total} elementos  ·  ${sel} seleccionados`
        : `${shown} / ${total} elementos`;
}

function dibujarResaltados() {
    if (typeof map === 'undefined' || typeof L === 'undefined') return;

    if (capaSeleccion) map.removeLayer(capaSeleccion);
    capaSeleccion = L.layerGroup().addTo(map);

    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo?.features) return;

    const estiloLinea  = { color: '#00b4d8', weight: 5, opacity: 1 };
    const estiloPunto  = { radius: 10, fillColor: '#00b4d8', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9 };

    seleccion.forEach(idx => {
        const feature = geo.features[idx];
        if (!feature?.geometry) return;
        const geom = feature.geometry;

        try {
            if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
                L.geoJSON(feature, { style: () => estiloLinea }).addTo(capaSeleccion);
            } else if (geom.type === 'Point') {
                const [lon, lat] = geom.coordinates;
                L.circleMarker([lat, lon], estiloPunto).addTo(capaSeleccion);
            } else {
                L.geoJSON(feature, {
                    style:       () => ({ ...estiloLinea, fillColor: '#00b4d8', fillOpacity: 0.35 }),
                    pointToLayer: (_, latlon) => L.circleMarker(latlon, estiloPunto),
                }).addTo(capaSeleccion);
            }
        } catch (e) { /* feature con geometría inválida */ }
    });
}

/**
 * Alterna la selección de una fila (con Shift para multi-selección).
 */
function toggleSeleccionFila(idx, shiftKey) {
    if (!shiftKey) {
        // Click simple: si ya estaba sola seleccionada, deseleccionar; si no, seleccionar solo esta
        if (seleccion.size === 1 && seleccion.has(idx)) {
            aplicarSeleccion(new Set());
        } else {
            aplicarSeleccion(new Set([idx]));
        }
    } else {
        // Shift+Click: añadir/quitar de la selección múltiple
        const nueva = new Set(seleccion);
        if (nueva.has(idx)) nueva.delete(idx);
        else                 nueva.add(idx);
        aplicarSeleccion(nueva);
    }
}

// ==================== RENDERIZADO ====================

function renderAttributeTable(geo, colsArr, featuresToRender) {
    const header = document.getElementById('table-header');
    const body   = document.getElementById('table-body');
    const infoEl = document.getElementById('table-panel-info');
    if (!header || !body) return;

    header.innerHTML = '';
    body.innerHTML   = '';

    const layerId = tablaCapa || '';

    if (!colsArr || colsArr.length === 0) {
        header.innerHTML = '<tr><th>Sin atributos</th></tr>';
        body.innerHTML   = '<tr><td style="text-align:center;color:#7f8c8d;padding:16px;">Sin atributos en esta capa</td></tr>';
        if (infoEl) infoEl.textContent = '';
        return;
    }

    // Cabecera con botones x solo en modo eliminar
    const trh = document.createElement('tr');
    colsArr.forEach(c => {
        const th    = document.createElement('th');
        const label = document.createElement('span');
        label.textContent = c;
        th.appendChild(label);

        if (modoEliminar) {
            const btnDel = document.createElement('button');
            btnDel.textContent = '✕';
            btnDel.title = `Eliminar columna "${c}"`;
            btnDel.style.cssText = 'margin-left:5px;padding:1px 4px;font-size:10px;border:none;border-radius:3px;background:#e74c3c;color:#fff;cursor:pointer;vertical-align:middle;';
            btnDel.onclick = e => {
                e.stopPropagation();
                dropColumnFromLayer(layerId, c);
            };
            th.appendChild(btnDel);
        }
        trh.appendChild(th);
    });
    header.appendChild(trh);

    // Filas de datos — clicables para selección en mapa
    const allFeatures = geo.features;
    featuresToRender.forEach(f => {
        const idx = allFeatures.indexOf(f);
        const tr  = document.createElement('tr');

        tr.style.cursor = 'pointer';
        tr.title = 'Click · Shift+Click para selección múltiple';

        if (seleccion.has(idx)) {
            tr.style.background    = '#caf0f8';
            tr.style.outline       = '2px solid #00b4d8';
            tr.style.outlineOffset = '-2px';
        }

        tr.onclick = e => {
            toggleSeleccionFila(idx, e.shiftKey);
            document.querySelectorAll('#table-body tr').forEach((row, i) => {
                const fIdx = allFeatures.indexOf(featuresToRender[i]);
                if (seleccion.has(fIdx)) {
                    row.style.background    = '#caf0f8';
                    row.style.outline       = '2px solid #00b4d8';
                    row.style.outlineOffset = '-2px';
                } else {
                    row.style.background    = '';
                    row.style.outline       = '';
                    row.style.outlineOffset = '';
                }
            });
            actualizarInfoSeleccion();
        };

        colsArr.forEach(col => {
            const td = document.createElement('td');
            td.textContent = (f?.properties?.[col] != null) ? String(f.properties[col]) : '';
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });

    actualizarInfoSeleccion();
}

// ==================== ACTUALIZAR TABLA ====================

// ── Caché de columnas de la tabla ─────────────────────────────────────────
// Reconstruir el Set de columnas iterando todos los features es caro con
// capas grandes. Solo lo rehacemos cuando cambia la capa activa o su tamaño.
let colsCacheKey  = null;
let colsCacheArr  = null;

function invalidarColsCache() { colsCacheKey = null; colsCacheArr = null; }

function updateAttributeTable() {
    if (!tablaCapa) return;

    const geo = tablaCapa === 'puntos' ? window.currentPuntosGeoJSON : window.currentViasGeoJSON;
    if (!geo || !Array.isArray(geo.features) || geo.features.length === 0) {
        document.getElementById('table-header').innerHTML = '<tr><th>Sin datos</th></tr>';
        document.getElementById('table-body').innerHTML   = '<tr><td style="text-align:center;color:#7f8c8d;padding:16px;">Capa sin datos</td></tr>';
        return;
    }

    // Caché de columnas: solo reconstruir si cambia capa o nº de features
    const cacheKey = `${tablaCapa}|${geo.features.length}`;
    if (colsCacheKey !== cacheKey) {
        const cols = new Set();
        for (const f of geo.features) {
            if (f?.properties) Object.keys(f.properties).forEach(k => cols.add(k));
        }
        colsCacheArr = Array.from(cols);
        colsCacheKey = cacheKey;
    }

    const sql    = document.getElementById('table-cmd')?.value || '';
    const result = parsearSQL(sql, geo.features);

    if (!result.ok) {
        showNotification('❌ Error en la consulta SQL', 'error');
        return;
    }

    // Si hay consulta activa, resaltar automáticamente los resultados en el mapa
    if (sql.trim()) {
        const indices = new Set(result.rows.map(f => geo.features.indexOf(f)).filter(i => i >= 0));
        aplicarSeleccion(indices);
    }

    renderAttributeTable(geo, colsCacheArr, result.rows);
}


function resetTableFilter() {
    const input = document.getElementById('table-cmd');
    if (input) input.value = '';
    limpiarSeleccion();
    updateAttributeTable();
}

// ==================== TABLA DE OBSTÁCULOS ====================

/**
 * Construye un GeoJSON temporal desde el array global `obstaculos`
 * con las mismas columnas que el CSV: id, Nombre, coord_lat, coord_lon, Porcentaje, Cruce, Calles, Portal
 */
function obstaculosAGeoJSON() {
    if (typeof obstaculos === 'undefined') return null;
    const activos = obstaculos.filter(Boolean);
    if (!activos.length) return null;

    const features = activos.map((obs, rowIdx) => {
        const nombres  = (typeof nombresViasAfectadas === 'function') ? nombresViasAfectadas(obs) : [];
        const esCruce  = nombres.length > 1;
        const id       = rowIdx + 1;  // enumeración
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [obs.latlon.lng, obs.latlon.lat] },
            properties: {
                id,
                Nombre:           obs.obsId !== null ? obs.obsId : id,  // id como valor alternativo visual
                NombreEsExplicito: obs.obsId !== null,                  // indicador interno para la tabla
                coord_lat:        obs.latlon.lat,
                coord_lon:        obs.latlon.lng,
                Porcentaje:       Math.round((obs.obstruccion ?? 0.5) * 100),
                Cruce:            esCruce ? 'Sí' : 'No',
                Calles:           nombres.join(';') || '—',
                Portal:           obs.portal || '',
            },
            obsRef: obs,
        };
    });
    return { type: 'FeatureCollection', features };
}

/** Columnas fijas de la tabla de obstáculos — mismo orden que el CSV de exportación */
const OBS_COLS = ['id', 'Nombre', 'coord_lat', 'coord_lon', 'Porcentaje', 'Cruce', 'Calles', 'Portal'];

function abrirTablaObstaculos() {
    const geo = obstaculosAGeoJSON();
    if (!geo || !geo.features.length) {
        showNotification('No hay obstáculos para mostrar', 'warning');
        return;
    }

    const panel = document.getElementById('table-panel');
    const title = document.getElementById('table-panel-title');

    // Toggle: si ya está abierta con obstáculos, cerrar
    if (panel.classList.contains('open') && tablaCapa === 'obstaculos') {
        cerrarTabla();
        return;
    }

    tablaCapa    = 'obstaculos';
    modoEliminar = false;

    // El botón "Editar" solo se muestra si puede editar
    const puedeEditar = (window.userRol === 'registrado' || window.userRol === 'admin');
    const btnEditar   = document.getElementById('btn-editar');
    if (btnEditar) btnEditar.style.display = puedeEditar ? '' : 'none';

    if (title) title.textContent = '📋 Obstáculos';

    document.querySelectorAll('.btn-ver-tabla').forEach(b => b.classList.remove('active'));
    const btnActivo = document.getElementById('btn-tabla-obstaculos');
    if (btnActivo) btnActivo.classList.add('active');

    // Guardar GeoJSON temporal en una variable accesible por updateAttributeTable
    window.currentObstaculosGeoJSON = geo;

    actualizarPosicionPanel();
    panel.classList.add('open');
    document.body.classList.add('tabla-abierta');
    document.getElementById('table-cmd').value = '';
    renderTablaObstaculos();
}

function renderTablaObstaculos() {
    const geo = obstaculosAGeoJSON();
    window.currentObstaculosGeoJSON = geo;

    const header = document.getElementById('table-header');
    const body   = document.getElementById('table-body');
    const infoEl = document.getElementById('table-panel-info');
    if (!header || !body) return;

    header.innerHTML = '';
    body.innerHTML   = '';

    const puedeEditar = (window.userRol === 'registrado' || window.userRol === 'admin');

    if (!geo || !geo.features.length) {
        header.innerHTML = '<tr><th>Sin obstáculos</th></tr>';
        body.innerHTML   = '<tr><td style="text-align:center;color:#7f8c8d;padding:16px;">No hay obstáculos creados</td></tr>';
        if (infoEl) infoEl.textContent = '';
        return;
    }

    // Cabecera
    const trh = document.createElement('tr');
    OBS_COLS.forEach(c => {
        const th = document.createElement('th');
        th.textContent = c;
        trh.appendChild(th);
    });
    header.appendChild(trh);

    // Filas
    geo.features.forEach((f, idx) => {
        const p  = f.properties;
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Click para centrar en el mapa';

        tr.onclick = () => {
            const [lon, lat] = f.geometry.coordinates;
            if (typeof map !== 'undefined') map.setView([lat, lon], 17, { animate: true });
        };

        OBS_COLS.forEach(col => {
            const td = document.createElement('td');
            const val = p[col];

            if (col === 'id') {
                // Enumeración: solo lectura, estilo sutil
                td.textContent = val;
                td.style.color     = '#95a5a6';
                td.style.textAlign = 'center';
                td.style.fontWeight = '500';

            } else if (col === 'Nombre') {
                // Solo lectura — editable únicamente desde Editar -> Editar valores
                const esExplicito = p.NombreEsExplicito;
                td.textContent      = String(val);
                td.style.fontWeight = '600';
                td.style.color      = esExplicito ? '#2c3e50' : '#95a5a6';
                td.style.background = esExplicito ? '#fffde7' : '#f4f4f4';
                td.title = 'Usa Editar -> Editar valores para modificar el Nombre';

            } else if (col === 'Porcentaje') {
                // Solo lectura — editable únicamente desde Editar -> Editar valores
                const color = (typeof colorObs === 'function') ? colorObs((val ?? 50) / 100) : '#e67e22';
                td.textContent      = val !== null && val !== undefined ? String(val) + '%' : '';
                td.style.fontWeight = '700';
                td.style.color      = color;
                td.title = 'Usa Editar -> Editar valores para modificar el porcentaje';

            } else if (col === 'coord_lat' || col === 'coord_lon') {
                // Coordenadas: 6 decimales, alineadas a la derecha, fuente monoespaciada
                td.textContent      = val !== null && val !== undefined ? Number(val).toFixed(6) : '';
                td.style.textAlign  = 'right';
                td.style.fontFamily = 'monospace';
                td.style.color      = '#555';

            } else {
                td.textContent = val !== null && val !== undefined ? String(val) : '';
            }
            tr.appendChild(td);
        });

        body.appendChild(tr);
    });

    if (infoEl) infoEl.textContent = `${geo.features.length} obstáculo(s)`;
}

// Sobrescribir cerrarTabla para limpiar también el estado de obstáculos
const cerrarTablaOriginal = cerrarTabla;
cerrarTabla = function() {
    cerrarTablaOriginal();
    window.currentObstaculosGeoJSON = null;
    const btnActivo = document.getElementById('btn-tabla-obstaculos');
    if (btnActivo) btnActivo.classList.remove('active');
};

// Parchear updateAttributeTable para que también refresque obstáculos
const updateAttributeTableOriginal = updateAttributeTable;
updateAttributeTable = function() {
    if (tablaCapa === 'obstaculos') {
        renderTablaObstaculos();
        return;
    }
    updateAttributeTableOriginal();
};

// Exponer función para que actualizarListaObstaculos pueda refrescar la tabla
window.refrescarTablaObstaculosSiAbierta = function() {
    if (tablaCapa === 'obstaculos') renderTablaObstaculos();
};