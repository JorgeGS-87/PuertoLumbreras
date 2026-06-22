/**
 * layer-manager.js
 * Gestión de carga y visualización de capas (vías + puntos de interés)
 */

let puntosInteresLayerGroup = null;

window.currentViasGeoJSON   = null;
window.currentPuntosGeoJSON = null;

// ==================== CARGAR ARCHIVO AL SERVIDOR ====================

function cargarArchivo(tipo, input) {
    const file = input?.files?.[0];
    if (!file) return;

    if (tipo === 'puntos') {
        showNotification('Usa "Añadir POI" o "Importar" en el panel de capas', 'info');
        input.value = '';
        return;
    }

    const endpoints = { vias: '/api/cargar-vias' };
    const endpoint  = endpoints[tipo];
    if (!endpoint) { showNotification('Tipo de capa desconocido', 'error'); return; }

    const formData = new FormData();
    formData.append('file', file);

    const btnCargar   = document.getElementById('btn-cargar-vias');
    const btnEliminar = document.getElementById('btn-eliminar-vias');
    const btnConfig   = document.getElementById('btn-config-campos');
    if (btnCargar) { btnCargar.textContent = '⏳ Cargando...'; btnCargar.disabled = true; }

    if (tipo === 'vias' && window.GeoLoader) {
        window.GeoLoader.show('Cargando capa de Vías', file.name);
        window.GeoLoader.progress(15);
    }

    // Ocultar "Config. Campos" mientras se procesa la nueva capa: la
    // configuración anterior ya no es válida para los nuevos atributos
    if (btnConfig) btnConfig.style.display = 'none';
    window.camposRutaConfigurados = false;

    // Resetear cualquier modo de selección de origen/destino activo
    // (evita dejar el cursor en modo "elegir punto" tras cargar la capa)
    window._esperandoOrigen  = false;
    window._esperandoDestino = false;
    document.getElementById('map')?.classList.remove('cursor-origen', 'cursor-destino');
    if (typeof ocultarInstruccion === 'function') ocultarInstruccion();

    fetch(endpoint, { method: 'POST', body: formData })
        .then(r => {
            if (!r.ok) return r.text().then(t => Promise.reject(new Error('HTTP ' + r.status + ': ' + t)));
            return r.json();
        })
        .then(data => {
            if (data.error) {
                window.aviso(data.error, '', 'Error al cargar la capa');
                if (btnCargar) { btnCargar.textContent = '📂 Cargar Vías'; btnCargar.disabled = false; }
                if (tipo === 'vias' && window.GeoLoader) window.GeoLoader.hide();
                return;
            }

            if (tipo === 'vias' && window.GeoLoader) {
                window.GeoLoader.status('Construyendo el grafo de rutas…');
                window.GeoLoader.progress(55);
            }

            // Actualizar item de capa en el panel
            const layerItem = document.getElementById('layer-' + tipo);
            if (layerItem) {
                layerItem.classList.add('loaded');
                const desc = layerItem.querySelector('.layer-description');
                if (desc && tipo === 'vias') desc.textContent = `${data.total_vias ?? 0} vías cargadas`;
            }

            // Estadísticas del panel derecho
            if (tipo === 'vias') {
                const sv = document.getElementById('stat-vias');  if (sv) sv.textContent = data.total_vias  ?? 0;
                const sn = document.getElementById('stat-nodos'); if (sn) sn.textContent = data.nodos_grafo ?? 0;
            }

            // Mostrar Eliminar, ocultar Cargar
            if (btnCargar)   { btnCargar.textContent = '📂 Cargar Vías'; btnCargar.disabled = false; btnCargar.style.display = 'none'; }
            if (btnEliminar) { btnEliminar.style.display = ''; }
            if (btnConfig)   { btnConfig.style.display   = ''; }

            window.aviso(data.mensaje || 'Capa cargada', '', 'Capa cargada');

            if (tipo === 'vias' && window.GeoLoader) window.GeoLoader.status('Dibujando la capa en el mapa…');
            cargarEnMapa(tipo, tipo === 'vias');

            if (Array.isArray(data.bounds) && data.bounds.length === 4) {
                map.fitBounds([[data.bounds[1], data.bounds[0]], [data.bounds[3], data.bounds[2]]]);
            }
        })
        .catch(err => {
            window.aviso('No se pudo cargar la capa', err.message, 'Error');
            if (btnCargar) { btnCargar.textContent = '📂 Cargar Vías'; btnCargar.disabled = false; }
            if (tipo === 'vias' && window.GeoLoader) window.GeoLoader.hide();
            console.error('cargarArchivo error:', err);
        });
}

