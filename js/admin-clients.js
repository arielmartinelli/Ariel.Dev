/**
 * admin-clients.js — Sección Clientes del panel.
 *
 * Es la contracara del portal: acá creo el cliente, genero su link privado,
 * cargo la demo, marco las tareas que voy completando (lo que mueve la barra
 * de progreso que ve el cliente) y llevo el control de cobros.
 *
 * Todo requiere sesión iniciada: las policies RLS de Supabase exigen que
 * auth.uid() sea la cuenta de Ariel. Si la sesión vence, las consultas fallan
 * del lado del servidor — no alcanza con esconder los botones.
 *
 * Los datos llegan desde admin.js, que ya los pidió para el Resumen. Así el
 * panel hace una sola tanda de consultas en vez de una por sección.
 */

import {
  adminCrearCliente, adminActualizarCliente, adminMoverFlujo, adminEliminarCliente, adminRevocarLink,
  adminListarTareas, adminAgregarTarea, adminMarcarTarea, adminEliminarTarea,
  adminListarPagos, adminConfigurarPlan, adminRecalcularSaldo,
  adminCrearCobro, adminEditarCobro, adminEliminarCobro,
  urlPortal, esUrlDePreview, sitioPublico, ESTADOS, ORDEN_ETAPAS, SIGUIENTE_PASO, ETIQUETA_PAGO,
  PLANES, KINDS_A_CUENTA,
} from "./clients.js";
import { escapeHtml, safeUrl, sanitizeText } from "./security.js";
import { confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";
import { abrirDocumentoPdf } from "./pdf-helper.js";
import { ico } from "./iconos.js";

const $ = (id) => document.getElementById(id);

let clientes = [];
let expandido = null;    // id del cliente con la ficha abierta
let filtro = "activos";

const usd = (n) => `USD ${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

/* ¿El valor guardado es un PDF embebido o un link común?
   Importa en el formulario: un PDF guardado mide cientos de miles de
   caracteres y volcarlo dentro de un <input type="url"> deja el campo
   inusable y encima lo vuelve a guardar como texto al apretar Guardar. */
const esDato = (v) => String(v || "").startsWith("data:");

/* ==========================================================================
   Arranque (una sola vez)
   ========================================================================== */
export function iniciarSeccionClientes() {
  conectarAlta();
  conectarFiltros();
  document.addEventListener("click", (ev) => {
    const btnPdf = ev.target.closest("[data-pdf-url]");
    if (btnPdf) {
      ev.preventDefault();
      const url = btnPdf.dataset.pdfUrl;
      const name = btnPdf.dataset.pdfFilename || "documento.pdf";
      abrirDocumentoPdf(url, name);
    }
  });
}

/** Llamado por admin.js con la lista ya cargada. */
export function refrescarClientes(lista) {
  clientes = lista || [];
  pintarLista();
}

/* ==========================================================================
   Filtros
   ========================================================================== */
function conectarFiltros() {
  document.querySelectorAll("[data-filtro-clientes]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filtro = btn.dataset.filtroClientes;
      document.querySelectorAll("[data-filtro-clientes]").forEach((b) =>
        b.classList.toggle("activo", b === btn));
      pintarLista();
    });
  });
}

function visibles() {
  // "Activos" = todo lo que está en curso. Se define por descarte (lo que no
  // terminó ni se rechazó) para que agregar una etapa nueva no obligue a
  // acordarse de sumarla también acá.
  if (filtro === "activos") {
    return clientes.filter((c) => !["finalizado", "rechazado"].includes(c.status));
  }
  if (filtro === "finalizados") {
    return clientes.filter((c) => ["finalizado", "rechazado"].includes(c.status));
  }
  return clientes;
}

/* ==========================================================================
   Lista
   ========================================================================== */
function pintarLista() {
  const cont = $("lista-clientes");
  cont.innerHTML = "";

  const lista = visibles();

  if (lista.length === 0) {
    cont.innerHTML = clientes.length === 0
      ? `<div class="admin-vacio">
           <div class="admin-vacio-icono">${ico("persona", "pico pico-lg")}</div>
           <p class="admin-vacio-titulo">Todavía no tenés clientes</p>
           <p class="admin-hint">Creá el primero con «Nuevo cliente». Te va a generar un link privado para pasarle por WhatsApp.</p>
         </div>`
      : `<p class="admin-hint">Ningún cliente con este filtro.</p>`;
    return;
  }

  lista.forEach((c) => cont.appendChild(tarjetaCliente(c)));
}

function tarjetaCliente(c) {
  const meta = ESTADOS[c.status] || { label: c.status, color: "#64748b" };
  const abierto = expandido === c.id;

  const card = document.createElement("article");
  card.className = `admin-cliente ${abierto ? "abierto" : ""} ${c.is_active ? "" : "revocado"}`;

  const cabecera = document.createElement("button");
  cabecera.type = "button";
  cabecera.className = "admin-cliente-head";
  cabecera.setAttribute("aria-expanded", String(abierto));
  cabecera.innerHTML = `
    <div class="admin-cliente-titulo">
      <strong>${escapeHtml(c.project_name)}</strong>
      <span class="admin-cliente-sub">${escapeHtml(c.client_name)}${c.is_active ? "" : " · link revocado"}</span>
    </div>
    <div class="admin-cliente-meta">
      <span class="admin-estado" style="--chip-color:${meta.color}">${escapeHtml(meta.label)}</span>
      <span class="admin-cliente-prog">${c.progreso}%</span>
    </div>`;

  cabecera.addEventListener("click", () => {
    expandido = abierto ? null : c.id;
    pintarLista();
  });

  card.appendChild(cabecera);
  if (abierto) card.appendChild(ficha(c));
  return card;
}

/**
 * Rastro de uso del link privado.
 *
 * Responde dos preguntas que antes no se podían contestar:
 *   1. ¿El cliente entró alguna vez, o el link nunca le llegó?
 *   2. ¿Se está consultando una cantidad de veces que no tiene sentido?
 *      Cientos de vistas en pocos días es la señal de que el link se filtró
 *      o de que alguien lo está automatizando. Ahí conviene revocarlo.
 */
function rastroDeAcceso(c) {
  const vistas = Number(c.view_count) || 0;

  if (!c.last_seen_at || vistas === 0) {
    return "Todavía no lo abrió nadie.";
  }

  const fecha = new Date(c.last_seen_at);
  const horas = (Date.now() - fecha.getTime()) / 36e5;

  const cuando = horas < 1
    ? "hace menos de una hora"
    : horas < 24
      ? `hace ${Math.floor(horas)} h`
      : fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });

  /* El texto se interpola sin escapar (sale de un número y de una fecha, no
     de nada que escriba el cliente), así que el ícono puede ir inline. */
  const alerta = vistas > 200
    ? ` <span class="admin-hint-alerta">${ico("alerta", "pico pico-sm")} son muchas: si no las hizo el cliente, revocá el link.</span>`
    : "";

  return `Visto ${vistas} ${vistas === 1 ? "vez" : "veces"} · última ${cuando}.${alerta}`;
}

/* ==========================================================================
   Flujo del proyecto
   --------------------------------------------------------------------------
   Nueve etapas, y en cada una hay UNA sola persona con la pelota. Este bloque
   contesta tres preguntas de un vistazo:

     1. ¿De quién es el turno ahora? (vos / el cliente / de nadie)
     2. ¿Cuál es la única acción que te toca? -> el botón grande
     3. ¿Qué está frenando el proyecto?      -> el cartel de color

   El selector de etapa sigue existiendo abajo, pero como salida de emergencia:
   el camino normal es el botón. Antes el panel era solo el selector, y había
   que acordarse de memoria de qué etapa seguía y qué efectos tenía.

   Ver FLUJO.md.
   ========================================================================== */

/** Los 5 pasos que ve el cliente, y en cuál cae cada una de las 9 etapas. */
const PASOS_CLIENTE = ["Demo", "Anticipo", "Cambios", "Dominio", "Entrega"];
const PASO_DE = {
  demo_pendiente: 0, demo_lista: 0, anticipo_pendiente: 1, en_produccion: 2,
  dominio: 3, publicando: 4, saldo_pendiente: 4, finalizado: 4, rechazado: -1,
};

/**
 * ¿Hay un comprobante esperando tu aprobación?
 *
 * Se usa comprobantes_a_revisar de la vista en vez de mirar el pago puntual:
 * en las dos etapas donde importa (anticipo_pendiente y saldo_pendiente) hay
 * un solo cobro abierto, así que no hay ambigüedad posible.
 */
const hayComprobante = (c) => Number(c.comprobantes_a_revisar || 0) > 0;

/**
 * De quién es el turno AHORA.
 *
 * No alcanza con el valor fijo de ESTADOS: en «esperando el anticipo» la
 * pelota es del cliente… salvo que ya haya subido el comprobante, y entonces
 * pasa a ser tuya. Sin esta corrección el chip decía «Le toca al cliente» a
 * dos centímetros de un cartel que decía «te toca aprobarlo»: dos fuentes de
 * verdad contradiciéndose en la misma pantalla.
 */
function deQuienEsElTurno(c) {
  if (hayComprobante(c) && ["anticipo_pendiente", "saldo_pendiente"].includes(c.status)) {
    return "ariel";
  }
  return ESTADOS[c.status]?.pelota || "nadie";
}

/** Los 5 pasos con su estado real, calculado de los datos, no del status. */
function pasosDelFlujo(c) {
  const orden = ESTADOS[c.status]?.orden ?? -1;
  const rechazado = c.status === "rechazado";
  const activo = PASO_DE[c.status] ?? -1;
  const finalizado = c.status === "finalizado";

  const est = (i) => {
    if (finalizado) return "ok";
    if (rechazado) return i === 0 && c.demo_url ? "ok" : "pendiente";
    if (i < activo) return "ok";
    if (i === activo) return "curso";
    return "pendiente";
  };

  return [
    {
      titulo: "Demo",
      estado: c.demo_url ? (orden >= 1 || rechazado ? "ok" : "curso") : "pendiente",
      detalle: c.demo_url
        ? (orden >= 1 ? "Enviada al cliente." : "Link cargado, todavía sin enviar.")
        : "Falta cargar el link de la demo.",
    },
    {
      titulo: "Anticipo",
      estado: rechazado ? "no" : est(1),
      detalle: rechazado
        ? "El cliente no continúa."
        : orden > 2 ? "Cobrado."
        : orden === 2 ? (hayComprobante(c)
            ? "Subió el comprobante: te toca aprobarlo en Cobros."
            : "Esperando que pague.")
        : "Se genera cuando el cliente acepta la demo.",
    },
    {
      titulo: "Cambios",
      estado: rechazado ? "pendiente" : est(2),
      detalle: c.tareas_total > 0
        ? `${c.tareas_hechas} de ${c.tareas_total} completados.`
        : "Todavía no cargó ningún cambio.",
    },
    {
      titulo: "Dominio",
      estado: c.domain_choice ? "ok" : rechazado ? "pendiente" : est(3),
      detalle: c.domain_choice === "propio"
        ? `Propio${c.domain_name ? `: ${c.domain_name}` : ""} (+${usd(c.domain_extra_usd ?? 10)} en el saldo).`
        : c.domain_choice === "vercel"
          ? "Se queda con la dirección de la demo."
          : "Sin definir.",
    },
    {
      titulo: "Entrega",
      estado: finalizado ? "ok" : rechazado ? "pendiente" : est(4),
      detalle: finalizado
        ? "Saldo cobrado y link final a la vista del cliente."
        : c.status === "saldo_pendiente" ? "Esperando el pago del saldo."
        : c.status === "publicando" ? "Te toca subir la página y conectar el dominio."
        : "El link final aparece cuando se cobra el saldo.",
    },
  ];
}

/**
 * Qué está pasando ahora mismo, en una frase.
 *
 * `tono` es 'falta' (te toca a vos), 'espera' (está bien, es del cliente) u
 * 'ok'. Que sean tres y no dos importa: "esperando al cliente hace 3 semanas"
 * y "te falta hacer algo" se ven distinto y se actúa distinto.
 */
function queTraba(c) {
  const T = {
    rechazado: ["espera", "El cliente dijo que no continúa. Si se arrepintió, reabrí la decisión acá abajo y volvé a enviarle la demo."],
    demo_pendiente: ["falta", c.demo_url
      ? "El link ya está cargado: mandale la demo con el botón de arriba."
      : "Cargá el link de la demo más abajo y después mandásela."],
    demo_lista: ["espera", "Esperando que mire la demo y decida. Si ya te confirmó por WhatsApp, movelo a «Esperando el anticipo» con el selector."],
    anticipo_pendiente: hayComprobante(c)
      ? ["falta", "Subió el comprobante del anticipo. Aprobalo en el bloque de Cobros y el proyecto avanza solo."]
      : ["espera", "Esperando que pague el anticipo. Cuando se acredite pasa solo a «Aplicando los cambios»."],
    dominio: ["espera", "Esperando que elija la dirección de su página."],
    publicando: ["falta", "Te toca a vos: subí la página, conectá el dominio y después pedile el saldo con el botón de arriba."],
    saldo_pendiente: hayComprobante(c)
      ? ["falta", "Subió el comprobante del saldo. Aprobalo en Cobros y el proyecto se cierra solo."]
      : ["espera", "Esperando el pago del saldo. Cuando se acredite queda finalizado y se le muestra el link."],
    finalizado: ["ok", "Proyecto cerrado: cobrado, publicado y con el link a la vista del cliente."],
  };

  if (c.status === "en_produccion") {
    const faltan = Number(c.tareas_total) - Number(c.tareas_hechas);
    if (c.tareas_total === 0) {
      return { tono: "espera", texto: "Esperando que cargue sus cambios. También podés agregarlos vos acá abajo." };
    }
    if (faltan > 0) {
      return { tono: "falta", texto: `Te faltan ${faltan} cambio(s) por completar. Cuando estén todos, tocá el botón de arriba para pasar al dominio.` };
    }
    return { tono: "falta", texto: "Están todos los cambios hechos. Tocá el botón de arriba para que elija el dominio." };
  }

  const [tono, texto] = T[c.status] || ["espera", "Etapa sin descripción."];
  return { tono, texto };
}

/**
 * La acción principal de la etapa, si es que te toca a vos.
 * Devuelve null cuando la pelota es del cliente: en esas etapas no hay botón,
 * porque no hay nada que apretar.
 */
function accionPrincipal(c) {
  const paso = SIGUIENTE_PASO[c.status];
  if (!paso) return null;

  const falta =
    paso.requiere === "demo_url" && !c.demo_url ? "Cargá primero el link de la demo, más abajo." :
    paso.requiere === "production_url" && !c.production_url ? "Cargá primero el link de producción, más abajo." :
    null;

  return { ...paso, bloqueado: Boolean(falta), motivo: falta };
}

function bloqueFlujo(c) {
  const pasos = pasosDelFlujo(c);
  const traba = queTraba(c);
  const dominio = c.domain_choice || "ninguno";
  const turno = deQuienEsElTurno(c);
  const accion = accionPrincipal(c);

  /* Un ícono por estado del paso. Antes eran glifos de texto (✓ ● ○ ✕):
     cambiaban de grosor y de alineación vertical según la fuente instalada,
     así que la columna de la izquierda nunca quedaba derecha. */
  const iconos = {
    ok:        ico("check",   "pico pico-sm"),
    curso:     ico("punto",   "pico pico-xs"),
    pendiente: ico("circulo", "pico pico-sm"),
    no:        ico("cruz",    "pico pico-sm"),
  };
  const dePelota = {
    ariel: "Te toca a vos",
    cliente: "Le toca al cliente",
    nadie: "Sin acciones pendientes",
  };

  return `
    <div class="admin-bloque admin-flujo">
      <div class="flujo-cab">
        <label class="admin-bloque-label" style="margin:0">Flujo del proyecto · ${c.progreso}%</label>
        <span class="flujo-turno flujo-turno-${turno}">${dePelota[turno]}</span>
      </div>

      <ol class="flujo-pasos">
        ${pasos.map((p, i) => `
          <li class="flujo-paso flujo-${p.estado}">
            <span class="flujo-icono" aria-hidden="true">${iconos[p.estado]}</span>
            <div>
              <strong>${escapeHtml(PASOS_CLIENTE[i])}</strong>
              <span class="flujo-detalle">${escapeHtml(p.detalle)}</span>
            </div>
          </li>`).join("")}
      </ol>

      <p class="flujo-traba flujo-traba-${traba.tono}" role="status">${escapeHtml(traba.texto)}</p>

      ${accion ? `
        <div class="flujo-accion">
          <button type="button" class="btn btn-primary" data-accion="avanzar"
                  data-a="${escapeHtml(accion.a)}" ${accion.bloqueado ? "disabled" : ""}>
            ${escapeHtml(accion.boton)}
          </button>
          <p class="admin-hint">${escapeHtml(accion.bloqueado ? accion.motivo : accion.ayuda)}</p>
        </div>` : ""}

      <details class="flujo-manual">
        <summary>Mover el flujo a mano</summary>
        <p class="admin-hint">
          Salida de emergencia: sirve para volver atrás, o para reflejar algo que
          arreglaste por WhatsApp. El camino normal es el botón de arriba.
        </p>

        <div class="admin-form-grid">
          <div class="form-group">
            <label for="ed-estado-${c.id}">Etapa</label>
            <select id="ed-estado-${c.id}" data-campo="status">
              ${ORDEN_ETAPAS.concat("rechazado").map((k) =>
                `<option value="${k}" ${c.status === k ? "selected" : ""}>${escapeHtml(ESTADOS[k].label)}</option>`
              ).join("")}
            </select>
          </div>

          <div class="form-group">
            <label for="ed-dominio-${c.id}">Dominio</label>
            <select id="ed-dominio-${c.id}" data-campo="dominio">
              <option value="ninguno" ${dominio === "ninguno" ? "selected" : ""}>Sin definir (lo elige el cliente)</option>
              <option value="vercel"  ${dominio === "vercel"  ? "selected" : ""}>El de la demo (incluido)</option>
              <option value="propio"  ${dominio === "propio"  ? "selected" : ""}>Dominio propio (+${escapeHtml(usd(c.domain_extra_usd ?? 10))})</option>
            </select>
          </div>
        </div>

        <div class="form-group" data-zona="dominio-nombre" ${dominio === "propio" ? "" : "hidden"}>
          <label for="ed-dominio-nombre-${c.id}">Nombre del dominio</label>
          <input type="text" id="ed-dominio-nombre-${c.id}" maxlength="253"
                 value="${escapeHtml(c.domain_name || "")}"
                 placeholder="elcliente.com" data-campo="domain_name">
        </div>

        <p class="admin-hint">La etapa y el dominio se aplican con «Guardar cambios», más abajo.</p>

        ${c.client_decision ? `
          <div class="flujo-decision">
            <p class="admin-hint">
              El cliente ya respondió: <strong>${c.client_decision === "continuar" ? "continúa" : "no continúa"}</strong>.
              Mientras esa respuesta esté guardada no puede volver a elegir desde su link.
            </p>
            <button type="button" class="btn btn-sm btn-outline" data-accion="reabrir">
              Reabrir la decisión del cliente
            </button>
          </div>` : ""}
      </details>
    </div>`;
}
/* ==========================================================================
   Ficha desplegada
   ========================================================================== */
function ficha(c) {
  const cont = document.createElement("div");
  cont.className = "admin-cliente-ficha";

  const link = urlPortal(c.access_token);

  cont.innerHTML = `
    <div class="admin-bloque">
      <label class="admin-bloque-label">Link privado del cliente</label>
      <div class="admin-link-row">
        <input type="text" class="admin-link-input" readonly value="${escapeHtml(link)}"
               aria-label="Link privado del cliente">
        <button type="button" class="btn btn-sm btn-outline" data-accion="copiar">Copiar</button>
        <button type="button" class="btn btn-sm btn-outline" data-accion="whatsapp">WhatsApp</button>
      </div>
      <p class="admin-hint">
        ${c.is_active
          ? "Da acceso al panel del cliente. Pasáselo solo a él."
          : `<span class="admin-hint-alerta">${ico("alerta", "pico pico-sm")} Link revocado: el cliente ya no puede entrar.</span>`}
      </p>
      <p class="admin-hint">${rastroDeAcceso(c)}</p>
      ${esUrlDePreview() ? `
        <p class="admin-aviso-preview">
          <strong>Ojo:</strong> estás viendo el panel desde una URL de preview de Vercel.
          El link de arriba igual apunta a ${escapeHtml(sitioPublico)}, que es el correcto —
          pero para evitar confusiones conviene entrar al panel por
          ${escapeHtml(sitioPublico)}/admin.
        </p>` : ""}
    </div>

    ${bloqueFlujo(c)}

    <div class="admin-bloque">
      <div class="admin-form-grid">
        <div class="form-group">
          <label for="ed-brief-${c.id}">Descripción del proyecto / Brief escrito</label>
          <textarea id="ed-brief-${c.id}" rows="3" maxlength="2000" data-campo="project_brief">${escapeHtml(c.project_brief || "")}</textarea>
        </div>
        <div class="form-group">
          <label for="ed-brief-file-${c.id}">Subir / Cambiar PDF de Descripción</label>
          <input type="file" id="ed-brief-file-${c.id}" accept="application/pdf" data-campo="brief_file">
          ${c.brief_pdf_filename && c.brief_pdf_url ? `<button type="button" class="btn btn-sm btn-outline mt-1" data-pdf-url="${escapeHtml(c.brief_pdf_url)}" data-pdf-filename="${escapeHtml(c.brief_pdf_filename)}">${ico("documento", "pico pico-sm")} Ver PDF actual: ${escapeHtml(c.brief_pdf_filename)}</button>` : ""}
        </div>
      </div>

      <div class="admin-form-grid">
        <div class="form-group">
          <label for="ed-precio-${c.id}">Precio de producción (USD)</label>
          <input type="number" id="ed-precio-${c.id}" min="0" step="1"
                 value="${Number(c.price_usd) || 0}" data-campo="price_usd">
        </div>
        <div class="form-group">
          <label for="ed-proposal-url-${c.id}">Link de la propuesta</label>
          <input type="url" id="ed-proposal-url-${c.id}" value="${escapeHtml(c.proposal_url || "")}"
                 placeholder="https://drive.google.com/..." data-campo="proposal_url">
        </div>
      </div>

      <div class="form-group">
        <label for="ed-proposal-file-${c.id}">Subir / Cambiar PDF de la propuesta</label>
        <input type="file" id="ed-proposal-file-${c.id}" accept="application/pdf" data-campo="proposal_file">
        ${c.proposal_filename && c.proposal_url ? `<button type="button" class="btn btn-sm btn-outline mt-1" data-pdf-url="${escapeHtml(c.proposal_url)}" data-pdf-filename="${escapeHtml(c.proposal_filename)}">${ico("documento", "pico pico-sm")} Ver PDF actual: ${escapeHtml(c.proposal_filename)}</button>` : ""}
      </div>

      <!-- Presupuesto: documento aparte de la propuesta. La propuesta cuenta
           QUÉ se va a hacer; el presupuesto, CUÁNTO sale y con qué detalle.
           El cliente ve los dos en el primer paso, junto al precio. -->
      <div class="admin-form-grid">
        <div class="form-group">
          <label for="ed-budget-url-${c.id}">Link del presupuesto</label>
          <input type="url" id="ed-budget-url-${c.id}" value="${escapeHtml(esDato(c.budget_pdf_url) ? "" : (c.budget_pdf_url || ""))}"
                 placeholder="https://drive.google.com/..." data-campo="budget_pdf_url">
        </div>
        <div class="form-group">
          <label for="ed-budget-file-${c.id}">Subir / Cambiar PDF del presupuesto</label>
          <input type="file" id="ed-budget-file-${c.id}" accept="application/pdf" data-campo="budget_file">
          ${c.budget_pdf_filename && c.budget_pdf_url ? `<button type="button" class="btn btn-sm btn-outline mt-1" data-pdf-url="${escapeHtml(c.budget_pdf_url)}" data-pdf-filename="${escapeHtml(c.budget_pdf_filename)}">${ico("documento", "pico pico-sm")} Ver PDF actual: ${escapeHtml(c.budget_pdf_filename)}</button>` : ""}
        </div>
      </div>

      <div class="form-group">
        <label for="ed-demo-${c.id}">Link de la demo</label>
        <input type="url" id="ed-demo-${c.id}" value="${escapeHtml(c.demo_url || "")}"
               placeholder="https://cliente-demo.vercel.app" data-campo="demo_url">
      </div>

      <div class="form-group">
        <label for="ed-prod-${c.id}">Link de producción</label>
        <input type="url" id="ed-prod-${c.id}" value="${escapeHtml(c.production_url || "")}"
               placeholder="https://elcliente.com" data-campo="production_url">
        <p class="admin-hint">Solo se le muestra al cliente cuando el proyecto llega al 100% y está finalizado.</p>
      </div>

      <button type="button" class="btn btn-primary btn-sm" data-accion="guardar">Guardar cambios</button>
    </div>

    <div class="admin-bloque">
      <label class="admin-bloque-label">Tareas · ${c.tareas_hechas}/${c.tareas_total} completadas</label>
      <div class="admin-tareas" data-zona="tareas"><p class="admin-hint">Cargando…</p></div>
      <div class="admin-link-row" style="margin-top:12px; flex-wrap:wrap; gap:8px; align-items:center;">
        <input type="text" class="admin-link-input" data-campo="nueva-tarea" maxlength="400"
               placeholder="Agregar una tarea…" aria-label="Nueva tarea" style="flex:1; min-width:180px;">
        <label class="btn btn-sm btn-outline" style="cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
          ${ico("documento", "pico pico-sm")} Adjuntar PDF
          <input type="file" data-campo="nueva-tarea-pdf" accept="application/pdf" style="display:none">
        </label>
        <span data-zona="nueva-tarea-pdf-nombre" class="admin-hint" style="font-size:0.75rem; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
        <button type="button" class="btn btn-sm btn-outline" data-accion="add-tarea">Agregar</button>
      </div>
    </div>

    ${bloqueCobros(c)}

    <div class="admin-bloque admin-bloque-peligro">
      <button type="button" class="btn btn-sm btn-outline" data-accion="revocar">
        ${c.is_active ? "Revocar link" : "Reactivar link"}
      </button>
      <button type="button" class="btn btn-sm admin-btn-peligro" data-accion="eliminar">
        Eliminar cliente
      </button>
    </div>`;

  conectarFicha(cont, c, link);
  cargarTareas(cont, c);
  cargarPagos(cont, c);
  return cont;
}

function leerArchivoPdf(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.type !== "application/pdf") {
      return reject(new Error("El archivo debe ser un PDF."));
    }
    if (file.size > 5 * 1024 * 1024) {
      return reject(new Error("El PDF no puede pesar más de 5 MB."));
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ data: String(reader.result || ""), name: file.name });
    reader.onerror = () => reject(new Error("No se pudo leer el PDF."));
    reader.readAsDataURL(file);
  });
}

function conectarFicha(ficha, c, link) {
  const accion = (n) => ficha.querySelector(`[data-accion="${n}"]`);
  const leer = (campo) => ficha.querySelector(`[data-campo="${campo}"]`)?.value ?? "";

  // --- Copiar link ---
  accion("copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      anunciar("Link copiado.");
      avisar("Link copiado", "Ya lo podés pegar donde quieras.", "success");
    } catch {
      // El portapapeles falla sin HTTPS o sin permiso: se selecciona el texto.
      const input = ficha.querySelector(".admin-link-input");
      input.select();
      avisar("Copialo a mano", "Tu navegador bloqueó el portapapeles: el link quedó seleccionado.", "info");
    }
  });

  // --- Enviar por WhatsApp ---
  accion("whatsapp").addEventListener("click", () => {
    const texto =
      `Hola ${c.client_name}! Te dejo el link privado para seguir el avance de "${c.project_name}":\n\n${link}\n\n` +
      `Es personal, no lo compartas.`;
    const destino = c.whatsapp ? `https://wa.me/${encodeURIComponent(c.whatsapp)}` : "https://wa.me/";
    window.open(`${destino}?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  });

  // --- Guardar ---
  accion("guardar").addEventListener("click", async (e) => {
    const boton = e.currentTarget;
    const demo = leer("demo_url").trim();
    const prod = leer("production_url").trim();
    const brief = leer("project_brief").trim();
    let propUrl = leer("proposal_url").trim();
    let propName = c.proposal_filename || null;
    let briefPdfUrl = c.brief_pdf_url || null;
    let briefPdfName = c.brief_pdf_filename || null;

    const briefFileEl = ficha.querySelector('[data-campo="brief_file"]');
    if (briefFileEl && briefFileEl.files && briefFileEl.files[0]) {
      try {
        const resPdf = await leerArchivoPdf(briefFileEl.files[0]);
        if (resPdf) {
          briefPdfUrl = resPdf.data;
          briefPdfName = resPdf.name;
        }
      } catch (err) {
        avisar("Error de archivo", err.message, "warning");
        return;
      }
    }

    let budgetUrl = leer("budget_pdf_url").trim();
    let budgetName = c.budget_pdf_filename || null;

    // Si ya había un PDF guardado y el campo de link quedó vacío, se conserva
    // el PDF: vaciar un input que nunca mostró el valor no es "borralo".
    if (!budgetUrl && esDato(c.budget_pdf_url)) budgetUrl = c.budget_pdf_url;

    const budgetFileEl = ficha.querySelector('[data-campo="budget_file"]');
    if (budgetFileEl && budgetFileEl.files && budgetFileEl.files[0]) {
      try {
        const resPdf = await leerArchivoPdf(budgetFileEl.files[0]);
        if (resPdf) {
          budgetUrl = resPdf.data;
          budgetName = resPdf.name;
        }
      } catch (err) {
        avisar("Error de archivo", err.message, "warning");
        return;
      }
    }

    const propFileEl = ficha.querySelector('[data-campo="proposal_file"]');
    if (propFileEl && propFileEl.files && propFileEl.files[0]) {
      try {
        const resPdf = await leerArchivoPdf(propFileEl.files[0]);
        if (resPdf) {
          propUrl = resPdf.data;
          propName = resPdf.name;
        }
      } catch (err) {
        avisar("Error de archivo", err.message, "warning");
        return;
      }
    }

    if (demo && !safeUrl(demo, "")) {
      avisar("Link de demo inválido", "Tiene que empezar con http:// o https://", "warning");
      return;
    }
    if (prod && !safeUrl(prod, "")) {
      avisar("Link de producción inválido", "Tiene que empezar con http:// o https://", "warning");
      return;
    }

    const precio = Number(leer("price_usd"));
    if (!Number.isFinite(precio) || precio < 0) {
      avisar("Precio inválido", "Ingresá un número mayor o igual a cero.", "warning");
      return;
    }

    boton.disabled = true;
    try {
      const datos = await adminActualizarCliente(c.id, {
        price_usd: precio,
        project_brief: brief || null,
        brief_pdf_url: briefPdfUrl || null,
        brief_pdf_filename: briefPdfName || null,
        proposal_url: propUrl || null,
        proposal_filename: propName || null,
        budget_pdf_url: budgetUrl || null,
        budget_pdf_filename: budgetName || null,
        demo_url: demo || null,
        production_url: prod || null,
      });
      if (!datos.ok) {
        avisar("No se pudo guardar", datos.error, "error");
        return;
      }

      const flujo = await adminMoverFlujo(c.id, {
        status: leer("status"),
        dominio: leer("dominio") || "ninguno",
        dominioNombre: leer("domain_name").trim() || null,
      });
      if (!flujo.ok) {
        avisar("No se pudo mover el flujo", flujo.error, "error");
        return;
      }

      await recargar();

      const avisos = Array.isArray(flujo.avisos) ? flujo.avisos : [];
      if (avisos.length) {
        avisar(
          `Guardado · ${flujo.progreso}%`,
          `Ojo con esto:\n\n• ${avisos.join("\n• ")}`,
          "info"
        );
      } else {
        avisar("Guardado", `El proyecto quedó en ${flujo.progreso}%.`, "success");
      }
    } finally {
      boton.disabled = false;
    }
  });

  // --- Acción principal de la etapa ---
  // Es el camino normal: un botón que dice exactamente qué va a pasar. La
  // migración 05 se encarga de los efectos (crear el cobro, abrir el paso
  // siguiente), así que desde acá solo hay que pedir la transición.
  const btnAvanzar = accion("avanzar");
  if (btnAvanzar) {
    btnAvanzar.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const destino = b.dataset.a;

      const ok = await confirmar({
        titulo: "¿Pasamos al siguiente paso?",
        texto: `${c.project_name}: el proyecto pasa a «${ESTADOS[destino]?.label || destino}» y el cliente lo ve al instante en su link.`,
        confirmar: "Sí, avanzar",
        icono: "question",
      });
      if (!ok) return;

      b.disabled = true;
      const res = await adminMoverFlujo(c.id, { status: destino });
      b.disabled = false;

      if (!res.ok) {
        avisar("No se pudo avanzar", res.error, "error");
        return;
      }
      await recargar();
      anunciar("Etapa actualizada.");

      const avisos = Array.isArray(res.avisos) ? res.avisos : [];
      avisar(
        `Listo · ${res.progreso}%`,
        avisos.length
          ? `El proyecto pasó a «${ESTADOS[res.status]?.label || res.status}».\n\nOjo con esto:\n• ${avisos.join("\n• ")}`
          : `El proyecto pasó a «${ESTADOS[res.status]?.label || res.status}».`,
        avisos.length ? "info" : "success"
      );
    });
  }

  // --- Mostrar/ocultar el nombre del dominio según la opción elegida ---
  const selDominio = ficha.querySelector('[data-campo="dominio"]');
  const zonaNombre = ficha.querySelector('[data-zona="dominio-nombre"]');
  if (selDominio && zonaNombre) {
    selDominio.addEventListener("change", () => {
      zonaNombre.hidden = selDominio.value !== "propio";
    });
  }

  // --- Reabrir la decisión del cliente ---
  // Sin esto, un cliente que dijo que no (o que aceptó por error) quedaba
  // trabado para siempre: portal_decidir contesta "Ya registramos tu
  // respuesta" mientras la decisión siga guardada.
  const btnReabrir = accion("reabrir");
  if (btnReabrir) {
    btnReabrir.addEventListener("click", async () => {
      const ok = await confirmar({
        titulo: "¿Reabrir la decisión?",
        texto: `${c.client_name} va a poder volver a elegir desde su link cuando el proyecto esté en «Demo lista». Las tareas y los cobros ya cargados no se tocan.`,
        confirmar: "Sí, reabrir",
        icono: "question",
      });
      if (!ok) return;

      const res = await adminMoverFlujo(c.id, { status: "demo_lista", reabrirDecision: true });
      if (!res.ok) {
        avisar("No se pudo reabrir", res.error, "error");
        return;
      }
      await recargar();
      anunciar("Decisión reabierta.");
      avisar(
        "Decisión reabierta",
        "El proyecto volvió a «Demo lista» y el cliente puede responder de nuevo desde su link.",
        "success"
      );
    });
  }

  // --- Nueva tarea ---
  const campo = ficha.querySelector('[data-campo="nueva-tarea"]');
  const pdfInput = ficha.querySelector('[data-campo="nueva-tarea-pdf"]');
  const pdfNombreLabel = ficha.querySelector('[data-zona="nueva-tarea-pdf-nombre"]');

  if (pdfInput && pdfNombreLabel) {
    pdfInput.addEventListener("change", () => {
      if (pdfInput.files && pdfInput.files[0]) {
        /* innerHTML en vez de textContent porque el ícono es un <svg>. El
           nombre del archivo lo elige quien usa el panel, pero igual va
           escapado: un archivo llamado `<img onerror=…>.pdf` no tiene que
           poder ejecutar nada. */
        pdfNombreLabel.innerHTML =
          `${ico("documento", "pico pico-xs")} ${escapeHtml(pdfInput.files[0].name)}`;
      } else {
        pdfNombreLabel.textContent = "";
      }
    });
  }

  const crearTarea = async () => {
    const texto = sanitizeText(campo.value, 400);
    if (!texto) return;

    let pdfData = null;
    let pdfName = null;

    if (pdfInput && pdfInput.files && pdfInput.files[0]) {
      try {
        const resPdf = await leerArchivoPdf(pdfInput.files[0]);
        if (resPdf) {
          pdfData = resPdf.data;
          pdfName = resPdf.name;
        }
      } catch (err) {
        avisar("Error en PDF de la tarea", err.message, "warning");
        return;
      }
    }

    const res = await adminAgregarTarea(c.id, texto, 999, pdfData, pdfName);
    if (!res.ok) {
      avisar("No se pudo agregar", res.error, "error");
      return;
    }
    campo.value = "";
    if (pdfInput) pdfInput.value = "";
    if (pdfNombreLabel) pdfNombreLabel.textContent = "";
    await recargar();
  };

  accion("add-tarea").addEventListener("click", crearTarea);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); crearTarea(); }
  });

  conectarCobros(ficha, c);

  // --- Revocar / reactivar ---
  accion("revocar").addEventListener("click", async () => {
    const revocando = c.is_active;
    const ok = await confirmar({
      titulo: revocando ? "¿Revocar el link?" : "¿Reactivar el link?",
      texto: revocando
        ? "El cliente va a dejar de poder entrar. Los datos se conservan."
        : "El cliente va a poder volver a entrar con el mismo link.",
      confirmar: revocando ? "Sí, revocar" : "Sí, reactivar",
      peligroso: revocando,
    });
    if (!ok) return;

    const res = await adminRevocarLink(c.id, !revocando);
    if (!res.ok) {
      avisar("No se pudo cambiar", res.error, "error");
      return;
    }
    await recargar();
  });

  // --- Eliminar ---
  accion("eliminar").addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "¿Eliminar el cliente?",
      html: `Se borra <strong>${escapeHtml(c.project_name)}</strong> con todas sus tareas y
             el historial de cobros. Esto no se puede deshacer.<br><br>
             Si solo querés cortarle el acceso, usá <em>Revocar link</em>.`,
      confirmar: "Sí, eliminar todo",
      peligroso: true,
    });
    if (!ok) return;

    const res = await adminEliminarCliente(c.id);
    if (!res.ok) {
      avisar("No se pudo eliminar", res.error, "error");
      return;
    }
    expandido = null;
    await recargar();
    avisar("Eliminado", "El cliente y sus datos se borraron.", "success");
  });
}

/* ==========================================================================
   Sub-listas
   ========================================================================== */
async function cargarTareas(ficha, c) {
  const zona = ficha.querySelector('[data-zona="tareas"]');
  const tareas = await adminListarTareas(c.id);

  zona.innerHTML = "";
  if (tareas.length === 0) {
    zona.innerHTML = `<p class="admin-hint">Sin tareas. Se cargan solas cuando el cliente pide sus cambios.</p>`;
    return;
  }

  tareas.forEach((t) => {
    const fila = document.createElement("div");
    fila.className = `admin-tarea ${t.done ? "hecha" : ""}`;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = t.done;
    check.id = `ct-${t.id}`;
    check.addEventListener("change", async () => {
      check.disabled = true;
      const res = await adminMarcarTarea(t.id, check.checked);
      if (!res.ok) {
        check.checked = !check.checked;   // el servidor rechazó: revertir
        avisar("No se pudo actualizar", res.error, "error");
        check.disabled = false;
        return;
      }
      await recargar();
    });

    const etiqueta = document.createElement("label");
    etiqueta.htmlFor = check.id;
    etiqueta.className = "admin-tarea-texto";
    etiqueta.textContent = t.title;

    const borrar = document.createElement("button");
    borrar.type = "button";
    borrar.className = "admin-tarea-borrar";
    borrar.setAttribute("aria-label", `Eliminar tarea: ${t.title}`);
    borrar.textContent = "×";
    borrar.addEventListener("click", async () => {
      const res = await adminEliminarTarea(t.id);
      if (!res.ok) {
        avisar("No se pudo eliminar", res.error, "error");
        return;
      }
      await recargar();
    });

    fila.append(check, etiqueta);

    if (t.pdf_data) {
      const pdfBtn = document.createElement("button");
      pdfBtn.type = "button";
      pdfBtn.dataset.pdfUrl = t.pdf_data;
      pdfBtn.dataset.pdfFilename = t.pdf_name || "Tarea.pdf";
      pdfBtn.className = "admin-tarea-pdf-link";
      pdfBtn.style.cssText = "font-size:0.75rem; color: #60a5fa; margin-left:8px; background:none; border:none; padding:0; cursor:pointer; display:inline-flex; align-items:center; gap:3px; font-family:inherit;";
      pdfBtn.innerHTML =
        `${ico("documento", "pico pico-xs")}<u>${escapeHtml(t.pdf_name || "Ver PDF")}</u>`;
      fila.appendChild(pdfBtn);
    }

    if (t.source === "cliente") {
      const origen = document.createElement("span");
      origen.className = "admin-tarea-origen";
      origen.textContent = "pedido";
      fila.appendChild(origen);
    }

    fila.appendChild(borrar);
    zona.appendChild(fila);
  });
}

/* ==========================================================================
   Cobros
   --------------------------------------------------------------------------
   El bloque de plata de cada cliente. Antes lo único que se podía hacer era
   «marcar pagado» y crear un cobro manual suelto: si un cliente pagaba una
   reserva o se acordaba otra forma de pago por WhatsApp, el panel no tenía
   dónde reflejarlo y el portal le seguía pidiendo el anticipo completo.

   Ahora:
     · el plan se puede fijar desde acá (y el cliente lo ve fijado);
     · cada cobro se edita entero: monto, estado, medio, fecha y concepto;
     · las reservas se descuentan solas del cobro inicial;
     · el saldo final es siempre «lo que falta», no un 50% fijo.

   Ver supabase/migracion-14-pagos-flexibles.sql y FLUJO.md.
   ========================================================================== */

const ESTADO_PAGO = {
  pendiente: "Pendiente",
  en_proceso: "En Mercado Pago",
  en_revision: "Comprobante a revisar",
  pagado: "Pagado",
  rechazado: "Rechazado",
};

const MEDIO_PAGO = {
  transferencia: "Transferencia",
  mercadopago: "Mercado Pago",
  efectivo: "Efectivo",
  otro: "Otro",
};

/* Los tres tipos que se cargan a mano. Anticipo, pago total y saldo los
   genera el plan solo: crearlos a mano duplicaría lo que ya hace la base. */
const TIPOS_MANUALES = {
  reserva: "Plata a cuenta del precio, cobrada antes de arrancar. Se descuenta sola del anticipo o del pago total.",
  cuota: "Una parte del precio. Para armar un plan personalizado (por ejemplo 3 cuotas por transferencia).",
  otro: "Algo fuera del presupuesto: una sección extra, un logo, un mes de mantenimiento.",
};

const dosDigitos = (n) => String(n).padStart(2, "0");
const aInputFecha = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
const fechaDeIso = (iso) => (iso ? aInputFecha(new Date(iso)) : aInputFecha(new Date()));
const fechaCorta = (iso) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
const redondo = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Precio + dominio propio. Es lo que el cliente paga por el proyecto. */
function totalDelProyecto(c) {
  const dominio = c.domain_choice === "propio" ? Number(c.domain_extra_usd ?? 10) : 0;
  return redondo(Number(c.price_usd || 0) + dominio);
}

function bloqueCobros(c) {
  const plan = c.payment_plan || "";
  const origen = !plan
    ? "Sin plan todavía: lo elige el cliente cuando acepta la demo, o lo fijás vos acá."
    : c.plan_fijado
      ? "Fijado por vos: el cliente lo ve en su link y no puede elegir otro."
      : "Lo eligió el cliente al aceptar la demo.";

  return `
    <div class="admin-bloque admin-cobros">
      <label class="admin-bloque-label">Cobros</label>
      <div class="cobros-resumen" data-zona="cobros-resumen" aria-live="polite"></div>

      <div class="cobros-plan">
        <div class="form-group">
          <label for="ed-plan-${c.id}">Plan de pago</label>
          <select id="ed-plan-${c.id}" data-campo="plan">
            ${plan ? "" : `<option value="" selected>Sin definir — lo elige el cliente</option>`}
            ${Object.entries(PLANES).map(([k, p]) => `
              <option value="${k}" ${plan === k ? "selected" : ""}>${escapeHtml(p.label)} · ${escapeHtml(p.detalle)}</option>`).join("")}
          </select>
        </div>
        <label class="cobros-check">
          <input type="checkbox" data-campo="plan-fijar" ${c.plan_fijado || !plan ? "checked" : ""}>
          <span>Fijarlo: el cliente ve este plan en su link y no puede cambiarlo</span>
        </label>
        <div class="cobros-plan-pie">
          <p class="admin-hint">${escapeHtml(origen)}</p>
          <button type="button" class="btn btn-sm btn-outline" data-accion="aplicar-plan">Aplicar plan</button>
        </div>
      </div>

      <div class="admin-pagos" data-zona="pagos"><p class="admin-hint">Cargando…</p></div>

      <div class="admin-link-row cobros-acciones">
        <button type="button" class="btn btn-sm btn-primary" data-accion="nuevo-cobro">+ Agregar cobro</button>
        <button type="button" class="btn btn-sm btn-outline" data-accion="recalcular-saldo">Recalcular el saldo final</button>
      </div>
      <p class="admin-hint">
        Reservas y cuotas son parte del precio; un extra se cobra aparte. El saldo
        final siempre es lo que falta: precio + dominio − lo ya cobrado o programado.
      </p>
    </div>`;
}

function pintarResumenCobros(zona, c, pagos) {
  const total = totalDelProyecto(c);
  const suma = (lista) => redondo(lista.reduce((a, p) => a + Number(p.amount_usd || 0), 0));

  const extras = suma(pagos.filter((p) => p.kind === "otro"));
  const cobrado = suma(pagos.filter((p) => p.status === "pagado"));
  const pendiente = suma(pagos.filter((p) => p.status !== "pagado"));
  // 'dominio' es un cobro viejo del dominio propio aparte: ya está dentro del total.
  const aCuenta = suma(pagos.filter((p) => KINDS_A_CUENTA.includes(p.kind) || p.kind === "dominio"));
  const sinProgramar = redondo(total - aCuenta);

  const nota = sinProgramar > 0
    ? `<p class="cobros-nota">${escapeHtml(usd(sinProgramar))} del precio todavía no tienen cobro: se piden con el saldo final.</p>`
    : sinProgramar < 0
      ? `<p class="cobros-nota alerta">${ico("alerta", "pico pico-sm")} Programaste ${escapeHtml(usd(-sinProgramar))} más que el precio. Revisá los montos o subí el precio.</p>`
      : "";

  zona.innerHTML = `
    <dl class="cobros-kpis">
      <div><dt>Total del proyecto</dt><dd>${escapeHtml(usd(total + extras))}</dd>
        ${extras > 0 ? `<small>incluye ${escapeHtml(usd(extras))} de extras</small>` : ""}</div>
      <div><dt>Cobrado</dt><dd class="verde">${escapeHtml(usd(cobrado))}</dd></div>
      <div><dt>Pendiente</dt><dd class="ambar">${escapeHtml(usd(pendiente))}</dd></div>
      <div><dt>Sin programar</dt><dd>${escapeHtml(usd(Math.max(sinProgramar, 0)))}</dd></div>
    </dl>
    ${nota}`;
}

async function cargarPagos(ficha, c) {
  const zona = ficha.querySelector('[data-zona="pagos"]');
  const resumen = ficha.querySelector('[data-zona="cobros-resumen"]');
  const pagos = await adminListarPagos(c.id);

  pintarResumenCobros(resumen, c, pagos);

  zona.innerHTML = "";
  if (pagos.length === 0) {
    zona.innerHTML = `<p class="admin-hint">Sin cobros todavía. Se generan solos según el plan cuando el cliente acepta la demo, o cargalos vos con «+ Agregar cobro».</p>`;
    return;
  }

  pagos.forEach((p) => zona.appendChild(filaCobro(c, p)));
}

function filaCobro(c, p) {
  const fila = document.createElement("div");
  fila.className = `admin-pago admin-pago-${p.status}`;

  const meta =
    p.status === "pagado"
      ? `${MEDIO_PAGO[p.method] || "Sin medio"}${p.paid_at ? ` · ${fechaCorta(p.paid_at)}` : ""}`
      : p.status === "en_proceso"
        ? "El cliente abrió el link de Mercado Pago"
        : p.status === "en_revision"
          ? "Subió el comprobante: revisalo en la pestaña Cobros"
          : `Generado el ${fechaCorta(p.created_at)}`;

  fila.innerHTML = `
    <div class="admin-pago-info">
      <span class="admin-pago-tipo">${escapeHtml(ETIQUETA_PAGO[p.kind] || p.kind)}${
        p.concepto ? ` <span class="admin-pago-concepto">· ${escapeHtml(p.concepto)}</span>` : ""}</span>
      <span class="admin-pago-meta">${escapeHtml(meta)}</span>
    </div>
    <span class="admin-pago-monto">${escapeHtml(usd(p.amount_usd))}</span>
    <span class="admin-badge ${escapeHtml(p.status)}">${escapeHtml(ESTADO_PAGO[p.status] || p.status)}</span>
    <div class="admin-pago-botones"></div>`;

  const botones = fila.querySelector(".admin-pago-botones");
  const boton = (texto, clase, alHacerClick, aria) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn-sm ${clase}`;
    b.textContent = texto;
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", alHacerClick);
    botones.appendChild(b);
  };

  const nombre = `${ETIQUETA_PAGO[p.kind] || p.kind} de ${usd(p.amount_usd)}`;

  if (p.status !== "pagado" && p.status !== "en_revision") {
    boton("Marcar pagado", "btn-outline", () => dialogoCobro(c, { pago: p, marcarPagado: true }),
      `Marcar pagado: ${nombre}`);
  }
  boton("Editar", "btn-outline", () => dialogoCobro(c, { pago: p }), `Editar: ${nombre}`);
  boton("Eliminar", "admin-btn-peligro", () => eliminarCobro(c, p), `Eliminar: ${nombre}`);

  return fila;
}

