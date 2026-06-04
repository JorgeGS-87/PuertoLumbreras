/**
 * tutorial.js — Tour guiado automático de GeoRuta (modo vídeo, v3)
 * ─────────────────────────────────────────────────────────────────
 * Arquitectura: cada paso define su propia función `accion()`.
 * El motor llama a accion() en onHighlightStarted y sólo avanza
 * al paso siguiente cuando accion() resuelve su promesa.
 * NO hay cadena paralela: acción y popover van siempre en sintonía.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
   *  ESTILOS
   * ═══════════════════════════════════════════════════════════════ */
  function inyectarEstilos() {
    if (document.getElementById('georuta-tutorial-styles')) return;
    var s = document.createElement('style');
    s.id = 'georuta-tutorial-styles';
    s.textContent = [
      'html body .driver-popover{background:#1a2535!important;border:1.5px solid #2980b9!important;',
      'border-radius:10px!important;box-shadow:0 8px 32px rgba(41,128,185,0.28),0 2px 10px rgba(0,0,0,0.55)!important;',
      'padding:0!important;max-width:340px!important;font-family:"Segoe UI",system-ui,sans-serif!important;color:#c8dff0!important;}',
      'html body .driver-popover-title{background:linear-gradient(135deg,#1c4f7a 0%,#2980b9 100%)!important;',
      'color:#e8f4fd!important;font-size:14px!important;font-weight:700!important;',
      'padding:12px 16px 11px!important;margin:0!important;border-radius:9px 9px 0 0!important;',
      'border-bottom:1px solid #2471a3!important;display:block!important;}',
      'html body .driver-popover-description{color:#c8dff0!important;font-size:13px!important;',
      'line-height:1.65!important;padding:13px 16px 10px!important;margin:0!important;}',
      'html body .driver-popover-description strong{color:#7ec8e3!important;font-weight:700!important;}',
      'html body .driver-popover-description code{background:rgba(52,152,219,0.20)!important;',
      'color:#85d4f5!important;border-radius:3px!important;padding:1px 5px!important;font-size:12px!important;}',
      'html body .driver-popover-progress-text{color:#5fa8d3!important;font-size:11px!important;',
      'padding:0 16px 8px!important;display:block!important;}',
      'html body .driver-popover-footer{background:#111d2b!important;border-top:1px solid #1e3a52!important;',
      'border-radius:0 0 9px 9px!important;padding:10px 14px!important;',
      'display:flex!important;align-items:center!important;gap:8px!important;margin:0!important;}',
      'html body .driver-popover-next-btn,html body .driver-popover-done-btn{',
      'background:#2980b9!important;color:#fff!important;border:none!important;',
      'border-radius:6px!important;font-size:12px!important;font-weight:600!important;',
      'padding:6px 14px!important;cursor:pointer!important;}',
      'html body .driver-popover-prev-btn{background:#1e3a52!important;color:#7ec8e3!important;',
      'border:none!important;border-radius:6px!important;font-size:12px!important;',
      'font-weight:600!important;padding:6px 14px!important;cursor:pointer!important;}',
      /* Cursor */
      '#tut-cursor{position:fixed;width:22px;height:22px;background:rgba(52,152,219,0.90);',
      'border:2px solid #fff;border-radius:50%;pointer-events:none;z-index:999999;',
      'transform:translate(-50%,-50%);',
      'transition:left 0.5s cubic-bezier(.4,0,.2,1),top 0.5s cubic-bezier(.4,0,.2,1);',
      'box-shadow:0 2px 12px rgba(52,152,219,0.55);display:none;}',
      '#tut-cursor.click{background:rgba(231,76,60,0.95)!important;',
      'transform:translate(-50%,-50%) scale(0.65)!important;transition:transform 0.1s,background 0.1s!important;}',
      /* Badge AUTO */
      'html body .tut-badge{display:inline-flex!important;align-items:center!important;gap:5px!important;',
      'background:rgba(39,174,96,0.18)!important;border:1px solid rgba(39,174,96,0.45)!important;',
      'border-radius:20px!important;color:#2ecc71!important;font-size:11px!important;',
      'font-weight:600!important;padding:3px 10px!important;margin-top:10px!important;}',
      /* Barra progreso */
      '#tut-bar-wrap{position:fixed;top:0;left:0;right:0;height:3px;z-index:999998;',
      'background:rgba(255,255,255,0.08);pointer-events:none;}',
      '#tut-bar{height:100%;background:linear-gradient(90deg,#3498db,#2ecc71);',
      'transition:width 0.4s ease;width:0%;}',
      /* Botón ? */
      'html body #btn-tutorial{width:40px!important;height:40px!important;border-radius:50%!important;',
      'border:2px solid rgba(52,152,219,0.50)!important;',
      'background:linear-gradient(135deg,#1c4f7a,#2980b9)!important;',
      'color:#e8f4fd!important;font-size:20px!important;font-weight:700!important;',
      'cursor:pointer!important;box-shadow:0 2px 8px rgba(41,128,185,0.35)!important;',
      'display:flex!important;align-items:center!important;justify-content:center!important;',
      'flex-shrink:0!important;padding:0!important;margin:0!important;',
      'transition:transform 0.15s,box-shadow 0.15s!important;}',
      'html body #btn-tutorial:hover{transform:scale(1.10)!important;',
      'box-shadow:0 4px 14px rgba(41,128,185,0.55)!important;}',
      /* Botón Saltar */
      'html body #tut-skip-btn{margin-right:auto!important;order:-1!important;',
      'background:transparent!important;border:1px solid rgba(94,160,200,0.40)!important;',
      'border-radius:5px!important;color:rgba(168,216,240,0.80)!important;',
      'font-size:11px!important;padding:5px 10px!important;cursor:pointer!important;}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════
   *  CURSOR SIMULADO
   * ═══════════════════════════════════════════════════════════════ */
  var cur = null;
  function initCur() {
    if (cur) return;
    cur = document.createElement('div');
    cur.id = 'tut-cursor';
    document.body.appendChild(cur);
  }
  function showCur(x, y) { if (!_cur) initCur(); cur.style.display = 'block'; cur.style.left = x + 'px'; cur.style.top = y + 'px'; }
  function hideCur() { if (cur) cur.style.display = 'none'; }

  /** Mueve el cursor animado hasta (x,y). Resuelve después de la transición CSS. */
  function mov(x, y) {
    return new Promise(function(res) { showCur(x, y); setTimeout(res, 580); });
  }

  /** Mueve el cursor al centro de un elemento y simula el click visual. */
  function click(el) {
    if (!el) return Promise.resolve();
    var r = el.getBoundingClientRect();
    return mov(r.left + r.width / 2, r.top + r.height / 2).then(function() {
      if (cur) { cur.classList.add('click'); setTimeout(function() { cur.classList.remove('click'); }, 180); }
      return wait(220);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   *  BARRA DE PROGRESO
   * ═══════════════════════════════════════════════════════════════ */
  var barEl;
  function initBar() {
    if (barEl) return;
    var w = document.createElement('div'); w.id = 'tut-bar-wrap';
    barEl = document.createElement('div'); barEl.id = 'tut-bar';
    w.appendChild(barEl); document.body.appendChild(w);
  }
  function setBar(cur, tot) { if (barEl) barEl.style.width = ((cur / tot) * 100) + '%'; }

  /* ═══════════════════════════════════════════════════════════════
   *  UTILIDADES
   * ═══════════════════════════════════════════════════════════════ */
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function waitFor(fn, iv, to) {
    iv = iv || 120; to = to || 15000;
    return new Promise(function(res, rej) {
      var t0 = Date.now(), id = setInterval(function() {
        if (fn()) { clearInterval(id); res(); }
        else if (Date.now() - t0 > to) { clearInterval(id); rej(); }
      }, iv);
    });
  }

  function cx(el) { if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }; var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /** Escribe text desde cero (borra el campo antes) */
  function type(inp, text) {
    inp.value = ''; inp.focus();
    var chars = text.split(''), i = 0;
    function step() { if (i >= chars.length) return Promise.resolve(); inp.value += chars[i++]; inp.dispatchEvent(new Event('input', { bubbles: true })); return wait(60).then(step); }
    return step();
  }

  /** Añade text al valor actual del campo (sin borrar) */
  function typeAppend(inp, text) {
    inp.focus();
    var chars = text.split(''), i = 0;
    function step() { if (i >= chars.length) return Promise.resolve(); inp.value += chars[i++]; inp.dispatchEvent(new Event('input', { bubbles: true })); return wait(60).then(step); }
    return step();
  }

  function badge(txt) {
    requestAnimationFrame(function() {
      var desc = document.querySelector('.driver-popover-description');
      if (!desc) return;
      var b = desc.querySelector('.tut-badge');
      if (!b) { b = document.createElement('div'); b.className = 'tut-badge'; desc.appendChild(b); }
      b.textContent = txt || ''; b.style.display = txt ? 'inline-flex' : 'none';
    });
  }

  /**
   * Quita temporalmente la capa oscura de Driver.js para que el usuario
   * vea el mapa con claridad. Llama a restaurarOverlay() para devolvérsela.
   */
  /* ── SPOTLIGHT ──────────────────────────────────────────────────
   * En vez de quitar todo el overlay, abrimos un "agujero" con forma
   * redondeada justo sobre el elemento o zona de interés, dejando el
   * resto de la pantalla oscurecido.
   *
   * Implementación: un <div> con clip-path: path(...) que recorta un
   * rectángulo redondeado sobre el rect del elemento.
   * Usamos una transición CSS en clip-path para animar el spotlight.
   * ─────────────────────────────────────────────────────────────── */

  var spotEl = null;   // el div de spotlight

  function ensureSpot() {
    if (spotEl) return spotEl;
    spotEl = document.createElement('div');
    spotEl.id = 'tut-spotlight';
    Object.assign(spotEl.style, {
      position:       'fixed',
      inset:          '0',
      pointerEvents:  'none',
      zIndex:         '99997',          // justo debajo del popover Driver (99998+)
      background:     'rgba(0,0,0,0)',  // transparente por defecto
      transition:     'background 0.5s ease',
    });
    document.body.appendChild(spotEl);
    return spotEl;
  }

  /**
   * Genera el valor de clip-path para recortar un rectángulo redondeado
   * definido por {left,top,width,height} con radio `r`.
   * El path cubre TODO menos ese rectángulo (regla even-odd con borde pantalla).
   */
  function spotPath(rect, r, pad) {
    pad = pad || 18;   // padding alrededor del elemento
    r   = r   || 16;
    var W = window.innerWidth, H = window.innerHeight;
    var x = rect.left - pad, y = rect.top - pad;
    var w = rect.width + pad * 2, h = rect.height + pad * 2;
    // Clampar al viewport
    x = Math.max(0, x); y = Math.max(0, y);
    if (x + w > W) w = W - x;
    if (y + h > H) h = H - y;
    var x2 = x + w, y2 = y + h;
    // Outer rectangle (pantalla completa) + inner rectangle redondeado (agujero)
    // SVG path even-odd: primero el exterior, luego el interior
    return 'path(evenodd, "' +
      'M 0 0 L ' + W + ' 0 L ' + W + ' ' + H + ' L 0 ' + H + ' Z ' +
      'M ' + (x+r) + ' ' + y + ' ' +
      'L ' + (x2-r) + ' ' + y + ' Q ' + x2 + ' ' + y + ' ' + x2 + ' ' + (y+r) + ' ' +
      'L ' + x2 + ' ' + (y2-r) + ' Q ' + x2 + ' ' + y2 + ' ' + (x2-r) + ' ' + y2 + ' ' +
      'L ' + (x+r) + ' ' + y2 + ' Q ' + x + ' ' + y2 + ' ' + x + ' ' + (y2-r) + ' ' +
      'L ' + x + ' ' + (y+r) + ' Q ' + x + ' ' + y + ' ' + (x+r) + ' ' + y + ' Z' +
      '")';
  }

  /**
   * Abre un spotlight sobre `elOrRect` (elemento DOM o {left,top,width,height}).
   * Oculta el overlay de Driver.js durante este tiempo.
   * Anima con fade-in del oscurecimiento + apertura del agujero.
   * durMs = duración de la animación de entrada.
   */
  function quitarOverlay(elOrRect, durMs) {
    durMs = durMs || 650;

    // Obtener rect
    var rect;
    if (elOrRect && typeof elOrRect.getBoundingClientRect === 'function') {
      rect = elOrRect.getBoundingClientRect();
    } else if (elOrRect && typeof elOrRect.left === 'number') {
      rect = elOrRect;
    } else {
      // Fallback: usar el elemento #map completo
      var mapEl = document.getElementById('map');
      rect = mapEl ? mapEl.getBoundingClientRect()
                   : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }

    // Ocultar overlay Driver.js (para que no compita)
    var ov = document.getElementById('driver-overlay') ||
             document.querySelector('.driver-overlay') ||
             document.querySelector('[class*="driver-overlay"]');
    if (ov) {
      ov.dataset.tutOvBak = ov.style.opacity || '';
      ov.style.transition = 'opacity ' + (durMs/1000).toFixed(2) + 's ease';
      ov.style.opacity    = '0';
      ov.style.pointerEvents = 'none';
    }

    // Crear/actualizar spotlight
    var sp = ensureSpot();
    // Estado inicial: sin oscurecimiento, sin agujero
    sp.style.transition  = 'none';
    sp.style.background  = 'rgba(0,0,0,0)';
    sp.style.clipPath    = '';
    sp.style.webkitClipPath = '';

    // Forzar reflow para que la transición arrange desde el estado inicial
    void sp.offsetWidth;

    sp.style.transition     = 'background ' + (durMs/1000).toFixed(2) + 's ease, ' +
                              '-webkit-clip-path ' + (durMs/1000).toFixed(2) + 's ease, ' +
                              'clip-path ' + (durMs/1000).toFixed(2) + 's ease';
    sp.style.background     = 'rgba(0,0,0,0.62)';
    var path = spotPath(rect, 16, 20);
    sp.style.clipPath        = path;
    sp.style.webkitClipPath  = path;

    return wait(durMs);
  }

  /**
   * Cierra el spotlight con fade-out suave y restaura el overlay de Driver.js.
   */
  function restaurarOverlay(durMs) {
    durMs = durMs || 500;

    var sp = spotEl;
    if (sp) {
      sp.style.transition    = 'background ' + (durMs/1000).toFixed(2) + 's ease, ' +
                               '-webkit-clip-path ' + (durMs/1000).toFixed(2) + 's ease, ' +
                               'clip-path ' + (durMs/1000).toFixed(2) + 's ease';
      sp.style.background    = 'rgba(0,0,0,0)';
      sp.style.clipPath       = '';
      sp.style.webkitClipPath = '';
    }

    var ov = document.getElementById('driver-overlay') ||
             document.querySelector('.driver-overlay') ||
             document.querySelector('[class*="driver-overlay"]');
    if (ov) {
      ov.style.transition    = 'opacity ' + (durMs/1000).toFixed(2) + 's ease';
      ov.style.opacity       = ov.dataset.tutOvBak || '';
      ov.style.pointerEvents = '';
    }

    return wait(durMs).then(function() {
      if (sp) { sp.style.transition = 'none'; }
      if (ov) { ov.style.transition = ''; }
    });
  }

  function skipBtn(destroyFn) {
    requestAnimationFrame(function() {
      if (document.getElementById('tut-skip-btn')) return;
      var f = document.querySelector('.driver-popover-footer'); if (!f) return;
      var b = document.createElement('button'); b.id = 'tut-skip-btn'; b.textContent = 'Saltar';
      b.addEventListener('click', destroyFn); f.insertBefore(b, f.firstChild);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   *  ACCIONES DE DOMINIO
   * ═══════════════════════════════════════════════════════════════ */

  function panelAbierto() { var p = document.getElementById('left-panel'); return p && !p.classList.contains('collapsed'); }

  function abrirPanel() {
    if (panelAbierto()) return Promise.resolve();
    var btn = document.getElementById('side-toggle-left');
    return (btn ? click(btn) : Promise.resolve()).then(function() {
      if (typeof toggleLeftPanel === 'function') toggleLeftPanel();
      return waitFor(panelAbierto, 100, 4000).catch(function() {});
    });
  }

  function abrirPanelCapas() {
    return abrirPanel().then(function() { return wait(250); }).then(function() {
      var sec = document.getElementById('layers-section');
      if (sec && sec.style.display !== 'none') return;
      var tab = document.getElementById('tab-capas');
      return (tab ? click(tab) : Promise.resolve()).then(function() {
        if (typeof selectLeftTab === 'function') selectLeftTab('capas'); else if (tab) tab.click();
        return waitFor(function() { var s = document.getElementById('layers-section'); return s && s.style.display !== 'none'; }, 120, 5000).catch(function() {});
      });
    });
  }

  function abrirPanelMomento() {
    return abrirPanel().then(function() { return wait(250); }).then(function() {
      var sec = document.getElementById('momento-section');
      if (sec && sec.style.display !== 'none') return;
      var tab = document.getElementById('tab-momento');
      return (tab ? click(tab) : Promise.resolve()).then(function() {
        if (typeof selectLeftTab === 'function') selectLeftTab('momento'); else if (tab) tab.click();
        return waitFor(function() { var s = document.getElementById('momento-section'); return s && s.style.display !== 'none'; }, 120, 5000).catch(function() {});
      });
    });
  }

  function abrirMswPanel() {
    var p = document.getElementById('msw-panel');
    if (p && p.style.display !== 'none') return Promise.resolve();
    var btn = document.querySelector('.msw-como-llegar-btn');
    return (btn ? click(btn) : Promise.resolve()).then(function() {
      if (btn) btn.click();
      return waitFor(function() { var q = document.getElementById('msw-panel'); return q && q.style.display !== 'none'; }, 120, 5000).catch(function() {});
    });
  }

  /** Busca texto en el widget y selecciona el primer resultado */
  function buscar(texto) {
    var inp = document.getElementById('msw-input');
    if (!inp) return Promise.resolve();
    var w = document.getElementById('map-search-widget');
    if (w && w.style.display === 'none') w.style.display = '';
    return click(inp).then(function() { return type(inp, texto); })
      .then(function() { return wait(900); })
      .then(function() {
        return waitFor(function() { var r = document.getElementById('msw-resultados'); return r && r.style.display !== 'none' && r.children.length > 0; }, 150, 6000).catch(function() {});
      });
  }

  /** Selecciona el primer resultado visible */
  function selPrimero() {
    var r = document.getElementById('msw-resultados');
    if (!r) return Promise.resolve();
    var el = r.querySelector('li') || r.querySelector('.msw-resultado') || r.querySelector('div');
    if (!el) return Promise.resolve();
    return click(el).then(function() { el.click(); return wait(700); });
  }

  /**
   * Demo del buscador con coma para mostrar cuadrícula de portales.
   * 1) Escribe "calle, "  -> aparece cuadrícula
   * 2) Pausa para que se vea
   * 3) Escribe el número  -> filtra
   * 4) Selecciona resultado
   */
  function buscarConPortal(calle, num) {
    var inp = document.getElementById('msw-input');
    if (!inp) return Promise.resolve();
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return wait(300)
      // Escribir "calle, " — activa cuadrícula de portales
      .then(function() { return type(inp, calle + ', '); })
      .then(function() { return wait(800); })
      .then(function() {
        return waitFor(function() { var r = document.getElementById('msw-resultados'); return r && r.style.display !== 'none' && r.children.length > 0; }, 150, 5000).catch(function() {});
      })
      // Spotlight sobre la cuadrícula de portales MIENTRAS está visible
      .then(function() {
        var res = document.getElementById('msw-resultados');
        return quitarOverlay(res, 600);
      })
      .then(function() { return wait(2500); })
      .then(function() { return restaurarOverlay(400); })
      .then(function() { return wait(200); })
      // Añadir el número SIN borrar lo que hay
      .then(function() { return typeAppend(inp, num); })
      .then(function() { return wait(800); })
      .then(function() {
        return waitFor(function() { var r = document.getElementById('msw-resultados'); return r && r.style.display !== 'none' && r.children.length > 0; }, 150, 5000).catch(function() {});
      })
      // Spotlight sobre el resultado filtrado antes de seleccionarlo
      .then(function() {
        var res = document.getElementById('msw-resultados');
        var item = res && (res.querySelector('li') || res.querySelector('.msw-resultado') || res.querySelector('div'));
        return quitarOverlay(item || res, 500);
      })
      .then(function() { return wait(1800); })
      .then(function() { return restaurarOverlay(400); })
      .then(function() { return wait(200); })
      .then(function() { return selPrimero(); });
  }

  function fijarLatlng(lat, lng) {
    var mapa = window.map || window.myMap || window.leafletMap;
    if (!mapa) return Promise.resolve();
    mapa.setView([lat, lng], Math.max(mapa.getZoom(), 16), { animate: true, duration: 0.8 });
    return wait(1000);
  }

  /** Devuelve un rect {left,top,width,height} centrado en el marcador Leaflet en pantalla */
  function rectMarker(lat, lng, size) {
    size = size || 80;
    try {
      var mapa = window.map || window.myMap || window.leafletMap;
      if (!mapa) return null;
      var ll = typeof L !== 'undefined' ? L.latLng(lat, lng) : { lat: lat, lng: lng };
      var px = mapa.latLngToContainerPoint(ll);
      var mapEl = document.getElementById('map');
      var rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
      return {
        left:   rect.left + px.x - size / 2,
        top:    rect.top  + px.y - size / 2,
        width:  size,
        height: size,
      };
    } catch(e) { return null; }
  }

  function clickMapa(lat, lng) {
    var mapa = window.map || window.myMap || window.leafletMap;
    if (!mapa) return;
    var ll = (typeof L !== 'undefined') ? L.latLng(lat, lng) : { lat: lat, lng: lng };
    var px  = mapa.latLngToContainerPoint(ll);
    var rect = (document.getElementById('map') || { getBoundingClientRect: function() { return { left: 0, top: 0 }; } }).getBoundingClientRect();
    var sx = rect.left + px.x, sy = rect.top + px.y;
    showCur(sx, sy);
    setTimeout(function() { if (cur) { cur.classList.add('click'); setTimeout(function() { cur.classList.remove('click'); }, 180); } }, 120);
    mapa.fire('click', { latlng: ll, layerPoint: px, containerPoint: px, originalEvent: new MouseEvent('click', { bubbles: true, clientX: sx, clientY: sy }) });
  }

  function selOrigen(lat, lng) {
    if (typeof iniciarSeleccionOrigen === 'function') iniciarSeleccionOrigen();
    return fijarLatlng(lat, lng).then(function() {
      clickMapa(lat, lng);
      return waitFor(function() { return typeof puntoOrigen !== 'undefined' && puntoOrigen !== null; }, 200, 8000).catch(function() {});
    });
  }

  function selDestino(lat, lng) {
    if (typeof iniciarSeleccionDestino === 'function') iniciarSeleccionDestino();
    return fijarLatlng(lat, lng).then(function() {
      clickMapa(lat, lng);
      return waitFor(function() { return typeof puntoDestino !== 'undefined' && puntoDestino !== null; }, 200, 8000).catch(function() {});
    });
  }

  function calcularRuta() {
    var btn = document.getElementById('msw-btn-calcular');
    return (btn ? click(btn) : Promise.resolve()).then(function() {
      if (typeof msw_lanzarCalculo === 'function') msw_lanzarCalculo();
      else if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return waitFor(function() { var r = document.getElementById('msw-resultados-ruta'); return r && r.style.display !== 'none'; }, 200, 15000).catch(function() {});
    }).then(function() { return wait(600); });
  }

  /** Desplaza el popover del tutorial justo ENCIMA del modal de obstáculo,
   *  con un pequeño margen, para que queden relacionados visualmente. */
  function aparcarPopover() {
    requestAnimationFrame(function() {
      var pop   = document.querySelector('.driver-popover');
      var modal = document.getElementById('obstaculo-modal');
      if (!pop) return;
      pop.dataset.tutStyleBak = pop.getAttribute('style') || '';
      if (modal) {
        var mr = modal.getBoundingClientRect();
        var popW = 320;
        // Centrar horizontalmente sobre el modal, colocar encima con 8 px de separación
        var left = mr.left + (mr.width - popW) / 2;
        var top  = Math.max(8, mr.top - 8); // si no cabe arriba, pegar arriba de pantalla
        // Si el modal ocupa mucho espacio vertical, poner debajo
        if (mr.top < 160) top = mr.bottom + 8;
        pop.style.cssText = 'position:fixed!important;top:' + top + 'px!important;' +
          'left:' + left + 'px!important;transform:none!important;' +
          'z-index:999999!important;max-width:' + popW + 'px!important;';
      } else {
        pop.style.cssText = 'position:fixed!important;top:12px!important;left:50%!important;' +
          'transform:translateX(-50%)!important;z-index:999999!important;max-width:320px!important;';
      }
    });
  }

  /** Devuelve el popover a su posición normal (Driver.js lo reposiciona en el siguiente paso). */
  function liberarPopover() {
    var pop = document.querySelector('.driver-popover');
    if (pop && pop.dataset.tutStyleBak !== undefined) {
      pop.setAttribute('style', pop.dataset.tutStyleBak);
      delete pop.dataset.tutStyleBak;
    }
  }

  function crearObstaculo(lat, lng, pct) {
    if (typeof modoObstaculo === 'undefined' || !modoObstaculo) {
      if (typeof activarModoObstaculo === 'function') activarModoObstaculo();
    }
    return wait(400).then(function() {
      return fijarLatlng(lat, lng);
    }).then(function() {
      clickMapa(lat, lng);
      return waitFor(function() { var m = document.getElementById('obstaculo-modal'); return m && m.style.display === 'flex'; }, 150, 10000).catch(function() {});
    }).then(function() {
      // Modal abierto: hacer spotlight sobre el modal y aparcar el popover sobre él
      aparcarPopover();
      return quitarOverlay(document.getElementById('obstaculo-modal'), 500);
    }).then(function() {
      return wait(800);
    }).then(function() {
      // Animar el slider progresivamente hacia el valor objetivo
      var sl = document.getElementById('obstaculo-pct');
      if (!sl) return Promise.resolve();
      var inicio = parseInt(sl.value) || 0;
      var fin = pct;
      var pasos = 18;
      var idx = 0;
      function animarSlider() {
        if (idx > pasos) return Promise.resolve();
        sl.value = Math.round(inicio + (fin - inicio) * (idx / pasos));
        sl.dispatchEvent(new Event('input', { bubbles: true }));
        idx++;
        return wait(55).then(animarSlider);
      }
      return animarSlider();
    }).then(function() {
      // Pausa para que el usuario vea el valor final del slider
      return wait(1400);
    }).then(function() {
      // Restaurar overlay y mover cursor al botón Colocar
      return restaurarOverlay(400);
    }).then(function() {
      var btnOk = document.querySelector('#obstaculo-modal .obstaculo-btn-ok') || document.querySelector('.obstaculo-btn-ok');
      return (btnOk ? click(btnOk) : Promise.resolve()).then(function() {
        if (typeof confirmarObstaculo === 'function') confirmarObstaculo();
        else if (btnOk) btnOk.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }).then(function() {
      return waitFor(function() { var m = document.getElementById('obstaculo-modal'); return !m || m.style.display !== 'flex'; }, 150, 6000).catch(function() {});
    }).then(function() {
      // Modal cerrado: liberar el popover para que Driver.js lo recoloque
      liberarPopover();
      return wait(600);
    });
  }

  function limpiarObstaculos() {
    var btn = document.getElementById('btn-limpiar-obstaculos');
    return (btn ? click(btn) : Promise.resolve()).then(function() {
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      else if (typeof limpiarObstaculos === 'function') limpiarObstaculos();
      return wait(500);
    });
  }

  function activarMomento(dia, hora) {
    return abrirPanelMomento().then(function() { return wait(400); }).then(function() {
      var sd = document.getElementById('select-dia');
      if (sd) { return click(sd).then(function() { sd.value = String(dia); sd.dispatchEvent(new Event('change', { bubbles: true })); return wait(350); }); }
    }).then(function() {
      var sl = document.getElementById('slider-hora');
      if (sl) { return click(sl).then(function() { sl.value = hora; sl.dispatchEvent(new Event('input', { bubbles: true })); sl.dispatchEvent(new Event('change', { bubbles: true })); return wait(350); }); }
    }).then(function() {
      var btn = document.querySelector('.botonera .upload-btn');
      if (btn) return click(btn).then(function() { btn.click(); });
      else if (window.estadoTemporal && typeof aplicarSimulacionTemporal === 'function') { window.estadoTemporal.activo = true; aplicarSimulacionTemporal(); }
      return wait(800);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   *  COORDENADAS DE DEMO (Puerto Lumbreras — ajustar al grafo real)
   * ═══════════════════════════════════════════════════════════════ */
  var C = {
    origen:  { lat: 37.5670, lng: -1.8010 },
    destino: { lat: 37.5720, lng: -1.7950 },
    obs1:    { lat: 37.5690, lng: -1.7985 },
    obs2:    { lat: 37.5700, lng: -1.7970 },
  };

  /* ═══════════════════════════════════════════════════════════════
   *  DEFINICIÓN DE PASOS
   *  Cada paso tiene: element?, popover{title,description,side,align},
   *  y accion(next) — función que ejecuta la acción y LLAMA a next()
   *  cuando termina. next() avanza el Driver al paso siguiente.
   * ═══════════════════════════════════════════════════════════════ */
  function steps() {
    /* Atajo: devuelve una acción que sólo espera T ms y avanza */
    function solo(T) { return function(next) { wait(T).then(next); }; }

    /* Señalar un elemento con el cursor y esperar T ms */
    function senalar(idOrSel, T) {
      return function(next) {
        var el = typeof idOrSel === 'string'
          ? (document.getElementById(idOrSel) || document.querySelector(idOrSel))
          : idOrSel;
        (el ? mov(cx(el).x, cx(el).y) : Promise.resolve()).then(function() { return wait(T || 4000); }).then(next);
      };
    }

    return [

      /* 0 — Bienvenida */
      {
        popover: { title: '🗺️ Bienvenido a GeoRuta', side: 'over', align: 'center',
          description: 'Este tutorial funciona <strong>automáticamente</strong>, como un vídeo.<br><br>Observa cómo el sistema realiza todas las acciones por ti. Puedes saltarlo en cualquier momento con el botón inferior.' },
        accion: solo(5000),
      },

      /* 1 — Cabecera */
      {
        element: '.header',
        popover: { title: '📡 Cabecera', side: 'bottom', align: 'start',
          description: 'Aquí verás el nombre de la app y el <strong>indicador de estado del servidor</strong>. Un punto verde indica que Flask está operativo.' },
        accion: senalar('.header', 5000),
      },

      /* 2 — Badge usuario */
      {
        element: '#user-badge',
        popover: { title: '👤 Perfil de usuario', side: 'bottom', align: 'end',
          description: 'Haz clic para identificarte. Tres roles:<br>• <strong>Invitado</strong> — routing básico<br>• <strong>Registrado</strong> — importar/exportar<br>• <strong>Admin</strong> — acceso total' },
        accion: senalar('user-badge', 5000),
      },

      /* 3 — Abrir panel de capas */
      {
        element: '#tab-capas',
        popover: { title: '📚 Abriendo panel de capas', side: 'right', align: 'start',
          description: 'La barra de iconos izquierda da acceso al panel lateral. El tutorial lo abrirá ahora en la pestaña <strong>Capas</strong>.' },
        accion: function(next) {
          badge('Abriendo panel de capas…');
          abrirPanelCapas().then(function() { badge(''); wait(1500).then(next); });
        },
      },

      /* 4 — Capa vías */
      {
        element: '#layer-vias',
        popover: { title: '🛣️ Red viaria', side: 'right', align: 'start',
          description: 'La capa de vías OSM es el <strong>grafo dirigido</strong> base para Dijkstra. Actívala o desactívala con el checkbox.' },
        accion: senalar('layer-vias', 5000),
      },

      /* 5 — Widget buscador */
      {
        element: '#map-search-widget',
        popover: { title: '🔍 Buscador de direcciones', side: 'left', align: 'start',
          description: 'Localiza cualquier dirección combinando calles y portales.<br><br>Formato: <code>nombre de calle, número</code><br>Ej: <code>Francia, 3</code>' },
        accion: function(next) {
          var w = document.getElementById('map-search-widget');
          if (w && w.style.display === 'none') w.style.display = '';
          senalar('map-search-widget', 4500)(next);
        },
      },

      /* 6 — Buscador: escribir "Francia" */
      {
        element: '#msw-input',
        popover: { title: '✏️ Búsqueda básica', side: 'left', align: 'start',
          description: 'El tutorial escribirá <strong>"Francia"</strong> en el buscador y seleccionará el primer resultado de la lista.' },
        accion: function(next) {
          badge('Escribiendo "Francia"…');
          buscar('Francia')
            .then(function() {
              // Spotlight sobre la lista de resultados ANTES de seleccionar
              var res = document.getElementById('msw-resultados');
              var item = res && (res.querySelector('li') || res.querySelector('.msw-resultado') || res.querySelector('div'));
              return quitarOverlay(item || res, 600);
            })
            .then(function() { return wait(2500); })
            .then(function() { return restaurarOverlay(400); })
            .then(function() { return wait(200); })
            .then(function() { badge('Seleccionando resultado…'); return selPrimero(); })
            .then(function() { badge(''); next(); });
        },
      },

      /* 7 — Buscador con coma: cuadrícula de portales */
      {
        element: '#msw-input',
        popover: { title: '🔢 Buscar por portal', side: 'left', align: 'start',
          description: 'Escribe una <strong>coma</strong> tras el nombre de la calle y aparece la cuadrícula de portales disponibles.<br><br><code>Francia, </code> -> cuadrícula de portales<br><code>Francia, 3</code> -> portal 3<br><br>GeoRuta hace zoom exactamente a ese portal.' },
        accion: function(next) {
          badge('Mostrando cuadrícula de portales…');
          buscarConPortal('Francia', '3')
            .then(function() {
              badge('');
              // Esperar a que el popup de Leaflet aparezca en el DOM, luego spotlight
              return waitFor(function() {
                var p = document.querySelector('.leaflet-popup-content-wrapper');
                return p && p.offsetParent !== null;
              }, 100, 5000).catch(function() {}).then(function() {
                var popup = document.querySelector('.leaflet-popup-content-wrapper') ||
                            document.querySelector('.leaflet-popup');
                return quitarOverlay(popup || document.getElementById('map'), 600);
              });
            })
            .then(function() { return wait(2800); })
            .then(function() { return restaurarOverlay(500); })
            .then(function() { return wait(300); })
            .then(next);
        },
      },

      /* 8 — Botón Cómo llegar */
      {
        element: '.msw-como-llegar-btn',
        popover: { title: '🧭 Cómo llegar', side: 'left', align: 'start',
          description: 'Abre el panel de routing. El tutorial lo pulsará ahora.' },
        accion: function(next) {
          badge('Abriendo panel de routing…');
          abrirMswPanel().then(function() { badge(''); wait(1500).then(next); });
        },
      },

      /* 9 — Tipo de vehículo */
      {
        element: '.msw-vehiculos',
        popover: { title: '🚗 Tipo de vehículo', side: 'left', align: 'start',
          description: 'Elige entre <strong>Veh. Ligero</strong> o <strong>Veh. Pesado</strong>.<br><br>El modo <strong>🚨 Emergencia</strong> añade +20 km/h y dibuja la ruta en rojo.' },
        accion: function(next) {
          var btn = document.getElementById('msw-btn-coche');
          (btn ? click(btn).then(function() { btn.click(); }) : Promise.resolve())
            .then(function() { return wait(4000); }).then(next);
        },
      },

      /* 10 — Seleccionar origen */
      {
        element: '#msw-origen-label',
        popover: { title: '📍 Fijando el origen', side: 'left', align: 'start',
          description: 'El tutorial centrará el mapa y hará clic para fijar el punto de <strong>origen</strong>.' },
        accion: function(next) {
          badge('Centrando mapa y fijando origen…');
          var lbl = document.getElementById('msw-origen-label');
          (lbl ? click(lbl) : Promise.resolve()).then(function() {
            return selOrigen(C.origen.lat, C.origen.lng);
          }).then(function() {
            badge('');
            // Spotlight sobre el marcador de origen en el mapa
            var r = rectMarker(C.origen.lat, C.origen.lng, 100);
            return quitarOverlay(r || document.getElementById('map'), 650);
          }).then(function() { return wait(2800); })
          .then(function() { return restaurarOverlay(500); })
          .then(function() { return wait(300); })
          .then(next);
        },
      },

      /* 11 — Seleccionar destino */
      {
        element: '#msw-destino-label',
        popover: { title: '🎯 Fijando el destino', side: 'left', align: 'start',
          description: 'Ahora el tutorial centra el mapa en un punto diferente y fija el <strong>destino</strong>.' },
        accion: function(next) {
          badge('Centrando mapa y fijando destino…');
          var lbl = document.getElementById('msw-destino-label');
          (lbl ? click(lbl) : Promise.resolve()).then(function() {
            return selDestino(C.destino.lat, C.destino.lng);
          }).then(function() {
            badge('');
            // Spotlight sobre el marcador de destino en el mapa
            var r = rectMarker(C.destino.lat, C.destino.lng, 100);
            return quitarOverlay(r || document.getElementById('map'), 650);
          }).then(function() { return wait(2800); })
          .then(function() { return restaurarOverlay(500); })
          .then(function() { return wait(300); })
          .then(next);
        },
      },

      /* 12 — Calcular ruta */
      {
        element: '#msw-btn-calcular',
        popover: { title: '🗺️ Calculando la ruta', side: 'left', align: 'start',
          description: 'El tutorial pulsa <strong>Calcular ruta</strong>. Dijkstra calculará el camino óptimo y lo dibujará en azul.' },
        accion: function(next) {
          badge('Calculando ruta con Dijkstra…');
          calcularRuta().then(function() {
            badge('');
            // La ruta llena el mapa — spotlight al mapa completo
            return quitarOverlay(document.getElementById('map'), 650);
          }).then(function() { return wait(4500); })
          .then(function() { return restaurarOverlay(500); })
          .then(function() { return wait(300); })
          .then(next);
        },
      },

      /* 13 — Resultados */
      {
        element: '#msw-resultados-ruta',
        popover: { title: '📊 Resultados', side: 'left', align: 'start',
          description: 'Aquí aparecen: <strong>distancia</strong> (km), <strong>tiempo estimado</strong>, <strong>velocidad media</strong> y <strong>tipo de vía dominante</strong>.' },
        accion: senalar('msw-resultados-ruta', 6000),
      },

      /* 14 — Activar modo obstáculos */
      {
        element: '#msw-btn-obstaculo',
        popover: { title: '🚧 Modo obstáculos', side: 'left', align: 'start',
          description: 'El tutorial activará el modo obstáculos. Con él activo, el siguiente clic en el mapa crea un corte de vía.' },
        accion: function(next) {
          badge('Activando modo obstáculos…');
          var btn = document.getElementById('msw-btn-obstaculo');
          (btn ? click(btn) : Promise.resolve()).then(function() {
            if (typeof activarModoObstaculo === 'function') activarModoObstaculo();
            else if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return wait(600);
          }).then(function() { badge(''); wait(1000).then(next); });
        },
      },

      /* 15 — Crear obstáculo 1 (65 %) */
      {
        element: '#map',
        popover: { title: '🖱️ Creando obstáculo en el mapa', side: 'over', align: 'center',
          description: 'El tutorial centra el mapa en una vía, hace clic, ajusta la obstrucción al <strong>65 %</strong> y pulsa <strong>Colocar</strong>.' },
        accion: function(next) {
          badge('Creando obstáculo al 65 %…');
          crearObstaculo(C.obs1.lat, C.obs1.lng, 65).then(function() {
            badge('');
            // Spotlight sobre el marcador del obstáculo en el mapa
            var r = rectMarker(C.obs1.lat, C.obs1.lng, 110);
            return quitarOverlay(r || document.getElementById('map'), 650);
          }).then(function() { return wait(2800); })
          .then(function() { return restaurarOverlay(500); })
          .then(function() { return wait(300); })
          .then(next);
        },
      },

      /* 16 — Panel flotante obstáculos */
      {
        element: '#obstaculos-panel-flotante',
        popover: { title: '📋 Panel de obstáculos activos', side: 'left', align: 'start',
          description: 'Cada obstáculo aparece aquí con su <strong>ID</strong>, <strong>porcentaje</strong> y <strong>vía afectada</strong>. Elimina con ✕.' },
        accion: senalar('obstaculos-panel-flotante', 5500),
      },

      /* 17 — Crear y eliminar obstáculo 2 */
      {
        element: '#obstaculos-panel-flotante',
        popover: { title: '🗑️ Crear y eliminar obstáculo', side: 'left', align: 'start',
          description: 'El tutorial crea un segundo obstáculo (30 %) y luego lo elimina con el botón <strong>✕</strong> del panel.' },
        accion: function(next) {
          badge('Creando segundo obstáculo al 30 %…');
          crearObstaculo(C.obs2.lat, C.obs2.lng, 30).then(function() {
            badge('Eliminando obstáculo con ✕…');
            return wait(800);
          }).then(function() {
            var lista = document.getElementById('obs-flotante-lista');
            var btns = lista ? lista.querySelectorAll('button') : [];
            var btnX = null;
            btns.forEach(function(b) {
              if (b.classList.contains('obs-item-remove') || /limin/i.test(b.title || '') || b.textContent.trim() === '✕' || b.textContent.trim() === '×') btnX = b;
            });
            if (!btnX && btns.length) btnX = btns[btns.length - 1];
            return btnX ? click(btnX).then(function() { btnX.dispatchEvent(new MouseEvent('click', { bubbles: true })); return wait(500); }) : Promise.resolve();
          }).then(function() { badge(''); wait(1200).then(next); });
        },
      },

      /* 18 — Editar obstáculo (informativo) */
      {
        popover: { title: '🔄 Editar un obstáculo', side: 'over', align: 'center',
          description: 'Haz clic en el marcador 🚧 del mapa para abrir su popup:<br>• <strong>📍 Mover</strong> — el siguiente clic lo reubica<br>• <strong>Slider</strong> — cambia el porcentaje al cerrar' },
        accion: function(next) {
          try {
            var mapa = window.map || window.myMap;
            if (mapa) {
              var ll = typeof L !== 'undefined' ? L.latLng(C.obs1.lat, C.obs1.lng) : C.obs1;
              var px = mapa.latLngToContainerPoint(ll);
              var rect = (document.getElementById('map') || { getBoundingClientRect: function() { return { left:0, top:0 }; } }).getBoundingClientRect();
              mov(rect.left + px.x, rect.top + px.y).then(function() { wait(5000).then(next); });
              return;
            }
          } catch(e) {}
          wait(5000).then(next);
        },
      },

      /* 19 — Limpiar todos */
      {
        element: '#btn-limpiar-obstaculos',
        popover: { title: '🧹 Limpiar todos los obstáculos', side: 'left', align: 'start',
          description: 'El tutorial eliminará todos los obstáculos activos de una sola vez.' },
        accion: function(next) {
          badge('Limpiando todos los obstáculos…');
          limpiarObstaculos().then(function() { badge(''); wait(1500).then(next); });
        },
      },

      /* 20 — Ir a import/export en panel capas */
      {
        element: '#tab-capas',
        popover: { title: '📂 Panel de capas — import/export', side: 'right', align: 'start',
          description: 'El tutorial abrirá el panel de capas para mostrar las opciones de importación y exportación de obstáculos.' },
        accion: function(next) {
          badge('Abriendo panel de capas…');
          abrirPanelCapas().then(function() { badge(''); wait(1500).then(next); });
        },
      },

      /* 21 — Sección obstáculos */
      {
        element: '#layer-obstaculos',
        popover: { title: '🚧 Sección obstáculos', side: 'right', align: 'start',
          description: 'Cuántos obstáculos hay activos y las opciones de <strong>importación / exportación</strong>. Solo para <strong>Registrado</strong> y <strong>Admin</strong>.' },
        accion: senalar('layer-obstaculos', 5500),
      },

      /* 22 — Exportar */
      {
        element: '[data-tutorial-id="obstaculos-import-export"], #obstaculos-import-export-top',
        popover: { title: '📤 Exportar obstáculos', side: 'right', align: 'start',
          description: 'Guarda los obstáculos en:<br>• <strong>.gpkg / .shp / .zip</strong> — formato GIS<br>• <strong>.csv</strong> — tabla de coordenadas' },
        accion: senalar('[data-tutorial-id="obstaculos-import-export"], #obstaculos-import-export-top', 5000),
      },

      /* 23 — Importar */
      {
        element: '[data-tutorial-id="obstaculos-import-export"], #obstaculos-import-export-top',
        popover: { title: '📥 Importar obstáculos', side: 'right', align: 'start',
          description: 'Carga daños sísmicos externos: <code>.gpkg</code>, <code>.shp</code>, <code>.zip</code>, <code>.csv</code>, <code>.geojson</code>.<br><br>Se integran de inmediato en el grafo de Dijkstra.' },
        accion: senalar('[data-tutorial-id="obstaculos-import-export"], #obstaculos-import-export-top', 5000),
      },

      /* 24 — Modo Momento */
      {
        element: '#tab-momento',
        popover: { title: '⏱️ Modo Momento', side: 'right', align: 'start',
          description: 'El tutorial abrirá la simulación de tráfico configurada para <strong>viernes a las 8:30 h</strong> — hora punta escolar y de oficinas.' },
        accion: function(next) {
          badge('Abriendo Modo Momento — viernes 8:30 h…');
          activarMomento(5, 8.5).then(function() { badge(''); wait(1500).then(next); });
        },
      },

      /* 25 — Panel Momento */
      {
        element: '#momento-section',
        popover: { title: '📅 Simulación temporal', side: 'right', align: 'start',
          description: 'Franjas críticas:<br>• <strong>Colegios</strong> L–V 8–9 h, 13:30–14:30 h, 17–18 h<br>• <strong>Oficinas</strong> L–V 8–9 h, 14–15 h, 18–19:30 h<br>• <strong>Ocio</strong> V–S–D 20–24 h, 12–15 h' },
        accion: senalar('momento-section', 6000),
      },

      /* 26 — Opciones de salida */
      {
        element: '#btn-salir-ahora-msw',
        popover: { title: '🕐 Tiempo de salida', side: 'left', align: 'start',
          description: 'Selecciona cuándo calcular:<br>• <strong>🕐 Salir ahora</strong><br>• <strong>📅 Salir a las</strong> — elige fecha y hora<br>• <strong>🏁 Llegar antes de las</strong> — calcula cuándo partir' },
        accion: function(next) {
          abrirMswPanel().then(function() {
            var btn = document.getElementById('btn-salir-ahora-msw');
            return btn ? mov(cx(btn).x, cx(btn).y) : Promise.resolve();
          }).then(function() { return wait(5000); }).then(next);
        },
      },

      /* 27 — Fin */
      {
        popover: { title: '✅ ¡GeoRuta listo!', side: 'over', align: 'center',
          description: 'Has visto todas las funciones principales:<br><br>• <strong>Buscar</strong> direcciones y portales<br>• <strong>Calcular rutas</strong> con Dijkstra<br>• <strong>Obstáculos</strong> sísmicos<br>• <strong>Import/export</strong> GIS<br>• <strong>Simulación</strong> de tráfico temporal<br><br>Relanza el tutorial con el botón <strong>?</strong> en la barra lateral.' },
        accion: function(next) { hideCur(); wait(6000).then(next); },
      },

    ];
  }

  /* ═══════════════════════════════════════════════════════════════
   *  MOTOR DEL TOUR
   * ═══════════════════════════════════════════════════════════════ */
  var activo = false, abortado = false;

  function iniciarTutorial() {
    if (activo) return;
    if (typeof window.driver === 'undefined') { console.error('[tutorial] Driver.js no cargado'); return; }

    activo   = true;
    abortado = false;
    initCur();
    initBar();

    var pasos = steps();
    var TOTAL = pasos.length;
    var idx  = 0;

    /* Construir array de pasos para Driver.js */
    var driverSteps = pasos.map(function(p, i) {
      return {
        element: p.element,
        popover: p.popover,
        onHighlightStarted: function() {
          if (abortado) return;
          setBar(i + 1, TOTAL);
          // Inyectar botón Saltar
          skipBtn(function() { abortado = true; driverObj.destroy(); cleanup(); });
          // Ejecutar la acción del paso
          p.accion(function() {
            if (!_abortado) {
              try { driverObj.moveNext(); } catch(e) {}
            }
          });
        },
      };
    });

    var driverObj = window.driver.js.driver({
      showProgress:   true,
      progressText:   'Paso {{current}} de {{total}}',
      nextBtnText:    'Siguiente ->',
      prevBtnText:    '← Anterior',
      doneBtnText:    '✓ Finalizar',
      allowClose:     true,
      overlayOpacity: 0.55,
      smoothScroll:   true,
      animate:        true,
      onDestroyed:    function() { cleanup(); },
      steps:          driverSteps,
    });

    window.georutaTour = driverObj;
    driverObj.drive();
  }

  function cleanup() {
    activo = false;
    hideCur();
    if (document.getElementById('tut-bar')) document.getElementById('tut-bar').style.width = '0%';
  }

  /* ═══════════════════════════════════════════════════════════════
   *  BOTÓN "?"
   * ═══════════════════════════════════════════════════════════════ */
  function crearBtn() {
    if (document.getElementById('btn-tutorial')) return;
    var btn = document.createElement('button');
    btn.id = 'btn-tutorial'; btn.innerHTML = '?';
    btn.title = 'Iniciar tutorial automático';
    btn.setAttribute('aria-label', 'Tutorial');
    btn.setAttribute('data-title', 'Tutorial');
    btn.classList.add('side-bar-item');
    btn.addEventListener('click', iniciarTutorial);

    var bar = document.getElementById('leftsideTabs');
    if (bar) {
      // Colocar al final de la barra pero anclado abajo,
      // a la misma altura visual que los controles del mapa
      btn.style.cssText = 'margin-top:auto;margin-bottom:12px;flex-shrink:0;';
      bar.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   *  INIT
   * ═══════════════════════════════════════════════════════════════ */
  function init() { inyectarEstilos(); crearBtn(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();