// ==================== ELIMINAR CAPA ====================

function eliminarCapa(tipo) {
    const labels    = { vias: 'Vías', puntos: 'Puntos de Interés' };
    const endpoints = { vias: '/api/eliminar-vias', puntos: '/api/eliminar-puntos-interes' };

    const ejecutarEliminacion = () => {
        fetch(endpoints[tipo], { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (tipo === 'vias') {
                    // Limpiar capa actual del mapa
                    if (viasLayer && map.hasLayer(viasLayer)) map.removeLayer(viasLayer);
                    viasLayer = null;
                    window.currentViasGeoJSON = null;
                    window.camposRutaConfigurados = false;

                    // Resetear cualquier modo de selección de origen/destino activo
                    // (evita dejar el cursor en modo "elegir punto" tras eliminar la capa)
                    window._esperandoOrigen  = false;
                    window._esperandoDestino = false;
                    document.getElementById('map')?.classList.remove('cursor-origen', 'cursor-destino');
                    if (typeof ocultarInstruccion === 'function') ocultarInstruccion();

                    const ul  = document.getElementById('legend-list');     if (ul)  ul.innerHTML  = '';
                    const chk = document.getElementById('check-vias');      if (chk) chk.checked   = false;
                    const fi  = document.getElementById('file-vias');       if (fi)  fi.value       = '';

                    const btnCargar   = document.getElementById('btn-cargar-vias');
                    const btnEliminar = document.getElementById('btn-eliminar-vias');
                    const btnConfig   = document.getElementById('btn-config-campos');
                    if (btnEliminar) btnEliminar.style.display = 'none';
                    if (btnConfig)   btnConfig.style.display   = 'none';

                    if (data.osm_restaurada) {
                        // El servidor ya recargó la capa por defecto (Vías_PuertoLumbreras)
                        // — actualizar estadísticas y recargarla en el mapa
                        const sv = document.getElementById('stat-vias');  if (sv) sv.textContent = data.total_vias  ?? 0;
                        const sn = document.getElementById('stat-nodos'); if (sn) sn.textContent = data.nodos_grafo ?? 0;
                        _resetLayerItem('layer-vias', `${data.total_vias ?? 0} vías (por defecto)`);
                        if (btnCargar) { btnCargar.style.display = ''; btnCargar.textContent = '📂 Cargar Vías'; }
                        cargarEnMapa('vias');
                        window.aviso('Capa eliminada — vías por defecto restauradas', '', 'Capa eliminada');
                    } else {
                        // Sin restauración por defecto: intentar igualmente recargar
                        // lo que el servidor tenga disponible para no dejar el mapa vacío
                        const sv = document.getElementById('stat-vias');  if (sv) sv.textContent = '0';
                        const sn = document.getElementById('stat-nodos'); if (sn) sn.textContent = '0';
                        _resetLayerItem('layer-vias', 'Sin cargar');
                        if (btnCargar) { btnCargar.style.display = ''; btnCargar.textContent = '📂 Cargar Vías'; }
                        cargarEnMapa('vias');
                        window.aviso('No hay capa de vías por defecto disponible', '', 'Capa eliminada');
                    }

                } else if (tipo === 'puntos') {
                    if (puntosInteresLayerGroup && map.hasLayer(puntosInteresLayerGroup)) map.removeLayer(puntosInteresLayerGroup);
                    puntosInteresLayerGroup = null;
                    window.currentPuntosGeoJSON = null;
                    const chk = document.getElementById('check-puntos'); if (chk) chk.checked   = false;
                    const sp  = document.getElementById('stat-puntos');  if (sp)  sp.textContent = '0';
                    const _nManuales = (typeof poisManuales !== 'undefined') ? poisManuales.filter(Boolean).length : 0;
                    _resetLayerItem('layer-puntos', _nManuales > 0 ? `${_nManuales} POI(s) manual(es)` : 'Sin añadir');
                    window.aviso('Capa eliminada', '', 'Capa eliminada');
                }

                populateTableLayerSelect();
            })
            .catch(err => {
                window.aviso('No se pudo eliminar la capa', err.message, 'Error');
                console.error('eliminarCapa error:', err);
            });
    };

    window.confirmarAviso(
        `¿Eliminar la capa "${labels[tipo]}"?`,
        (confirmado) => { if (confirmado) ejecutarEliminacion(); },
        'Eliminar capa',
        'Eliminar'
    );
}

// ==================== CARGAR EN MAPA ====================

