// =============================================================================
// js/ui/search.js
// Búsqueda combinada de portales y vías (MSW) y gestión del cierre del panel.
// Depende de: map-config.js (map), route-manager.js (variables de ruta),
//             ui-controls.js (showNotification, mostrarInstruccionOrigen, …)
// =============================================================================


// ==================== CERRAR MSW ====================

/**
 * Oculta el panel de rutas flotante (MSW), limpia la ruta activa,
 * desactiva el modo obstáculo si estaba en marcha y resetea los labels.
 */
function cerrarMsw() {
    // Ocultar panel y restaurar botón "Cómo llegar"
    document.getElementById('msw-panel').style.display = 'none';
    const btnComoLlegar = document.querySelector('.msw-como-llegar-btn');
    if (btnComoLlegar) btnComoLlegar.style.display = 'inline-flex';

    // Detener modo obstáculo si estaba activo
    if (typeof modoObstaculo !== 'undefined' && modoObstaculo) {
        if (typeof desactivarModoObstaculo === 'function') desactivarModoObstaculo();
    }

    // Limpiar ruta y modo
    if (modoActual === 'ruta' || (typeof rutaLayer !== 'undefined' && rutaLayer)) {
        if (typeof limpiarRuta === 'function') limpiarRuta();
    }
    modoActual = 'navegar';
    if (typeof ocultarInstruccion === 'function') ocultarInstruccion();
    document.getElementById('map').classList.remove('cursor-origen', 'cursor-destino');

    // Limpiar labels de origen y destino
    const ol = document.getElementById('msw-origen-label');
    const dl = document.getElementById('msw-destino-label');
    if (ol) { ol.textContent = 'Elige un punto de origen…';  ol.classList.add('placeholder'); }
    if (dl) { dl.textContent = 'Elige un destino…';          dl.classList.add('placeholder'); }
    const panel = document.getElementById('msw-panel');
    if (panel) {
        panel.classList.remove('minimized');
    }
    _mswPanelMinimizado = false;
    actualizarMswToggleIcon();
}

let _mswPanelMinimizado = false;

function mostrarMswPanel() {
    const panel = document.getElementById('msw-panel');
    const btnComoLlegar = document.querySelector('.msw-como-llegar-btn');
    if (!panel) return;
    panel.style.display = 'block';
    panel.classList.remove('minimized');
    _mswPanelMinimizado = false;
    actualizarMswToggleIcon();
    if (btnComoLlegar) btnComoLlegar.style.display = 'none';
}

function toggleMswMinimizar() {
    const panel = document.getElementById('msw-panel');
    if (!panel) return;
    panel.classList.toggle('minimized');
    _mswPanelMinimizado = panel.classList.contains('minimized');
    actualizarMswToggleIcon();
}

function actualizarMswToggleIcon() {
    const btn = document.getElementById('msw-toggle-btn');
    if (!btn) return;
    btn.textContent = _mswPanelMinimizado ? '□' : '─';
    btn.title = _mswPanelMinimizado ? 'Maximizar panel' : 'Minimizar panel';
}


// ==================== BÚSQUEDA COMBINADA (portales + vías) ====================

/** Timer para el debounce de la búsqueda. */
let _buscarTimeout = null;

/** Capa temporal que resalta tramos de vía coincidentes. */
let _capaResaltada = null;

/** Marcador temporal para un portal exacto encontrado. */
let _markerPortal  = null;

/**
 * Punto de entrada principal del buscador.
 * Detecta si el usuario escribió un número al final (portal) o solo nombre (calle).
 *
 *  "Hernán Cortés 3"  → busca portal exacto en /api/buscar-portal
 *  "Hernán Cortés"    → busca tramos en GeoJSON de vías y portales en paralelo
 *
 * @param {string} texto - Texto introducido en el campo de búsqueda
 */
