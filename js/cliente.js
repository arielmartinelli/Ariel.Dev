/**
 * cliente.js — Portal privado del cliente.
 *
 * Se entra con /cliente/<token>. El token es lo unico que identifica a la
 * persona: no hay login. Por eso:
 *
 *  - El token NUNCA se guarda en localStorage. Si la maquina es compartida,
 *    dejarlo persistido significa que el siguiente que la use entra al panel.
 *    Vive en memoria mientras dura la pestana y nada mas.
 *  - No se manda en la URL a ningun tercero: la pagina declara
 *    <meta name="referrer" content="no-referrer">, asi que al tocar el link de
 *    la demo el token NO viaja en la cabecera Referer al sitio de destino.
 *    Sin eso, el token quedaria en los logs de cualquier servidor visitado.
 *  - Todo lo que se muestra viene de funciones RPC que validan el token en el
 *    servidor. El navegador no filtra nada: no tiene acceso a filtrar.
 */

import {
  portalObtener,
  portalDecidir,
  portalElegirDominio,
  portalPedirCambio,
  portalSubirComprobante,
  ESTADOS,
  ETIQUETA_PAGO,
} from "./clients.js";
import { escapeHtml, safeUrl, sanitizeText } from "./security.js";
import { configurarDialogos, confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";

const WHATSAPP = "543517877753";

/* Datos para transferencia. Si algun dia cambian, se cambian ACA y listo:
   estan en un solo lugar y no repartidos por el HTML. */
const DATOS_TRANSFERENCIA = {
  alias: "Ariel.fit",
  titular: "Ariel Omar Martinelli",
  banco: "Mercado Pago",
};

/* Pago que el cliente eligio abonar por transferencia (kind + monto). */
let pagoTransferencia = null;
let comprobanteBase64 = "";

/* ==========================================================================
   Token: se lee de la URL y se saca de la barra de direcciones
   ========================================================================== */

/**
 * Acepta las dos formas:
 *   /cliente/<token>        (bonita, via rewrite de Vercel)
 *   /cliente.html?t=<token> (respaldo si el rewrite no esta activo)
 */
function leerToken() {
  const params = new URLSearchParams(window.location.search);
  const deQuery = params.get("t");
  if (deQuery) return deQuery.trim();

  const partes = window.location.pathname.split("/").filter(Boolean);
  const i = partes.indexOf("cliente");
  if (i !== -1 && partes[i + 1]) {
    try {
      return decodeURIComponent(partes[i + 1]).trim();
    } catch {
      return partes[i + 1].trim();
    }
  }
  return "";
}

const TOKEN = leerToken();

// Se lee ANTES de limpiar la URL: Mercado Pago devuelve al cliente con
// ?pago=... y si se borra la query primero, ese dato se pierde.
const VUELVE_DE_PAGO = Boolean(new URLSearchParams(window.location.search).get("pago"));

// EL TOKEN SE QUEDA EN LA URL. A PROPOSITO.
//
// Antes esto lo borraba de la barra de direcciones apenas se leia, para que
// no quedara a la vista en una captura. Sonaba prudente y era un desastre:
// al recargar, al volver con la flecha o al abrir el favorito, la URL ya era
// /cliente/ sin token y el portal decia "este link no es valido". El cliente
// perdia el acceso a su propio proyecto por usar el navegador con normalidad.
//
// El link ES la credencial: si se borra, no hay forma de volver a entrar sin
// pedirselo de nuevo a Ariel. Tiene que sobrevivir a recargas y favoritos.
//
// Lo que si protege de verdad sigue en su lugar:
//   - <meta name="referrer" content="no-referrer"> en cliente.html, para que
//     el token NO viaje en la cabecera Referer al tocar el link de la demo;
//   - Cache-Control: private, no-store en vercel.json;
//   - el token no se guarda en localStorage.

/* ==========================================================================
   Referencias al DOM
   ========================================================================== */
const $ = (id) => document.getElementById(id);

const vistas = {
  cargando: $("portal-cargando"),
  invalido: $("portal-invalido"),
  contenido: $("portal-contenido"),
};

let datos = null;          // ultimo estado traido del servidor
let decisionElegida = null; // 'continuar' mientras el cliente completa cambios

/* ==========================================================================
   Helpers de presentacion
   ========================================================================== */
const usd = (n) =>
  `USD ${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function mostrarVista(cual) {
  Object.entries(vistas).forEach(([nombre, el]) => {
    if (el) el.classList.toggle("hidden", nombre !== cual);
  });
}

function mostrarBloque(id, visible) {
  const el = $(id);
  if (el) el.hidden = !visible;
}

function enlaceWhatsApp(texto) {
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
}

/* ==========================================================================
   Render principal
   ========================================================================== */
function render() {
  if (!datos) return;

  const {
    client_name, project_name, project_brief, status, demo_url,
    price_usd, total_usd, domain_choice, domain_extra_usd,
    progreso, production_url, tareas = [], pagos = [],
  } = datos;

  // --- Encabezado ---
  $("pc-nombre").textContent = client_name || "";
  $("pc-proyecto").textContent = project_name || "Tu proyecto";
  document.title = `${project_name || "Tu proyecto"} | Seguimiento`;

  const brief = $("pc-brief");
  brief.textContent = project_brief || "";
  brief.hidden = !project_brief;

  const meta = ESTADOS[status] || { label: status, color: "#64748b" };
  const chip = $("pc-estado");
  chip.textContent = meta.label;
  chip.style.setProperty("--chip-color", meta.color);

  // --- Bloque demo ---
  const enDemo = status === "demo_lista";
  mostrarBloque("pc-bloque-demo", enDemo);
  if (enDemo && demo_url) {
    const link = $("pc-demo-link");
    link.href = safeUrl(demo_url, "#");
    link.hidden = false;
  } else if (enDemo) {
    $("pc-demo-link").hidden = true;
  }
  $("pc-anticipo-monto").textContent = usd((Number(price_usd) || 0) * 0.5);

  // --- Progreso ---
  const enProduccion = status === "en_produccion" || status === "finalizado";
  mostrarBloque("pc-bloque-progreso", enProduccion);
  mostrarBloque("pc-hero-progreso", enProduccion);
  if (enProduccion) pintarProgreso(progreso, tareas, domain_choice);

  // --- Dominio: aparece durante la produccion, antes de cerrar el 100% ---
  const necesitaDominio = status === "en_produccion" && !domain_choice;
  mostrarBloque("pc-bloque-dominio", necesitaDominio);
  if (necesitaDominio) {
    $("pc-dom-precio").textContent = `+${usd(domain_extra_usd)}`;
    if (demo_url) {
      $("pc-dom-vercel-desc").textContent =
        `El mismo de tu demo (${dominioLegible(demo_url)}). Sin costo adicional.`;
    }
  }

  // --- Pagos ---
  mostrarBloque("pc-bloque-pagos", pagos.length > 0);
  if (pagos.length > 0) {
    $("pc-total").textContent = `Total: ${usd(total_usd)}`;
    pintarPagos(pagos);
  }

  // --- Pedido de cambios extra ---
  mostrarBloque("pc-bloque-pedido", status === "en_produccion");

  // --- Final ---
  const finalizado = status === "finalizado" && production_url;
  mostrarBloque("pc-bloque-final", Boolean(finalizado));
  if (finalizado) $("pc-final-link").href = safeUrl(production_url, "#");

  // --- Rechazado ---
  mostrarBloque("pc-bloque-rechazado", status === "rechazado");

  // --- Links de WhatsApp contextualizados ---
  const asunto = `Hola Ariel, te escribo por el proyecto "${project_name || ""}".`;
  ["pc-wa-footer", "pc-wa-rechazo", "portal-wa-ayuda"].forEach((id) => {
    const el = $(id);
    if (el) el.href = enlaceWhatsApp(asunto);
  });

  mostrarVista("contenido");
}

function dominioLegible(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "el dominio de la demo";
  }
}

function pintarProgreso(progreso, tareas, domainChoice) {
  const pct = Math.max(0, Math.min(100, Number(progreso) || 0));

  $("pc-progreso-num").textContent = `${pct}%`;
  $("pc-barra").style.width = `${pct}%`;

  // La barra vive en el encabezado, ancho completo: se lee de un vistazo.

  const wrap = $("pc-barra-wrap");
  wrap.setAttribute("aria-valuenow", String(pct));
  wrap.setAttribute("aria-valuetext", `${pct} por ciento completado`);

  // Explica por que el numero se queda en 99: sin esto parece que algo falla.
  const nota = $("pc-nota-progreso");
  if (pct === 100) {
    nota.textContent = "¡Listo! Tu página está terminada.";
  } else if (pct === 99 && !domainChoice) {
    nota.textContent = "Falta solo un paso: elegir el dominio para poder publicar.";
  } else {
    const hechas = tareas.filter((t) => t.done).length;
    nota.textContent = `${hechas} de ${tareas.length} cambios completados.`;
  }

  const lista = $("pc-tareas");
  lista.innerHTML = "";
  tareas.forEach((t) => {
    const li = document.createElement("li");
    li.className = `portal-tarea ${t.done ? "hecha" : ""}`;
    li.innerHTML = `
      <span class="portal-tarea-check" aria-hidden="true">${t.done ? "✓" : ""}</span>
      <span class="portal-tarea-texto">${escapeHtml(t.title)}</span>
      <span class="sr-only">${t.done ? "Completado" : "Pendiente"}</span>
    `;
    lista.appendChild(li);
  });
}

function pintarPagos(pagos) {
  const cont = $("pc-pagos");
  cont.innerHTML = "";

  pagos.forEach((p) => {
    const pagado = p.status === "pagado";
    const enProceso = p.status === "en_proceso";
    const enRevision = p.status === "en_revision";

    const fila = document.createElement("div");
    fila.className = `portal-pago ${pagado ? "pagado" : ""} ${enRevision ? "en-revision" : ""}`;

    // Cada estado dice algo distinto y concreto. "Pendiente" a secas, cuando
    // el cliente ya mandó el comprobante, lo hace pensar que no llegó.
    const estadoTexto = pagado
      ? "Pagado"
      : enRevision
        ? "Comprobante enviado · lo estoy revisando"
        : enProceso
          ? "Procesando…"
          : "Pendiente";

    fila.innerHTML = `
      <div class="portal-pago-info">
        <span class="portal-pago-tipo">${escapeHtml(ETIQUETA_PAGO[p.kind] || p.kind)}</span>
        <span class="portal-pago-estado">${escapeHtml(estadoTexto)}</span>
      </div>
      <div class="portal-pago-monto">${escapeHtml(usd(p.amount_usd))}</div>
    `;

    if (!pagado && !enProceso && !enRevision) {
      const acciones = document.createElement("div");
      acciones.className = "portal-pago-acciones";

      const mp = document.createElement("button");
      mp.type = "button";
      mp.className = "btn btn-primary btn-sm";
      mp.textContent = "Mercado Pago";
      mp.addEventListener("click", () => iniciarPago(p.kind, mp));

      const transf = document.createElement("button");
      transf.type = "button";
      transf.className = "btn btn-outline btn-sm";
      transf.textContent = "Transferencia";
      transf.addEventListener("click", () => abrirTransferencia(p));

      acciones.append(mp, transf);
      fila.appendChild(acciones);
    }

    cont.appendChild(fila);
  });
}

/* ==========================================================================
   Transferencia + comprobante
   ========================================================================== */
function abrirTransferencia(pago) {
  pagoTransferencia = pago;

  $("pc-transf-concepto").textContent = ETIQUETA_PAGO[pago.kind] || pago.kind;
  $("pc-transf-monto").textContent = usd(pago.amount_usd);
  $("pc-alias").textContent = DATOS_TRANSFERENCIA.alias;

  const bloque = $("pc-bloque-transferencia");
  bloque.classList.remove("hidden");
  bloque.scrollIntoView({ behavior: "smooth", block: "center" });
  anunciar("Datos para transferir");
}

function cerrarTransferencia() {
  $("pc-bloque-transferencia").classList.add("hidden");
  $("pc-form-comprobante").reset();
  $("pc-comprobante-preview").classList.add("hidden");
  $("pc-comprobante-texto").textContent = "Tocá para elegir la imagen";
  comprobanteBase64 = "";
  pagoTransferencia = null;
}

$("pc-cancelar-transferencia")?.addEventListener("click", cerrarTransferencia);

/* Copiar el alias. Tipear un alias a mano desde el celular sale mal seguido. */
document.querySelectorAll("[data-copiar]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const texto = $(btn.dataset.copiar)?.textContent?.trim() || "";
    try {
      await navigator.clipboard.writeText(texto);
      btn.textContent = "¡Copiado!";
      setTimeout(() => { btn.textContent = "Copiar"; }, 1800);
    } catch {
      // Sin HTTPS o sin permiso el portapapeles falla: se selecciona el texto
      // para que se pueda copiar a mano.
      const rango = document.createRange();
      rango.selectNodeContents($(btn.dataset.copiar));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rango);
      avisar("Copialo a mano", "Tu navegador bloqueó el portapapeles: el alias quedó seleccionado.", "info");
    }
  });
});

$("pc-comprobante-zona")?.addEventListener("click", () => $("pc-comprobante-file").click());
$("pc-comprobante-preview")?.addEventListener("click", () => $("pc-comprobante-file").click());

$("pc-comprobante-file")?.addEventListener("change", (e) => {
  const archivo = e.target.files[0];
  if (archivo) comprimirImagen(archivo);
});

/**
 * Comprime la foto ANTES de mandarla.
 *
 * Una foto de celular pesa 3-6 MB. Mandarla tal cual significa que el cliente
 * espera medio minuto con datos moviles, que la base guarda megabytes por cada
 * comprobante, y que muchas veces directamente falla. Un comprobante solo
 * tiene que ser LEGIBLE: 1200px de lado y JPEG al 75% alcanza de sobra y
 * queda en 100-300 KB.
 */
function comprimirImagen(archivo) {
  const TIPOS = ["image/png", "image/jpeg", "image/webp"];
  if (!TIPOS.includes(archivo.type)) {
    avisar("Formato no soportado", "Mandá una imagen JPG, PNG o WEBP.", "warning");
    return;
  }

  // Tope de entrada generoso: lo que importa es el tamaño DESPUÉS de comprimir.
  if (archivo.size > 20 * 1024 * 1024) {
    avisar("Imagen muy pesada", "Probá con una foto más chica.", "warning");
    return;
  }

  const lector = new FileReader();
  lector.onerror = () => avisar("Error", "No se pudo leer el archivo.", "error");

  lector.onload = () => {
    const img = new Image();

    img.onerror = () => avisar("Archivo inválido", "Eso no parece una imagen.", "error");

    img.onload = () => {
      const MAX = 1200;
      const escala = Math.min(1, MAX / Math.max(img.width, img.height));
      const ancho = Math.round(img.width * escala);
      const alto = Math.round(img.height * escala);

      const lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;
      lienzo.getContext("2d").drawImage(img, 0, 0, ancho, alto);

      comprobanteBase64 = lienzo.toDataURL("image/jpeg", 0.75);

      const kb = Math.round((comprobanteBase64.length * 0.75) / 1024);
      $("pc-comprobante-preview").src = comprobanteBase64;
      $("pc-comprobante-preview").classList.remove("hidden");
      $("pc-comprobante-texto").textContent = `Imagen lista (${kb} KB) · tocá para cambiarla`;
      anunciar("Comprobante cargado.");
    };

    img.src = String(lector.result || "");
  };

  lector.readAsDataURL(archivo);
}

$("pc-form-comprobante")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!pagoTransferencia) return;

  if (!comprobanteBase64) {
    avisar("Falta el comprobante", "Elegí la imagen del comprobante antes de enviar.", "warning");
    return;
  }

  const boton = $("pc-enviar-comprobante");
  boton.disabled = true;
  boton.textContent = "Enviando…";

  try {
    const res = await portalSubirComprobante(
      TOKEN,
      pagoTransferencia.kind,
      comprobanteBase64,
      sanitizeText($("pc-comprobante-nota").value, 500)
    );

    if (!res?.ok) {
      avisar("No se pudo enviar", res?.error || "Probá de nuevo.", "error");
      return;
    }

    cerrarTransferencia();
    await recargar();
    avisar(
      "¡Comprobante recibido!",
      "Lo reviso y te lo confirmo. Vas a ver el pago acreditado acá mismo.",
      "success"
    );
  } finally {
    boton.disabled = false;
    boton.textContent = "Enviar comprobante";
  }
});

/* ==========================================================================
   Acciones del cliente
   ========================================================================== */

async function recargar() {
  datos = await portalObtener(TOKEN);
  if (!datos) {
    mostrarVista("invalido");
    return;
  }
  render();
}

// --- Decision sobre continuar ---
$("pc-btn-continuar")?.addEventListener("click", () => {
  decisionElegida = "continuar";
  $("pc-decision").classList.add("hidden");
  $("pc-form-cambios").classList.remove("hidden");
  if ($("pc-lista-cambios").children.length === 0) agregarCampoCambio();
  $("pc-form-cambios").scrollIntoView({ behavior: "smooth", block: "nearest" });
  anunciar("Contanos qué cambios querés hacer.");
});

$("pc-btn-no-continuar")?.addEventListener("click", async () => {
  const ok = await confirmar({
    titulo: "¿Preferís no seguir por ahora?",
    texto: "Podés escribirme cuando quieras para retomar. No se pierde nada.",
    confirmar: "Sí, por ahora no",
    cancelar: "Volver",
    icono: "question",
  });
  if (!ok) return;

  const res = await portalDecidir(TOKEN, "no_continuar");
  if (!res?.ok) {
    avisar("No se pudo registrar", res?.error || "Probá de nuevo.", "error");
    return;
  }
  await recargar();
});

function agregarCampoCambio(valor = "") {
  const lista = $("pc-lista-cambios");
  // Tope del lado del cliente que acompaña al del servidor (40).
  if (lista.children.length >= 40) return;

  const fila = document.createElement("div");
  fila.className = "portal-cambio-fila";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "portal-cambio-input";
  input.maxLength = 400;
  input.placeholder = "Ej: cambiar la foto principal por otra";
  input.value = valor;
  input.setAttribute("aria-label", "Cambio solicitado");

  const quitar = document.createElement("button");
  quitar.type = "button";
  quitar.className = "portal-cambio-quitar";
  quitar.setAttribute("aria-label", "Quitar este cambio");
  quitar.textContent = "×";
  quitar.addEventListener("click", () => {
    fila.remove();
    if (lista.children.length === 0) agregarCampoCambio();
  });

  fila.append(input, quitar);
  lista.appendChild(fila);
  input.focus();
}

$("pc-add-cambio")?.addEventListener("click", () => agregarCampoCambio());

$("pc-form-cambios")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (decisionElegida !== "continuar") return;

  const cambios = Array.from($("pc-lista-cambios").querySelectorAll(".portal-cambio-input"))
    .map((i) => sanitizeText(i.value, 400))
    .filter(Boolean);

  const anticipo = usd((Number(datos?.price_usd) || 0) * 0.5);
  const ok = await confirmar({
    titulo: "¿Confirmamos el arranque?",
    html: `
      <p style="margin-bottom:10px">Voy a registrar
        <strong>${cambios.length}</strong> ${cambios.length === 1 ? "cambio" : "cambios"}
        y arrancamos con la producción.</p>
      <p>Para iniciar se abona un adelanto del 50%: <strong>${escapeHtml(anticipo)}</strong>.</p>`,
    confirmar: "Sí, arrancamos",
    icono: "question",
  });
  if (!ok) return;

  const boton = $("pc-enviar-cambios");
  boton.disabled = true;
  boton.textContent = "Guardando…";

  try {
    const res = await portalDecidir(TOKEN, "continuar", cambios);
    if (!res?.ok) {
      avisar("No se pudo confirmar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    await recargar();
    avisar(
      "¡Arrancamos!",
      "Ya podés seguir el avance acá mismo. Abajo te dejo el adelanto para abonar.",
      "success"
    );
  } finally {
    boton.disabled = false;
    boton.textContent = "Confirmar y arrancar";
  }
});

// --- Dominio ---
document.querySelectorAll('input[name="dominio"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const propio = $("pc-dom-propio")?.checked;
    $("pc-dominio-nombre-wrap").classList.toggle("hidden", !propio);
    if (propio) $("pc-dominio-nombre").focus();
  });
});

$("pc-guardar-dominio")?.addEventListener("click", async () => {
  const elegido = document.querySelector('input[name="dominio"]:checked');
  if (!elegido) {
    avisar("Elegí una opción", "Marcá el dominio incluido o uno propio.", "warning");
    return;
  }

  const opcion = elegido.value;
  let nombre = null;

  if (opcion === "propio") {
    nombre = sanitizeText($("pc-dominio-nombre").value, 253).toLowerCase();
    // Validacion basica: evita mandar "quiero un .com" como si fuera dominio.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(nombre)) {
      avisar("Revisá el dominio", "Escribilo como tunegocio.com, sin http ni barras.", "warning");
      return;
    }

    const ok = await confirmar({
      titulo: "Dominio propio",
      html: `Se agrega <strong>${escapeHtml(usd(datos?.domain_extra_usd))}</strong> al total
             por la compra y configuración de <strong>${escapeHtml(nombre)}</strong>.`,
      confirmar: "Confirmar",
      icono: "info",
    });
    if (!ok) return;
  }

  const btn = $("pc-guardar-dominio");
  btn.disabled = true;
  try {
    const res = await portalElegirDominio(TOKEN, opcion, nombre);
    if (!res?.ok) {
      avisar("No se pudo guardar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    await recargar();
    avisar("Dominio confirmado", "Ya lo tengo anotado. Cualquier detalle lo vemos por WhatsApp.", "success");
  } finally {
    btn.disabled = false;
  }
});

// --- Pedido de cambio durante la produccion ---
$("pc-form-pedido")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const campo = $("pc-pedido-texto");
  const texto = sanitizeText(campo.value, 400);
  if (!texto) {
    avisar("Falta el detalle", "Contame qué querés cambiar.", "warning");
    return;
  }

  const res = await portalPedirCambio(TOKEN, texto);
  if (!res?.ok) {
    avisar("No se pudo enviar", res?.error || "Probá de nuevo.", "error");
    return;
  }
  campo.value = "";
  await recargar();
  avisar("Pedido enviado", "Lo sumé a la lista de cambios.", "success");
});

/* ==========================================================================
   Pago con Mercado Pago
   --------------------------------------------------------------------------
   El navegador NO habla con Mercado Pago directamente: para crear una
   preferencia hace falta el ACCESS_TOKEN de la cuenta, que es un secreto y
   jamas puede estar en el bundle. Se pide a una funcion serverless (Vercel),
   que es la unica que lo conoce. Ver api/mp-crear-preferencia.js.
   ========================================================================== */
async function iniciarPago(kind, boton) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Abriendo Mercado Pago…";

  try {
    const respuesta = await fetch("/api/mp-crear-preferencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, kind }),
    });

    const cuerpo = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok || !cuerpo.init_point) {
      avisar(
        "No se pudo abrir el pago",
        cuerpo.error || "Escribime por WhatsApp y lo resolvemos en un minuto.",
        "error"
      );
      return;
    }

    window.location.href = cuerpo.init_point;
  } catch (err) {
    console.error("Error iniciando el pago:", err?.message || err);
    avisar("Sin conexión", "No pudimos contactar el servidor de pagos. Probá de nuevo.", "error");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

/* ==========================================================================
   Arranque
   ========================================================================== */
(async function iniciar() {
  configurarDialogos();

  $("portal-wa-ayuda").href = enlaceWhatsApp("Hola Ariel, el link de mi proyecto no me funciona.");

  if (!TOKEN || TOKEN.length < 20) {
    mostrarVista("invalido");
    return;
  }

  try {
    datos = await portalObtener(TOKEN);
    if (!datos) {
      mostrarVista("invalido");
      return;
    }
    render();

    // Si el cliente vuelve desde Mercado Pago, el estado del pago lo confirma
    // el webhook y puede tardar unos segundos. Se refresca una vez sin que el
    // cliente tenga que recargar a mano.
    if (VUELVE_DE_PAGO) {
      avisar("Procesando tu pago", "Apenas Mercado Pago lo confirme se actualiza acá solo.", "info");
      setTimeout(recargar, 4000);
      setTimeout(recargar, 12000);
    }
  } catch (err) {
    console.error(err);
    mostrarVista("invalido");
  }
})();