function cargarEnMapa(tipo, mostrarLoader = false) {
    const endpoints = { vias: '/api/obtener-vias', puntos: '/api/obtener-puntos-interes' };
    const endpoint  = endpoints[tipo];
    if (!endpoint) return;

    fetch(endpoint)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(geojson => {
            if (!geojson || !geojson.type) {
                window.aviso('GeoJSON inválido', '', 'Error');
                if (mostrarLoader && window.GeoLoader) window.GeoLoader.hide();
                return;
            }

            // Reproyectar en cliente si el servidor devuelve coordenadas UTM
            try {
                if (_isLikelyProjected(geojson)) geojson = _reprojectGeoJSONFrom25830To4326(geojson);
            } catch (e) { console.error('Error reproyectando:', e); }

            if (tipo === 'vias') {
                window.currentViasGeoJSON = geojson;
                // Invalidar caché de pesos: nueva capa cargada
                if (window.GeoRutaSyncManager) GeoRutaSyncManager.cachearGrafo(geojson); // Actualiza grafo en IndexedDB para offline
                if (typeof window.invalidarPesosCache === 'function') window.invalidarPesosCache();
                if (typeof procesarVias === 'function') procesarVias(geojson);

                if (viasLayer) map.removeLayer(viasLayer);
                viasLayer = L.geoJSON(geojson, {
                    style: obtenerEstiloVia,
                    onEachFeature: function (feature, layer) {
                        const p = feature.properties || {};
                        layer.on('click', function(e) {
                            const tablaAbierta = document.getElementById('table-panel')?.classList.contains('open');
                            if (window._userRol === 'admin' && tablaAbierta) {
                                L.DomEvent.stopPropagation(e);
                                layer.bindPopup(`
                                    <div style="font-family:var(--font-base,sans-serif);min-width:160px;">
                                        <strong>${p.name || 'Sin nombre'}</strong><br>
                                        Tipo: ${p.highway || 'N/A'}<br>
                                        Vel. máx: ${p.maxspeed || 'N/A'} km/h<br>
                                        Carriles: ${p.lanes || 'N/A'}<br>
                                        Sentido único: ${p.oneway === 'yes' ? 'Sí' : 'No'}
                                    </div>
                                `).openPopup();
                            }
                        });
                    }
                }).addTo(map);

                const chk = document.getElementById('check-vias'); if (chk) chk.checked = true;
                populateAttributeDropdownVias(geojson);
                populateTableLayerSelect();
                const btnTablaVias = document.getElementById('btn-tabla-vias'); if (btnTablaVias) btnTablaVias.disabled = false;

                if (mostrarLoader && window.GeoLoader) window.GeoLoader.progress(90);

                // Autodetectar campos de ruta a partir de la capa cargada.
                // La visibilidad de "Config. Campos" la gestionan directamente
                // cargarArchivo() (al cargar) y eliminarCapa() (al eliminar).
                if (typeof autodetectarCamposRuta === 'function') autodetectarCamposRuta(geojson);
                if (mostrarLoader && window.GeoLoader) window.GeoLoader.hide();

            } else if (tipo === 'puntos') {
                if (puntosInteresLayerGroup) map.removeLayer(puntosInteresLayerGroup);
                window.currentPuntosGeoJSON = geojson;

                const capas        = geojson.capas || {};
                const colores      = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];
                const colorPorCapa = {};
                Object.keys(capas).forEach((nombre, i) => { colorPorCapa[nombre] = colores[i % colores.length]; });

                puntosInteresLayerGroup = L.layerGroup();
                geojson.features.forEach(feature => {
                    const capa  = feature.properties._capa || 'desconocido';
                    const color = colorPorCapa[capa] || '#95a5a6';
                    const marker = L.circleMarker(
                        [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
                        { radius: 6, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8 }
                    );
                    marker.feature = feature;
                    marker.on('click', function(e) {
                        const tablaAbierta = document.getElementById('table-panel')?.classList.contains('open');
                        if (window._userRol === 'admin' && tablaAbierta) {
                            L.DomEvent.stopPropagation(e);
                            marker.bindPopup(crearPopupPunto(feature.properties)).openPopup();
                        }
                    });
                    puntosInteresLayerGroup.addLayer(marker);
                });

                puntosInteresLayerGroup.addTo(map);
                window.puntosLayer = puntosInteresLayerGroup;

                const chk = document.getElementById('check-puntos'); if (chk) chk.checked = true;
                populateAttributeDropdownPuntos(geojson);
                populateTableLayerSelect();
                const btnTablaPuntos = document.getElementById('btn-tabla-puntos'); if (btnTablaPuntos) btnTablaPuntos.disabled = false;
                _actualizarDescriptorPuntos(geojson);
            }
        })
        .catch(err => {
            window.aviso('No se pudo obtener la capa', err.message, 'Error');
            if (mostrarLoader && window.GeoLoader) window.GeoLoader.hide();
            console.error('cargarEnMapa error:', err);
        });
}