function buscarDireccion(texto) {
    clearTimeout(_buscarTimeout);
    if (_capaResaltada) { map.removeLayer(_capaResaltada); _capaResaltada = null; }
    if (_markerPortal)  { map.removeLayer(_markerPortal);  _markerPortal  = null; }

    const q = texto.trim();
    if (!q) { cerrarResultados(); return; }

    _buscarTimeout = setTimeout(() => _ejecutarBusqueda(q), 220);
}

/** Alias de compatibilidad (algunos sitios llaman buscarVia directamente). */
function buscarVia(texto) { buscarDireccion(texto); }

// ── Despachador interno ──────────────────────────────────────────────────────

/**
 * Decide si la cadena apunta a un portal (calle + número o separado por coma)
 * o a una búsqueda de tramos de vía sin número.
 *
 * @param {string} q - Texto ya limpiado con trim()
 */
function _ejecutarBusqueda(q) {
    // Si hay coma: "Calle Francia, 32" o "Calle Francia, "
    if (q.includes(',')) {
        const [nombreRaw, numeroRaw] = q.split(',');
        const nombre = nombreRaw.trim();   // "Calle Francia"
        const numero = numeroRaw ? numeroRaw.trim() : '';  // "32" o ""
        if (nombre) {
            if (numero) {
                // Número completo o parcial → buscar portal directamente
                const qPortal = `${nombre} ${numero}`;
                _buscarPortal(qPortal);  // busca "Calle Francia 32"
            } else {
                // Justo tras la coma, sin número → mostrar cuadrícula de portales de esa calle
                _mostrarNumerosPortal(nombre);
            }
        }
        return;
    }

    const partes      = q.trim().split(/\s+/);
    const ultimaParte = partes[partes.length - 1];
    const tieneNumero = /^\d+[a-zA-Z]?$/.test(ultimaParte) && partes.length > 1;

    if (tieneNumero) {
        _buscarPortal(q);
    } else {
        _buscarViasYPortales(q);
    }
}

// ── Búsqueda de portal exacto (calle + número) ──────────────────────────────

/**
 * Consulta el endpoint /api/buscar-portal con la cadena completa (nombre + número).
 * Si no hay resultados exactos, recae en la búsqueda mixta de tramos.
 *
 * @param {string} q - Consulta completa (p. ej. "Hernán Cortés 3")
 */
function _buscarPortal(q) {
    console.log('🔍 Buscando portal:', q);
    fetch('/api/buscar-portal?q=' + encodeURIComponent(q))
        .then(r => r.json())
        .then(data => {
            console.log('📍 Respuesta del servidor:', data);
            const resultados = data.resultados || [];
            console.log(`   ${resultados.length} resultado(s) encontrado(s)`);
            
            if (!resultados.length) {
                console.log('   Sin portal exacto, recayendo a búsqueda de tramos…');
                // Sin portal exacto → recaer en búsqueda de tramos de calle
                const partes = q.trim().split(/\s+/);
                partes.pop(); // quitar el número
                _buscarViasYPortales(partes.join(' '));
                return;
            }
            _mostrarResultadosPortales(resultados, q);
        })
        .catch(err => {
            console.error('❌ Error en búsqueda portal:', err);
            _buscarViasYPortales(q); // alternativo offline
        });
}

// ── Búsqueda mixta sin número ────────────────────────────────────────────────

/**
 * Busca tramos de vía en el GeoJSON local y portales en el servidor,
 * luego los mezcla en una lista de resultados.
 *
 * @param {string} nombre - Nombre parcial de calle a buscar
 */
function _buscarViasYPortales(nombre) {
    const q       = nombre.trim().toLowerCase();
    const viasGeo = window.currentViasGeoJSON;

    // Tramos de vía que coinciden con el nombre
    const agrupadas = {};
    if (viasGeo?.features?.length) {
        viasGeo.features
            .filter(f => (f.properties?.name || '').toLowerCase().includes(q))
            .forEach(f => {
                const n = f.properties.name || 'Sin nombre';
                if (!agrupadas[n]) agrupadas[n] = [];
                agrupadas[n].push(f);
            });
    }

    // Completar con portales del servidor (para calles sin geometría de vía)
    fetch('/api/buscar-portal?nombre=' + encodeURIComponent(nombre))
        .then(r => r.json())
        .then(data => {
            _mostrarResultadosMixtos(agrupadas, data.resultados || [], nombre);
        })
        .catch(() => _mostrarResultadosMixtos(agrupadas, [], nombre));
}

