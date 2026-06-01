/**
 * main.js
 * Inicialización y configuración final de la aplicación
 */

console.log('🗺️ Visualizador GIS - Puerto Lumbreras cargado correctamente');

// Inicializar el sistema temporal (crea los layerGroups sobre el mapa)
// Se llama en DOMContentLoaded para garantizar que `map` ya existe
document.addEventListener('DOMContentLoaded', function () {
    if (typeof inicializarSistemaTemporal === 'function') {
        inicializarSistemaTemporal();
        console.log('✅ Sistema temporal inicializado');
    } else {
        console.warn('⚠️ inicializarSistemaTemporal no encontrada');
    }
});