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
            '#georuta-toast-close:hover{color:#1a5276;}' +
            '#georuta-confirm-overlay{' +
            '  position:fixed;inset:0;z-index:299998;' +
            '  background:rgba(13,17,23,0.45);' +
            '  display:flex;align-items:center;justify-content:center;' +
            '  opacity:0;visibility:hidden;' +
            '  transition:opacity 0.18s ease,visibility 0.18s ease;' +
            '}' +
            '#georuta-confirm-overlay.gc-visible{opacity:1;visibility:visible;}' +
            '#georuta-confirm-box{' +
            '  width:min(360px,88vw);' +
            '  background:#fff;border-radius:14px;' +
            '  box-shadow:0 10px 36px rgba(0,0,0,0.25);' +
            '  font-family:var(--font-base,"Segoe UI",system-ui,sans-serif);' +
            '  padding:20px 20px 16px;' +
            '  transform:translateY(-8px);' +
            '  transition:transform 0.18s ease;' +
            '}' +
            '#georuta-confirm-overlay.gc-visible #georuta-confirm-box{transform:translateY(0);}' +
            '#georuta-confirm-titulo{' +
            '  font-size:15px;font-weight:700;color:#1a2733;margin-bottom:8px;' +
            '}' +
            '#georuta-confirm-texto{' +
            '  font-size:13px;color:#4a5a68;line-height:1.5;margin-bottom:18px;' +
            '}' +
            '#georuta-confirm-footer{' +
            '  display:flex;justify-content:flex-end;gap:10px;' +
            '}' +
            '#georuta-confirm-footer button{' +
            '  border:none;border-radius:8px;padding:8px 16px;' +
            '  font-size:13px;font-weight:600;cursor:pointer;' +
            '  transition:filter 0.15s;' +
            '}' +
            '#georuta-confirm-footer button:hover{filter:brightness(0.93);}' +
            '#georuta-confirm-cancelar{' +
            '  background:#eef1f4;color:#4a5a68;' +
            '}' +
            '#georuta-confirm-aceptar{' +
            '  background:#e74c3c;color:#fff;' +
            '}';
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
            if (e.key === 'Escape') {
                _hide();
                var overlay = document.getElementById('georuta-confirm-overlay');
                if (overlay && overlay.classList.contains('gc-visible')) _ocultarConfirm(false);
            }
        });
    }

    var _autoHideTimer = null;

    function _hide() {
        clearTimeout(_autoHideTimer);
        var el = document.getElementById('georuta-toast');
        if (el) el.classList.remove('gt-visible');
    }

    // ── Modal de confirmación (sustituye a window.confirm) ────────────────────
    function _buildConfirmDOM() {
        if (document.getElementById('georuta-confirm-overlay')) return;
        var el = document.createElement('div');
        el.id = 'georuta-confirm-overlay';
        el.innerHTML =
            '<div id="georuta-confirm-box">' +
            '  <div id="georuta-confirm-titulo">Confirmar</div>' +
            '  <div id="georuta-confirm-texto"></div>' +
            '  <div id="georuta-confirm-footer">' +
            '    <button id="georuta-confirm-cancelar">Cancelar</button>' +
            '    <button id="georuta-confirm-aceptar">Confirmar</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(el);

        // Cerrar al hacer click fuera de la caja
        el.addEventListener('click', function (e) {
            if (e.target === el) _ocultarConfirm(false);
        });
    }

    var _confirmCallback = null;

    function _ocultarConfirm(resultado) {
        var overlay = document.getElementById('georuta-confirm-overlay');
        if (overlay) overlay.classList.remove('gc-visible');
        var cb = _confirmCallback;
        _confirmCallback = null;
        if (typeof cb === 'function') cb(resultado);
    }

    /**
     * Modal de confirmación con el mismo estilo visual que el toast de aviso.
     * Sustituye a window.confirm() nativo (que muestra el feo "localhost dice:").
     * @param {string} texto        - Pregunta/mensaje de confirmación.
     * @param {function} callback   - Recibe true (confirmado) o false (cancelado).
     * @param {string} [titulo]     - Título (por defecto "Confirmar").
     * @param {string} [textoBoton] - Texto del botón de aceptar (por defecto "Confirmar").
     */
    window.confirmarAviso = function (texto, callback, titulo, textoBoton) {
        darEstilos();
        _buildConfirmDOM();

        document.getElementById('georuta-confirm-titulo').textContent = titulo || 'Confirmar';
        document.getElementById('georuta-confirm-texto').textContent  = texto  || '¿Estás seguro?';
        document.getElementById('georuta-confirm-aceptar').textContent = textoBoton || 'Confirmar';

        _confirmCallback = callback;

        var btnCancelar = document.getElementById('georuta-confirm-cancelar');
        var btnAceptar  = document.getElementById('georuta-confirm-aceptar');
        btnCancelar.onclick = function () { _ocultarConfirm(false); };
        btnAceptar.onclick  = function () { _ocultarConfirm(true); };

        document.getElementById('georuta-confirm-overlay').classList.add('gc-visible');
    };

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

    // ── Captura global de errores ──────────────────────────────────────────
    // Errores de JavaScript no controlados y fallos de carga de recursos
    // (scripts, hojas de estilo, imágenes...).
    window.addEventListener('error', function (e) {
        var objetivo = e.target || e.srcElement;

        // Fallo al cargar un recurso (script, css, img, etc.)
        if (objetivo && objetivo !== window && objetivo.tagName) {
            var url = objetivo.src || objetivo.href || '(desconocido)';
            window.aviso(
                'No se pudo cargar un recurso (' + objetivo.tagName.toLowerCase() + ')',
                url,
                'Error de carga',
                0
            );
            return;
        }

        // Error de JavaScript en tiempo de ejecución
        window.aviso(
            e.message || 'Error de JavaScript desconocido',
            (e.filename || '') + (e.lineno ? (':' + e.lineno + ':' + (e.colno || 0)) : ''),
            'Error',
            0
        );
    }, true);

    // Promesas rechazadas sin .catch (o cuyo .catch no informa al usuario)
    window.addEventListener('unhandledrejection', function (e) {
        var razon = e.reason;
        var msg = (razon && (razon.message || (razon.toString && razon.toString()))) || 'Error desconocido';
        window.aviso(msg, '', 'Error', 0);
    });

    // ── Interceptor de fetch ─────────────────────────────────────────────────
    // Avisa de fallos de conexión (servidor caído, ERR_CONNECTION_REFUSED, etc.)
    // y de respuestas HTTP de error, incluso si el código que llama a fetch
    // captura el error y no muestra nada.
    if (window.fetch && !window.fetch._georutaAvisoWrapped) {
        var _fetchOriginal = window.fetch;
        var fetchConAviso = function (recurso, opciones) {
            var url = (typeof recurso === 'string') ? recurso : (recurso && recurso.url) || '(desconocido)';

            return _fetchOriginal.apply(this, arguments).then(function (respuesta) {
                // 401 = "no autenticado". En esta app es el estado normal de
                // un Invitado (p.ej. /api/auth/me), no un fallo real: lo ignoramos.
                if (!respuesta.ok && respuesta.status !== 401) {
                    // Clonamos la respuesta para poder leer el cuerpo sin
                    // "consumirlo" — el código que llamó a fetch sigue
                    // pudiendo leer la respuesta original con normalidad.
                    respuesta.clone().json().then(function (cuerpo) {
                        var detalle = (cuerpo && cuerpo.error) ? cuerpo.error : url;
                        window.aviso(
                            detalle,
                            url,
                            'Error ' + respuesta.status,
                            0
                        );
                    }).catch(function () {
                        // El cuerpo no era JSON (p.ej. página de error HTML)
                        window.aviso(
                            'El servidor respondió con un error (' + respuesta.status + ')',
                            url,
                            'Error ' + respuesta.status,
                            0
                        );
                    });
                }
                return respuesta;
            }, function (error) {
                window.aviso(
                    'No se pudo conectar con el servidor',
                    url,
                    'Error de conexión',
                    0
                );
                throw error;
            });
        };
        fetchConAviso._georutaAvisoWrapped = true;
        window.fetch = fetchConAviso;
    }

})();