// ── Renderizado de resultados ────────────────────────────────────────────────

/**
 * Muestra en el desplegable una lista de portales exactos encontrados.
 * Si solo hay uno, hace zoom directo sin mostrar lista.
 *
 * @param {Array}  portales      - Array de portales devueltos por la API
 * @param {string} inputOriginal - Texto original del buscador
 */
function _mostrarResultadosPortales(portales, inputOriginal) {
    const el = document.getElementById('msw-resultados');
    el.innerHTML = '';

    // Único resultado exacto → zoom directo sin lista
    if (portales.length === 1) {
        console.log('✅ Portal único encontrado, haciendo zoom automático…', portales[0]);
        cerrarResultados();
        _zoomAPortal(portales[0]);
        return;
    }

    console.log(`📍 ${portales.length} portales encontrados, mostrando lista…`);
    portales.slice(0, 8).forEach(p => {
        const label  = `${_capitalizarVia(p.tipo_vial)} ${_capitalizarVia(p.nombre_via)}`;
        const numero = p.numero ? `, ${p.numero}` : '';
        const cp     = p.cod_postal ? ` · ${p.cod_postal}` : '';
        const item   = document.createElement('div');
        item.className = 'msw-resultado-item';
        item.innerHTML = `
            <span class="msw-resultado-icono">📍</span>
            <span class="msw-resultado-nombre">${label}${numero}</span>
            <span class="msw-resultado-count" style="color:#7f8c8d;font-size:11px;">${cp}</span>`;
        item.onclick = () => {
            console.log('User seleccionó portal:', p);
            document.getElementById('msw-input').value = `${label}${numero}`;
            cerrarResultados();
            _zoomAPortal(p);
        };
        el.appendChild(item);
    });

    el.style.display = 'block';
}

/**
 * Muestra en el desplegable una mezcla de tramos de vía (GeoJSON local)
 * y portales adicionales del servidor.
 *
 * @param {Object} agrupadas    - Mapa { nombreCalle: [features] }
 * @param {Array}  portalesExtra - Portales adicionales del servidor
 * @param {string} input         - Texto del buscador (para mostrar en el item)
 */
function _mostrarResultadosMixtos(agrupadas, portalesExtra, input) {
    const el         = document.getElementById('msw-resultados');
    const viaNombres = Object.keys(agrupadas);
    el.innerHTML = '';

    // Calles con geometría local
    viaNombres.slice(0, 5).forEach(nombre => {
        const features = agrupadas[nombre];
        const item = document.createElement('div');
        item.className = 'msw-resultado-item';
        item.innerHTML = `
            <span class="msw-resultado-icono">🛣️</span>
            <span class="msw-resultado-nombre">${nombre}</span>
            ${features.length > 1
                ? `<span class="msw-resultado-count">${features.length} tramos</span>`
                : ''}`;
        item.onclick = () => {
            document.getElementById('msw-input').value = nombre;
            cerrarResultados();
            zoomAFeatures(features);
        };
        el.appendChild(item);
    });

    if (!el.children.length) {
        el.innerHTML = '<div class="msw-resultado-vacio">Sin resultados</div>';
    }
    el.style.display = 'block';
}

// ── Zoom / marcador ──────────────────────────────────────────────────────────

/**
 * Coloca un marcador en las coordenadas del portal, abre su popup con
 * el botón "Cómo llegar" y centra el mapa en él.
 * El marcador se elimina automáticamente tras 8 segundos.
 *
 * @param {Object} portal - Objeto portal devuelto por la API
 */