// ==================== VISIBILIDAD ====================

function toggleLayerVisibility(tipo, visible) {
    if (tipo === 'vias' && viasLayer) {
        visible ? map.addLayer(viasLayer) : map.removeLayer(viasLayer);
    } else if (tipo === 'puntos' && puntosInteresLayerGroup) {
        visible ? map.addLayer(puntosInteresLayerGroup) : map.removeLayer(puntosInteresLayerGroup);
    } else if (tipo === 'obstaculos') {
        // Mostrar u ocultar todos los marcadores, círculos y segmentos de obstáculos
        if (typeof obstaculos === 'undefined') return;
        obstaculos.filter(Boolean).forEach(obs => {
            const fn = visible ? 'addLayer' : 'removeLayer';
            if (obs.marker)  map[fn](obs.marker);
            if (obs.circulo) map[fn](obs.circulo);
            obs.segmentosBloqueados?.forEach(s => map[fn](s));
        });
    } else if (tipo === 'pois') {
        // Mostrar u ocultar los marcadores de POIs manuales
        if (typeof poisManuales === 'undefined') return;
        poisManuales.filter(Boolean).forEach(poi => {
            if (!poi.marker) return;
            visible ? map.addLayer(poi.marker) : map.removeLayer(poi.marker);
        });
    }
}

// ==================== RECORTAR CAPA ====================

function recortarCapa(tipo, input) {
    const file = input.files[0];
    if (!file) return;

    showNotification('⏳ Recortando vías...', 'info');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('capa', tipo);

    fetch('/api/recortar-capa', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showNotification('❌ ' + data.error, 'error'); return; }

            showNotification('✅ ' + data.mensaje, 'success');

            // Recargar la capa recortada desde el servidor
            setTimeout(() => {
                if (viasLayer && map.hasLayer(viasLayer)) map.removeLayer(viasLayer);
                viasLayer = null;
                cargarEnMapa('vias');
                const sv = document.getElementById('stat-vias');  if (sv) sv.textContent = data.total_despues ?? 0;
                const sn = document.getElementById('stat-nodos'); if (sn) sn.textContent = data.nodos_grafo  ?? 0;
            }, 300);
        })
        .catch(err => showNotification('❌ Error al recortar: ' + err.message, 'error'))
        .finally(() => { input.value = ''; });
}

// ==================== HELPERS PRIVADOS ====================

function _labelCargar(tipo) {
    return tipo === 'vias' ? '📂 Cargar Vías' : '📂 Cargar Puntos';
}

function _resetLayerItem(id, texto) {
    const item = document.getElementById(id);
    if (!item) return;
    item.classList.remove('loaded');
    const desc = item.querySelector('.layer-description');
    if (desc) desc.textContent = texto;
}

// ==================== RECARGA DE PUNTOS DE INTERÉS ====================

/**
 * Recarga la capa de puntos de interés desde el servidor y la refresca en el mapa.
 * Llamado por poi-manager tras importar POIs o cuando se necesite sincronizar.
 * Mantiene los POIs manuales (marcadores Leaflet) intactos.
 */
function recargarPuntosInteres() {
    cargarEnMapa('puntos');
}

// Alias usado desde poi-manager.js (importarPoisDesdeArchivo)
window.recargarPuntosInteres = recargarPuntosInteres;
window.cargarCapaPuntos      = recargarPuntosInteres;

/**
 * Actualiza el descriptor de la capa puntos en el panel izquierdo
 * combinando las capas base del ZIP con los POIs manuales.
 * Se llama desde cargarEnMapa('puntos') al terminar de pintar.
 */
function _actualizarDescriptorPuntos(geojson) {
    const desc = document.getElementById('pois-manuales-desc');
    if (!desc) return;

    const totalBase     = geojson?.features?.length ?? 0;
    const totalManuales = (typeof poisManuales !== 'undefined') ? poisManuales.filter(Boolean).length : 0;

    if (totalBase > 0 && totalManuales > 0) {
        desc.textContent = `${totalBase} base · ${totalManuales} manual(es)`;
    } else if (totalBase > 0) {
        desc.textContent = `${totalBase} punto(s) cargados`;
    } else if (totalManuales > 0) {
        desc.textContent = `${totalManuales} POI(s) manual(es)`;
    } else {
        desc.textContent = 'Sin añadir';
    }
}