/**
 * Si el cliente ya aceptó, rehace el cobro inicial con las reservas de hoy.
 * Se llama después de tocar una reserva: sin esto el anticipo seguía con el
 * monto viejo y el cliente veía que le pedían de más.
 */
async function recalcularInicio(c) {
  if (Number(c.orden) < 2 || c.status === "finalizado" || c.payment_plan === "personalizado") return [];
  const res = await adminConfigurarPlan(c.id, c.payment_plan || "mitades", Boolean(c.plan_fijado));
  if (!res.ok) return [`No se pudo recalcular el anticipo: ${res.error}`];
  return Array.isArray(res.avisos) ? res.avisos : [];
}

/**
 * El formulario de un cobro: alta (pago = null) o edición.
 * `marcarPagado` abre la edición con el estado ya en «pagado».
 */
async function dialogoCobro(c, { pago = null, marcarPagado = false } = {}) {
  const Swal = window.Swal;
  if (!Swal) return;

  const nuevo = !pago;
  const estadoInicial = marcarPagado ? "pagado" : pago?.status || "pagado";
  const estados = ["pendiente", "pagado"].concat(
    pago && !["pendiente", "pagado"].includes(pago.status) ? [pago.status] : []);
  const medioInicial = pago?.method || "transferencia";

  const opciones = (obj, elegido) => Object.entries(obj)
    .map(([k, v]) => `<option value="${k}" ${k === elegido ? "selected" : ""}>${escapeHtml(v)}</option>`).join("");

  const aviso = pago?.status === "en_proceso"
    ? `<p class="cobro-form-aviso">El cliente abrió el link de Mercado Pago. Si cambiás el monto, ese link deja de acreditarse solo: un pago hecho con él queda para que lo revises.</p>`
    : pago?.method === "mercadopago" && marcarPagado
      ? `<p class="cobro-form-aviso">Este cobro se inició por Mercado Pago y se acredita solo cuando MP lo confirma. Marcalo a mano solo si viste la plata en tu cuenta.</p>`
      : "";

  const { value } = await Swal.fire({
    title: nuevo ? "Agregar cobro" : marcarPagado ? "Marcar como pagado" : "Editar cobro",
    width: 520,
    html: `
      <div class="cobro-form">
        ${nuevo ? `
          <label class="cobro-campo">
            <span>Tipo</span>
            <select id="cf-kind">
              <option value="reserva">Reserva — a cuenta del precio</option>
              <option value="cuota">Cuota — parte del precio</option>
              <option value="otro">Extra — fuera del presupuesto</option>
            </select>
          </label>
          <p class="cobro-form-ayuda" id="cf-kind-ayuda">${escapeHtml(TIPOS_MANUALES.reserva)}</p>`
        : `<p class="cobro-form-tipo">${escapeHtml(ETIQUETA_PAGO[pago.kind] || pago.kind)} · ${escapeHtml(c.project_name)}</p>`}

        <label class="cobro-campo">
          <span>Concepto <small>(lo ve el cliente)</small></span>
          <input id="cf-concepto" maxlength="200" value="${escapeHtml(pago?.concepto || "")}"
                 placeholder="${nuevo ? "Ej: Reserva para arrancar" : "Opcional"}">
        </label>

        <div class="cobro-fila">
          <label class="cobro-campo">
            <span>Monto (USD)</span>
            <input id="cf-monto" type="number" min="0" step="0.01" inputmode="decimal"
                   value="${pago ? Number(pago.amount_usd) : ""}">
          </label>
          <label class="cobro-campo">
            <span>Estado</span>
            <select id="cf-estado">${estados.map((e) =>
              `<option value="${e}" ${e === estadoInicial ? "selected" : ""}>${escapeHtml(ESTADO_PAGO[e] || e)}</option>`).join("")}</select>
          </label>
        </div>

        <div class="cobro-fila" id="cf-datos-pago">
          <label class="cobro-campo">
            <span>Medio</span>
            <select id="cf-medio">${opciones(MEDIO_PAGO, medioInicial)}</select>
          </label>
          <label class="cobro-campo">
            <span>Fecha de pago</span>
            <input id="cf-fecha" type="date" value="${fechaDeIso(pago?.paid_at)}" max="${aInputFecha(new Date())}">
          </label>
        </div>
        ${aviso}
      </div>`,
    showCancelButton: true,
    confirmButtonText: nuevo ? "Agregar" : "Guardar",
    cancelButtonText: "Cancelar",
    didOpen: (popup) => {
      const estado = popup.querySelector("#cf-estado");
      const datos = popup.querySelector("#cf-datos-pago");
      const kind = popup.querySelector("#cf-kind");
      const ayuda = popup.querySelector("#cf-kind-ayuda");
      const sincronizar = () => { datos.hidden = estado.value !== "pagado"; };
      estado.addEventListener("change", sincronizar);
      kind?.addEventListener("change", () => {
        ayuda.textContent = TIPOS_MANUALES[kind.value];
        // Una reserva casi siempre se carga cuando ya entró la plata; una
        // cuota o un extra, cuando todavía hay que cobrarlos.
        estado.value = kind.value === "reserva" ? "pagado" : "pendiente";
        sincronizar();
      });
      sincronizar();
      popup.querySelector("#cf-monto")?.focus();
    },
    preConfirm: () => {
      const monto = Number(document.getElementById("cf-monto").value);
      if (!Number.isFinite(monto) || monto <= 0) {
        Swal.showValidationMessage("Ingresá un monto mayor a cero.");
        return false;
      }
      return {
        kind: document.getElementById("cf-kind")?.value || pago.kind,
        concepto: sanitizeText(document.getElementById("cf-concepto").value, 200),
        monto: redondo(monto),
        estado: document.getElementById("cf-estado").value,
        medio: document.getElementById("cf-medio").value,
        fecha: document.getElementById("cf-fecha").value,
      };
    },
  });

  if (!value) return;

  const res = nuevo
    ? await adminCrearCobro(c.id, {
        kind: value.kind, concepto: value.concepto, montoUsd: value.monto,
        pagado: value.estado === "pagado", method: value.medio, fecha: value.fecha,
      })
    : await adminEditarCobro(pago, {
        montoUsd: value.monto, status: value.estado, concepto: value.concepto,
        method: value.estado === "pagado" ? value.medio : (value.estado === "pendiente" ? null : pago.method),
        fecha: value.fecha,
      });

  if (!res.ok) {
    avisar("No se pudo guardar", res.error, "error");
    return;
  }

  const avisos = value.kind === "reserva" ? await recalcularInicio(c) : [];
  await recargar();

  const texto = nuevo
    ? value.estado === "pagado" ? "Se sumó como cobrado." : "Le va a figurar al cliente para abonar."
    : "El cobro quedó actualizado y el cliente ya lo ve así en su link.";
  avisar(nuevo ? "Cobro agregado" : "Cobro guardado",
    avisos.length ? `${texto}\n\n• ${avisos.join("\n• ")}` : texto,
    avisos.length ? "info" : "success");
}

