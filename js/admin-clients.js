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
  adminCrearCliente, adminActualizarCliente, adminEliminarCliente, adminRevocarLink,
  adminListarTareas, adminAgregarTarea, adminMarcarTarea, adminEliminarTarea,
  adminListarPagos, adminMarcarPago, adminCrearSaldoFinal, adminCrearCobroManual,
  urlPortal, ESTADOS, ETIQUETA_PAGO,
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
  if (filtro === "activos") {
    return clientes.filter((c) => ["demo_pendiente", "demo_lista", "en_produccion"].includes(c.status));
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
    </div>

    <div class="admin-bloque">
      <div class="admin-form-grid">
        <div class="form-group">
          <label for="ed-estado-${c.id}">Estado</label>
          <select id="ed-estado-${c.id}" data-campo="status">
            ${Object.entries(ESTADOS).map(([k, v]) =>
              `<option value="${k}" ${c.status === k ? "selected" : ""}>${escapeHtml(v.label)}</option>`
            ).join("")}
          </select>
        </div>
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
          Generar saldo final (50%)
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
      const res = await adminActualizarCliente(c.id, {
        status: leer("status"),
        price_usd: precio,
        demo_url: demo || null,
        production_url: prod || null,
      });

      if (!res.ok) {
        avisar("No se pudo guardar", res.error, "error");
        return;
      }
      await recargar();
      avisar("Guardado", "Los datos del cliente se actualizaron.", "success");
    } finally {
      boton.disabled = false;
    }
  });

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
    const res = await adminCrearSaldoFinal(c.id, Number(c.price_usd) || 0);
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
