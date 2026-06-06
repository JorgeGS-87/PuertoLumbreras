/**
 * loader.js
 * Pantalla de carga
 */

(function () {
    'use strict';

    // ── Inyectar estilos una sola vez ────────────────────────────────────────
    function darEstilos() {
        if (document.getElementById('georuta-loader-styles')) return;
        var s = document.createElement('style');
        s.id = 'georuta-loader-styles';
        s.textContent = [
            '#georuta-loader{',
            '  position:fixed;inset:0;z-index:199999;',
            '  background:#0d1117;',
            '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;',
            '  font-family:var(--font-base,"Segoe UI",system-ui,sans-serif);',
            '  opacity:0.3;visibility:visible;',
            '  transition:opacity 0.45s ease,visibility 0.45s ease;',
            '  pointer-events:all;',
            '}',
            '#georuta-loader.gl-hidden{',
            '  opacity:0;visibility:hidden;pointer-events:none;',
            '}',
            '#georuta-loader .gl-logo{',
            '  font-size:52px;',
            '  animation:gl-pulse 1.6s ease-in-out infinite;',
            '}',
            '#georuta-loader .gl-title{',
            '  font-size:22px;font-weight:700;color:#e8ecf0;',
            '  letter-spacing:0.08em;text-transform:uppercase;text-align:center;',
            '}',
            '#georuta-loader .gl-subtitle{',
            '  font-size:12px;color:#5a6a7a;',
            '  letter-spacing:0.15em;text-transform:uppercase;',
            '  margin-top:6px;text-align:center;min-height:16px;',
            '}',
            '#georuta-loader .gl-bar-wrap{',
            '  width:200px;height:3px;background:#1e2a38;border-radius:2px;overflow:hidden;',
            '}',
            '#georuta-loader .gl-bar{',
            '  height:100%;width:0%;',
            '  background:linear-gradient(90deg,#3498db,#2ecc71);',
            '  border-radius:2px;transition:width 0.35s ease;',
            '}',
            '#georuta-loader .gl-status{',
            '  font-size:11px;color:#3d5166;letter-spacing:0.08em;',
            '}',
            '@keyframes gl-pulse{',
            '  0%,100%{transform:scale(1);opacity:1;}',
            '  50%{transform:scale(1.1);opacity:0.75;}',
            '}',
        ].join('');
        document.head.appendChild(s);
    }

    // ── Construir el DOM del loader ──────────────────────────────────────────
    function _buildDOM() {
        if (document.getElementById('georuta-loader')) return;
        var el = document.createElement('div');
        el.id = 'georuta-loader';
        el.classList.add('gl-hidden'); // empieza oculto
        el.innerHTML = [
            '<div class="gl-logo">&#x1F5FA;&#xFE0F;</div>',
            '<div>',
            '  <div class="gl-title"  id="gl-title">Cargando</div>',
            '  <div class="gl-subtitle" id="gl-subtitle"></div>',
            '</div>',
            '<div class="gl-bar-wrap">',
            '  <div class="gl-bar" id="gl-bar"></div>',
            '</div>',
            '<div class="gl-status" id="gl-status"></div>',
        ].join('');
        document.body.appendChild(el);
    }

    // ── Estado interno ───────────────────────────────────────────────────────
    var _autoTicker = null;

    function _startAutoTicker() {
        _stopAutoTicker();
        var pct = 0;
        var bar = document.getElementById('gl-bar');
        _autoTicker = setInterval(function () {
            if (pct < 85) {
                pct += (85 - pct) * 0.05;
                if (bar) bar.style.width = pct + '%';
            }
        }, 80);
    }

    function _stopAutoTicker() {
        if (_autoTicker) { clearInterval(_autoTicker); _autoTicker = null; }
    }

    // ── API pública ──────────────────────────────────────────────────────────
    window.GeoLoader = {

        /**
         * Muestra el overlay.
         * @param {string} titulo   - Texto principal (ej. 'Calculando ruta…')
         * @param {string} [subtitulo] - Texto secundario opcional
         */
        show: function (titulo, subtitulo) {
             darEstilos();
            _buildDOM();

            document.getElementById('gl-title').textContent    = titulo    || 'Cargando';
            document.getElementById('gl-subtitle').textContent = subtitulo || '';
            document.getElementById('gl-status').textContent   = '';
            document.getElementById('gl-bar').style.width      = '0%';

            var el = document.getElementById('georuta-loader');
            el.classList.remove('gl-hidden');

            _startAutoTicker();
        },

        /**
         * Actualiza solo el texto de estado (sin reabrir ni resetear la barra).
         * @param {string} texto
         */
        status: function (texto) {
            var s = document.getElementById('gl-status');
            if (s) s.textContent = texto || '';
        },

        /**
         * Mueve la barra al porcentaje indicado (0-100).
         * Detiene el ticker automático.
         * @param {number} pct
         */
        progress: function (pct) {
            _stopAutoTicker();
            var bar = document.getElementById('gl-bar');
            if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
        },

        /**
         * Oculta el overlay con fade-out (igual que el splash inicial).
         */
        hide: function () {
            _stopAutoTicker();
            var bar = document.getElementById('gl-bar');
            if (bar) bar.style.width = '100%';

            setTimeout(function () {
                var el = document.getElementById('georuta-loader');
                if (el) el.classList.add('gl-hidden');
            }, 200);
        },
    };

})();