async function eliminarCobro(c, p) {
  const pagado = p.status === "pagado";
  const ok = await confirmar({
    titulo: "¿Eliminar este cobro?",
    html: `<strong>${escapeHtml(ETIQUETA_PAGO[p.kind] || p.kind)}${p.concepto ? ` · ${escapeHtml(p.concepto)}` : ""}</strong>
           por ${escapeHtml(usd(p.amount_usd))}.<br><br>${pagado
      ? "Figura como <strong>pagado</strong>: si lo borrás, desaparece del total cobrado y del historial del cliente, junto con su recibo. Si solo te equivocaste en el estado, usá «Editar»."
      : "El cliente deja de verlo para pagar."}`,
    confirmar: "Sí, eliminar",
    peligroso: true,
  });
  if (!ok) return;

  const res = await adminEliminarCobro(p.id);
  if (!res.ok) {
    avisar("No se pudo eliminar", res.error, "error");
    return;
  }

  const avisos = p.kind === "reserva" ? await recalcularInicio(c) : [];
  await recargar();
  avisar("Cobro eliminado", avisos.length ? `• ${avisos.join("\n• ")}` : "Ya no figura en el proyecto.",
    avisos.length ? "info" : "success");
}

function conectarCobros(ficha, c) {
  const accion = (n) => ficha.querySelector(`[data-accion="${n}"]`);

  accion("aplicar-plan").addEventListener("click", async (e) => {
    const plan = ficha.querySelector('[data-campo="plan"]').value;
    const fijar = ficha.querySelector('[data-campo="plan-fijar"]').checked;
    if (!plan) {
      avisar("Elegí un plan", "Seleccioná cómo va a pagar el cliente.", "warning");
      return;
    }

    const yaAcepto = Number(c.orden) >= 2;
    const ok = await confirmar({
      titulo: `¿Aplicar «${PLANES[plan].label}»?`,
      texto: yaAcepto
        ? "Se rehace el cobro inicial (anticipo o pago total) con este plan, descontando las reservas. Lo que ya está cobrado no se toca."
        : fijar
          ? "Cuando el cliente abra la demo va a ver este plan, sin poder elegir otro."
          : "Queda como sugerencia: el cliente igual puede elegir otro al aceptar la demo.",
      confirmar: "Sí, aplicar",
      icono: "question",
    });
    if (!ok) return;

    const b = e.currentTarget;
    b.disabled = true;
    const res = await adminConfigurarPlan(c.id, plan, fijar);
    b.disabled = false;

    if (!res.ok) {
      avisar("No se pudo aplicar", res.error, "error");
      return;
    }
    await recargar();
    const avisos = Array.isArray(res.avisos) ? res.avisos : [];
    avisar("Plan aplicado",
      avisos.length ? `• ${avisos.join("\n• ")}` : `El cliente ya ve «${PLANES[plan].label}» en su link.`,
      avisos.length ? "info" : "success");
  });

  accion("nuevo-cobro").addEventListener("click", () => dialogoCobro(c));

  accion("recalcular-saldo").addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "¿Recalcular el saldo final?",
      texto: "Se borra el saldo pendiente y se vuelve a calcular con lo que falta hoy: precio + dominio − lo ya cobrado o programado. Si no falta nada, no se genera.",
      confirmar: "Sí, recalcular",
      icono: "question",
    });
    if (!ok) return;

    const res = await adminRecalcularSaldo(c.id);
    if (!res.ok) {
      avisar("No se pudo recalcular", res.error, "error");
      return;
    }
    await recargar();
    avisar("Saldo recalculado",
      Number(res.monto) > 0
        ? `Saldo final: ${usd(res.monto)}. Ya le figura al cliente para abonar.`
        : "No queda nada por cobrar del precio: no se generó saldo.",
      "success");
  });
}

