// =============================================================================
// js/ui/auth.js
// Gestión de autenticación, rol global, y modal de cuenta de usuario.
// Pestañas dinámicas según rol:
//   • Invitado  -> Iniciar sesión | Registrarse
//   • Registrado -> Mi cuenta (cambiar nombre/email/contraseña) | Cerrar sesión
//   • Admin     -> Mi cuenta | Administrar usuarios | Cerrar sesión
// =============================================================================


// ==================== ROL GLOBAL ====================

window.userRol = 'invitado';

function aplicarPermisos(rol, usuario) {
    window.userRol = rol;

    const nameEl   = document.getElementById('user-name');
    const rolBadge = document.getElementById('user-rol-badge');
    const userIcon = document.getElementById('user-icon');
    if (nameEl)   nameEl.textContent   = usuario || 'Invitado';
    if (rolBadge) rolBadge.textContent = rol;
    const iconos = { invitado: '👤', registrado: '🙋', admin: '🔑' };
    if (userIcon) userIcon.textContent = iconos[rol] || '👤';

    const esReg   = (rol === 'registrado' || rol === 'admin');
    const esAdmin = (rol === 'admin');

    const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
    const showB = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? 'block' : 'none'; };
    const showG = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? 'grid'  : 'none'; };

    show('btn-tabla-vias',          esReg);
    show('btn-tabla-puntos',        esReg);
    show('btn-editar',              esAdmin);
    show('btn-config-campos',       esReg);
    showB('admin-vias-controls',    esReg);
    showB('admin-puntos-controls',  esAdmin);
    show('btn-calendario-momento',  esAdmin);
    if (!esReg) show('btn-tabla-obstaculos-layer', false);
    showG('obstaculos-import-export-top',  esReg);
    showG('obstaculos-registrado-controls', esReg);
    if (!esReg) show('btn-tabla-obstaculos', false);
    showG('obstaculos-admin-controls', esReg);
    show('layer-eventos',           esAdmin);
    showB('admin-eventos-controls', esAdmin);
    show('msw-btn-evento',          esAdmin);
    show('msw-btn-obstaculo',       true);

    if (rol === 'invitado' && typeof cerrarTabla === 'function') cerrarTabla();
    if (typeof initSesionPersistencia === 'function') initSesionPersistencia();

    // Actualizar cabecera del modal si está abierto
    actualizarHeaderModal(rol, usuario);
}


// ==================== MODAL DE CUENTA ====================

let cuentaTabActual = null;

function abrirModalCuenta() {
    const modal = document.getElementById('cuenta-modal');
    if (!modal) return;
    modal.classList.add('open');
    renderizarTabsCuenta();
}

// Mantener compatibilidad con el nombre anterior usado en el HTML
function abrirModalRegistro() { abrirModalCuenta(); }

function cerrarModalCuenta()  {
    document.getElementById('cuenta-modal')?.classList.remove('open');
    cuentaTabActual = null;
}
function cerrarModalRegistro() { cerrarModalCuenta(); }

function actualizarHeaderModal(rol, usuario) {
    const iconos = { invitado: '👤', registrado: '🙋', admin: '🔑' };
    const el = document.getElementById('cuenta-header-icon');
    const nm = document.getElementById('cuenta-header-nombre');
    const rl = document.getElementById('cuenta-header-rol');
    if (el) el.textContent = iconos[rol] || '👤';
    if (nm) nm.textContent = usuario || 'Invitado';
    if (rl) rl.textContent = rol;
}

function renderizarTabsCuenta() {
    const rol     = window.userRol || 'invitado';
    const tabsEl  = document.getElementById('cuenta-tabs');
    const bodyEl  = document.getElementById('cuenta-body');
    if (!tabsEl || !bodyEl) return;

    const tabs = tabsParaRol(rol);
    if (!_cuentaTabActual || !tabs.find(t => t.id === cuentaTabActual))
        cuentaTabActual = tabs[0]?.id;

    tabsEl.innerHTML = tabs.map(t => `
        <div class="cuenta-tab ${t.id === cuentaTabActual ? 'activa' : ''}"
             onclick="_cambiarTabCuenta('${t.id}')">
            ${t.icono} ${t.label}
        </div>`).join('');

    renderizarBodyCuenta(cuentaTabActual);
}

function tabsParaRol(rol) {
    if (rol === 'invitado') return [
        { id: 'login',    icono: '🔐', label: 'Iniciar sesión' },
        { id: 'registro', icono: '✍️',  label: 'Registrarse' },
    ];
    if (rol === 'admin') return [
        { id: 'cuenta',  icono: '👤', label: 'Mi cuenta' },
        { id: 'admin',   icono: '🔑', label: 'Usuarios' },
    ];
    return [
        { id: 'cuenta', icono: '👤', label: 'Mi cuenta' },
    ];
}

