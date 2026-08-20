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
  adminListarPagos, adminMarcarPago, adminCrearSaldoFinal, adminCrearCobroManual,
  urlPortal, ESTADOS, ORDEN_ETAPAS, SIGUIENTE_PASO, ETIQUETA_PAGO,
} from "./clients.js";
import { escapeHtml, safeUrl, sanitizeText } from "./security.js";
import { confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";

const $ = (id) => document.getElementById(id);

let clientes = [];
let expandido = null;    // id del cliente con la ficha abierta
let filtro = "activos";

const usd = (n) => `USD ${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

/* ==========================================================================
   Arranque (una sola vez)
   ========================================================================== */
export function iniciarSeccionClientes() {
  conectarAlta();
  conectarFiltros();
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
           <div class="admin-vacio-icono" aria-hidden="true">👤</div>
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

  const alerta = vistas > 200 ? " ⚠️ son muchas: si no las hizo el cliente, revocá el link." : "";

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

  const iconos = { ok: "✓", curso: "●", pendiente: "○", no: "✕" };
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
          : "⚠️ Link revocado: el cliente ya no puede entrar."}
      </p>
      <p class="admin-hint">${rastroDeAcceso(c)}</p>
    </div>

    ${bloqueFlujo(c)}

    <div class="admin-bloque">
      <div class="admin-form-grid">
        <div class="form-group">
          <label for="ed-precio-${c.id}">Precio de producción (USD)</label>
          <input type="number" id="ed-precio-${c.id}" min="0" step="1"
                 value="${Number(c.price_usd) || 0}" data-campo="price_usd">
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
      <div class="admin-link-row" style="margin-top:12px">
        <input type="text" class="admin-link-input" data-campo="nueva-tarea" maxlength="400"
               placeholder="Agregar una tarea…" aria-label="Nueva tarea">
        <button type="button" class="btn btn-sm btn-outline" data-accion="add-tarea">Agregar</button>
      </div>
    </div>

    <div class="admin-bloque">
      <label class="admin-bloque-label">
        Cobros · ${usd(c.cobrado_usd)} cobrado / ${usd(c.pendiente_usd)} pendiente
      </label>
      <div class="admin-pagos" data-zona="pagos"><p class="admin-hint">Cargando…</p></div>
      <div class="admin-link-row" style="margin-top:12px">
        <button type="button" class="btn btn-sm btn-outline" data-accion="crear-saldo">
          Generar el saldo final
        </button>
        <button type="button" class="btn btn-sm btn-outline" data-accion="cobro-manual">
          + Cobro manual
        </button>
      </div>
    </div>

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

    // Se valida acá además de en la base: un CHECK que salta devuelve un error
    // de Postgres ilegible; este mensaje dice qué corregir.
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
      // ORDEN A PROPÓSITO: primero los datos sueltos, después el flujo.
      // admin_mover_flujo revisa si falta el link de producción para avisar,
      // así que el link tiene que estar guardado antes de que lo mire. Al
      // revés, avisaría de algo que el usuario acaba de completar.
      const datos = await adminActualizarCliente(c.id, {
        price_usd: precio,
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

      const res = await adminMoverFlujo(c.id, { reabrirDecision: true });
      if (!res.ok) {
        avisar("No se pudo reabrir", res.error, "error");
        return;
      }
      await recargar();
      anunciar("Decisión reabierta.");
      avisar(
        "Decisión reabierta",
        "Poné el proyecto en «Demo lista» para que el cliente pueda responder de nuevo por el mismo link.",
        "success"
      );
    });
  }

  // --- Nueva tarea ---
  const campo = ficha.querySelector('[data-campo="nueva-tarea"]');
  const crearTarea = async () => {
    const texto = sanitizeText(campo.value, 400);
    if (!texto) return;

    const res = await adminAgregarTarea(c.id, texto);
    if (!res.ok) {
      avisar("No se pudo agregar", res.error, "error");
      return;
    }
    campo.value = "";
    await recargar();
  };

  accion("add-tarea").addEventListener("click", crearTarea);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); crearTarea(); }
  });

  // --- Saldo final ---
  accion("crear-saldo").addEventListener("click", async () => {
    const res = await adminCrearSaldoFinal(c.id);
    if (!res.ok) {
      avisar("No se pudo generar", res.error, "error");
      return;
    }
    await recargar();
    avisar("Saldo generado", "Ya le figura al cliente para abonar.", "success");
  });

  // --- Cobro manual ---
  accion("cobro-manual").addEventListener("click", async () => {
    const Swal = window.Swal;
    if (!Swal) return;

    const { value } = await Swal.fire({
      title: "Cobro manual",
      html: `
        <input id="cm-concepto" class="swal2-input" placeholder="Concepto (ej: sección extra)" maxlength="200">
        <input id="cm-monto" class="swal2-input" type="number" min="0" step="1" placeholder="Monto en USD">
        <label style="display:flex;align-items:center;gap:9px;margin-top:14px;
                      font-size:.9rem;text-align:left;cursor:pointer">
          <input type="checkbox" id="cm-cobrado" style="width:18px;height:18px;accent-color:#22c55e">
          Ya lo cobré (se suma al total de una vez)
        </label>`,
      showCancelButton: true,
      confirmButtonText: "Agregar",
      cancelButtonText: "Cancelar",
      focusConfirm: false,
      preConfirm: () => {
        const concepto = document.getElementById("cm-concepto").value.trim();
        const monto = Number(document.getElementById("cm-monto").value);
        const cobrado = document.getElementById("cm-cobrado").checked;

        // La validación va acá adentro: si se deja pasar y falla después,
        // el usuario pierde lo que escribió y tiene que cargarlo de nuevo.
        if (!Number.isFinite(monto) || monto <= 0) {
          Swal.showValidationMessage("Ingresá un monto mayor a cero.");
          return false;
        }
        return { concepto, monto, cobrado };
      },
    });

    if (!value) return;

    const res = await adminCrearCobroManual(c.id, {
      concepto: sanitizeText(value.concepto, 200),
      montoUsd: value.monto,
      yaCobrado: value.cobrado,
    });

    if (!res.ok) {
      avisar("No se pudo agregar", res.error, "error");
      return;
    }
    await recargar();
    avisar("Cobro agregado", value.cobrado
      ? "Se sumó como cobrado."
      : "Le va a figurar al cliente para abonar.", "success");
  });

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

async function cargarPagos(ficha, c) {
  const zona = ficha.querySelector('[data-zona="pagos"]');
  const pagos = await adminListarPagos(c.id);

  zona.innerHTML = "";
  if (pagos.length === 0) {
    zona.innerHTML = `<p class="admin-hint">Sin cobros generados. El anticipo se crea solo cuando el cliente acepta pasar a producción.</p>`;
    return;
  }

  pagos.forEach((p) => {
    const fila = document.createElement("div");
    fila.className = "admin-pago";

    fila.innerHTML = `
      <span class="admin-pago-tipo">${escapeHtml(ETIQUETA_PAGO[p.kind] || p.kind)}</span>
      <span class="admin-pago-monto">${escapeHtml(usd(p.amount_usd))}</span>
      <span class="admin-badge ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span>`;

    if (p.status === "en_revision") {
      const aviso = document.createElement("span");
      aviso.className = "admin-hint";
      aviso.style.flexBasis = "100%";
      aviso.textContent = "El cliente subió un comprobante. Revisalo desde la sección Cobros.";
      fila.appendChild(aviso);
    } else if (p.status !== "pagado") {
      const porMp = p.method === "mercadopago";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline";
      btn.textContent = "Marcar pagado";

      btn.addEventListener("click", async () => {
        // Los cobros por Mercado Pago los confirma el webhook con el dato
        // verificado contra MP. Marcarlos a mano rompe esa cadena: se avisa.
        const ok = await confirmar({
          titulo: "¿Marcar como pagado?",
          texto: porMp
            ? "Este cobro se inició por Mercado Pago y se acredita solo cuando MP lo confirma. Marcalo a mano solo si verificaste el dinero en tu cuenta."
            : "Confirmá que recibiste la transferencia antes de marcarlo.",
          confirmar: "Sí, ya cobré",
          icono: "question",
        });
        if (!ok) return;

        const res = await adminMarcarPago(p.id, { status: "pagado", method: p.method || "transferencia" });
        if (!res.ok) {
          avisar("No se pudo marcar", res.error, "error");
          return;
        }
        await recargar();
      });

      fila.appendChild(btn);
    }

    zona.appendChild(fila);
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
    if (boton.disabled) return;   // evita crear dos clientes con doble clic

    const datos = {
      clientName: sanitizeText($("cli-nombre").value, 120),
      projectName: sanitizeText($("cli-proyecto").value, 120),
      brief: sanitizeText($("cli-brief").value, 2000),
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