/* ==========================================================================
   Alta de cliente
   ========================================================================== */
function conectarAlta() {
  const panel = $("panel-alta");

  $("btn-abrir-alta").addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) $("cli-nombre").focus();
  });

  $("btn-cancelar-alta").addEventListener("click", () => {
    panel.classList.add("hidden");
    $("form-nuevo-cliente").reset();
    $("cli-precio").value = "0";
  });

  $("form-nuevo-cliente").addEventListener("submit", async (e) => {
    e.preventDefault();

    const boton = $("btn-crear-cliente");
    if (boton.disabled) return;

    let briefPdfUrl = null;
    let briefPdfFilename = null;
    const briefFileEl = $("cli-brief-file");
    if (briefFileEl && briefFileEl.files && briefFileEl.files[0]) {
      try {
        const pdfRes = await leerArchivoPdf(briefFileEl.files[0]);
        if (pdfRes) {
          briefPdfUrl = pdfRes.data;
          briefPdfFilename = pdfRes.name;
        }
      } catch (err) {
        avisar("Error de PDF", err.message, "warning");
        return;
      }
    }

    let propUrl = $("cli-proposal-url")?.value.trim() || null;
    let propName = null;
    const propFileEl = $("cli-proposal-file");
    if (propFileEl && propFileEl.files && propFileEl.files[0]) {
      try {
        const pdfRes = await leerArchivoPdf(propFileEl.files[0]);
        if (pdfRes) {
          propUrl = pdfRes.data;
          propName = pdfRes.name;
        }
      } catch (err) {
        avisar("Error de PDF", err.message, "warning");
        return;
      }
    }

    let budgetUrl = $("cli-budget-url")?.value.trim() || null;
    let budgetName = null;
    const budgetFileEl = $("cli-budget-file");
    if (budgetFileEl && budgetFileEl.files && budgetFileEl.files[0]) {
      try {
        const pdfRes = await leerArchivoPdf(budgetFileEl.files[0]);
        if (pdfRes) {
          budgetUrl = pdfRes.data;
          budgetName = pdfRes.name;
        }
      } catch (err) {
        avisar("Error de PDF", err.message, "warning");
        return;
      }
    }

    const datos = {
      clientName: sanitizeText($("cli-nombre").value, 120),
      projectName: sanitizeText($("cli-proyecto").value, 120),
      brief: sanitizeText($("cli-brief").value, 2000),
      briefPdfUrl,
      briefPdfFilename,
      proposalUrl: propUrl,
      proposalFilename: propName,
      budgetPdfUrl: budgetUrl,
      budgetPdfFilename: budgetName,
      demoUrl: $("cli-demo").value.trim(),
      priceUsd: Number($("cli-precio").value),
      whatsapp: sanitizeText($("cli-whatsapp").value, 30).replace(/[^\d+]/g, ""),
    };

    if (!datos.clientName || !datos.projectName) {
      avisar("Faltan datos", "El nombre de la persona y el de la página son obligatorios.", "warning");
      return;
    }
    if (datos.demoUrl && !safeUrl(datos.demoUrl, "")) {
      avisar("Link inválido", "El link de la demo debe empezar con http:// o https://", "warning");
      return;
    }
    if (!Number.isFinite(datos.priceUsd) || datos.priceUsd < 0) {
      avisar("Precio inválido", "Ingresá un número válido.", "warning");
      return;
    }

    boton.disabled = true;
    boton.textContent = "Creando…";

    try {
      const res = await adminCrearCliente(datos);
      if (!res.ok) {
        avisar("No se pudo crear", res.error, "error");
        return;
      }

      const link = urlPortal(res.cliente.access_token);

      $("form-nuevo-cliente").reset();
      $("cli-precio").value = "0";
      panel.classList.add("hidden");

      await recargar();
      await mostrarLinkNuevo(datos.clientName, link);
    } finally {
      boton.disabled = false;
      boton.textContent = "Crear cliente y generar link";
    }
  });
}