function cambiarTabCuenta(tabId) {
    cuentaTabActual = tabId;
    renderizarTabsCuenta();
}

function renderizarBodyCuenta(tabId) {
    const bodyEl = document.getElementById('cuenta-body');
    if (!bodyEl) return;
    const renders = {
        login:    htmlLogin,
        registro: htmlRegistro,
        cuenta:   htmlCuenta,
        admin:    htmlAdmin,
    };
    bodyEl.innerHTML = (renders[tabId] || (() => ''))();

    // Post-render hooks
    if (tabId === 'admin') cargarAdminUsuarios();
}


// ── Pestaña: Iniciar sesión ───────────────────────────────────────────────────

function htmlLogin() {
    return `
        <div class="cm-section-title">🔐 Iniciar sesión</div>
        <div id="cm-login-msg" class="cm-msg"></div>
        <div class="cm-field">
            <label class="cm-label">Email</label>
            <input id="cm-login-email" class="cm-input" type="email" placeholder="tu@email.com"
                onkeydown="if(event.key==='Enter') cmLogin()">
        </div>
        <div class="cm-field">
            <label class="cm-label">Contraseña</label>
            <div class="cm-input-wrap">
                <input id="cm-login-pw" class="cm-input" type="password" placeholder="••••••••"
                    onkeydown="if(event.key==='Enter') cmLogin()">
                <button class="cm-pw-toggle" onclick="cmTogglePw('cm-login-pw',this)" tabindex="-1">👁️</button>
            </div>
        </div>
        <button class="cm-btn cm-btn-primary" onclick="cmLogin()">🔐 Entrar</button>
        <p style="text-align:center;font-size:12px;color:#95a5a6;margin-top:14px;">
            ¿No tienes cuenta?
            <a href="#" style="color:#3498db;" onclick="event.preventDefault();_cambiarTabCuenta('registro')">Regístrate aquí</a>
        </p>`;
}

// cm significa "cuenta modal"
async function cmLogin() {
    const email = document.getElementById('cm-login-email')?.value.trim();
    const pw    = document.getElementById('cm-login-pw')?.value;
    const msg   = document.getElementById('cm-login-msg');
    if (!email || !pw) { cmMsg(msg, 'Introduce email y contraseña.', 'error'); return; }

    const btn = document.querySelector('#cuenta-body .cm-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Entrando…'; }

    const res  = await fetch('/api/auth/entrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
        cmMsg(msg, data.error || 'Credenciales incorrectas.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🔐 Entrar'; }
        return;
    }

    aplicarPermisos(data.rol, data.usuario);
    cerrarModalCuenta();
    showNotification(`✅ Bienvenido, ${data.usuario}`, 'success');
}


// ── Pestaña: Registrarse ──────────────────────────────────────────────────────

function htmlRegistro() {
    return `
        <div class="cm-section-title">✍️ Crear cuenta</div>
        <div id="cm-reg-msg" class="cm-msg"></div>
        <div class="cm-field">
            <label class="cm-label">Nombre de usuario</label>
            <input id="cm-reg-user" class="cm-input" type="text" placeholder="ej. maria_lopez">
        </div>
        <div class="cm-field">
            <label class="cm-label">Email</label>
            <input id="cm-reg-email" class="cm-input" type="email" placeholder="tu@email.com">
        </div>
        <div class="cm-field">
            <label class="cm-label">Contraseña</label>
            <div class="cm-input-wrap">
                <input id="cm-reg-pw" class="cm-input" type="password" placeholder="Mín. 6 caracteres"
                    onkeydown="if(event.key==='Enter') cmRegistrar()">
                <button class="cm-pw-toggle" onclick="cmTogglePw('cm-reg-pw',this)" tabindex="-1">👁️</button>
            </div>
        </div>
        <button class="cm-btn cm-btn-primary" onclick="cmRegistrar()">✅ Crear cuenta</button>
        <p style="text-align:center;font-size:12px;color:#95a5a6;margin-top:14px;">
            ¿Ya tienes cuenta?
            <a href="#" style="color:#3498db;" onclick="event.preventDefault();_cambiarTabCuenta('login')">Inicia sesión</a>
        </p>`;
}

