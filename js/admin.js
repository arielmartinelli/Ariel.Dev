/**
 * admin.js — Shell del panel propietario.
 *
 * Responsabilidades de este archivo:
 *   - Login y sesión (Supabase Auth).
 *   - Navegación entre las cuatro secciones.
 *   - La sección Resumen (KPIs + cola de trabajo).
 *
 * Las otras secciones viven en sus propios módulos:
 *   js/admin-clients.js    -> Clientes
 *   js/admin-portfolio.js  -> Portfolio
 *   js/admin-reviews.js    -> Reseñas
 *   (Cobros está acá abajo porque es una sola tabla)
 *
 * SOBRE LA SEGURIDAD: esconder el dashboard NO es un control de acceso. Todo
 * lo que se muestra viene de tablas con RLS que exigen que auth.uid() sea la
 * cuenta de Ariel. Si alguien entra a /admin sin sesión, ve el login; y si
 * lograra saltearlo desde la consola, las consultas volverían vacías porque
 * la autorización real está en el servidor.
 */

import { supabase, isSupabaseConfigured } from "./supabase.js";
import { adminTareasDeTodos, adminPagosDeTodos, adminListarClientes, adminMarcarTarea, adminMarcarPago, adminObtenerComprobante, ETIQUETA_PAGO } from "./clients.js";
import { escapeHtml, safeImageSrc } from "./security.js";
import { configurarDialogos, confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";
import { iniciarSeccionClientes, refrescarClientes } from "./admin-clients.js";
import { iniciarSeccionPortfolio, refrescarPortfolio } from "./admin-portfolio.js";
import { iniciarSeccionResenas, refrescarResenas } from "./admin-reviews.js";

const $ = (id) => document.getElementById(id);

const TITULOS = {
  resumen: "Resumen",
  clientes: "Clientes",
  cobros: "Cobros",
  portfolio: "Portfolio",
  resenas: "Reseñas",
};

let vistaActual = "resumen";
let seccionesIniciadas = false;

/* Datos compartidos entre Resumen y Cobros: se piden una vez por refresco. */
let cacheTareas = [];
let cachePagos = [];
let cacheClientes = [];

let filtroTareas = "pendientes";
let filtroCobros = "todos";
let faltanTablas = false;

/* Proyectos con las tareas desplegadas en el Resumen. Arrancan TODOS
   plegados: con 5 clientes activos, la lista abierta era una pared de texto
   donde no se distinguia un proyecto de otro. */
const desplegados = new Set();

const usd = (n) =>
  `USD ${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

/* ==========================================================================
   LOGIN
   ========================================================================== */
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();

  const boton = $("btn-login");
  const error = $("login-error");
  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  error.textContent = "";

  if (!isSupabaseConfigured) {
    error.textContent = "Falta configurar Supabase (.env). No se puede validar el acceso.";
    return;
  }

  boton.disabled = true;
  boton.textContent = "Entrando…";

  try {
    const { data, error: errAuth } = await supabase.auth.signInWithPassword({ email, password });
    if (errAuth) throw errAuth;
    if (!data?.session?.access_token) throw new Error("Sesión inválida.");

    await entrarAlPanel();
  } catch (err) {
    // El motivo real va a la consola (es tu navegador); en pantalla se muestra
    // un mensaje genérico, que es lo que vería alguien probando contraseñas.
    console.error("Error de login:", err?.message || err);
    error.textContent = "Credenciales incorrectas.";
  } finally {
    boton.disabled = false;
    boton.textContent = "Acceder";
    $("login-password").value = "";
  }
});

$("btn-logout").addEventListener("click", async () => {
  const ok = await confirmar({
    titulo: "¿Cerrar sesión?",
    texto: "Vas a volver a la pantalla de acceso.",
    confirmar: "Sí, salir",
    icono: "question",
  });
  if (!ok) return;

  try {
    await supabase.auth.signOut();
  } finally {
    $("login-email").value = "";
    volverAlLogin();
  }
});

/**
 * Vuelve a la pantalla de acceso.
 * @param {string} motivo  Se muestra en el login para que no parezca un
 *                         cierre de sesión arbitrario.
 */
function volverAlLogin(motivo = "") {
  $("admin-shell").classList.add("hidden");
  $("admin-login").classList.remove("hidden");
  $("login-password").value = "";
  $("login-error").textContent = motivo;
}

/**
 * Vigila la sesión.
 *
 * BUG CORREGIDO: no había nada escuchando el estado de autenticación. Si
 * dejabas el panel abierto y el token vencía (o el refresco fallaba porque se
 * cortó internet), TODAS las acciones empezaban a fallar con errores de
 * permisos — y la pantalla seguía mostrando datos viejos como si nada. Se
 * veía como "el panel se rompió", no como "se venció la sesión".
 *
 * Ahora, apenas Supabase avisa que no hay sesión, se vuelve al login con el
 * motivo escrito.
 */
supabase.auth.onAuthStateChange((evento, sesion) => {
  const panelAbierto = !$("admin-shell").classList.contains("hidden");

  if ((evento === "SIGNED_OUT" || !sesion) && panelAbierto) {
    volverAlLogin("Tu sesión venció. Volvé a entrar para seguir.");
  }
});

async function entrarAlPanel() {
  $("admin-login").classList.add("hidden");
  $("admin-shell").classList.remove("hidden");

  if (!seccionesIniciadas) {
    iniciarSeccionClientes();
    iniciarSeccionPortfolio();
    iniciarSeccionResenas();
    seccionesIniciadas = true;
  }

  await refrescarTodo();
}

/* ==========================================================================
   NAVEGACIÓN
   ========================================================================== */
const PESTANAS = () => Array.from(document.querySelectorAll(".admin-tab[data-vista]"));

function cambiarVista(vista) {
  vistaActual = vista;

  PESTANAS().forEach((btn) => {
    const activa = btn.dataset.vista === vista;
    btn.classList.toggle("activo", activa);
    // aria-current le dice al lector de pantalla en qué sección está parado;
    // el color solo no transmite eso.
    if (activa) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });

  document.querySelectorAll(".admin-vista").forEach((sec) => {
    sec.classList.toggle("hidden", sec.id !== `vista-${vista}`);
  });

  $("admin-titulo").textContent = TITULOS[vista] || "Panel";
  document.title = `${TITULOS[vista]} · Ariel.Dev`;

  // Al cambiar de sección se espera empezar arriba, no donde había quedado
  // la sección anterior.
  window.scrollTo({ top: 0, behavior: "instant" });

  anunciar(`Sección ${TITULOS[vista]}`);
}

PESTANAS().forEach((btn, i, todas) => {
  btn.addEventListener("click", () => cambiarVista(btn.dataset.vista));

  // Flechas izquierda/derecha entre pestañas: es el patrón que espera quien
  // navega con teclado en una barra de pestañas.
  btn.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const paso = e.key === "ArrowRight" ? 1 : -1;
    const siguiente = todas[(i + paso + todas.length) % todas.length];
    siguiente.focus();
    cambiarVista(siguiente.dataset.vista);
  });
});

/* ==========================================================================
   REFRESCO GENERAL
   ========================================================================== */
$("btn-refrescar").addEventListener("click", () => refrescarTodo());

// El aviso de comprobantes no solo informa: lleva directo a donde se resuelve.
$("aviso-revisar")?.addEventListener("click", () => {
  filtroCobros = "pendiente";
  document.querySelectorAll("[data-filtro-cobros]").forEach((b) =>
    b.classList.toggle("activo", b.dataset.filtroCobros === "pendiente"));
  pintarCobros();
  cambiarVista("cobros");
});

export async function refrescarTodo() {
  const boton = $("btn-refrescar");
  boton.classList.add("girando");
  boton.disabled = true;

  try {
    // Las tres consultas van en paralelo: son independientes entre sí y
    // esperarlas en fila triplicaría el tiempo de carga del panel.
    let sinEsquema = false;
    const atrapar = (e) => {
      console.error(e);
      if (e?.faltaEsquema) sinEsquema = true;
      return [];
    };

    const [clientes, tareas, pagos] = await Promise.all([
      adminListarClientes().catch(atrapar),
      adminTareasDeTodos().catch(atrapar),
      adminPagosDeTodos().catch(atrapar),

      // Las reseñas se pintan solas y no alimentan ningún KPI, así que van en
      // la misma tanda pero con su propio manejo de error: si fallan, el resto
      // del panel tiene que cargar igual.
      refrescarResenas().catch((e) => console.error("Reseñas:", e)),
    ]);

    cacheClientes = clientes;
    cacheTareas = tareas;
    cachePagos = pagos;

    // Si las tablas todavía no existen, no tiene sentido pintar listas vacías
    // y dejar que el usuario descubra el problema recién al apretar "crear":
    // se explica arriba de todo qué falta hacer.
    faltanTablas = sinEsquema;
    pintarAvisoEsquema();

    pintarResumen();
    pintarCobros();
    pintarBadges();
    refrescarClientes(clientes);
    await refrescarPortfolio();
  } finally {
    boton.classList.remove("girando");
    boton.disabled = false;
  }
}

/**
 * Aviso de instalación pendiente.
 *
 * Sin esto, el panel se veía perfecto y vacío, y el único síntoma aparecía al
 * intentar crear un cliente: un cartel rojo que decía "no se pudo completar la
 * operación". Eso manda a buscar el problema al código, cuando en realidad
 * falta correr un script. El error tiene que apuntar al arreglo.
 */
function pintarAvisoEsquema() {
  const existente = document.getElementById("aviso-esquema");
  if (existente) existente.remove();

  if (!faltanTablas) {
    document.getElementById("btn-abrir-alta")?.removeAttribute("disabled");
    return;
  }

  // Sin tablas no se puede crear nada: se deshabilita en vez de dejar que
  // el usuario complete un formulario que va a fallar sí o sí.
  document.getElementById("btn-abrir-alta")?.setAttribute("disabled", "");

  const aviso = document.createElement("div");
  aviso.id = "aviso-esquema";
  aviso.className = "admin-aviso-setup";
  aviso.setAttribute("role", "alert");
  aviso.innerHTML = `
    <div class="admin-aviso-icono" aria-hidden="true">⚙️</div>
    <div>
      <p class="admin-aviso-titulo">Falta un paso para activar el sector clientes</p>
      <p class="admin-aviso-texto">
        Las tablas <code>clients</code>, <code>client_tasks</code> y <code>payments</code>
        todavía no existen en tu Supabase. Por eso no se pueden crear clientes.
      </p>
      <ol class="admin-aviso-pasos">
        <li>Entrá a <strong>Supabase → SQL Editor → New query</strong>.</li>
        <li>Pegá el contenido completo de <code>supabase/portal-clientes.sql</code>.</li>
        <li>Apretá <strong>Run</strong> y revisá el resultado de las consultas del final.</li>
        <li>Volvé acá y tocá el botón de actualizar (↻, arriba a la derecha).</li>
      </ol>
      <p class="admin-aviso-texto">
        El script es idempotente: se puede correr más de una vez sin romper nada.
      </p>
    </div>`;

  // Se muestra en las dos secciones que dependen de esas tablas.
  document.getElementById("vista-resumen")?.prepend(aviso);
  document.getElementById("vista-clientes")?.prepend(aviso.cloneNode(true));
}

/**
 * Un proyecto está "activo" si no terminó ni se rechazó.
 *
 * Se define por descarte a propósito. Antes era una lista blanca de tres
 * etapas, y al pasar el flujo a 9 los proyectos que estaban esperando el
 * anticipo, eligiendo dominio o esperando el saldo desaparecían de los KPIs:
 * el panel decía "0 clientes activos" con medio trabajo en curso. Con la
 * lista negra, cualquier etapa nueva entra sola.
 */
const estaActivo = (c) => !["finalizado", "rechazado"].includes(c.status);

function pintarBadges() {
  const pendientes = cacheTareas.filter((t) => !t.done).length;
  const activos = cacheClientes.filter(estaActivo).length;
  const cobrosPendientes = cachePagos.filter((p) => p.status !== "pagado").length;

  // Son puntos, no números: en una barra de 4 pestañas un número compite con
  // la etiqueta y no entra. El dato exacto está en los KPIs de cada sección.
  const poner = (id, valor, etiqueta) => {
    const el = $(id);
    if (!el) return;
    el.hidden = valor === 0;
    el.setAttribute("aria-label", valor === 0 ? "" : `${valor} ${etiqueta}`);
  };

  poner("badge-pendientes", pendientes, "tareas pendientes");
  poner("badge-clientes", activos, "clientes activos");
  poner("badge-cobros", cobrosPendientes, "cobros sin acreditar");
}

/* ==========================================================================
   SECCIÓN RESUMEN
   ========================================================================== */
function pintarResumen() {
  // --- KPIs ---
  const cobrado = cachePagos.filter((p) => p.status === "pagado")
    .reduce((a, p) => a + p.amountUsd, 0);

  // Solo lo pendiente de proyectos vivos: sumar lo de un proyecto rechazado
  // infla el número con plata que nunca va a entrar.
  const idsVivos = new Set(cacheClientes.filter((c) => c.status !== "rechazado").map((c) => c.id));
  const pendiente = cachePagos
    .filter((p) => p.status !== "pagado" && idsVivos.has(p.clientId))
    .reduce((a, p) => a + p.amountUsd, 0);

  const activos = cacheClientes.filter(estaActivo);
  const finalizados = cacheClientes.filter((c) => c.status === "finalizado").length;

  const tareasPendientes = cacheTareas.filter((t) => !t.done);
  const pedidasPorCliente = tareasPendientes.filter((t) => t.source === "cliente").length;

  $("kpi-cobrado").textContent = usd(cobrado);
  $("kpi-cobrado-nota").textContent =
    `${cachePagos.filter((p) => p.status === "pagado").length} cobros acreditados`;

  $("kpi-pendiente").textContent = usd(pendiente);
  $("kpi-pendiente-nota").textContent =
    `${cachePagos.filter((p) => p.status !== "pagado" && idsVivos.has(p.clientId)).length} sin cobrar`;

  $("kpi-activos").textContent = String(activos.length);
  $("kpi-activos-nota").textContent = `${finalizados} finalizados`;

  $("kpi-tareas").textContent = String(tareasPendientes.length);
  $("kpi-tareas-nota").textContent = pedidasPorCliente
    ? `${pedidasPorCliente} pedidas por clientes`
    : "nada pendiente";

  // Aviso de comprobantes esperando tu revisión. Va arriba de todo porque es
  // plata que ya entró y todavía no está registrada.
  const aRevisar = cachePagos.filter((p) => p.status === "en_revision");
  const avisoRev = $("aviso-revisar");
  if (avisoRev) {
    avisoRev.hidden = aRevisar.length === 0;
    $("aviso-revisar-texto").textContent =
      `${aRevisar.length} comprobante${aRevisar.length === 1 ? "" : "s"} de transferencia esperando que lo revises.`;
  }

  pintarColaDeTrabajo();
}

function pintarColaDeTrabajo() {
  const cont = $("resumen-proyectos");
  cont.innerHTML = "";

  // Agrupar las tareas por proyecto. Se usa un Map para conservar el orden en
  // que aparecen y no reordenar el tablero en cada refresco.
  const porProyecto = new Map();
  cacheTareas.forEach((t) => {
    if (!porProyecto.has(t.clientId)) {
      porProyecto.set(t.clientId, {
        clientId: t.clientId,
        projectName: t.projectName,
        clientName: t.clientName,
        tareas: [],
      });
    }
    porProyecto.get(t.clientId).tareas.push(t);
  });

  // Proyectos en producción sin ninguna tarea: igual se muestran, porque
  // "sin tareas cargadas" es información — significa que hay que cargarlas.
  cacheClientes
    .filter((c) => c.status === "en_produccion" && !porProyecto.has(c.id))
    .forEach((c) => {
      porProyecto.set(c.id, {
        clientId: c.id,
        projectName: c.project_name,
        clientName: c.client_name,
        tareas: [],
      });
    });

  // Los que tienen más pendientes primero: es lo que hay que atacar.
  const grupos = Array.from(porProyecto.values())
    .map((g) => {
      const cliente = cacheClientes.find((c) => c.id === g.clientId);
      return {
        ...g,
        progreso: cliente ? cliente.progreso : 0,
        pendientes: g.tareas.filter((t) => !t.done).length,
        hechas: g.tareas.filter((t) => t.done).length,
      };
    })
    .sort((a, b) => b.pendientes - a.pendientes);

  const visibles = grupos.filter((g) => {
    if (filtroTareas === "pendientes") return g.pendientes > 0;
    if (filtroTareas === "hechas") return g.hechas > 0;
    return g.tareas.length > 0 || g.pendientes === 0;
  });

  if (visibles.length === 0) {
    cont.innerHTML = `
      <div class="admin-vacio">
        <div class="admin-vacio-icono" aria-hidden="true">${filtroTareas === "pendientes" ? "✅" : "📭"}</div>
        <p class="admin-vacio-titulo">${
          filtroTareas === "pendientes" ? "No tenés nada pendiente" : "Todavía no hay nada acá"
        }</p>
        <p class="admin-hint">${
          filtroTareas === "pendientes"
            ? "Cuando un cliente pida cambios, aparecen automáticamente en esta lista."
            : "Las tareas completadas van a aparecer acá."
        }</p>
      </div>`;
    return;
  }

  visibles.forEach((g) => cont.appendChild(tarjetaProyecto(g)));
}

function tarjetaProyecto(g) {
  const abierto = desplegados.has(g.clientId);

  const card = document.createElement("article");
  card.className = `res-proyecto ${abierto ? "abierto" : ""}`;

  // La cabecera es un <button>: se puede abrir con Enter o Espacio, y el
  // lector de pantalla anuncia si esta expandido o no.
  const cabecera = document.createElement("button");
  cabecera.type = "button";
  cabecera.className = "res-proyecto-head";
  cabecera.setAttribute("aria-expanded", String(abierto));
  cabecera.innerHTML = `
    <svg class="res-flecha" width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
    <div class="res-proyecto-info">
      <div class="res-proyecto-nombre">${escapeHtml(g.projectName)}</div>
      <div class="res-proyecto-cliente">${escapeHtml(g.clientName)}</div>
    </div>
    <div class="res-proyecto-derecha">
      ${g.pendientes > 0
        ? `<span class="res-contador">${g.pendientes} pendiente${g.pendientes === 1 ? "" : "s"}</span>`
        : `<span class="res-contador listo">al día</span>`}
      <div class="res-progreso">
        <div class="res-barra"><div class="res-barra-fill" style="width:${g.progreso}%"></div></div>
        <span class="res-progreso-num">${g.progreso}%</span>
      </div>
    </div>
  `;

  cabecera.addEventListener("click", () => {
    if (desplegados.has(g.clientId)) desplegados.delete(g.clientId);
    else desplegados.add(g.clientId);
    pintarColaDeTrabajo();
  });

  card.appendChild(cabecera);

  // Las tareas solo se construyen si el proyecto esta abierto: con muchos
  // clientes, generar todos los nodos y esconderlos cuesta igual.
  if (!abierto) return card;

  const lista = document.createElement("div");
  lista.className = "res-tareas";

  const mostrar = g.tareas.filter((t) => {
    if (filtroTareas === "pendientes") return !t.done;
    if (filtroTareas === "hechas") return t.done;
    return true;
  });

  if (mostrar.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "res-vacio";
    vacio.textContent = g.tareas.length === 0
      ? "Sin tareas cargadas. Agregalas desde la ficha del cliente."
      : "Nada para mostrar con este filtro.";
    lista.appendChild(vacio);
  }

  mostrar.forEach((t) => lista.appendChild(filaTarea(t)));
  card.appendChild(lista);
  return card;
}

function filaTarea(t) {
  const fila = document.createElement("div");
  fila.className = `res-tarea ${t.done ? "hecha" : ""}`;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = t.done;
  check.id = `rt-${t.id}`;

  check.addEventListener("change", async () => {
    check.disabled = true;
    const res = await adminMarcarTarea(t.id, check.checked);

    if (!res.ok) {
      // Revertir: si el servidor rechazó el cambio, dejar el tilde puesto
      // sería mentirle al usuario sobre el estado real.
      check.checked = !check.checked;
      avisar("No se pudo actualizar", res.error, "error");
      check.disabled = false;
      return;
    }

    t.done = check.checked;
    t.doneAt = check.checked ? new Date().toISOString() : null;
    anunciar(check.checked ? "Tarea completada" : "Tarea reabierta");

    // Se recarga todo porque marcar una tarea cambia el progreso del proyecto
    // (y puede cambiar el 99% → 100%, que el cliente ve al instante).
    await refrescarTodo();
  });

  const etiqueta = document.createElement("label");
  etiqueta.htmlFor = check.id;
  etiqueta.className = "res-tarea-texto";
  etiqueta.textContent = t.title;

  fila.append(check, etiqueta);

  if (t.source === "cliente") {
    const origen = document.createElement("span");
    origen.className = "res-tarea-origen";
    origen.textContent = "pidió el cliente";
    fila.appendChild(origen);
  }

  return fila;
}

document.querySelectorAll("[data-filtro-tareas]").forEach((btn) => {
  btn.addEventListener("click", () => {
    filtroTareas = btn.dataset.filtroTareas;
    document.querySelectorAll("[data-filtro-tareas]").forEach((b) =>
      b.classList.toggle("activo", b === btn));
    pintarColaDeTrabajo();
  });
});

/* ==========================================================================
   SECCIÓN COBROS
   ========================================================================== */
function pintarCobros() {
  const cobrado = cachePagos.filter((p) => p.status === "pagado").reduce((a, p) => a + p.amountUsd, 0);
  const pendiente = cachePagos.filter((p) => p.status === "pendiente").reduce((a, p) => a + p.amountUsd, 0);
  const proceso = cachePagos.filter((p) => p.status === "en_proceso").reduce((a, p) => a + p.amountUsd, 0);

  $("cob-cobrado").textContent = usd(cobrado);
  $("cob-pendiente").textContent = usd(pendiente);
  $("cob-proceso").textContent = usd(proceso);

  const cont = $("tabla-cobros");
  cont.innerHTML = "";

  const filas = cachePagos.filter((p) => {
    if (filtroCobros === "todos") return true;
    if (filtroCobros === "pagado") return p.status === "pagado";
    return p.status === "pendiente" || p.status === "en_proceso";
  });

  if (filas.length === 0) {
    cont.innerHTML = `
      <div class="admin-vacio">
        <div class="admin-vacio-icono" aria-hidden="true">💸</div>
        <p class="admin-vacio-titulo">No hay cobros con este filtro</p>
        <p class="admin-hint">Los cobros se generan solos cuando un cliente acepta pasar a producción.</p>
      </div>`;
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "admin-tabla-wrap";
  wrap.innerHTML = `
    <table class="admin-tabla">
      <thead>
        <tr>
          <th scope="col">Proyecto</th>
          <th scope="col">Concepto</th>
          <th scope="col">Monto</th>
          <th scope="col">Estado</th>
          <th scope="col">Medio</th>
          <th scope="col">Fecha</th>
          <th scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>`;

  const tbody = wrap.querySelector("tbody");

  filas.forEach((p) => {
    const tr = document.createElement("tr");
    const fecha = p.paidAt || p.createdAt;

    tr.innerHTML = `
      <td>
        <span class="admin-td-proyecto">
          <strong>${escapeHtml(p.projectName)}</strong>
          <span>${escapeHtml(p.clientName)}</span>
        </span>
      </td>
      <td>${escapeHtml(ETIQUETA_PAGO[p.kind] || p.kind)}</td>
      <td class="num">${escapeHtml(usd(p.amountUsd))}</td>
      <td><span class="admin-badge ${escapeHtml(p.status)}">${escapeHtml(etiquetaEstado(p.status))}</span></td>
      <td>${escapeHtml(etiquetaMedio(p.method))}</td>
      <td>${fecha ? escapeHtml(formatearFecha(fecha)) : "—"}</td>
      <td class="admin-td-acciones"></td>`;

    const celda = tr.querySelector(".admin-td-acciones");

    if (p.status === "en_revision") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary btn-sm";
      btn.textContent = "Revisar";
      btn.addEventListener("click", () => revisarComprobante(p));
      celda.appendChild(btn);
    } else {
      celda.textContent = "—";
    }

    tbody.appendChild(tr);
  });

  cont.appendChild(wrap);
}

/**
 * Abre el comprobante en grande y deja aprobarlo o rechazarlo.
 *
 * La imagen NO viene en la consulta general de cobros: son cientos de KB por
 * fila y traerlas todas para mostrar una sola es un desperdicio. Se pide
 * recién al abrir.
 */
async function revisarComprobante(pago) {
  const Swal = window.Swal;
  if (!Swal) return;

  Swal.fire({ title: "Abriendo comprobante…", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  const comprobante = await adminObtenerComprobante(pago.id);
  Swal.close();

  if (!comprobante?.imagen) {
    avisar("Sin comprobante", "No se encontró la imagen de este pago.", "warning");
    return;
  }

  // safeImageSrc además de escapeHtml: escapar solo impide romper el atributo,
  // no valida QUÉ se está cargando. Hoy la única vía de entrada es la función
  // del portal, que valida el formato — pero esta pantalla no tiene por qué
  // depender de eso. Un SVG con <script> adentro se bloquea acá también.
  const imagenSegura = safeImageSrc(comprobante.imagen, "");
  if (!imagenSegura) {
    avisar("Comprobante inválido", "El archivo guardado no es una imagen válida.", "error");
    return;
  }

  const r = await Swal.fire({
    title: `${ETIQUETA_PAGO[pago.kind] || pago.kind} · ${usd(pago.amountUsd)}`,
    html: `
      <p style="margin-bottom:12px;font-size:.9rem;opacity:.8">
        ${escapeHtml(pago.projectName)} — ${escapeHtml(pago.clientName)}
      </p>
      <img src="${escapeHtml(imagenSegura)}" alt="Comprobante de transferencia"
           style="width:100%;max-height:52vh;object-fit:contain;border-radius:12px;
                  border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3)">
      ${comprobante.nota
        ? `<p style="margin-top:12px;font-size:.88rem"><strong>Nota del cliente:</strong> ${escapeHtml(comprobante.nota)}</p>`
        : ""}
      <p style="margin-top:14px;font-size:.82rem;opacity:.7">
        Verificá el monto y que el dinero esté realmente en tu cuenta antes de aprobar.
      </p>`,
    width: 620,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: "Aprobar cobro",
    denyButtonText: "Rechazar",
    cancelButtonText: "Cerrar",
    confirmButtonColor: "#22c55e",
    denyButtonColor: "#ef4444",
  });

  if (r.isConfirmed) {
    const res = await adminMarcarPago(pago.id, { status: "pagado", method: "transferencia" });
    if (!res.ok) {
      avisar("No se pudo aprobar", res.error, "error");
      return;
    }
    await refrescarTodo();

    // Aprobar un comprobante no solo suma plata: el trigger de la base mueve
    // el proyecto a la etapa siguiente (anticipo → cambios, saldo → en línea).
    // Conviene decirlo, si no parece que aprobar y avanzar fueran dos cosas
    // distintas que hay que hacer por separado.
    const efecto = {
      anticipo: " El proyecto pasó a «Aplicando los cambios» y el cliente ya puede cargarlos.",
      saldo: " El proyecto quedó finalizado y el cliente ya ve su link.",
    }[pago.kind] || "";

    avisar("Cobro aprobado",
           `Ya se sumó a tu dashboard y el cliente lo ve acreditado.${efecto}`, "success");
  } else if (r.isDenied) {
    const res = await adminMarcarPago(pago.id, { status: "pendiente", method: "transferencia" });
    if (!res.ok) {
      avisar("No se pudo rechazar", res.error, "error");
      return;
    }
    await refrescarTodo();
    avisar("Comprobante rechazado", "El pago volvió a quedar pendiente. Avisale al cliente por WhatsApp.", "info");
  }
}

function etiquetaEstado(estado) {
  return {
    pendiente: "Pendiente",
    en_proceso: "En proceso",
    en_revision: "A revisar",
    pagado: "Pagado",
    rechazado: "Rechazado",
  }[estado] || estado;
}

function etiquetaMedio(medio) {
  return { mercadopago: "Mercado Pago", transferencia: "Transferencia", efectivo: "Efectivo", otro: "Otro" }[medio] || "—";
}

function formatearFecha(iso) {
  try {
    return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

document.querySelectorAll("[data-filtro-cobros]").forEach((btn) => {
  btn.addEventListener("click", () => {
    filtroCobros = btn.dataset.filtroCobros;
    document.querySelectorAll("[data-filtro-cobros]").forEach((b) =>
      b.classList.toggle("activo", b === btn));
    pintarCobros();
  });
});

/* ==========================================================================
   ARRANQUE
   ========================================================================== */
(async function iniciar() {
  configurarDialogos();

  if (!isSupabaseConfigured) {
    $("login-error").textContent =
      "Supabase no está configurado en este entorno (falta el .env).";
    return;
  }

  // Si ya hay sesión válida, se entra directo: obligar a loguearse de nuevo en
  // cada recarga no aporta seguridad (el token sigue siendo válido) y molesta.
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      await entrarAlPanel();
    }
  } catch (err) {
    console.error("No se pudo verificar la sesión:", err?.message || err);
  }
})();
