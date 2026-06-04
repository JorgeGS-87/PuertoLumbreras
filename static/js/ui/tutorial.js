/**
 * tutorial.js — Tour guiado interactivo de GeoRuta
 * ─────────────────────────────────────────────────
 * Usa Driver.js v1.x  (IIFE build)
 *
 * INTEGRACIÓN en index.html, justo antes de </body>:
 *
 *   <link  rel="stylesheet" href="https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css">
 *   <script src="https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js"></script>
 *   <script src="{{ url_for('static', filename='js/ui/tutorial.js') }}"></script>
 *
 * Copia este fichero en:  static/js/ui/tutorial.js
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
   *  0. ESTILOS — inyectados con máxima especificidad para ganar
   *     a cualquier CSS del proyecto (incluido el reset * y Leaflet)
   * ═══════════════════════════════════════════════════════════════ */
  function _inyectarEstilos() {
    if (document.getElementById('georuta-tutorial-styles')) return;
    const s = document.createElement('style');
    s.id = 'georuta-tutorial-styles';

    /* Usamos html body delante de cada selector para forzar especificidad
       sin depender de !important donde el proyecto ya los tiene. */
    s.textContent = `
      /* ─── overlay ─── */
      html body #driver-overlay { background: rgba(0,0,0,0.62) !important; }

      /* ─── popover contenedor ─── */
      html body .driver-popover {
        background: #1a2535 !important;
        border: 1.5px solid #2980b9 !important;
        border-radius: 10px !important;
        box-shadow: 0 8px 32px rgba(41,128,185,0.28), 0 2px 10px rgba(0,0,0,0.55) !important;
        padding: 0 !important;
        max-width: 340px !important;
        font-family: 'Segoe UI', system-ui, sans-serif !important;
        color: #c8dff0 !important;
      }

      /* ─── título ─── */
      html body .driver-popover-title {
        background: linear-gradient(135deg, #1c4f7a 0%, #2980b9 100%) !important;
        color: #e8f4fd !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        padding: 12px 16px 11px !important;
        margin: 0 !important;
        border-radius: 9px 9px 0 0 !important;
        border-bottom: 1px solid #2471a3 !important;
        letter-spacing: 0.2px !important;
        display: block !important;
      }

      /* ─── descripción ─── */
      html body .driver-popover-description {
        color: #c8dff0 !important;
        font-size: 13px !important;
        line-height: 1.65 !important;
        padding: 13px 16px 10px !important;
        margin: 0 !important;
        background: transparent !important;
      }
      html body .driver-popover-description strong { color: #7ec8e3 !important; font-weight: 700 !important; }
      html body .driver-popover-description code   {
        background: rgba(52,152,219,0.20) !important;
        color: #85d4f5 !important;
        border-radius: 3px !important;
        padding: 1px 5px !important;
        font-size: 12px !important;
      }
      html body .driver-popover-description em { color: #a8d8f0 !important; font-style: italic !important; }

      /* ─── progreso ─── */
      html body .driver-popover-progress-text {
        color: #5fa8d3 !important;
        font-size: 11px !important;
        padding: 0 16px 8px !important;
        display: block !important;
        background: transparent !important;
      }

      /* ─── footer ─── */
      html body .driver-popover-footer {
        background: #111d2b !important;
        border-top: 1px solid #1e3a52 !important;
        border-radius: 0 0 9px 9px !important;
        padding: 10px 14px !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        margin: 0 !important;
      }

      /* ─── botones nav ─── */
      html body .driver-popover-next-btn,
      html body .driver-popover-done-btn {
        background: #2980b9 !important;
        color: #fff !important;
        border: none !important;
        border-radius: 6px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        padding: 6px 14px !important;
        cursor: pointer !important;
        transition: background 0.15s !important;
        text-shadow: none !important;
        box-shadow: none !important;
      }
      html body .driver-popover-next-btn:hover,
      html body .driver-popover-done-btn:hover {
        background: #3498db !important;
      }
      html body .driver-popover-prev-btn {
        background: #1e3a52 !important;
        color: #7ec8e3 !important;
        border: none !important;
        border-radius: 6px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        padding: 6px 14px !important;
        cursor: pointer !important;
        text-shadow: none !important;
        box-shadow: none !important;
      }
      html body .driver-popover-prev-btn:hover { background: #2a4f6e !important; }

      /* ─── flecha ─── */
      html body .driver-popover-arrow-side-left  { border-right-color:  #2980b9 !important; }
      html body .driver-popover-arrow-side-right { border-left-color:   #2980b9 !important; }
      html body .driver-popover-arrow-side-top   { border-bottom-color: #2980b9 !important; }
      html body .driver-popover-arrow-side-bottom{ border-top-color:    #2980b9 !important; }

      /* ─── highlight del elemento activo ─── */
      html body .driver-active-element,
      html body .driver-active-element:focus {
        outline: 2px solid #3498db !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 4px rgba(52,152,219,0.28) !important;
        border-radius: 5px !important;
      }

      /* ─── botón "Saltar tutorial" ─── */
      html body #driver-skip-btn {
        margin-right: auto !important;
        order: -1 !important;
        background: transparent !important;
        border: 1px solid rgba(94,160,200,0.40) !important;
        border-radius: 5px !important;
        color: rgba(168,216,240,0.80) !important;
        font-size: 11px !important;
        padding: 5px 10px !important;
        cursor: pointer !important;
        transition: color 0.15s, border-color 0.15s !important;
        text-shadow: none !important;
      }
      html body #driver-skip-btn:hover {
        color: #e8f4fd !important;
        border-color: rgba(94,160,200,0.80) !important;
      }

      /* ─── chip de acción pendiente ─── */
      html body .tut-accion {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        background: rgba(52,152,219,0.18) !important;
        border: 1px solid rgba(52,152,219,0.50) !important;
        border-radius: 20px !important;
        color: #7ec8e3 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 3px 10px !important;
        margin-top: 10px !important;
      }
      html body .tut-accion::before { content: '👆' !important; font-size: 13px !important; }

      /* ─── botón "?" en la barra lateral (side-bar-item) ─── */
      html body #btn-tutorial {
        position: static !important;
        width: 40px !important;
        height: 40px !important;
        border-radius: 50% !important;
        border: 2px solid rgba(52,152,219,0.50) !important;
        background: linear-gradient(135deg,#1c4f7a,#2980b9) !important;
        color: #e8f4fd !important;
        font-size: 20px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: 0 2px 8px rgba(41,128,185,0.35) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: transform 0.15s, box-shadow 0.15s !important;
        padding: 0 !important;
        margin: 0 !important;
        line-height: 1 !important;
        flex-shrink: 0 !important;
      }
      html body #btn-tutorial:hover {
        transform: scale(1.10) !important;
        box-shadow: 0 4px 14px rgba(41,128,185,0.55) !important;
      }
      /* empuja el botón a 20px del borde inferior dentro del flex column */
      html body #leftsideTabs #btn-tutorial {
        margin-top: 0 !important;
        margin-bottom: 20px !important;
      }
    `;
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════
   *  1. UTILIDADES
   * ═══════════════════════════════════════════════════════════════ */

  function _esperarCondicion(condFn, intervalo, timeout) {
    intervalo = intervalo || 150;
    timeout   = timeout   || 30000;
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        if (condFn())                   { clearInterval(id); resolve(); return; }
        if (Date.now() - t0 > timeout) { clearInterval(id); reject(new Error('timeout')); }
      }, intervalo);
    });
  }

  function _setChipAccion(texto) {
    requestAnimationFrame(() => {
      const desc = document.querySelector('.driver-popover-description');
      if (!desc) return;
      let chip = desc.querySelector('.tut-accion');
      if (!chip) { chip = document.createElement('div'); chip.className = 'tut-accion'; desc.appendChild(chip); }
      chip.textContent = texto;
      chip.style.display = texto ? 'inline-flex' : 'none';
    });
  }

  function _clearChip() { _setChipAccion(''); }

  function _insertarBotonSkip(driverObj) {
    requestAnimationFrame(() => {
      if (document.getElementById('driver-skip-btn')) return;
      const footer = document.querySelector('.driver-popover-footer');
      if (!footer) return;
      const btn = document.createElement('button');
      btn.id          = 'driver-skip-btn';
      btn.textContent = 'Saltar tutorial';
      btn.addEventListener('click', () => driverObj.destroy());
      footer.insertBefore(btn, footer.firstChild);
    });
  }

  function _bloquearNav(bloquear) {
    requestAnimationFrame(() => {
      ['prev', 'next', 'close', 'done'].forEach(tipo => {
        const btn = document.querySelector(`.driver-popover-${tipo}-btn`);
        if (!btn) return;
        btn.disabled            = bloquear;
        btn.style.opacity       = bloquear ? '0.35' : '1';
        btn.style.pointerEvents = bloquear ? 'none' : '';
        btn.title               = bloquear ? 'Completa la acción indicada primero' : '';
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   *  2. PASOS DEL TUTORIAL
   * ═══════════════════════════════════════════════════════════════ */
  function construirPasos(driverObj) {
    const next = () => { try { driverObj.moveNext(); } catch(e) {} };

    return [

      /* ── 0: Bienvenida ── */
      {
        popover: {
          title: '🗺️ Bienvenido a GeoRuta',
          description:
            'Este tutorial te guiará por las funciones principales de la aplicación.<br><br>' +
            'Irás realizando acciones reales: el tutorial avanzará solo cuando las completes. ' +
            'Puedes saltarlo en cualquier momento con el botón inferior izquierdo.',
          side: 'over', align: 'center',
        },
      },

      /* ── 1: Cabecera ── */
      {
        element: '.header',
        popover: {
          title: '📡 Cabecera de la aplicación',
          description:
            'Aquí verás el nombre de la app y el <strong>indicador de estado del servidor</strong>. ' +
            'Un punto verde significa que el backend Flask está operativo y listo para calcular rutas.',
          side: 'bottom', align: 'start',
        },
      },

      /* ── 2: Badge usuario ── */
      {
        element: '#user-badge',
        popover: {
          title: '👤 Perfil de usuario',
          description:
            'Haz clic para identificarte. Tres roles:<br>' +
            '• <strong>Invitado</strong> — solo lectura y routing básico<br>' +
            '• <strong>Registrado</strong> — importar/exportar capas<br>' +
            '• <strong>Admin</strong> — acceso total (contraseña: <em>admin</em>)',
          side: 'bottom', align: 'end',
        },
      },

      /* ── 3: Tabs izquierda — acción: abrir panel de capas ── */
      {
        element: '#tab-capas',
        popover: {
          title: '📚 Panel lateral — Capas',
          description:
            'La barra de iconos de la izquierda da acceso al panel lateral. ' +
            '<strong>Capas</strong> gestiona los datos vectoriales, y ' +
            '<strong>Momento ⏱️</strong> la simulación temporal de tráfico.<br><br>' +
            'Pulsa el icono de <strong>Capas</strong> para abrir el panel.',
          side: 'right', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Pulsa el icono de Capas para abrir el panel');
          _esperarCondicion(() => {
            const s = document.getElementById('layers-section');
            return s && s.style.display !== 'none';
          }, 150, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 4: Capa vías — panel ya abierto garantizado ── */
      {
        element: '#layer-vias',
        popover: {
          title: '🛣️ Capa de red viaria',
          description:
            'Activa o desactiva la red de vías OSM. Es la capa base sobre la que se construye ' +
            'el <strong>grafo dirigido</strong> que usa Dijkstra para calcular rutas.',
          side: 'right', align: 'start',
        },
      },

      /* ── 5: Buscador — explicación ── */
      {
        element: '#map-search-widget',
        popover: {
          title: '🔍 Buscador de direcciones',
          description:
            'Localiza cualquier dirección de Puerto Lumbreras combinando nombres de vías y portales.<br><br>' +
            'Formato: <code>nombre de calle, número</code><br>' +
            'Ejemplo: <code>Francia, 3</code>',
          side: 'left', align: 'start',
        },
      },

      /* ── 6: Buscador — acción: escribe y selecciona un resultado ── */
      {
        element: '#msw-input',
        popover: {
          title: '✏️ Prueba el buscador',
          description:
            'Escribe el nombre de una calle y <strong>selecciona un resultado</strong> de la lista ' +
            'que aparece debajo.<br><br>' +
            'El tutorial avanzará cuando elijas un resultado (no al escribir).',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Escribe una calle y selecciona un resultado');

          /* Avanzar SOLO cuando el usuario hace clic en un resultado del desplegable
             o pulsa Enter sobre él — el desplegable se cierra y msw-resultados se oculta,
             y/o el input adquiere un valor no vacío y el desplegable desaparece. */
          let _seleccionado = false;

          /* Escuchar clic en cualquier ítem del desplegable */
          const onResultClick = (e) => {
            const res = document.getElementById('msw-resultados');
            if (res && res.contains(e.target)) {
              _seleccionado = true;
              document.removeEventListener('click', onResultClick, true);
            }
          };
          document.addEventListener('click', onResultClick, true);

          /* Condición: el desplegable desaparece (style display:none) Y ya se había
             seleccionado un ítem, O el input tiene valor y el desplegable se cierra. */
          _esperarCondicion(() => {
            const res    = document.getElementById('msw-resultados');
            const input  = document.getElementById('msw-input');
            const hidden = !res || res.style.display === 'none';
            const tieneValor = input && input.value.trim().length > 2;
            return _seleccionado && hidden && tieneValor;
          }, 200, 120000)
            .then(() => {
              document.removeEventListener('click', onResultClick, true);
              _clearChip();
              _bloquearNav(false);
              next();
            })
            .catch(() => {
              document.removeEventListener('click', onResultClick, true);
              _bloquearNav(false);
            });
        },
      },

      /* ── 7: Cómo llegar — acción ── */
      {
        element: '.msw-como-llegar-btn',
        popover: {
          title: '🧭 Cómo llegar',
          description:
            'Este botón abre el panel de routing. También aparece en el popup al hacer ' +
            'clic en cualquier punto del mapa.<br><br>' +
            'Pulsa <strong>Cómo llegar</strong> para continuar.',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Pulsa el botón "Cómo llegar"');
          _esperarCondicion(() => {
            const panel = document.getElementById('msw-panel');
            return panel && panel.style.display !== 'none';
          }, 150, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 8: Tipo de vehículo ── */
      {
        element: '.msw-vehiculos',
        popover: {
          title: '🚗 Tipo de vehículo',
          description:
            'Elige entre <strong>Vehículo Ligero</strong> (coche, ambulancia) o ' +
            '<strong>Vehículo Pesado</strong> (camión de bomberos).<br><br>' +
            'El modo <strong>🚨 Emergencia</strong> añade +20 km/h a cada tramo ' +
            'y pinta la ruta con borde rojo.',
          side: 'left', align: 'start',
        },
      },

      /* ── 9: Origen — acción ── */
      {
        element: '#msw-origen-label',
        popover: {
          title: '📍 Selecciona el origen',
          description:
            'Haz clic en este campo para activar la selección de origen, ' +
            'luego haz clic en cualquier punto del mapa.',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Haz clic en el mapa para fijar el origen');
          _esperarCondicion(
            () => typeof puntoOrigen !== 'undefined' && puntoOrigen !== null,
            150, 60000
          )
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 10: Destino — acción ── */
      {
        element: '#msw-destino-label',
        popover: {
          title: '🎯 Selecciona el destino',
          description:
            'Ahora haz clic en otro punto del mapa para fijar el destino. ' +
            'Verás un marcador 🎯 en el punto elegido.',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Haz clic en el mapa para fijar el destino');
          _esperarCondicion(
            () => typeof puntoDestino !== 'undefined' && puntoDestino !== null,
            150, 60000
          )
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 11: Calcular ruta — acción ── */
      {
        element: '#msw-btn-calcular',
        popover: {
          title: '🗺️ Calcular ruta',
          description:
            'Pulsa <strong>Calcular ruta</strong> para lanzar el algoritmo de Dijkstra. ' +
            'La ruta óptima se dibujará en <strong>azul</strong> y verás las estadísticas justo debajo.',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Pulsa "Calcular ruta"');
          _esperarCondicion(() => {
            const r = document.getElementById('msw-resultados-ruta');
            return r && r.style.display !== 'none';
          }, 200, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 12: Resultados ── */
      {
        element: '#msw-resultados-ruta',
        popover: {
          title: '📊 Resultados de la ruta',
          description:
            'Aquí aparecen: <strong>distancia</strong> (km), <strong>tiempo estimado</strong>, ' +
            '<strong>velocidad media</strong> y <strong>tipo de vía dominante</strong>.<br><br>' +
            'Si hay obstáculos o eventos activos en el recorrido, se indicarán con el factor de penalización.',
          side: 'left', align: 'start',
        },
      },

      /* ── 13: Activar modo obstáculo — acción ── */
      {
        element: '#msw-btn-obstaculo',
        popover: {
          title: '🚧 Modo obstáculos',
          description:
            'Activa el modo de colocación de obstáculos. Cada clic posterior en el mapa ' +
            'abrirá un modal para configurar el grado de obstrucción.<br><br>' +
            '<strong>Pulsa el botón 🚧 Obstáculos</strong> para activarlo.',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Pulsa el botón "🚧 Obstáculos"');
          _esperarCondicion(
            () => typeof modoObstaculo !== 'undefined' && modoObstaculo === true,
            150, 60000
          )
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 14: Clic en mapa — acción ── */
      {
        element: '#map',
        popover: {
          title: '🖱️ Haz clic en el mapa',
          description:
            'Con el modo obstáculo activo, haz clic sobre un punto de la red viaria. ' +
            'El cursor habrá cambiado a <code>crosshair</code>.<br><br>' +
            'Se abrirá el modal de configuración.',
          side: 'over', align: 'center',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Haz clic sobre una vía en el mapa');
          _esperarCondicion(() => {
            const modal = document.getElementById('obstaculo-modal');
            return modal && modal.style.display === 'flex';
          }, 150, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 15: Modal obstáculo — acción ── */
      {
        element: '#obstaculo-modal',
        popover: {
          title: '⚙️ Configurar el obstáculo',
          description:
            'Ajusta el <strong>porcentaje de obstrucción</strong> con el slider:<br>' +
            '• <strong style="color:#5dbb63">0 %</strong> → sin efecto<br>' +
            '• <strong style="color:#f0a500">50 %</strong> → el doble de tiempo de tránsito<br>' +
            '• <strong style="color:#e05c5c">90 %</strong> → diez veces más lento<br><br>' +
            'Haz clic en el título <em>"🚧 Nuevo obstáculo"</em> para asignarle un ID opcional. ' +
            'Pulsa <strong>Colocar</strong> cuando estés listo.',
          side: 'over', align: 'center',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Ajusta el slider y pulsa Colocar');
          _esperarCondicion(() => {
            const modal = document.getElementById('obstaculo-modal');
            return !modal || modal.style.display !== 'flex';
          }, 150, 60000)
            .then(() => {
              setTimeout(() => { _clearChip(); _bloquearNav(false); next(); }, 350);
            })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 16: Panel flotante ── */
      {
        element: '#obstaculos-panel-flotante',
        popover: {
          title: '📋 Panel de obstáculos activos',
          description:
            'Cada obstáculo colocado aparece aquí con su <strong>ID</strong>, ' +
            '<strong>porcentaje</strong> y la <strong>vía afectada</strong>.<br><br>' +
            'Elimina obstáculos individuales con la <strong>✕</strong> junto a cada uno.',
          side: 'left', align: 'start',
        },
      },

      /* ── 17: Eliminar obstáculo — acción ── */
      {
        element: '#obstaculos-panel-flotante',
        popover: {
          title: '🗑️ Elimina el obstáculo',
          description:
            'Prueba a eliminar el obstáculo que acabas de crear pulsando la <strong>✕</strong> ' +
            'a su derecha en el panel.',
          side: 'left', align: 'start',
        },
        onHighlightStarted: () => {
          const contarActivos = () => (typeof obstaculos === 'undefined') ? 0
            : obstaculos.filter(Boolean).length;
          const antes = contarActivos();
          _bloquearNav(true);
          _setChipAccion('Pulsa ✕ en el panel para eliminar el obstáculo');
          _esperarCondicion(() => contarActivos() < antes, 150, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 18: Mover obstáculo (informativo) ── */
      {
        popover: {
          title: '🔄 Mover y editar un obstáculo',
          description:
            'Haz clic sobre el marcador 🚧 en el mapa para abrir su popup. Dentro encontrarás:<br>' +
            '• <strong>📍 Mover</strong> — el siguiente clic reubica el obstáculo<br>' +
            '• <strong>Slider</strong> — cambia el porcentaje de obstrucción (se aplica al cerrar el popup)',
          side: 'over', align: 'center',
        },
      },

      /* ── 19: Limpiar todos ── */
      {
        element: '#btn-limpiar-obstaculos',
        popover: {
          title: '🧹 Limpiar todos los obstáculos',
          description:
            'Elimina <strong>todos los obstáculos activos</strong> de una sola vez. ' +
            'Útil para resetear el escenario antes de una nueva simulación.',
          side: 'left', align: 'start',
        },
      },

      /* ── 20: Abrir capas para import/export — acción ── */
      {
        element: '#tab-capas',
        popover: {
          title: '📂 Abre el panel de capas',
          description:
            'Para importar o exportar la capa de obstáculos, abre el panel lateral. ' +
            'Pulsa el icono de <strong>Capas</strong>.',
          side: 'right', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Pulsa el icono de Capas');
          _esperarCondicion(() => {
            const s = document.getElementById('layers-section');
            return s && s.style.display !== 'none';
          }, 150, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 21: Sección obstáculos en panel ── */
      {
        element: '#layer-obstaculos',
        popover: {
          title: '🚧 Sección obstáculos en el panel',
          description:
            'Aquí verás cuántos obstáculos hay activos y las opciones de ' +
            '<strong>importación</strong> y <strong>exportación</strong>.<br><br>' +
            'Estas funciones son exclusivas de usuarios <strong>Registrado</strong> y <strong>Admin</strong>.',
          side: 'right', align: 'start',
        },
      },

      /* ── 22: Exportar ── */
      {
        element: '[data-tutorial-id="obstaculos-import-export"]',
        popover: {
          title: '📤 Exportar obstáculos',
          description:
            'Guarda los obstáculos en un fichero para compartirlos entre sesiones o sistemas:<br>' +
            '• <strong>.gpkg / .shp / .zip</strong> — formato vectorial GIS<br>' +
            '• <strong>.csv</strong> — tabla de coordenadas y porcentajes',
          side: 'right', align: 'start',
        },
      },

      /* ── 23: Importar ── */
      {
        element: '[data-tutorial-id="obstaculos-import-export"]',
        popover: {
          title: '📥 Importar obstáculos',
          description:
            'Carga una capa de daños sísmicos externa. Formatos admitidos: ' +
            '<code>.gpkg</code>, <code>.shp</code>, <code>.zip</code>, <code>.csv</code>, <code>.geojson</code>.<br><br>' +
            'Los obstáculos importados se integran de inmediato en el grafo de Dijkstra.',
          side: 'right', align: 'start',
        },
      },

      /* ── 24: Modo Momento — acción ── */
      {
        element: '#tab-momento',
        popover: {
          title: '⏱️ Modo Momento',
          description:
            'Abre la simulación de tráfico. Selecciona el día y la hora para que el router ' +
            'aplique <strong>coeficientes de congestión</strong> según el tipo de POI próximo.<br><br>' +
            'Pulsa el icono de <strong>Momento ⏱️</strong>.',
          side: 'right', align: 'start',
        },
        onHighlightStarted: () => {
          _bloquearNav(true);
          _setChipAccion('Pulsa el icono ⏱️ de Momento');
          _esperarCondicion(() => {
            const s = document.getElementById('momento-section');
            return s && s.style.display !== 'none';
          }, 150, 60000)
            .then(() => { _clearChip(); _bloquearNav(false); next(); })
            .catch(() => { _bloquearNav(false); });
        },
      },

      /* ── 25: Panel Momento ── */
      {
        element: '#momento-section',
        popover: {
          title: '📅 Día y hora de simulación',
          description:
            'Elige el <strong>tipo de día</strong> y la <strong>hora</strong> para aplicar el coeficiente.<br><br>' +
            'Franjas críticas:<br>' +
            '• <strong>Colegios</strong> L–V 8–9 h, 13:30–14:30 h, 17–18 h<br>' +
            '• <strong>Oficinas</strong> L–V 8–9 h, 14–15 h, 18–19:30 h<br>' +
            '• <strong>Ocio</strong> V–S–D 20–24 h, 12–15 h',
          side: 'right', align: 'start',
        },
      },

      /* ── 26: Salir ahora ── */
      {
        element: '#btn-salir-ahora-msw',
        popover: {
          title: '🕐 Modo de tiempo de salida',
          description:
            'Por defecto el router calcula con la hora actual. Desde aquí puedes cambiar a:<br>' +
            '• <strong>📅 Salir a las</strong> — elige fecha y hora<br>' +
            '• <strong>🏁 Llegar antes de las</strong> — el sistema calcula cuándo debes salir',
          side: 'left', align: 'start',
        },
      },

      /* ── 27: Fin ── */
      {
        popover: {
          title: '✅ ¡GeoRuta listo para operar!',
          description:
            'Ya conoces las funciones principales:<br><br>' +
            '• <strong>Buscar</strong> direcciones postales<br>' +
            '• <strong>Calcular rutas</strong> óptimas con Dijkstra<br>' +
            '• <strong>Modelar obstáculos</strong> sísmicos dinámicos<br>' +
            '• <strong>Importar/exportar</strong> capas de daños<br>' +
            '• <strong>Simular tráfico</strong> por día y hora<br><br>' +
            'Relanza el tutorial cuando quieras con el botón <strong>?</strong> ' +
            'en la esquina inferior izquierda.',
          side: 'over', align: 'center',
        },
      },
    ];
  }

  /* ═══════════════════════════════════════════════════════════════
   *  3. INICIALIZACIÓN DEL DRIVER
   * ═══════════════════════════════════════════════════════════════ */
  function iniciarTutorial() {
    if (typeof window.driver === 'undefined') {
      console.error('[tutorial.js] Driver.js no está cargado.');
      return;
    }

    /* Primer driver solo para obtener referencia, luego reconstruimos con los pasos reales */
    let driverObj = window.driver.js.driver({ steps: [] });
    driverObj.destroy();

    const pasosReales = construirPasos({ moveNext: () => driverObj.moveNext(), destroy: () => driverObj.destroy() });

    driverObj = window.driver.js.driver({
      showProgress:   true,
      progressText:   'Paso {{current}} de {{total}}',
      nextBtnText:    'Siguiente →',
      prevBtnText:    '← Anterior',
      doneBtnText:    '✓ Finalizar',
      allowClose:     true,
      overlayOpacity: 0.60,
      smoothScroll:   true,
      animate:        true,

      onHighlightStarted: (_el, step) => {
        _insertarBotonSkip(driverObj);
        if (step?.onHighlightStarted) step.onHighlightStarted();
      },

      steps: pasosReales,
    });

    window.georutaTour = driverObj;
    driverObj.drive();
  }

  /* ═══════════════════════════════════════════════════════════════
   *  4. BOTÓN "?" FLOTANTE
   * ═══════════════════════════════════════════════════════════════ */
  function crearBotonTutorial() {
    if (document.getElementById('btn-tutorial')) return;
    const btn = document.createElement('button');
    btn.id        = 'btn-tutorial';
    btn.title     = 'Iniciar tutorial';
    btn.innerHTML = '?';
    btn.setAttribute('aria-label', 'Iniciar tutorial de GeoRuta');
    btn.setAttribute('data-title', 'Tutorial');
    btn.addEventListener('click', iniciarTutorial);

    // Añadir a la barra lateral izquierda como side-bar-item, a 20px del fondo
    const sidebar = document.getElementById('leftsideTabs');
    if (sidebar) {
      btn.classList.add('side-bar-item');
      const spacer = document.createElement('div');
      spacer.id = 'tutorial-spacer';
      spacer.style.cssText = 'flex:1;min-height:8px;flex-shrink:0;';
      sidebar.appendChild(spacer);
      sidebar.appendChild(btn);
    } else {
      // Fallback: flotante en body
      document.body.appendChild(btn);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   *  5. ARRANQUE
   * ═══════════════════════════════════════════════════════════════ */
  function init() {
    _inyectarEstilos();
    crearBotonTutorial();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();