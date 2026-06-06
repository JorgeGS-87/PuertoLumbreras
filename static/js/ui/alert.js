/**
 * alert.js
 * Toast de aviso en esquina superior derecha.
 * API: window.aviso(texto, subtexto)
 */

(function () {
    'use strict';

    // ── Estilos ──────────────────────────────────────────────────────────────
    function darEstilos() {
        if (document.getElementById('georuta-toast-styles')) return;
        var s = document.createElement('style');
        s.id = 'georuta-toast-styles';
        s.textContent =
            '#georuta-toast{' +
            '  position:fixed;top:18px;right:18px;z-index:299999;' +
            '  width:min(340px,90vw);' +
            '  background:#eaf4fd;' +
            '  border:1.5px solid #aed6f1;' +
            '  border-radius:12px;' +
            '  box-shadow:0 6px 24px rgba(52,152,219,0.18);' +
            '  font-family:var(--font-base,"Segoe UI",system-ui,sans-serif);' +
            '  display:flex;align-items:flex-start;gap:10px;' +
            '  padding:14px 14px 14px 16px;' +
            '  opacity:0;transform:translateY(-12px);' +
            '  transition:opacity 0.22s ease,transform 0.22s ease;' +
            '  pointer-events:none;' +
            '}' +
            '#georuta-toast.gt-visible{' +
            '  opacity:1;transform:translateY(0);pointer-events:auto;' +
            '}' +
            '#georuta-toast-icon{' +
            '  flex-shrink:0;margin-top:1px;' +
            '  width:22px;height:22px;' +
            '  border-radius:50%;' +
            '  border:2px solid #2980b9;' +
            '  display:flex;align-items:center;justify-content:center;' +
            '  color:#2980b9;font-size:13px;font-weight:900;line-height:1;' +
            '}' +
            '#georuta-toast-body{flex:1;min-width:0;}' +
            '#georuta-toast-titulo{' +
            '  font-size:14px;font-weight:700;color:#1a5276;margin-bottom:3px;' +
            '}' +
            '#georuta-toast-texto{' +
            '  font-size:12px;color:#2c3e50;line-height:1.5;' +
            '}' +
            '#georuta-toast-subtexto{' +
            '  font-size:11px;color:#5d8aa8;margin-top:4px;line-height:1.4;' +
            '}' +
            '#georuta-toast-close{' +
            '  flex-shrink:0;background:none;border:none;cursor:pointer;' +
            '  color:#7fb3d3;font-size:18px;line-height:1;padding:0;' +
            '  transition:color 0.15s;' +
            '}' +
            '#georuta-toast-close:hover{color:#1a5276;}';
        document.head.appendChild(s);
    }

    // ── DOM ──────────────────────────────────────────────────────────────────
    function _buildDOM() {
        if (document.getElementById('georuta-toast')) return;
        var el = document.createElement('div');
        el.id = 'georuta-toast';
        el.innerHTML =
            '<div id="georuta-toast-icon">i</div>' +
            '<div id="georuta-toast-body">' +
            '  <div id="georuta-toast-titulo">Aviso</div>' +
            '  <div id="georuta-toast-texto"></div>' +
            '  <div id="georuta-toast-subtexto"></div>' +
            '</div>' +
            '<button id="georuta-toast-close" title="Cerrar">&#x2715;</button>';
        document.body.appendChild(el);

        document.getElementById('georuta-toast-close').addEventListener('click', _hide);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') _hide();
        });
    }

    var _autoHideTimer = null;

    function _hide() {
        clearTimeout(_autoHideTimer);
        var el = document.getElementById('georuta-toast');
        if (el) el.classList.remove('gt-visible');
    }

    // ── API pública ──────────────────────────────────────────────────────────
    /**
     * Muestra el toast.
     * @param {string} texto      - Mensaje principal.
     * @param {string} [subtexto] - Detalle adicional opcional.
     * @param {string} [titulo]   - Título (por defecto "Aviso").
     * @param {number} [ms]       - Auto-cierre en ms (0 = sin auto-cierre).
     */
    window.aviso = function (texto, subtexto, titulo, ms) {
         darEstilos();
        _buildDOM();

        document.getElementById('georuta-toast-titulo').textContent   = titulo   || 'Aviso';
        document.getElementById('georuta-toast-texto').textContent    = texto    || '';
        document.getElementById('georuta-toast-subtexto').textContent = subtexto || '';

        var el = document.getElementById('georuta-toast');
        // Reiniciar animación si ya estaba visible
        el.classList.remove('gt-visible');
        void el.offsetWidth;
        el.classList.add('gt-visible');

        // Auto-cierre 6 s
        clearTimeout(_autoHideTimer);
        var delay = (ms === undefined) ? 6000 : ms;
        if (delay > 0) _autoHideTimer = setTimeout(_hide, delay);
    };

})();