function _zoomAPortal(portal) {
    console.log('🎯 _zoomAPortal llamado con:', portal);
    
    // Validar coordenadas
    if (!portal.lat || !portal.lon || isNaN(portal.lat) || isNaN(portal.lon)) {
        console.error('❌ Portal sin coordenadas válidas:', portal);
        showNotification('Error: coordenadas inválidas', 'error');
        return;
    }
    
    if (_markerPortal) { map.removeLayer(_markerPortal); _markerPortal = null; }
    
    const latlng = L.latLng(portal.lat, portal.lon);
    console.log('📍 Ubicación objetivo:', latlng);
    
    _markerPortal = L.marker(latlng, {
        icon: L.divIcon({
            className: 'marker-custom',
            html: `<div style="font-size:28px;text-shadow:2px 2px 6px rgba(0,0,0,.7);">📍</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 28]
        })
    }).addTo(map);

    const label   = `${_capitalizarVia(portal.tipo_vial)} ${_capitalizarVia(portal.nombre_via)}`;
    const numero  = portal.numero ? `, ${portal.numero}` : '';
    const popupId = 'popup-portal-' + Date.now();

    // Guardar en window para que los onclick del popup puedan acceder
    window._portalPopupData = { lat: portal.lat, lon: portal.lon, label, numero: portal.numero || '' };

    _markerPortal.bindPopup(
        `<div id="${popupId}" style="font-family:sans-serif;min-width:160px;">
            <strong>📍 ${label}${numero}</strong><br>
            <span style="color:#7f8c8d;font-size:11px;">${portal.cod_postal || ''} ${portal.municipio || ''}</span><br>
            <button onclick="window._colocarObstaculoDesdePortal()"
                style="margin-top:8px;width:100%;padding:6px 10px;background:linear-gradient(135deg,#e67e22,#f39c12);
                       color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;
                       display:flex;align-items:center;justify-content:center;gap:5px;">
                🚧 Colocar obstáculo
            </button>
            <button onclick="window._abrirComoLlegarDesdePortal(${portal.lat}, ${portal.lon})"
                style="margin-top:6px;width:100%;padding:6px 10px;background:linear-gradient(135deg,#8e44ad,#9b59b6);
                       color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;
                       display:flex;align-items:center;justify-content:center;gap:5px;">
                🧭 Cómo llegar
            </button>
        </div>`, { offset: [0, -20] }
    ).openPopup();

    console.log('🗺️ Haciendo setView a zoom 18…');
    map.setView(latlng, 18, { animate: true });

    // Auto-eliminar tras 8 s
    setTimeout(() => { if (_markerPortal) { map.removeLayer(_markerPortal); _markerPortal = null; } }, 8000);
}

/**
 * Devuelve el punto más cercano sobre la red viaria (currentViasGeoJSON)
 * al latlng dado. Itera todos los segmentos e interpola 20 puntos por
 * segmento para encontrar la proyección más precisa.
 * Si no hay red cargada devuelve el latlng original sin modificar.
 *
 * @param {L.LatLng} latlng
 * @returns {L.LatLng}
 */
function _snapAVia(latlng) {
    const geo = window.currentViasGeoJSON;
    if (!geo?.features?.length) return latlng;

    let mejorDist = Infinity;
    let mejorPunto = latlng;

    geo.features.forEach(f => {
        const coords = f?.geometry?.coordinates;
        if (!coords || f.geometry.type !== 'LineString') return;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = L.latLng(coords[i][1],   coords[i][0]);
            const p2 = L.latLng(coords[i+1][1], coords[i+1][0]);

            // Interpolar N puntos sobre el segmento y quedarse con el más cercano
            for (let t = 0; t <= 1; t += 0.05) {
                const pt = L.latLng(
                    p1.lat + t * (p2.lat - p1.lat),
                    p1.lng + t * (p2.lng - p1.lng)
                );
                const dist = latlng.distanceTo(pt);
                if (dist < mejorDist) {
                    mejorDist  = dist;
                    mejorPunto = pt;
                }
            }
        }
    });

    return mejorPunto;
}

/**
 * Llamada desde el botón "Colocar obstáculo" del popup de portal.
 * Cierra el popup, abre el modal de porcentaje y, al confirmar,
 * crea el obstáculo en las coordenadas del portal con su número guardado.
 */
window._colocarObstaculoDesdePortal = function () {
    const d = window._portalPopupData;
    if (!d) return;

    // Cerrar popup y marcador temporal del buscador
    if (typeof _markerPortal !== 'undefined' && _markerPortal) {
        map.closePopup();
        map.removeLayer(_markerPortal);
        _markerPortal = null;
    }

    // Snap al punto más cercano sobre la red viaria
    const latlng = _snapAVia(L.latLng(d.lat, d.lon));

    // Guardar el número de portal para pasarlo a crearObstaculo al confirmar
    window._portalPendiente = d.numero;

    // Parchear confirmarObstaculo puntualmente para inyectar el portal
    const _confirmarOriginal = window.confirmarObstaculo;
    window.confirmarObstaculo = function () {
        // Restaurar inmediatamente para no interferir con futuros obstáculos manuales
        window.confirmarObstaculo = _confirmarOriginal;

        const pct    = parseInt(document.getElementById('obstaculo-pct')?.value ?? 50, 10);
        const titulo = document.getElementById('obstaculo-titulo');
        const errEl  = document.getElementById('obstaculo-id-error');

        const textoTitulo = titulo?.textContent?.trim() ?? '';
        const matchId     = textoTitulo.match(/^🚧\s*Obstáculo\s*#([\w\-]+)$/);
        let obsId = null;
        if (matchId) {
            const parsed = matchId[1];
            if (typeof _obsIdEnUso === 'function' && _obsIdEnUso(parsed)) {
                if (errEl) { errEl.textContent = `El ID "${parsed}" ya está en uso. Cambia el título.`; errEl.style.display = 'block'; }
                // Re-parchear para que el usuario pueda reintentar
                window.confirmarObstaculo = arguments.callee;
                return;
            }
            obsId = parsed;
        }

        document.getElementById('obstaculo-modal').style.display = 'none';
        if (typeof crearObstaculo === 'function') {
            crearObstaculo(latlng, pct / 100, obsId, window._portalPendiente || '');
        }
        window._portalPendiente = null;
        if (typeof _latlngPendiente !== 'undefined') window._latlngPendiente = null;
    };

    // Abrir el modal de porcentaje
    if (typeof _pedirPorcentajeObstaculo === 'function') {
        _pedirPorcentajeObstaculo(latlng);
    }
};


/**
 * Resalta un conjunto de features de vía en el mapa y hace zoom para encuadrarlos.
 * La capa temporal se elimina automáticamente tras 4 segundos.
 *
 * @param {Array} features - Array de GeoJSON features a resaltar
 */
function zoomAFeatures(features) {
    if (_capaResaltada) map.removeLayer(_capaResaltada);
    _capaResaltada = L.geoJSON({ type: 'FeatureCollection', features }, {
        style: { color: '#e74c3c', weight: 5, opacity: 0.9 }
    }).addTo(map);
    map.fitBounds(_capaResaltada.getBounds(), { padding: [60, 60], maxZoom: 17 });
    setTimeout(() => { if (_capaResaltada) { map.removeLayer(_capaResaltada); _capaResaltada = null; } }, 4000);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convierte una cadena de texto a formato título, poniendo en mayúscula
 * la primera letra de cada palabra. Ejemplo: "HERNÁN CORTÉS" → "Hernán Cortés".
 *
 * @param {string} str - Cadena a capitalizar
 * @returns {string}
 */
function _capitalizarVia(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

/**
 * Muestra una cuadrícula de botones con los números de portal disponibles
 * para la calle indicada. Se llama cuando el usuario escribe la coma.
 *
 * @param {string} nombreCalle - Nombre de la calle (sin número)
 */
function _mostrarNumerosPortal(nombreCalle) {
    const el = document.getElementById('msw-resultados');
    el.innerHTML = '<div class="msw-resultado-vacio">🔢 Cargando números…</div>';
    el.style.display = 'block';

    fetch('/api/buscar-portal-numeros?nombre=' + encodeURIComponent(nombreCalle))
        .then(r => r.json())
        .then(data => {
            const nums = data.numeros || [];
            if (!nums.length) {
                el.innerHTML = '<div class="msw-resultado-vacio">Sin portales para esta calle</div>';
                return;
            }

            el.innerHTML = `
                <div style="padding:6px 14px 4px;font-size:11px;color:#7f8c8d;border-bottom:1px solid #f0f0f0;">
                    Portales de <strong>${_capitalizarVia(nombreCalle)}</strong> — elige un número:
                </div>
                <div id="msw-num-grid" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;max-height:200px;overflow-y:auto;"></div>`;

            const grid = document.getElementById('msw-num-grid');
            nums.forEach(num => {
                const btn = document.createElement('button');
                btn.textContent = num;
                btn.style.cssText = `
                    padding:5px 12px;border:1px solid #dde3ea;border-radius:20px;
                    background:#f8f9fa;cursor:pointer;font-size:12px;font-weight:600;
                    color:#2c3e50;transition:background .12s,color .12s,border-color .12s;`;
                btn.addEventListener('mouseover',  () => { btn.style.background = '#3498db'; btn.style.color = '#fff'; btn.style.borderColor = '#3498db'; });
                btn.addEventListener('mouseout',   () => { btn.style.background = '#f8f9fa'; btn.style.color = '#2c3e50'; btn.style.borderColor = '#dde3ea'; });
                btn.addEventListener('mousedown', e => {
                    e.preventDefault();
                    const inputEl = document.getElementById('msw-input');
                    if (inputEl) inputEl.value = `${_capitalizarVia(nombreCalle)}, ${num}`;
                    cerrarResultados();
                    _buscarPortal(`${nombreCalle} ${num}`);
                });
                grid.appendChild(btn);
            });
        })
        .catch(() => {
            el.innerHTML = '<div class="msw-resultado-vacio">Error al cargar portales</div>';
        });
}

/** Oculta el desplegable de resultados de búsqueda. */
function cerrarResultados() {
    document.getElementById('msw-resultados').style.display = 'none';
}

/**
 * Llamado desde el botón "Cómo llegar" del popup del marcador de búsqueda.
 * Cierra el popup/marcador y abre el widget de rutas con el punto como destino.
 *
 * @param {number} lat - Latitud del portal
 * @param {number} lon - Longitud del portal
 */
window._abrirComoLlegarDesdePortal = function (lat, lon) {
    console.log('🚀 _abrirComoLlegarDesdePortal llamado:', { lat, lon });
    
    // Limpiar marcador y capa resaltada de búsqueda
    if (_markerPortal)  { 
        console.log('  Eliminando marcador de portal');
        map.removeLayer(_markerPortal);  
        _markerPortal  = null; 
    }
    if (_capaResaltada) { 
        console.log('  Eliminando capa resaltada');
        map.removeLayer(_capaResaltada); 
        _capaResaltada = null; 
    }

    // Delegar en clickWidgetComoLlegar (map-widgets.js), que gestiona correctamente
    // todas las variables del ámbito de route-manager y el estado del panel MSW.
    const latlng = L.latLng(lat, lon);
    console.log('  Creado L.latLng:', latlng);
    
    if (typeof window.clickWidgetComoLlegar === 'function') {
        console.log('  ✅ clickWidgetComoLlegar existe, llamando…');
        window.clickWidgetComoLlegar(latlng);
    } else {
        console.error('  ❌ clickWidgetComoLlegar NO EXISTE');
    }
};

// Cerrar el desplegable al hacer clic fuera del widget de búsqueda
document.addEventListener('click', function (e) {
    if (!e.target.closest('#map-search-widget')) cerrarResultados();
});