async function cmRegistrar() {
    const user  = document.getElementById('cm-reg-user')?.value.trim();
    const email = document.getElementById('cm-reg-email')?.value.trim();
    const pw    = document.getElementById('cm-reg-pw')?.value;
    const msg   = document.getElementById('cm-reg-msg');
    if (!user || !email || !pw) { cmMsg(msg, 'Rellena todos los campos.', 'error'); return; }
    if (pw.length < 6)          { cmMsg(msg, 'La contraseña debe tener al menos 6 caracteres.', 'error'); return; }

    const btn = document.querySelector('#cuenta-body .cm-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Creando cuenta…'; }

    const res  = await fetch('/api/auth/registrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, email, password: pw })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
        cmMsg(msg, data.error || 'No se pudo registrar.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Crear cuenta'; }
        return;
    }

    // Si el backend devuelve rol y usuario, aplicar permisos directamente.
    // Si no (algunos backends devuelven solo {message}), hacer login automático.
    if (data.rol && data.usuario) {
        aplicarPermisos(data.rol, data.usuario);
        cerrarModalCuenta();
        showNotification(`✅ Cuenta creada. Bienvenido, ${data.usuario}`, 'success');
    } else {
        // Auto-login con las credenciales recién introducidas
        const loginRes  = await fetch('/api/auth/entrar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pw })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok && !loginData.error) {
            aplicarPermisos(loginData.rol, loginData.usuario);
            cerrarModalCuenta();
            showNotification(`✅ Cuenta creada. Bienvenido, ${loginData.usuario}`, 'success');
        } else {
            // Registro OK pero login falló: mostrar mensaje y redirigir a login
            cmMsg(msg, '✅ Cuenta creada. Inicia sesión para continuar.', 'success');
            setTimeout(() => cambiarTabCuenta('login'), 1800);
        }
    }
}


// ── Pestaña: Mi cuenta ────────────────────────────────────────────────────────

function htmlCuenta() {
    const nombre = document.getElementById('user-name')?.textContent || '';
    return `
        <div class="cm-section-title">✏️ Cambiar datos</div>
        <div id="cm-cuenta-msg" class="cm-msg"></div>

        <div class="cm-field">
            <label class="cm-label">Nuevo nombre de usuario</label>
            <input id="cm-nuevo-nombre" class="cm-input" type="text" placeholder="${nombre}" value="${nombre}">
        </div>
        <div class="cm-field">
            <label class="cm-label">Nuevo email</label>
            <input id="cm-nuevo-email" class="cm-input" type="email" placeholder="Nuevo email (opcional)">
        </div>
        <button class="cm-btn cm-btn-primary" onclick="cmGuardarDatos()">💾 Guardar datos</button>

        <hr class="cm-sep">
        <div class="cm-section-title">🔒 Cambiar contraseña</div>
        <div id="cm-pw-msg" class="cm-msg"></div>

        <div class="cm-field">
            <label class="cm-label">Contraseña actual</label>
            <div class="cm-input-wrap">
                <input id="cm-pw-actual" class="cm-input" type="password" placeholder="Tu contraseña actual">
                <button class="cm-pw-toggle" onclick="cmTogglePw('cm-pw-actual',this)" tabindex="-1">👁️</button>
            </div>
        </div>
        <div class="cm-field">
            <label class="cm-label">Nueva contraseña</label>
            <div class="cm-input-wrap">
                <input id="cm-pw-nueva" class="cm-input" type="password" placeholder="Mín. 6 caracteres"
                    onkeydown="if(event.key==='Enter') cmCambiarPassword()">
                <button class="cm-pw-toggle" onclick="cmTogglePw('cm-pw-nueva',this)" tabindex="-1">👁️</button>
            </div>
        </div>
        <button class="cm-btn cm-btn-ghost" onclick="cmCambiarPassword()">🔒 Cambiar contraseña</button>

        <hr class="cm-sep">
        <button class="cm-btn cm-btn-danger" onclick="cerrarSesion()">⏻ Cerrar sesión</button>`;
}

async function cmGuardarDatos() {
    const nombre = document.getElementById('cm-nuevo-nombre')?.value.trim();
    const email  = document.getElementById('cm-nuevo-email')?.value.trim();
    const msg    = document.getElementById('cm-cuenta-msg');
    if (!nombre && !email) { cmMsg(msg, 'Introduce al menos un campo para actualizar.', 'error'); return; }

    const payload = {};
    if (nombre) payload.username = nombre;
    if (email)  payload.email    = email;

    const res  = await fetch('/api/auth/actualizar', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || data.error) { cmMsg(msg, data.error || 'Error al guardar.', 'error'); return; }
    cmMsg(msg, '✅ Datos actualizados correctamente.', 'success');
    if (nombre) aplicarPermisos(window.userRol, nombre);
}

