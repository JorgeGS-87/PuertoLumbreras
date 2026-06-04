/**
 * projection-utils.js
 * Utilidades para detectar y reproyectar GeoJSON
 *
 * Sistema de referencia nativo del proyecto: EPSG:4258 — ETRS89 geográfico.
 * ETRS89 y WGS84 comparten el mismo elipsoide GRS80; sus coordenadas geográficas
 * difieren en menos de 1 metro en la Península Ibérica, por lo que Leaflet
 * (que trabaja en WGS84) las trata directamente sin conversión adicional.
 *
 * Si el servidor devuelve datos en coordenadas proyectadas (UTM zona 30 / EPSG:25830)
 * la función reproyectarGeoJSON se encarga de transformarlos a EPSG:4258 para
 * su uso en el mapa.
 */

// ── Definiciones proj4 ──────────────────────────────────────────────────────

/** Registra EPSG:4258 (ETRS89 geográfico) en proj4 */
function registrarETRS89() {
    try {
        proj4.defs(
            "EPSG:4258",
            "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs +type=crs"
        );
    } catch (e) { /* ya definido */ }
}

/** Registra EPSG:25830 (UTM zona 30N / ETRS89) en proj4 */
function registrarUTM30() {
    try {
        proj4.defs(
            "EPSG:25830",
            "+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs"
        );
    } catch (e) { /* ya definido */ }
}

// ── Detección ────────────────────────────────────────────────────────────────

// Extrae un par de coordenadas [x, y] de ejemplo de un GeoJSON, o null si no encuentra.
function CoordEjemplo(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) return null;
    for (const f of geojson.features) {
        if (!f || !f.geometry || !f.geometry.coordinates) continue;
        let c = f.geometry.coordinates;
        while (Array.isArray(c) && c.length && Array.isArray(c[0])) c = c[0];
        if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') return c;
    }
    return null;
}

/**
 * Detecta si el GeoJSON está en coordenadas proyectadas (métricas).
 * Valores > 10 000 en cualquier eje indican UTM u otra proyección plana.
 */
function puedeUTM(geojson) {
    const sample = CoordEjemplo(geojson);
    if (!sample) return false;
    const [a, b] = sample.map(Math.abs);
    return a > 10000 || b > 10000;
}

// ── Reproyección ─────────────────────────────────────────────────────────────

/**
 * Transforma un GeoJSON de EPSG:25830 (UTM 30N / ETRS89) a EPSG:4258
 * (ETRS89 geográfico), que Leaflet puede renderizar directamente.
 *
 * Sustituye a la antigua función reproyectarGeoJSON_25830To4326.
 * El resultado es semánticamente EPSG:4258; a efectos prácticos sus
 * valores numéricos son idénticos a EPSG:4326 en la Península Ibérica.
 */
function reproyectarGeoJSON(geojson) {
    registrarETRS89();
    registrarUTM30();

    const sistOrigen = "EPSG:25830";
    const sistDestino = "EPSG:4258";   // ← ETRS89 geográfico (proyecto)

    function recorrerCoord(coords) {
        if (typeof coords[0] === 'number') {
            const [x, y] = coords;
            const [lon, lat] = proj4(sistOrigen, sistDestino, [x, y]);
            return [lon, lat];
        }
        return coords.map(recorrerCoord);
    }

    const copia = JSON.parse(JSON.stringify(geojson));
    for (const f of copia.features) {
        if (f && f.geometry && f.geometry.coordinates) {
            f.geometry.coordinates = recorrerCoord(f.geometry.coordinates);
        }
    }
    return copia;
}

// Alias de compatibilidad — layer-manager.js llama a la función antigua
const reproyectarGeoJSON_25830To4326 = reproyectarGeoJSON;