/**
 * El link se muestra una vez, grande y copiable: pasárselo al cliente es lo
 * único que hay que hacer a continuación, así que no conviene esconderlo
 * dentro de la lista.
 */
async function mostrarLinkNuevo(nombre, link) {
  const Swal = window.Swal;
  if (!Swal) {
    avisar("Cliente creado", link, "success");
    return;
  }

  const r = await Swal.fire({
    title: "Cliente creado",
    html: `
      <p style="margin-bottom:12px">Pasale este link a <strong>${escapeHtml(nombre)}</strong>:</p>
      <input readonly value="${escapeHtml(link)}"
             style="width:100%;padding:11px;border-radius:9px;font-size:12px;
                    background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.15);
                    color:inherit" onclick="this.select()">
      <p style="margin-top:12px;font-size:.85rem;opacity:.75">
        Es personal e intransferible. Podés revocarlo cuando quieras.</p>`,
    icon: "success",
    confirmButtonText: "Copiar link",
    showCancelButton: true,
    cancelButtonText: "Listo",
  });

  if (r.isConfirmed) {
    try {
      await navigator.clipboard.writeText(link);
      avisar("Copiado", "El link está en tu portapapeles.", "success");
    } catch {
      /* sin permiso de portapapeles: el link ya quedó visible arriba */
    }
  }
}

/* ==========================================================================
   Recarga
   --------------------------------------------------------------------------
   Se delega en admin.js porque marcar una tarea o acreditar un pago también
   cambia los KPIs del Resumen y la tabla de Cobros. Recargar solo esta
   sección dejaría los otros números desactualizados.
   ========================================================================== */
async function recargar() {
  const { refrescarTodo } = await import("./admin.js");
  await refrescarTodo();
}