async function cmCambiarPassword() {
    const actual = document.getElementById('cm-pw-actual')?.value;
    const nueva  = document.getElementById('cm-pw-nueva')?.value;
    const msg    = document.getElementById('cm-pw-msg');
    if (!actual || !nueva) { cmMsg(msg, 'Introduce la contraseña actual y la nueva.', 'error'); return; }
    if (nueva.length < 6)  { cmMsg(msg, 'La nueva contraseña debe tener al menos 6 caracteres.', 'error'); return; }

    const res  = await fetch('/api/auth/cambiar-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password_actual: actual, password_nueva: nueva })
    });
    const data = await res.json();

    if (!res.ok || data.error) { cmMsg(msg, data.error || 'Error al cambiar contraseña.', 'error'); return; }
    cmMsg(msg, '✅ Contraseña cambiada correctamente.', 'success');
    document.getElementById('cm-pw-actual').value = '';
    document.getElementById('cm-pw-nueva').value  = '';
}


// ── Pestaña: Admin usuarios ───────────────────────────────────────────────────

function htmlAdmin() {
    return `
        <div class="cm-section-title">👥 Usuarios del sistema</div>
        <div id="cm-admin-msg" class="cm-msg"></div>
        <div id="cm-online-lista" style="margin-bottom:18px;">
            <div style="text-align:center;padding:20px;color:#aab0b7;font-size:13px;">Cargando…</div>
        </div>
        <button class="cm-btn cm-btn-primary" style="width:100%;"
            onclick="window.open('/admin/usuarios','_blank')">
            🔑 Administrar usuarios
        </button>`;
}

async function cargarAdminUsuarios() {
    const res  = await fetch('/api/admin/usuarios/online').catch(() => null);
    if (!res || !res.ok) {
        const msg = document.getElementById('cm-admin-msg');
        if (msg) cmMsg(msg, 'No se pudo cargar la lista de usuarios.', 'error');
        return;
    }
    const data    = await res.json();
    const lista   = document.getElementById('cm-online-lista');
    if (!lista) return;

    const usuarios = data.usuarios || [];
    if (!usuarios.length) {
        lista.innerHTML = '<div style="text-align:center;color:#aab0b7;font-size:13px;">Sin usuarios registrados.</div>';
        return;
    }

    const iconosRol = { admin: '🔑', registrado: '🙋' };
    lista.innerHTML = usuarios.map(u => `
        <div style="display:flex;align-items:center;gap:10px;
                    padding:9px 12px;border-radius:8px;margin-bottom:6px;
                    background:${u.online ? '#f0fdf4' : '#f8f9fa'};
                    border:1px solid ${u.online ? '#bbf7d0' : '#ecf0f1'};">
            <span style="font-size:18px;">${iconosRol[u.rol] || '👤'}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;color:#2c3e50;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${esc(u.username)}
                    <span style="font-size:10px;font-weight:400;color:#7f8c8d;margin-left:4px;">${u.rol}</span>
                </div>
                <div style="font-size:11px;color:#95a5a6;margin-top:1px;">
                    ${u.ultimo_acceso
                        ? 'Último acceso: ' + new Date(u.ultimo_acceso).toLocaleString('es-ES', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
                        : 'Sin actividad registrada'}
                </div>
            </div>
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;
                         color:${u.online ? '#16a34a' : '#9ca3af'};">
                <span style="width:8px;height:8px;border-radius:50%;display:inline-block;
                             background:${u.online ? '#22c55e' : '#d1d5db'};"></span>
                ${u.online ? 'En línea' : 'Desconectado'}
            </span>
        </div>`).join('');
}

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function cmMsg(el, texto, tipo) {
    if (!el) return;
    el.textContent  = texto;
    el.className    = 'cm-msg ' + tipo;
}

function cmTogglePw(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type        = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁️';
}

// Compatibilidad con llamadas legacy desde index.html
function confirmarRegistro() { cmLogin(); }


// ==================== CERRAR SESIÓN ====================

async function cerrarSesion() {
    await fetch('/api/auth/salir', { method: 'POST' });
    cerrarModalCuenta();
    aplicarPermisos('invitado', 'Invitado');
    showNotification('Sesión cerrada. Continuando como invitado.', 'info');
}


// ==================== ENDPOINT: actualizar datos de cuenta ====================
// Si el backend no tiene /api/auth/actualizar, añadirlo (ver instrucciones).
// Por ahora la función ya está wired arriba en cmGuardarDatos().


// ==================== INIT ====================

(async function init() {
    try {
        const me = await fetch('/api/auth/me').then(r => r.json());
        aplicarPermisos(me.rol || 'invitado', me.usuario || 'Invitado');
    } catch (e) {
        aplicarPermisos('invitado', 'Invitado');
        console.warn('No se pudo obtener datos de usuario', e);
    }

    cargarEnMapa('vias');
    cargarEnMapa('puntos');

    if (typeof inicializarSistemaTemporal === 'function') inicializarSistemaTemporal();
})();