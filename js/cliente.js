/**
 * cliente.js — Portal privado del cliente.
 *
 * Se entra con /cliente/<token>. El token es lo unico que identifica a la
 * persona: no hay login. Por eso:
 *
 *  - El token NUNCA se guarda en localStorage. Si la maquina es compartida,
 *    dejarlo persistido significa que el siguiente que la use entra al panel.
 *  - No se manda a ningun tercero: la pagina declara
 *    <meta name="referrer" content="no-referrer">, asi que al tocar el link de
 *    la demo el token NO viaja en la cabecera Referer al sitio de destino.
 *  - Todo lo que se muestra viene de funciones RPC que validan el token en el
 *    servidor. El navegador no filtra nada: no tiene acceso a filtrar.
 *
 * ESTRUCTURA: UN DASHBOARD CON PESTAÑAS (migración 15)
 * ----------------------------------------------------
 * Arriba el saludo y el avance. Abajo, una barra lateral con cinco
 * pestañas — Inicio, Tareas, Pagos, Dominio y Producción — y el contenido
 * de la elegida. Inicio está siempre abierta; las otras cuatro las habilita
 * Ariel A MANO desde su panel, y mientras tanto se ven con candado.
 *
 * Dentro de cada pestaña sigue valiendo la regla de antes: cada pieza
 * devuelve su propio HTML entero (ver ETAPAS).
 *
 * Antes todos los bloques vivian en el HTML y se mostraban u ocultaban con
 * `hidden`. Con 9 etapas eso se vuelve inmanejable: cada bloque nuevo hay que
 * acordarse de esconderlo en las otras 8 situaciones, y basta olvidarse una
 * vez para que el cliente vea dos cosas contradictorias en pantalla. Aca cada
 * etapa devuelve su propio HTML y no existe la posibilidad de que se pisen.
 *
 * Ver FLUJO.md para el diseño del flujo completo.
 */

import {
  portalObtener,
  portalDecidir,
  portalElegirDominio,
  portalPedirCambio,
  portalSubirComprobante,
  portalDocumento,
} from "./clients.js";
import { escapeHtml, safeUrl, sanitizeText } from "./security.js";
import { configurarDialogos, confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";
import { abrirDocumentoPdf } from "./pdf-helper.js";
import { ico } from "./iconos.js";
import { descargarComprobante, numeroRecibo } from "./comprobante.js";

const WHATSAPP = "543516121498";

/* Datos para transferencia. Si algun dia cambian, se cambian ACA y listo:
   estan en un solo lugar y no repartidos por el HTML. */
const DATOS_TRANSFERENCIA = {
  alias: "Ariel.fit",
  titular: "Ariel Omar Martinelli",
  banco: "Mercado Pago",
};

/* ==========================================================================
   Token
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

// Se lee ANTES de tocar la URL: Mercado Pago devuelve al cliente con ?pago=…
const VUELVE_DE_PAGO = Boolean(new URLSearchParams(window.location.search).get("pago"));

// EL TOKEN SE QUEDA EN LA URL. A PROPOSITO.
//
// Antes esto lo borraba de la barra de direcciones apenas se leia, para que no
// quedara a la vista en una captura. Sonaba prudente y era un desastre: al
// recargar, al volver con la flecha o al abrir el favorito, la URL ya era
// /cliente/ sin token y el portal decia "este link no es valido". El cliente
// perdia el acceso a su propio proyecto por usar el navegador con normalidad.
//
// El link ES la credencial: tiene que sobrevivir a recargas y favoritos.
// Lo que si protege de verdad sigue en su lugar: la meta referrer no-referrer,
// Cache-Control: private, no-store en vercel.json, y no guardarlo en storage.

/* ==========================================================================
   Estado
   ========================================================================== */
const $ = (id) => document.getElementById(id);

let datos = null;            // ultimo estado traido del servidor
let comprobanteBase64 = "";  // imagen ya comprimida, lista para enviar
let metodoElegido = "mercadopago";
let cotizacionDolar = 1350;  // respaldo por si falla la red
let pestanaActiva = null;    // la que eligió el cliente; null = la que corresponde a la etapa

async function cargarCotizacionDolar() {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    if (res.ok) {
      const data = await res.json();
      if (data && data.venta) {
        cotizacionDolar = Math.round(parseFloat(data.venta));
        console.log("Cotización Dólar Blue cargada en el portal:", cotizacionDolar);
      }
    }
  } catch (err) {
    console.warn("No se pudo obtener la cotización en vivo, usando respaldo:", err);
  } finally {
    const rateEl = $("pc-dolar-rate");
    if (rateEl) {
      rateEl.innerHTML = `${ico("billete", "pico pico-sm")}<span>Dólar hoy: <strong>$${cotizacionDolar.toLocaleString("es-AR")} ARS</strong></span>`;
    }
  }
}

const usd = (n) =>
  `USD ${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const ars = (nUsd) =>
  `$${Math.round(Number(nUsd || 0) * cotizacionDolar).toLocaleString("es-AR")} ARS`;

const enlaceWhatsApp = (texto) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;

function mostrarVista(cual) {
  ["cargando", "invalido", "contenido"].forEach((n) => {
    const el = $(`portal-${n}`);
    if (el) el.classList.toggle("hidden", n !== cual);
  });
}

/* ==========================================================================
   Iconos
   --------------------------------------------------------------------------
   SVG dibujados, no emojis: un emoji cambia de forma en cada sistema
   operativo y no hereda el color del texto.
   ========================================================================== */

/* ==========================================================================
   Documentos del proyecto
   --------------------------------------------------------------------------
   Tres documentos distintos, todos opcionales:
     propuesta   — qué se va a hacer
     presupuesto — cuánto sale y con qué detalle
     descripción — el brief del proyecto

   Cada uno puede ser un link común o un PDF guardado en la base. El botón se
   arma igual en los dos casos; lo que cambia es de dónde sale el archivo:

     - link http(s): viene dentro de portal_obtener, se abre directo.
     - PDF guardado: NO viaja en portal_obtener (esa consulta se repite cada
       30 segundos). Viaja solo el nombre, y el contenido se pide con
       portalDocumento() cuando el cliente toca el botón.
   ========================================================================== */
const DOCUMENTOS = {
  propuesta:   { url: "proposal_url",   nombre: "proposal_filename",   flag: "proposal_es_pdf", etiqueta: "la propuesta",   porDefecto: "Propuesta.pdf" },
  presupuesto: { url: "budget_pdf_url", nombre: "budget_pdf_filename", flag: "budget_es_pdf",   etiqueta: "el presupuesto", porDefecto: "Presupuesto.pdf" },
  descripcion: { url: "brief_pdf_url",  nombre: "brief_pdf_filename",  flag: "brief_es_pdf",    etiqueta: "la descripción", porDefecto: "Descripcion.pdf" },
};

/** ¿Hay algo cargado en este documento, sea link o PDF? */
function hayDocumento(d, cual) {
  const m = DOCUMENTOS[cual];
  return Boolean(d?.[m.flag] || safeUrl(d?.[m.url], ""));
}

/**
 * Botón para ver un documento.
 * Si es un PDF guardado lleva data-doc (se pide al tocarlo); si es un link,
 * lleva data-pdf-url y se abre directo, como siempre.
 */
function botonDocumento(d, cual, clase = "btn btn-outline") {
  if (!hayDocumento(d, cual)) return "";
  const m = DOCUMENTOS[cual];
  const nombre = d[m.nombre] || m.porDefecto;

  if (d[m.flag]) {
    return `<button type="button" class="${clase}" data-doc="${cual}"
                    data-doc-nombre="${escapeHtml(nombre)}">
              ${ico("documento", "pico pico-sm")} Ver ${escapeHtml(m.etiqueta)}
            </button>`;
  }

  const url = safeUrl(d[m.url], "");
  return `<button type="button" class="${clase}" data-pdf-url="${escapeHtml(url)}"
                  data-pdf-filename="${escapeHtml(nombre)}">
            ${ico("documento", "pico pico-sm")} Ver ${escapeHtml(m.etiqueta)}
          </button>`;
}

/** Pide un PDF guardado y lo abre. Se llama al tocar el botón, no antes. */
async function abrirDocumentoGuardado(boton) {
  const cual = boton.dataset.doc;
  const tareaId = boton.dataset.docTarea || null;
  const nombre = boton.dataset.docNombre || "documento.pdf";

  const original = boton.innerHTML;
  boton.disabled = true;
  boton.textContent = "Abriendo…";

  try {
    const res = await portalDocumento(TOKEN, cual, tareaId);
    if (!res?.ok) {
      avisar("No se pudo abrir", res?.error || "Probá de nuevo.", "error");
      return;
    }
    abrirDocumentoPdf(res.data, res.filename || nombre);
  } finally {
    boton.disabled = false;
    boton.innerHTML = original;
  }
}

/* ==========================================================================
   Piezas reutilizables
   ========================================================================== */
/**
 * La tarjeta de una etapa.
 *
 * UN SOLO BORDE IZQUIERDO. El ícono va en su PROPIA línea, arriba del título,
 * no al costado. Antes iba al costado y eso creaba dos márgenes distintos
 * dentro de la misma tarjeta: el título arrancaba corrido unos 100px (después
 * del ícono) y todo lo de abajo —montos, opciones, botones— arrancaba pegado
 * al borde. Se veía torcido sin que se notara por qué.
 */
function tarjeta({ icono, tono = "", titulo, bajada, cuerpo = "" }) {
  return `
    <section class="portal-etapa">
      <span class="portal-etapa-ico ${tono}">${ico(icono)}</span>
      <h2>${escapeHtml(titulo)}</h2>
      ${bajada ? `<p class="portal-etapa-sub">${bajada}</p>` : ""}
      ${cuerpo ? `<div class="portal-etapa-cuerpo">${cuerpo}</div>` : ""}
    </section>`;
}

const nota = (texto, tono = "", icono = "info") =>
  `<p class="portal-nota ${tono}">${ico(icono, "pico pico-sm")}<span>${texto}</span></p>`;

const cartelDeEspera = (titulo, bajada) => `
  <div class="portal-espera">
    <span class="portal-pulso" aria-hidden="true"><i></i><i></i><i></i></span>
    <strong>${escapeHtml(titulo)}</strong>
    <small>${escapeHtml(bajada)}</small>
  </div>`;

/** Los datos bancarios + el cargador de comprobante. */
function bloqueTransferencia(kind, monto) {
  const d = DATOS_TRANSFERENCIA;
  const montoArsNum = Math.round(Number(monto || 0) * cotizacionDolar);
  return `
    <div class="portal-datos">
      <div class="portal-dato">
        <span><small>Alias</small><b>${escapeHtml(d.alias)}</b></span>
        <button type="button" class="portal-copiar" data-accion="copiar" data-valor="${escapeHtml(d.alias)}">
          ${ico("copiar", "pico pico-sm")} Copiar Alias
        </button>
      </div>
      <div class="portal-dato"><span><small>Titular</small><b>${escapeHtml(d.titular)}</b></span></div>
      <div class="portal-dato"><span><small>Banco</small><b>${escapeHtml(d.banco)}</b></span></div>
      <div class="portal-dato"><span><small>Importe USD</small><b>${escapeHtml(usd(monto))}</b></span></div>
      <div class="portal-dato">
        <span><small>Importe al cambio ($${cotizacionDolar.toLocaleString("es-AR")} ARS/USD)</small><b style="color: #4ade80;">${escapeHtml(ars(monto))}</b></span>
        <button type="button" class="portal-copiar" data-accion="copiar" data-valor="${montoArsNum}">
          ${ico("copiar", "pico pico-sm")} Copiar ARS
        </button>
      </div>
    </div>

    <label class="portal-subir" for="pc-archivo">
      ${ico("subir")}
      <span id="pc-archivo-texto">Tocá para elegir la foto del comprobante</span>
      <img id="pc-vista-previa" class="hidden" alt="Vista previa del comprobante">
    </label>
    <input type="file" id="pc-archivo" accept="image/png,image/jpeg,image/webp" class="portal-oculto">

    <label class="portal-campo">
      <span>Nota (opcional)</span>
      <input type="text" id="pc-nota-comprobante" maxlength="500" placeholder="Ej: transferí desde otra cuenta">
    </label>

    <div class="portal-acciones">
      <button type="button" class="btn btn-primary" data-accion="enviar-comprobante" data-kind="${escapeHtml(kind)}">
        Enviar comprobante
      </button>
    </div>`;
}

/** Tarjeta de pago, compartida por el anticipo y el saldo. */
function tarjetaPago({ kind, titulo, bajada, monto, detalle, pago }) {
  // Comprobante ya enviado: la pelota es de Ariel, no del cliente.
  if (pago?.status === "en_revision") {
    return tarjeta({
      icono: "reloj", tono: "espera",
      titulo: "Recibí tu comprobante",
      bajada: "Lo estoy verificando. Apenas confirmo el pago seguimos con el paso siguiente — normalmente en el día.",
      cuerpo:
        cartelDeEspera("Comprobante en revisión", `${usd(pago.amount_usd)} (${ars(pago.amount_usd)}) · enviado el ${fecha(pago.comprobante_fecha)}`) +
        nota("Si necesitás que lo mire ya, escribime por WhatsApp y lo destrabo en el momento.", "warn", "alerta"),
    });
  }

  // Medios que Ariel habilitó para este cliente (migración 15). Si hay uno
  // solo, no se ofrece elegir: se muestra directamente ese.
  const medios = metodosDe(datos);
  const soloUno = medios.length === 1;
  const esTransferencia = soloUno ? medios[0] === "transferencia" : metodoElegido === "transferencia";

  return tarjeta({
    icono: "tarjeta", titulo, bajada,
    cuerpo: `
      ${detalle || `
        <div class="portal-monto-box" style="margin: 8px 0 18px;">
          <p class="portal-monto"><b>${escapeHtml(usd(monto))}</b></p>
          <p style="font-size: 1.05rem; font-weight: 700; color: #4ade80; margin-top: 2px;">
            ≡ ${escapeHtml(ars(monto))}
            <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-left: 6px;">(cotización en vivo: $${cotizacionDolar.toLocaleString("es-AR")} ARS/USD)</span>
          </p>
        </div>`}

      ${soloUno ? "" : `<div class="portal-ops" role="radiogroup" aria-label="Forma de pago">
        <label class="portal-op">
          <input type="radio" name="metodo" value="mercadopago" data-accion="metodo" ${esTransferencia ? "" : "checked"}>
          <span class="portal-op-marca" aria-hidden="true"></span>
          <span class="portal-op-txt"><b>Mercado Pago</b>
            <small>Tarjeta, débito o dinero en cuenta (en pesos al cambio en vivo). Se acredita al instante.</small></span>
        </label>
        <label class="portal-op">
          <input type="radio" name="metodo" value="transferencia" data-accion="metodo" ${esTransferencia ? "checked" : ""}>
          <span class="portal-op-marca" aria-hidden="true"></span>
          <span class="portal-op-txt"><b>Transferencia Bancaria / Mercado Pago</b>
            <small>Transferís en pesos (${escapeHtml(ars(monto))}) o USD y subís la foto del comprobante.</small></span>
        </label>
      </div>`}

      ${esTransferencia
        ? bloqueTransferencia(kind, monto)
        : `<div class="portal-acciones">
             <button type="button" class="btn btn-primary" data-accion="mercadopago" data-kind="${escapeHtml(kind)}">
               ${ico("tarjeta", "pico pico-sm")} Pagar con Mercado Pago
             </button>
           </div>`}`,
  });
}

function fecha(iso) {
  if (!iso) return "hoy";
  try {
    return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
  } catch {
    return "hoy";
  }
}

const pagoDe = (kind) => (datos?.pagos || []).find((p) => p.kind === kind) || null;

/* --------------------------------------------------------------------------
   Plan de pagos (migración 14)
   --------------------------------------------------------------------------
   El plan puede elegirlo el cliente (mitades, pago total o 3 cuotas) o
   fijarlo Ariel desde el panel — incluido uno personalizado con los cobros
   armados a mano. Puede haber además una reserva ya pagada que se descuenta
   del primer pago, cuotas y extras. Estas funciones son la única fuente para
   decidir qué se muestra.
   -------------------------------------------------------------------------- */
const PLAN_TXT = {
  mitades: {
    titulo: "Mitad y mitad",
    detalle: (p) => `${usd(p / 2)} para arrancar y ${usd(p / 2)} cuando la página está publicada.`,
  },
  unico: {
    titulo: "Pago total",
    detalle: (p) => `${usd(p)} en un solo pago, por transferencia o Mercado Pago.`,
  },
  cuotas3: {
    titulo: "3 cuotas sin interés",
    detalle: (p) => `${usd(p)} con tarjeta en Mercado Pago. Lo pagás una vez y la tarjeta te lo divide en 3.`,
  },
  personalizado: {
    titulo: "Plan acordado",
    detalle: () => "Los pagos que acordamos, uno por uno, con su monto.",
  },
};

const NOMBRE_PAGO = {
  anticipo: "Anticipo",
  saldo: "Saldo final",
  total: "Pago total",
  reserva: "Reserva",
  cuota: "Cuota",
  otro: "Extra",
  dominio: "Dominio propio",
};

const ESTADO_PAGO_CLIENTE = {
  pagado: "Pagado",
  pendiente: "Pendiente",
  en_proceso: "Procesando",
  en_revision: "En revisión",
  rechazado: "Pendiente",
};

/** Lo que es parte del precio (y no un extra aparte). */
const A_CUENTA = ["reserva", "anticipo", "total", "cuota"];

const nombrePago = (p) => p.concepto || NOMBRE_PAGO[p.kind] || "Pago";

const sumaPagos = (filtro) => (datos?.pagos || [])
  .filter(filtro)
  .reduce((a, p) => a + Number(p.amount_usd || 0), 0);

/** Lo ya pagado de esos tipos. */
const pagadoDe = (kinds) => sumaPagos((p) => p.status === "pagado" && kinds.includes(p.kind));

/** El primer cobro sin pagar, en el orden de prioridad de `kinds`. */
function proximoPendiente(kinds) {
  const pagos = datos?.pagos || [];
  for (const k of kinds) {
    const p = pagos.find((x) => x.kind === k && x.status !== "pagado");
    if (p) return p;
  }
  return null;
}

/** El cobro con el que arranca el proyecto, según el plan. */
function cobroInicial(d) {
  const plan = d.payment_plan || "mitades";
  if (plan === "personalizado") return proximoPendiente(["cuota", "reserva", "anticipo", "total", "otro"]);
  return pagoDe(["cuotas3", "unico"].includes(plan) ? "total" : "anticipo");
}


/* ==========================================================================
   Una función por etapa
   --------------------------------------------------------------------------
   Cada una devuelve el HTML completo de su tarjeta. No hay estado compartido
   entre ellas: lo que no devuelve una etapa, sencillamente no existe en
   pantalla.
   ========================================================================== */
/**
 * Cómo se paga, en la tarjeta de la demo.
 *
 * Si Ariel fijó el plan, se muestra ese y nada más: ofrecerle opciones que
 * después la base no respeta sería mentirle. Si no, el cliente elige entre
 * los tres planes que puede elegir él solo.
 */
function bloquePlanDemo(d, precio) {
  const reserva = pagadoDe(["reserva"]);
  // En el plan acordado los montos ya los armó Ariel con la reserva en
  // cuenta: decir "se descuenta del primer pago" ahí sería falso.
  const notaReserva = reserva > 0
    ? nota(d.plan_fijado && d.payment_plan === "personalizado"
        ? `Ya abonaste <strong>${escapeHtml(usd(reserva))}</strong> de reserva.`
        : `Ya abonaste <strong>${escapeHtml(usd(reserva))}</strong> de reserva: se descuenta del primer pago.`, "ok", "check")
    : "";

  if (d.plan_fijado && PLAN_TXT[d.payment_plan]) {
    const plan = PLAN_TXT[d.payment_plan];
    const programados = (d.pagos || []).filter((p) => p.kind !== "reserva" || p.status !== "pagado");
    return `
      <p class="portal-ruta-tit">Cómo lo vas a pagar</p>
      <div class="portal-plan-fijo">
        <b>${escapeHtml(plan.titulo)}</b>
        <small>${escapeHtml(plan.detalle(precio))}</small>
        ${d.payment_plan === "personalizado" && programados.length ? `
          <ul class="portal-plan-lista">
            ${programados.map((p) => `
              <li><span>${escapeHtml(nombrePago(p))}</span><b>${escapeHtml(usd(p.amount_usd))}</b></li>`).join("")}
          </ul>` : ""}
      </div>
      ${notaReserva}
      ${nota("Es el plan que acordamos. Si querés cambiar algo, escribime antes de continuar.")}`;
  }

  const op = (valor, titulo, detalle, extra = "", marcado = false) => `
    <label class="portal-op">
      <input type="radio" name="plan" value="${valor}" ${marcado ? "checked" : ""}>
      <span class="portal-op-marca" aria-hidden="true"></span>
      <span class="portal-op-txt"><b>${escapeHtml(titulo)}</b>
        <small>${escapeHtml(detalle)}</small></span>
      ${extra}
    </label>`;

  const sugerido = PLAN_TXT[d.payment_plan] && d.payment_plan !== "personalizado" ? d.payment_plan : "mitades";

  return `
    <p class="portal-ruta-tit">¿Cómo preferís pagarlo?</p>
    <div class="portal-ops" role="radiogroup" aria-label="Forma de pago">
      ${op("mitades", PLAN_TXT.mitades.titulo, PLAN_TXT.mitades.detalle(precio), "", sugerido === "mitades")}
      ${op("unico", PLAN_TXT.unico.titulo, PLAN_TXT.unico.detalle(precio), "", sugerido === "unico")}
      ${op("cuotas3", PLAN_TXT.cuotas3.titulo, PLAN_TXT.cuotas3.detalle(precio),
           `<span class="portal-op-precio libre">Sin recargo</span>`, sugerido === "cuotas3")}
    </div>
    ${notaReserva}
    ${nota("Elegís ahora y después, si querés cambiar, me escribís y lo vemos. El dominio propio, si lo elegís más adelante, se suma al final.")}`;
}

const ETAPAS = {

  demo_pendiente: () => tarjeta({
    icono: "reloj", tono: "espera",
    titulo: "Tu demo está en preparación",
    bajada: "Estoy armando una primera versión de tu página. Cuando esté lista aparece acá mismo y te aviso por WhatsApp.",
    cuerpo:
      cartelDeEspera("Todavía no hay nada para revisar", "No tenés que hacer nada por ahora.") + `
      <p class="portal-ruta-tit">Lo que viene después</p>
      <ol class="portal-ruta">
        <li><span>1</span><div><b>Ver la demo y decidir</b><small>Si te gusta cómo va, seguimos.</small></div></li>
        <li><span>2</span><div><b>El primer pago</b><small>Según el plan de pago. Con eso arranco a trabajar en serio.</small></div></li>
        <li><span>3</span><div><b>Cargar tus cambios</b><small>Todo lo que quieras ajustar, lo escribís acá.</small></div></li>
      </ol>` +
      nota("Este link es tuyo y <strong>no vence</strong>. Guardalo: desde acá vas a seguir todo el proyecto de punta a punta."),
  }),

  demo_lista: (d) => {
    const link = safeUrl(d.demo_url, "");
    const precio = Number(d.price_usd) || 0;

    return tarjeta({
      icono: "ojo",
      titulo: "Tu demo está lista",
      bajada: "Miralá con calma, desde la computadora y desde el celular. Abajo tenés la propuesta, el presupuesto y el valor del trabajo.",
      cuerpo: `
        ${precio > 0 ? `
          <div class="portal-precio">
            <span class="portal-precio-etq">Valor del proyecto</span>
            <p class="portal-precio-num">${escapeHtml(usd(precio))}</p>
            <p class="portal-precio-ars">
              ${escapeHtml(ars(precio))}
              <span>Dólar hoy $${cotizacionDolar.toLocaleString("es-AR")}</span>
            </p>
          </div>` : ""}

        <div class="portal-acciones">
          <a class="btn btn-primary" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
            ${ico("ojo", "pico pico-sm")} Ver la demo
          </a>
          ${botonDocumento(d, "propuesta")}
          ${botonDocumento(d, "presupuesto")}
          ${botonDocumento(d, "descripcion")}
        </div>
        <p class="portal-url">${escapeHtml(d.demo_url || "")}</p>

        ${bloquePlanDemo(d, precio)}

        <div class="portal-acciones">
          <button type="button" class="btn btn-exito" data-accion="continuar">
            ${ico("check", "pico pico-sm")} Sí, quiero continuar
          </button>
          <button type="button" class="btn btn-suave" data-accion="no-continuar">Por ahora no</button>
        </div>`,
    });
  },

  anticipo_pendiente: (d) => {
    const plan = d.payment_plan || "mitades";
    const pago = cobroInicial(d);

    // Sin cobro pendiente todavía: el plan personalizado sin cuotas cargadas,
    // o un pago que ya entró y el flujo está por avanzar. Nada para pagar.
    if (!pago || pago.status === "pagado") {
      return tarjeta({
        icono: "reloj", tono: "espera",
        titulo: "Estoy preparando tu plan de pagos",
        bajada: "En un rato te aparece acá el monto a pagar. Te aviso por WhatsApp.",
        cuerpo: cartelDeEspera("Todavía no hay nada para pagar", "No tenés que hacer nada por ahora."),
      });
    }

    const monto = Number(pago.amount_usd);
    const totalUsd = Number(d.total_usd) || 0;
    const reserva = pagadoDe(["reserva"]);
    const enCuotas = plan === "cuotas3" && pago.kind === "total";
    // Cuotas de MP: las que fijó Ariel en el cobro o, si no, las del plan.
    const nCuotas = Number(pago.cuotas_mp) || (enCuotas ? 3 : 1);
    const conMp = metodosDe(d).includes("mercadopago");

    const titulo =
      pago.kind === "anticipo" ? "Anticipo para arrancar"
      : pago.kind === "total" ? (enCuotas ? "Pago en 3 cuotas sin interés" : "Pago total del proyecto")
      : nombrePago(pago);

    const bajada =
      enCuotas ? "Pagás una sola vez con tarjeta y Mercado Pago te lo divide en 3 cuotas sin interés. Apenas se acredita arranco y se te habilita la lista de cambios."
      : pago.kind === "total" ? "Pagás el proyecto completo de una vez. Apenas se acredita arranco y se te habilita la lista de cambios."
      : "Con este pago arranco a trabajar y se te habilita la lista de cambios para dejar la página a tu gusto.";

    const referencia = pago.kind === "anticipo"
      ? `de ${escapeHtml(usd(totalUsd))} totales`
      : pago.kind === "total" ? "el proyecto completo" : "";

    return tarjetaPago({
      kind: pago.kind,
      titulo,
      bajada,
      monto,
      detalle: `
        <div class="portal-monto-box" style="margin: 8px 0 18px;">
          <p class="portal-monto">
            <b>${escapeHtml(usd(monto))}</b>
            ${referencia ? `<span>${referencia}</span>` : ""}
          </p>
          <p style="font-size: 1.05rem; font-weight: 700; color: #4ade80; margin-top: 2px;">
            ≡ ${escapeHtml(ars(monto))}
            <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-left: 6px;">(Cotización Dólar hoy: $${cotizacionDolar.toLocaleString("es-AR")} ARS/USD)</span>
          </p>
          ${conMp && nCuotas > 1 ? `<p class="portal-cuotas-hint">Con tarjeta en Mercado Pago: hasta ${nCuotas} cuotas de ${escapeHtml(usd(monto / nCuotas))} · ${escapeHtml(ars(monto / nCuotas))}</p>` : ""}
        </div>
        ${reserva > 0 ? nota(`Ya descontamos tu reserva de <strong>${escapeHtml(usd(reserva))}</strong>.`, "ok", "check") : ""}`,
      pago,
    });
  },

  en_produccion: (d) => {
    const tareas = d.tareas || [];
    const hechas = tareas.filter((t) => t.done).length;
    const pct = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

    const lista = tareas.length
      ? `<ul class="portal-cambios">
          ${tareas.map((t) => `
            <li class="portal-cambio ${t.done ? "ok" : ""}">
              <span class="portal-cambio-est">${ico(t.done ? "check" : "reloj", "pico pico-sm")}</span>
              <div><p>${escapeHtml(t.title)}</p>
                <small>${t.done ? "Listo" : "Pendiente"}${t.source === "cliente" ? " · lo pediste vos" : ""}</small></div>
            </li>`).join("")}
        </ul>
        <div class="portal-avance">
          <b>${hechas} de ${tareas.length}</b>
          <span class="portal-avance-barra"><i style="transform:scaleX(${pct / 100})"></i></span>
          <b>${pct}%</b>
        </div>`
      : `<p class="portal-vacio">Todavía no cargaste ningún cambio. Escribí el primero acá arriba.</p>`;

    return tarjeta({
      icono: "lista",
      titulo: "Contame qué querés cambiar",
      bajada: "Escribí cada cambio por separado, así los voy tachando a medida que los hago. Podés seguir sumando mientras trabajo.",
      cuerpo: `
        <div class="portal-fila-campo">
          <label class="portal-campo">
            <span>Nuevo cambio</span>
            <input type="text" id="pc-cambio" maxlength="400"
                   placeholder="Ej: cambiar el color del botón de contacto">
          </label>
          <button type="button" class="btn btn-primary" data-accion="agregar-cambio">Agregar</button>
        </div>
        ${lista}
        ${nota("Cuando terminemos con todos los cambios te habilito el paso siguiente: elegir la dirección de tu página.")}`,
    });
  },

  dominio: (d) => {
    const propio = d.domain_choice === "propio";
    const extra = usd(d.domain_extra_usd ?? 10);
    const dominioActual = d.domain_name || "";
    const demo = (d.demo_url || "").replace(/^https?:\/\//, "");

    return tarjeta({
      icono: "globo",
      titulo: d.domain_choice ? "La dirección de tu página" : "Elegí la dirección de tu página",
      bajada: d.domain_choice
        ? `Elegiste ${propio ? `<strong>${escapeHtml(dominioActual || "un dominio propio")}</strong>` : "la dirección que ya tiene"}. Si querés cambiarla, elegí otra y confirmá.`
        : "Decidí con qué dirección va a quedar publicada tu página.",
      cuerpo: `
        <div class="portal-ops" role="radiogroup" aria-label="Dirección de la página">
          <label class="portal-op">
            <input type="radio" name="dom" value="vercel" data-accion="dominio-op" ${propio ? "" : "checked"}>
            <span class="portal-op-marca" aria-hidden="true"></span>
            <span class="portal-op-txt"><b>La dirección que ya tiene</b>
              <small>${escapeHtml(demo || "la del enlace de tu demo")}</small></span>
            <span class="portal-op-precio libre">Incluido</span>
          </label>
          <label class="portal-op">
            <input type="radio" name="dom" value="propio" data-accion="dominio-op" ${propio ? "checked" : ""}>
            <span class="portal-op-marca" aria-hidden="true"></span>
            <span class="portal-op-txt"><b>Un dominio propio</b>
              <small>Más corto y más fácil de recordar. Lo compro y lo configuro yo.</small></span>
            <span class="portal-op-precio">+${escapeHtml(extra)}</span>
          </label>
        </div>

        <label class="portal-campo" id="pc-dom-nombre-wrap" ${propio ? "" : "hidden"}>
          <span>¿Qué dominio querés?</span>
          <input type="text" id="pc-dom-nombre" maxlength="253" placeholder="tunegocio.com"
                 value="${escapeHtml(dominioActual)}">
        </label>

        ${nota(`Los ${escapeHtml(extra)} del dominio propio se suman al pago final, así hacés una sola transferencia.`)}

        <div class="portal-acciones">
          <button type="button" class="btn btn-primary" data-accion="guardar-dominio">
            Confirmar y seguir ${ico("check", "pico pico-sm")}
          </button>
        </div>`,
    });
  },

  publicando: (d) => {
    const destino = d.domain_choice === "propio" && d.domain_name
      ? d.domain_name
      : "la dirección que elegiste";

    return tarjeta({
      icono: "cohete", tono: "espera",
      titulo: "Estamos publicando tu página",
      bajada: `Ya tengo todo lo que necesito. Estoy subiendo la página y configurando <strong>${escapeHtml(destino)}</strong>. Suele tardar unas horas.`,
      cuerpo: `
        <ul class="portal-cambios">
          <li class="portal-cambio ok"><span class="portal-cambio-est">${ico("check", "pico pico-sm")}</span>
            <div><p>Todos los cambios aplicados</p></div></li>
          <li class="portal-cambio ok"><span class="portal-cambio-est">${ico("check", "pico pico-sm")}</span>
            <div><p>Dirección elegida: ${escapeHtml(destino)}</p></div></li>
          <li class="portal-cambio"><span class="portal-cambio-est">${ico("reloj", "pico pico-sm")}</span>
            <div><p>Subiendo la página y conectando el dominio</p><small>En curso</small></div></li>
        </ul>
        ${nota("No tenés que hacer nada. Apenas esté lista te habilito el último paso acá mismo y te aviso por WhatsApp.")}`,
    });
  },

  saldo_pendiente: (d) => {
    const saldo = pagoDe("saldo");
    const pago = saldo && saldo.status !== "pagado"
      ? saldo
      : proximoPendiente(["cuota", "otro", "anticipo", "total", "reserva", "dominio"]);

    if (!pago) {
      return tarjeta({
        icono: "reloj", tono: "espera",
        titulo: "Estoy confirmando tus pagos",
        bajada: "No queda nada por pagar. En un momento se habilita el link de tu página.",
      });
    }

    // Un cobro suelto (una cuota del plan acordado, un extra): tarjeta simple.
    if (pago.kind !== "saldo") {
      return tarjetaPago({
        kind: pago.kind,
        titulo: `Último paso: ${nombrePago(pago).toLowerCase()}`,
        bajada: "Tu página ya está lista y funcionando. Con este pago queda publicada y es toda tuya.",
        monto: Number(pago.amount_usd),
        pago,
      });
    }

    // El saldo es "lo que falta": se muestra la cuenta completa para que el
    // cliente vea de dónde sale el número y que ya se descontó lo que pagó.
    const monto = Number(pago.amount_usd);
    const extra = d.domain_choice === "propio" ? Number(d.domain_extra_usd || 0) : 0;
    const precio = Number(d.price_usd) || 0;
    const aCuenta = (d.pagos || []).filter((p) => A_CUENTA.includes(p.kind));
    const linea = (izq, der, estilo = "") =>
      `<div><span>${izq}</span><span${estilo}>${der}</span></div>`;

    const detalle = `
      <div class="portal-desglose">
        ${linea("Valor del proyecto", `${escapeHtml(usd(precio))} <small class="portal-desglose-ars">(${ars(precio)})</small>`)}
        ${extra > 0 ? linea(`Dominio propio${d.domain_name ? ` · ${escapeHtml(d.domain_name)}` : ""}`,
             `${escapeHtml(usd(extra))} <small class="portal-desglose-ars">(${ars(extra)})</small>`) : ""}
        ${aCuenta.map((p) => linea(
             `${escapeHtml(nombrePago(p))} <small class="portal-desglose-ars">${p.status === "pagado" ? "· pagado" : "· pendiente aparte"}</small>`,
             `− ${escapeHtml(usd(p.amount_usd))}`)).join("")}
        ${linea("Total a pagar", `${escapeHtml(usd(monto))} · ${ars(monto)}`, ' style="color: #4ade80;"')}
      </div>
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 18px; display: flex; align-items: center; gap: 6px;">
        ${ico("info", "pico pico-sm")} Tipo de cambio en vivo: <strong>$${cotizacionDolar.toLocaleString("es-AR")} ARS/USD</strong>
      </p>`;

    return tarjetaPago({
      kind: "saldo",
      titulo: "Último paso: el saldo",
      bajada: "Tu página ya está lista y funcionando. Con este pago queda publicada y es toda tuya.",
      monto, detalle, pago,
    });
  },

  finalizado: (d) => {
    const link = safeUrl(d.production_url, "");
    const visible = (d.production_url || "").replace(/^https?:\/\//, "");
    const cobrado = (d.pagos || [])
      .filter((p) => p.status === "pagado")
      .reduce((a, p) => a + Number(p.amount_usd || 0), 0);

    return tarjeta({
      icono: "check", tono: "listo",
      titulo: "Tu página está en línea",
      bajada: "Listo el proyecto. Quedó publicada, es tuya, y este link te va a seguir funcionando por si querés volver a mirar el historial.",
      cuerpo: `
        ${link ? `
          <div class="portal-final">
            <div><b>${escapeHtml(visible)}</b><small>Publicada y funcionando</small></div>
            <a class="btn btn-exito" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Abrir mi página</a>
          </div>` : ""}
        ${(d.pagos || []).some((p) => p.status !== "pagado")
          ? nota(`Pagaste ${escapeHtml(usd(cobrado))} (${ars(cobrado)}). Te queda un pago pendiente en la pestaña Pagos.`, "warn", "alerta")
          : nota(`Pagos al día: ${escapeHtml(usd(cobrado))} (${ars(cobrado)}).`, "ok", "check")}
        ${nota("¿Querés sumar algo más adelante? Escribime y lo vemos.", "", "wa")}`,
    });
  },

  rechazado: () => tarjeta({
    icono: "cruz", tono: "espera",
    titulo: "Quedamos en contacto",
    bajada: "Anotado: por ahora no seguimos. Gracias por tomarte el tiempo de mirar la demo.",
    cuerpo:
      nota("Si cambiás de idea, escribime y lo retomamos exactamente desde donde quedó. La demo queda guardada.") + `
      <div class="portal-acciones">
        <a class="btn btn-primary" target="_blank" rel="noopener noreferrer"
           href="${escapeHtml(enlaceWhatsApp("Hola Ariel! Quería retomar el proyecto que habíamos empezado."))}">
          ${ico("wa", "pico pico-sm")} Escribirme
        </a>
      </div>`,
  }),
};

/* ==========================================================================
   Recibos
   --------------------------------------------------------------------------
   Un boton por pago acreditado. Van en el resumen y no adentro de la tarjeta
   de la etapa a proposito: la tarjeta cambia a medida que avanza el
   proyecto, y el recibo del anticipo tiene que seguir estando a mano en el
   paso 5, no solo el dia que se pago.

   El numero lo pone la base (migracion 12). Si un pago figura pagado y no
   tiene numero, es un pago anterior a esa migracion que no se alcanzo a
   numerar: en vez de mostrar un boton que generaria un recibo sin numero, no
   se muestra nada y el cliente lo pide por WhatsApp.
   ========================================================================== */
const CONCEPTO_CORTO = {
  anticipo: "Anticipo",
  saldo:    "Saldo final",
  total:    "Pago total",
  dominio:  "Dominio propio",
  reserva:  "Reserva",
  cuota:    "Cuota",
  otro:     "Extra",
};

function bloqueComprobantes(d) {
  const conRecibo = (d.pagos || []).filter((p) => p.status === "pagado" && p.nro_recibo);
  if (!conRecibo.length) return "";

  return `
    <div class="portal-recibos">
      <p class="portal-recibos-tit">${ico("recibo", "pico pico-sm")} Tus comprobantes</p>
      ${conRecibo.map((p) => `
        <button type="button" class="portal-resumen-link portal-recibo-btn"
                data-accion="bajar-recibo" data-nro="${escapeHtml(String(p.nro_recibo))}">
          ${ico("descargar", "pico pico-sm")}
          <span class="portal-recibo-txt">
            <b>${escapeHtml(p.concepto || CONCEPTO_CORTO[p.kind] || "Pago")}</b>
            <small>${escapeHtml(numeroRecibo(p.nro_recibo, p.recibo_fecha || p.paid_at) || "")} · ${escapeHtml(usd(p.amount_usd))}</small>
          </span>
        </button>`).join("")}
      <p class="portal-recibos-nota">No válido como factura.</p>
    </div>`;
}

/* ==========================================================================
   Resumen del proyecto (columna derecha en pantalla ancha)
   ========================================================================== */
/**
 * Todos los pagos del proyecto, con su estado. Es lo que pidió Ariel: que en
 * el link quede claro qué se pagó, qué falta y de qué es cada monto.
 */
function listaDePagos(pagos) {
  if (!pagos.length) return "";
  return `
    <div class="portal-pagos">
      <p class="portal-recibos-tit">${ico("tarjeta", "pico pico-sm")} Tus pagos</p>
      <ul>
        ${pagos.map((p) => `
          <li class="portal-pago portal-pago-${p.status === "pagado" ? "ok" : "pend"}">
            <span class="portal-pago-nom">${escapeHtml(nombrePago(p))}
              <small>${escapeHtml(ESTADO_PAGO_CLIENTE[p.status] || p.status)}${
                p.status === "pagado" && p.paid_at ? ` · ${escapeHtml(fecha(p.paid_at))}` : ""}</small></span>
            <b>${escapeHtml(usd(p.amount_usd))}</b>
          </li>`).join("")}
      </ul>
    </div>`;
}

function panelResumen(d) {
  const pagos = d.pagos || [];
  const pagado = pagos.filter((p) => p.status === "pagado")
                      .reduce((a, p) => a + Number(p.amount_usd || 0), 0);
  const extras = pagos.filter((p) => p.kind === "otro")
                      .reduce((a, p) => a + Number(p.amount_usd || 0), 0);
  const total = (Number(d.total_usd) || 0) + extras;
  const resta = Math.max(0, total - pagado);
  const plan = PLAN_TXT[d.payment_plan];

  const filas = [
    { label: extras > 0 ? "Presupuesto + extras" : "Presupuesto", usdVal: usd(total), arsVal: ars(total) },
    { label: "Pagado", usdVal: usd(pagado), arsVal: ars(pagado) },
    resta > 0 ? { label: "Falta abonar", usdVal: usd(resta), arsVal: ars(resta), highlight: true } : null,
    { label: "Cotización USD", usdVal: `$${cotizacionDolar.toLocaleString("es-AR")} ARS`, arsVal: null },
  ].filter(Boolean);

  const dominio = d.domain_choice === "propio"
    ? (d.domain_name || "Dominio propio")
    : d.domain_choice === "vercel"
      ? (d.demo_url || "").replace(/^https?:\/\//, "")
      : "A definir";

  return `
    <div class="portal-resumen-caja">
      <h3>Tu cuenta</h3>
      <p class="portal-resumen-nombre">${escapeHtml(d.project_name || "")}</p>

      <dl class="portal-resumen-datos">
        ${filas.map((f) => `
          <div>
            <dt>${escapeHtml(f.label)}</dt>
            <dd class="portal-resumen-val">
              <span class="monto-usd">${escapeHtml(f.usdVal)}</span>
              ${f.arsVal ? `<small class="monto-ars ${f.highlight ? "resaltado" : ""}">(${escapeHtml(f.arsVal)})</small>` : ""}
            </dd>
          </div>
        `).join("")}
        ${plan ? `<div><dt>Plan de pago</dt><dd class="corta">${escapeHtml(plan.titulo)}</dd></div>` : ""}
        <div><dt>Dirección</dt><dd class="corta">${escapeHtml(dominio)}</dd></div>
      </dl>

      ${listaDePagos(pagos)}

      ${bloqueComprobantes(d)}

    </div>`;
}


/* ==========================================================================
   Render
   ========================================================================== */
/* ==========================================================================
   Pestañas (migración 15)
   --------------------------------------------------------------------------
   El link del cliente es un dashboard: barra lateral con cinco pestañas y el
   contenido de la elegida al lado (o debajo, en el celular).

     Inicio      demo, propuesta, presupuesto y en qué está el proyecto
     Tareas      la lista de cambios
     Pagos       plan, lo que hay que pagar, historial y comprobantes
     Dominio     elegir la dirección de la página
     Producción  el link final

   Inicio está siempre abierta. Las otras las abre Ariel A MANO desde su
   panel (clients.secciones). Una pestaña cerrada se ve con candado y, si
   el cliente la toca, le explica que se habilita más adelante.

   La base es la que hace cumplir el candado (cargar cambios, elegir dominio
   y ver el link final se rechazan del lado del servidor con la pestaña
   cerrada). Esto es solo cómo se ve.
   ========================================================================== */
const PESTANAS = {
  inicio:     { label: "Inicio",     icono: "casa" },
  tareas:     { label: "Tareas",     icono: "lista" },
  pagos:      { label: "Pagos",      icono: "tarjeta" },
  dominio:    { label: "Dominio",    icono: "globo" },
  produccion: { label: "Producción", icono: "cohete" },
};

const BLOQUEO = {
  tareas: "Acá vas a cargar los cambios que quieras en tu página. Te la habilito cuando arranquemos con la producción.",
  pagos: "Acá vas a ver tu plan de pagos, lo que tenés que abonar y tus comprobantes. Te la habilito cuando haya algo para pagar.",
  dominio: "Acá vas a elegir con qué dirección queda publicada tu página. Te la habilito cuando terminemos los cambios.",
  produccion: "Acá vas a tener el link final de tu página publicada. Te la habilito apenas esté en línea.",
};

/**
 * ¿Está abierta esa pestaña?
 * Si la base todavía no tiene la migración 15 (no viene `secciones`), se
 * abren según la etapa, como antes: así el portal no queda todo con
 * candado entre que se sube el código y se corre el SQL.
 */
function seccionAbierta(d, k) {
  if (k === "inicio") return true;
  if (d?.secciones && typeof d.secciones === "object") return d.secciones[k] === true;
  const orden = ["demo_pendiente", "demo_lista", "anticipo_pendiente", "en_produccion",
                 "dominio", "publicando", "saldo_pendiente", "finalizado"].indexOf(d?.status);
  return { tareas: orden >= 3, pagos: orden >= 2, dominio: orden >= 4, produccion: orden >= 7 }[k] || false;
}

/** Medios de pago habilitados para este cliente. Por defecto, los dos. */
function metodosDe(d) {
  const m = Array.isArray(d?.metodos_pago) ? d.metodos_pago.filter((x) => x === "mercadopago" || x === "transferencia") : [];
  return m.length ? m : ["mercadopago", "transferencia"];
}

/** El próximo cobro sin pagar, en el orden en que se crearon. */
function proximoAPagar(d) {
  return (d?.pagos || []).find((p) => p.status !== "pagado") || null;
}

/**
 * La pestaña que corresponde mostrar si el cliente no eligió otra: la que
 * tiene algo para hacer.
 */
function pestanaSugerida(d) {
  if (["demo_pendiente", "demo_lista", "rechazado"].includes(d.status)) return "inicio";
  const pend = proximoAPagar(d);
  if (seccionAbierta(d, "pagos") && pend && pend.status !== "en_revision") return "pagos";
  if (d.status === "dominio" && seccionAbierta(d, "dominio")) return "dominio";
  if (d.status === "en_produccion" && seccionAbierta(d, "tareas")) return "tareas";
  if (d.status === "finalizado" && seccionAbierta(d, "produccion")) return "produccion";
  return "inicio";
}

/** El renglón chico de cada pestaña y si hay algo que le toca al cliente. */
function estadoPestana(d, k) {
  if (!seccionAbierta(d, k)) return { sub: "Próximamente", aviso: false };

  if (k === "inicio") {
    return d.status === "demo_lista"
      ? { sub: "Tu demo está lista", aviso: true }
      : { sub: "Demo y documentos", aviso: false };
  }
  if (k === "tareas") {
    const t = d.tareas || [];
    return { sub: t.length ? `${t.filter((x) => x.done).length} de ${t.length} listas` : "Cargá tus cambios", aviso: false };
  }
  if (k === "pagos") {
    const pend = proximoAPagar(d);
    if (!pend) return { sub: "Al día", aviso: false };
    if (pend.status === "en_revision") return { sub: "Comprobante en revisión", aviso: false };
    return { sub: `Pendiente ${usd(pend.amount_usd)}`, aviso: true };
  }
  if (k === "dominio") {
    if (d.domain_choice === "propio") return { sub: d.domain_name || "Dominio propio", aviso: false };
    if (d.domain_choice === "vercel") return { sub: "Dirección incluida", aviso: false };
    return { sub: "Elegí tu dirección", aviso: true };
  }
  if (k === "produccion") {
    return d.production_url ? { sub: "En línea", aviso: false } : { sub: "En camino", aviso: false };
  }
  return { sub: "", aviso: false };
}

function pintarNav(d, activa) {
  $("pc-nav").innerHTML = Object.entries(PESTANAS).map(([k, p]) => {
    const abierta = seccionAbierta(d, k);
    const { sub, aviso } = estadoPestana(d, k);
    const actual = k === activa;
    return `
      <li>
        <button type="button" class="portal-nav-btn ${actual ? "activo" : ""} ${abierta ? "" : "bloqueada"}"
                data-accion="pestana" data-pestana="${k}" ${actual ? 'aria-current="page"' : ""}>
          <span class="portal-nav-ico">${ico(abierta ? p.icono : "candado")}</span>
          <span class="portal-nav-txt">
            <b>${escapeHtml(p.label)}</b>
            <small>${escapeHtml(sub)}</small>
          </span>
          ${aviso ? `<span class="portal-nav-aviso"><span class="sr-only">Tenés algo pendiente acá</span></span>` : ""}
        </button>
      </li>`;
  }).join("");
}

/** Botón para saltar a otra pestaña desde el contenido (solo si está abierta). */
const irA = (d, k, texto, clase = "btn btn-primary") => seccionAbierta(d, k)
  ? `<button type="button" class="${clase}" data-accion="pestana" data-pestana="${k}">${escapeHtml(texto)}</button>`
  : "";

/* --------------------------------------------------------------------------
   Contenido de cada pestaña
   -------------------------------------------------------------------------- */

/** Inicio: en qué está el proyecto + los documentos. */
function tabInicio(d) {
  const etapa = ["demo_pendiente", "demo_lista", "rechazado"].includes(d.status)
    ? ETAPAS[d.status](d)
    : tarjetaEstado(d);
  return etapa + bloqueDocumentos(d);
}

/**
 * En qué está el proyecto, en una tarjeta, para las etapas posteriores a la
 * demo. Dice qué sigue y, si la pestaña para hacerlo está abierta, lleva ahí.
 */
function tarjetaEstado(d) {
  const tareas = d.tareas || [];
  const hechas = tareas.filter((t) => t.done).length;
  const pend = proximoAPagar(d);
  const accion = (...botones) => {
    const b = botones.filter(Boolean).join("");
    return b ? `<div class="portal-acciones">${b}</div>` : "";
  };
  const esperaHabilitar = (k) => seccionAbierta(d, k)
    ? "" : nota("Te habilito ese paso en un rato y te aviso por WhatsApp.", "", "reloj");

  const T = {
    anticipo_pendiente: () => tarjeta({
      icono: "tarjeta", titulo: "¡Arrancamos!",
      bajada: "Aceptaste la propuesta. El siguiente paso es el primer pago: con eso arranco a trabajar en tu página.",
      cuerpo: accion(irA(d, "pagos", "Ir a Pagos")) + esperaHabilitar("pagos"),
    }),
    en_produccion: () => tarjeta({
      icono: "engranaje", titulo: "Estoy trabajando en tu página",
      bajada: tareas.length
        ? `Llevo ${hechas} de ${tareas.length} cambios hechos. Podés seguir sumando los que quieras.`
        : "Contame qué querés ajustar: cada cambio por separado, así los voy tachando.",
      cuerpo: accion(irA(d, "tareas", "Ver y cargar cambios")) + esperaHabilitar("tareas"),
    }),
    dominio: () => tarjeta({
      icono: "globo", titulo: "Falta elegir la dirección",
      bajada: "Los cambios están listos. Decidí con qué dirección queda publicada tu página.",
      cuerpo: accion(irA(d, "dominio", "Elegir la dirección")) + esperaHabilitar("dominio"),
    }),
    publicando: () => ETAPAS.publicando(d),
    saldo_pendiente: () => tarjeta({
      icono: "check", tono: "listo", titulo: "Tu página está lista",
      bajada: pend ? "Solo falta el último pago para dejarla publicada y que sea toda tuya." : "Ya está todo pago.",
      cuerpo: accion(pend ? irA(d, "pagos", "Ir a Pagos") : "", irA(d, "produccion", "Ver mi página", "btn btn-outline")),
    }),
    finalizado: () => tarjeta({
      icono: "check", tono: "listo", titulo: "Tu página está en línea",
      bajada: "Proyecto terminado. Este link te queda para volver a mirar todo cuando quieras.",
      cuerpo: accion(irA(d, "produccion", "Ver mi página")),
    }),
  };

  return (T[d.status] || (() => tarjeta({
    icono: "info", tono: "espera",
    titulo: "Estamos trabajando en tu proyecto",
    bajada: "Te aviso por WhatsApp en cuanto haya novedades.",
  })))();
}

/** Demo, propuesta, presupuesto y descripción, juntos. */
function bloqueDocumentos(d) {
  const demo = safeUrl(d.demo_url, "");
  const docs = ["propuesta", "presupuesto", "descripcion"].map((k) => botonDocumento(d, k)).join("");
  const brief = d.project_brief || "";
  if (!demo && !docs && !brief) return "";

  return tarjeta({
    icono: "documento",
    titulo: "Tu proyecto",
    bajada: escapeHtml(d.project_name || ""),
    cuerpo: `
      ${brief ? `<p class="portal-brief">${escapeHtml(brief)}</p>` : ""}
      <div class="portal-acciones">
        ${demo ? `<a class="btn btn-outline" href="${escapeHtml(demo)}" target="_blank" rel="noopener noreferrer">
          ${ico("ojo", "pico pico-sm")} Ver la demo</a>` : ""}
        ${docs}
      </div>
      ${demo ? `<p class="portal-url">${escapeHtml(d.demo_url || "")}</p>` : ""}`,
  });
}

/** Tareas: la lista de cambios y, con la pestaña abierta, el campo para sumar. */
function tabTareas(d) {
  const tareas = d.tareas || [];
  const hechas = tareas.filter((t) => t.done).length;
  const pct = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

  const lista = tareas.length
    ? `<ul class="portal-cambios">
        ${tareas.map((t) => `
          <li class="portal-cambio ${t.done ? "ok" : ""}">
            <span class="portal-cambio-est">${ico(t.done ? "check" : "reloj", "pico pico-sm")}</span>
            <div><p>${escapeHtml(t.title)}</p>
              <small>${t.done ? "Listo" : "Pendiente"}${t.source === "cliente" ? " · lo pediste vos" : ""}</small>
              ${t.tiene_pdf ? `
                <button type="button" class="pilar-pdf-chip" data-doc="tarea" data-doc-tarea="${escapeHtml(String(t.id))}"
                        data-doc-nombre="${escapeHtml(t.pdf_name || "Tarea.pdf")}">
                  ${ico("documento", "pico pico-sm")} ${escapeHtml(t.pdf_name || "Ver PDF adjunto")}
                </button>` : ""}
            </div>
          </li>`).join("")}
      </ul>
      <div class="portal-avance">
        <b>${hechas} de ${tareas.length}</b>
        <span class="portal-avance-barra"><i style="transform:scaleX(${pct / 100})"></i></span>
        <b>${pct}%</b>
      </div>`
    : `<p class="portal-vacio">Todavía no hay cambios cargados. Escribí el primero acá arriba.</p>`;

  return tarjeta({
    icono: "lista",
    titulo: "Contame qué querés cambiar",
    bajada: "Escribí cada cambio por separado, así los voy tachando a medida que los hago. Si tenés un ejemplo o un texto, adjuntalo en PDF.",
    cuerpo: `
      <div class="portal-fila-campo">
        <label class="portal-campo">
          <span>Nuevo cambio</span>
          <input type="text" id="pc-pilar-cambio" maxlength="400"
                 placeholder="Ej: cambiar el color del botón de contacto">
        </label>
        <label class="btn btn-outline portal-adjuntar">
          ${ico("documento", "pico pico-sm")} PDF
          <input type="file" id="pc-pilar-pdf" accept="application/pdf" class="portal-oculto">
        </label>
        <button type="button" class="btn btn-primary" data-accion="agregar-cambio-pilar">Agregar</button>
      </div>
      <p id="pc-pilar-pdf-nombre" class="portal-adjunto-nombre"></p>
      ${lista}`,
  });
}

/** Pagos: lo que hay que pagar ahora + la cuenta completa. */
function tabPagos(d) {
  const pend = proximoAPagar(d);
  let tarjetaActual;

  if (!pend) {
    tarjetaActual = tarjeta({
      icono: "checkCirculo", tono: "listo",
      titulo: (d.pagos || []).length ? "Estás al día" : "Todavía no hay pagos",
      bajada: (d.pagos || []).length
        ? "No tenés nada pendiente por ahora. Abajo está el detalle de todo lo que pagaste."
        : "Cuando haya algo para pagar te aparece acá con el monto y las formas de pago.",
    });
  } else if (pend.kind === "saldo") {
    tarjetaActual = ETAPAS.saldo_pendiente(d);
  } else if (pend.kind === "anticipo" || pend.kind === "total") {
    tarjetaActual = ETAPAS.anticipo_pendiente(d);
  } else {
    tarjetaActual = tarjetaPago({
      kind: pend.kind,
      titulo: nombrePago(pend),
      bajada: pend.kind === "otro"
        ? "Un adicional que acordamos aparte del presupuesto."
        : "Uno de los pagos que acordamos.",
      monto: Number(pend.amount_usd),
      pago: pend,
    });
  }

  return tarjetaActual + `<div class="portal-resumen">${panelResumen(d)}</div>`;
}

/** Dominio: elegir (o corregir) la dirección. */
function tabDominio(d) {
  return ETAPAS.dominio(d);
}

/** Producción: el link final, o que todavía está en camino. */
function tabProduccion(d) {
  const link = safeUrl(d.production_url, "");
  if (!link) return ETAPAS.publicando(d);
  return ETAPAS.finalizado(d);
}

/** Lo que ve el cliente si toca una pestaña con candado. */
function tabBloqueada(k) {
  return tarjeta({
    icono: "candado", tono: "espera",
    titulo: `${PESTANAS[k].label}: todavía no está habilitada`,
    bajada: BLOQUEO[k] || "Se habilita más adelante.",
    cuerpo: nota("No tenés que hacer nada. Cuando la habilite te aviso por WhatsApp.", "", "reloj") + `
      <div class="portal-acciones">
        <button type="button" class="btn btn-outline" data-accion="pestana" data-pestana="inicio">Volver al inicio</button>
      </div>`,
  });
}

const CONTENIDO = {
  inicio: tabInicio,
  tareas: tabTareas,
  pagos: tabPagos,
  dominio: tabDominio,
  produccion: tabProduccion,
};

/* --------------------------------------------------------------------------
   El avance: anillo + en qué etapa está + qué sigue
   --------------------------------------------------------------------------
   Un número solo ("55%") no le dice nada al cliente: ¿55% de qué? ¿falta
   mucho? Al lado del anillo va la etapa en palabras y el paso que viene.
   -------------------------------------------------------------------------- */
const ETAPA_TXT = {
  demo_pendiente:     ["Preparando tu demo", "Después: la revisás y decidís si seguimos"],
  demo_lista:         ["Tu demo está lista", "Siguiente: mirala y decidí si seguimos"],
  anticipo_pendiente: ["Esperando el primer pago", "Después: arranco con tus cambios"],
  en_produccion:      ["Aplicando tus cambios", ""],
  dominio:            ["Eligiendo la dirección", "Después: publico tu página"],
  publicando:         ["Publicando tu página", "Ya casi está"],
  saldo_pendiente:    ["Tu página está lista", "Falta el último pago"],
  finalizado:         ["¡Proyecto terminado!", "Tu página está en línea"],
  rechazado:          ["Proyecto en pausa", "Escribime cuando quieras retomarlo"],
};

const CIRCUNFERENCIA = 2 * Math.PI * 52;   // r = 52 en el SVG

function pintarAvance(d, progreso) {
  const pct = Math.max(0, Math.min(100, progreso));
  const anillo = $("pc-anillo");
  if (anillo) {
    anillo.style.strokeDasharray = String(CIRCUNFERENCIA);
    anillo.style.strokeDashoffset = String(CIRCUNFERENCIA * (1 - pct / 100));
  }
  const caja = $("pc-barra-wrap");
  caja?.setAttribute("aria-valuenow", String(pct));
  caja?.classList.toggle("completo", d.status === "finalizado");
  caja?.classList.toggle("tres-cifras", pct >= 100);

  let [nombre, sig] = ETAPA_TXT[d.status] || ["En curso", ""];
  if (d.status === "en_produccion") {
    const t = d.tareas || [];
    sig = t.length
      ? `${t.filter((x) => x.done).length} de ${t.length} cambios listos`
      : "Contame qué querés ajustar";
  }
  $("pc-etapa-nombre").textContent = nombre;
  $("pc-etapa-sig").textContent = sig;
  caja?.setAttribute("aria-valuetext", `${pct}% · ${nombre}`);
}

function render() {
  if (!datos) return;

  const d = datos;
  const progreso = Number(d.progreso) || 0;

  $("pc-saludo").textContent = `Hola, ${d.client_name || ""}`.replace(/,\s*$/, "");
  $("pc-proyecto").textContent = d.project_name || "";
  $("pc-progreso-num").textContent = String(progreso);

  pintarAvance(d, progreso);

  // La pestaña: la que eligió el cliente (también una con candado, para
  // que vea por qué está cerrada) o, si no eligió, la que tiene algo para hacer.
  const activa = PESTANAS[pestanaActiva] ? pestanaActiva : pestanaSugerida(d);

  pintarNav(d, activa);
  $("pc-panel").innerHTML = seccionAbierta(d, activa) ? CONTENIDO[activa](d) : tabBloqueada(activa);

  const pdfInput = $("pc-pilar-pdf");
  const pdfNombre = $("pc-pilar-pdf-nombre");
  if (pdfInput && pdfNombre) {
    pdfInput.addEventListener("change", () => {
      const f = pdfInput.files?.[0];
      pdfNombre.innerHTML = f ? `${ico("documento", "pico pico-sm")} ${escapeHtml(f.name)}` : "";
    });
  }

  $("pc-wa-footer").href = enlaceWhatsApp(`Hola Ariel! Te escribo por "${d.project_name || "mi proyecto"}".`);

  firmaActual = firma(d);
  mostrarVista("contenido");
}

async function recargar() {
  datos = await portalObtener(TOKEN);
  if (!datos) {
    mostrarVista("invalido");
    return;
  }
  render();
}

/* ==========================================================================
   Actualización automática
   --------------------------------------------------------------------------
   Cuando Ariel mueve algo del proyecto —manda la demo, tacha un cambio,
   habilita el dominio— el cliente lo ve solo, sin recargar la página.
   Es consulta periódica y no Realtime a propósito: Realtime exigiría abrir
   una suscripción sobre `clients`, una tabla que el rol público no puede
   tocar ni de lejos. Acá se reusa la misma función que ya valida el token.

   Tres cuidados para que no moleste:

   1. Si la pestaña está en segundo plano, no se consulta nada. No tiene
      sentido gastar datos y batería para actualizar algo que nadie mira.
   2. Al volver a la pestaña se consulta AL INSTANTE. Es el momento en que
      más probable es que haya novedades y donde más se nota la espera.
   3. Si nada cambió, NO se repinta. Repintar de más reinicia animaciones y,
      peor, borraría lo que el cliente esté escribiendo.
   ========================================================================== */
const REFRESCO_MS = 30000;
let firmaActual = "";

/** Resumen de lo que, si cambia, amerita repintar. */
function firma(d) {
  if (!d) return "";
  return JSON.stringify([
    d.status,
    d.progreso,
    d.domain_choice,
    d.production_url,
    (d.tareas || []).map((t) => [t.id, t.done]),
    d.payment_plan,
    d.plan_fijado,
    d.secciones,
    d.metodos_pago,
    d.domain_name,
    (d.pagos || []).map((p) => [p.kind, p.status, p.amount_usd, p.concepto]),
  ]);
}

async function revisarNovedades() {
  if (document.hidden || !datos) return;

  let nuevos;
  try {
    nuevos = await portalObtener(TOKEN);
  } catch {
    return;   // Un corte de red no debe romper lo que ya está en pantalla.
  }

  // Sin respuesta: se deja lo que hay. El link puede seguir siendo válido y
  // ser un problema momentáneo de conexión; mandarlo a "link inválido" por
  // eso sería un susto injustificado.
  if (!nuevos) return;
  if (firma(nuevos) === firmaActual) return;

  // Si está escribiendo algo, se espera al próximo ciclo antes de repintar.
  const foco = document.activeElement;
  const escribiendo =
    foco && $("pc-panel")?.contains(foco) &&
    (foco.tagName === "INPUT" || foco.tagName === "TEXTAREA") && foco.value;
  if (escribiendo) return;

  const etapaAnterior = datos.status;
  datos = nuevos;
  render();

  // Cambiar de etapa es una novedad de verdad y merece un cartel. Que se
  // tache una tarea no: eso se ve solo en la lista.
  if (nuevos.status !== etapaAnterior) {
    anunciar("Tu proyecto avanzó de etapa.");
    avisar("¡Novedades!", "Tu proyecto avanzó. Mirá lo que sigue acá abajo.", "info");
  } else {
    anunciar("Se actualizó el avance de tu proyecto.");
  }
}

function iniciarActualizacionAutomatica() {
  setInterval(revisarNovedades, REFRESCO_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) revisarNovedades();
  });
  window.addEventListener("focus", revisarNovedades);
}

/* ==========================================================================
   Comprobante: comprimir antes de subir
   --------------------------------------------------------------------------
   Una foto de celular pesa 3-6 MB. Mandarla tal cual significa que el cliente
   espera medio minuto con datos móviles, que la base guarda megabytes por
   comprobante, y que muchas veces directamente falla. Un comprobante solo
   tiene que ser LEGIBLE: 1200px de lado y JPEG al 75% deja 100-300 KB.
   ========================================================================== */
function comprimirImagen(archivo) {
  const TIPOS = ["image/png", "image/jpeg", "image/webp"];
  if (!TIPOS.includes(archivo.type)) {
    avisar("Formato no soportado", "Mandá una imagen JPG, PNG o WEBP.", "warning");
    return;
  }

  // Tope de entrada generoso: lo que importa es el peso DESPUÉS de comprimir.
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
      const vista = $("pc-vista-previa");
      if (vista) {
        vista.src = comprobanteBase64;
        vista.classList.remove("hidden");
      }
      const txt = $("pc-archivo-texto");
      if (txt) txt.textContent = `Imagen lista (${kb} KB) · tocá para cambiarla`;
      anunciar("Comprobante cargado.");
    };

    img.src = String(lector.result || "");
  };

  lector.readAsDataURL(archivo);
}

/* ==========================================================================
   Mercado Pago
   --------------------------------------------------------------------------
   El navegador NO habla con Mercado Pago directamente: crear una preferencia
   exige el ACCESS_TOKEN de la cuenta, que es un secreto y jamás puede estar en
   el bundle. Se pide a una función serverless, la única que lo conoce.
   Ver api/mp-crear-preferencia.js.
   ========================================================================== */
async function iniciarPago(kind, boton) {
  const original = boton.innerHTML;
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
      avisar("No se pudo abrir el pago",
             cuerpo.error || "Escribime por WhatsApp y lo resolvemos en un minuto.", "error");
      return;
    }

    window.location.href = cuerpo.init_point;
  } catch (err) {
    console.error("Error iniciando el pago:", err?.message || err);
    avisar("Sin conexión", "No pudimos contactar el servidor de pagos. Probá de nuevo.", "error");
  } finally {
    boton.disabled = false;
    boton.innerHTML = original;
  }
}

/* ==========================================================================
   Acciones
   --------------------------------------------------------------------------
   Delegación en el contenedor de la etapa: como el HTML se vuelve a armar en
   cada render, enganchar listeners a cada botón obligaría a re-enganchar todo
   cada vez (y a acordarse de hacerlo). Un solo listener en el padre sobrevive
   a todos los repintados.
   ========================================================================== */
const ACCIONES = {

  copiar: async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.valor || "");
      anunciar("Copiado.");
      el.textContent = "¡Copiado!";
      setTimeout(() => { el.innerHTML = `${ico("copiar", "pico pico-sm")} Copiar`; }, 1600);
    } catch {
      avisar("Copialo a mano", "Tu navegador bloqueó el portapapeles.", "info");
    }
  },

  metodo: (el) => {
    metodoElegido = el.value;
    comprobanteBase64 = "";
    render();
  },

  mercadopago: (el) => iniciarPago(el.dataset.kind, el),

  /**
   * Baja el recibo del pago que se toco.
   *
   * El boton se deshabilita mientras se genera: html2pdf tarda ~1 segundo y
   * sin esto el cliente aprieta tres veces y se bajan tres archivos iguales.
   */
  "bajar-recibo": async (el) => {
    // Por número de recibo y no por tipo: con varias cuotas o extras, el
    // tipo ya no identifica un pago solo.
    const pago = (datos?.pagos || []).find((p) => String(p.nro_recibo) === el.dataset.nro);
    if (!pago) return;

    const original = el.innerHTML;
    el.disabled = true;
    el.innerHTML = `${ico("reloj", "pico pico-sm")} <span class="portal-recibo-txt">Generando…</span>`;

    try {
      await descargarComprobante({ pago, datos, cotizacion: cotizacionDolar });
      anunciar("Comprobante descargado.");
    } catch (err) {
      console.error("comprobante:", err);
      avisar("No se pudo generar el comprobante",
             "Probá de nuevo en un momento. Si sigue sin salir, escribime y te lo paso por WhatsApp.",
             "error");
    } finally {
      el.disabled = false;
      el.innerHTML = original;
    }
  },

  continuar: async (el) => {
    const fijo = Boolean(datos?.plan_fijado && PLAN_TXT[datos?.payment_plan]);
    const plan = fijo
      ? datos.payment_plan
      : document.querySelector('input[name="plan"]:checked')?.value || "mitades";
    const precio = Number(datos?.price_usd) || 0;
    const reserva = pagadoDe(["reserva"]);
    const conReserva = reserva > 0 ? ` (menos los ${usd(reserva)} de reserva que ya abonaste)` : "";

    const detalle = {
      cuotas3: `Vas a pagar ${usd(precio)}${conReserva} en 3 cuotas sin interés con tarjeta, desde Mercado Pago. Con eso arranco y se te habilita la lista de cambios.`,
      unico: `Vas a pagar ${usd(precio)}${conReserva} en un solo pago para arrancar.`,
      mitades: `Vas a pagar ${usd(precio / 2)}${conReserva} ahora para arrancar, y el resto cuando la página esté publicada.`,
      personalizado: "Vamos con los pagos que acordamos. El primero te aparece acá para pagar.",
    }[plan];

    const ok = await confirmar({
      titulo: "¿Arrancamos?",
      texto: detalle,
      confirmar: "Sí, arrancamos",
      cancelar: "Volver",
      icono: "question",
    });
    if (!ok) return;

    el.disabled = true;
    const res = await portalDecidir(TOKEN, "continuar", plan);
    el.disabled = false;

    if (!res?.ok) {
      avisar("No se pudo confirmar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    // Si la pestaña Pagos ya está abierta, se lo lleva directo ahí.
    pestanaActiva = null;
    await recargar();
    const pagosAbierta = seccionAbierta(datos, "pagos");
    if (pagosAbierta && res.status !== "en_produccion") {
      pestanaActiva = "pagos";
      render();
    }
    avisar("¡Buenísimo!",
           res.status === "en_produccion"
             ? "Con lo que ya abonaste alcanza para arrancar. Te aviso cuando te habilite la lista de cambios."
             : !pagosAbierta
               ? "Anotado. En un rato te habilito el pago acá mismo y te aviso por WhatsApp."
               : plan === "cuotas3"
                 ? "Te dejé el pago listo. Al entrar a Mercado Pago elegí las cuotas."
                 : "Te dejé el primer pago listo.",
           "success");
  },

  "no-continuar": async () => {
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
  },

  "agregar-cambio": async (el) => {
    const campo = $("pc-cambio");
    const texto = sanitizeText(campo?.value || "", 400);
    if (!texto) {
      avisar("Falta el texto", "Escribí qué querés cambiar.", "warning");
      campo?.focus();
      return;
    }

    el.disabled = true;
    const res = await portalPedirCambio(TOKEN, texto);
    el.disabled = false;

    if (!res?.ok) {
      avisar("No se pudo agregar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    await recargar();
    anunciar("Cambio agregado.");
    $("pc-cambio")?.focus();
  },

  "agregar-cambio-pilar": async (el) => {
    const campo = $("pc-pilar-cambio");
    const pdfInput = $("pc-pilar-pdf");
    const texto = sanitizeText(campo?.value || "", 400);

    if (!texto) {
      avisar("Falta el texto", "Escribí qué querés cambiar o hacer.", "warning");
      campo?.focus();
      return;
    }

    let pdfData = null;
    let pdfName = null;

    if (pdfInput && pdfInput.files && pdfInput.files[0]) {
      try {
        const file = pdfInput.files[0];
        if (file.type !== "application/pdf") {
          avisar("Formato inválido", "El archivo adjunto debe ser un PDF.", "warning");
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          avisar("Archivo grande", "El PDF no puede pesar más de 5 MB.", "warning");
          return;
        }
        const reader = new FileReader();
        const resPdf = await new Promise((resolve, reject) => {
          reader.onload = () => resolve({ data: String(reader.result || ""), name: file.name });
          reader.onerror = () => reject(new Error("Error leyendo el PDF"));
          reader.readAsDataURL(file);
        });
        pdfData = resPdf.data;
        pdfName = resPdf.name;
      } catch (err) {
        avisar("Error de archivo", "No se pudo leer el PDF adjunto.", "error");
        return;
      }
    }

    el.disabled = true;
    const res = await portalPedirCambio(TOKEN, texto, pdfData, pdfName);
    el.disabled = false;

    if (!res?.ok) {
      avisar("No se pudo agregar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    await recargar();
    anunciar("Cambio agregado.");
  },

  "dominio-op": (el) => {
    const wrap = $("pc-dom-nombre-wrap");
    if (wrap) wrap.hidden = el.value !== "propio";
    if (el.value === "propio") $("pc-dom-nombre")?.focus();
  },

  "guardar-dominio": async (el) => {
    const opcion = document.querySelector('input[name="dom"]:checked')?.value || "vercel";
    const nombre = sanitizeText($("pc-dom-nombre")?.value || "", 253);

    if (opcion === "propio" && !nombre) {
      avisar("Falta el dominio", "Escribí qué dirección querés (por ejemplo: tunegocio.com).", "warning");
      $("pc-dom-nombre")?.focus();
      return;
    }

    const ok = await confirmar({
      titulo: "¿Confirmamos la dirección?",
      texto: opcion === "propio"
        ? `Tu página va a quedar en ${nombre}. El costo del dominio se suma al pago final.`
        : "Tu página va a quedar con la dirección que ya tiene, sin costo extra.",
      confirmar: "Sí, confirmar",
      cancelar: "Volver",
      icono: "question",
    });
    if (!ok) return;

    el.disabled = true;
    const res = await portalElegirDominio(TOKEN, opcion, nombre || null);
    el.disabled = false;

    if (!res?.ok) {
      avisar("No se pudo confirmar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    await recargar();
    avisar("Listo", res.status === "publicando"
      ? "Ya me pongo con la publicación. Te aviso apenas esté."
      : "Dirección guardada. Si querés cambiarla, podés hacerlo desde acá mismo.", "success");
  },

  "enviar-comprobante": async (el) => {
    if (!comprobanteBase64) {
      avisar("Falta el comprobante", "Elegí la foto del comprobante antes de enviar.", "warning");
      return;
    }

    el.disabled = true;
    el.textContent = "Enviando…";

    try {
      const res = await portalSubirComprobante(
        TOKEN,
        el.dataset.kind,
        comprobanteBase64,
        sanitizeText($("pc-nota-comprobante")?.value || "", 500)
      );

      if (!res?.ok) {
        avisar("No se pudo enviar", res?.error || "Probá de nuevo.", "error");
        return;
      }

      comprobanteBase64 = "";
      await recargar();
      avisar("¡Comprobante recibido!",
             "Lo reviso y te lo confirmo. Vas a ver el pago acreditado acá mismo.", "success");
    } finally {
      el.disabled = false;
      el.textContent = "Enviar comprobante";
    }
  },

  /** Cambiar de pestaña. Queda en la URL (#pagos) para que al recargar
      o al volver con la flecha se abra la misma. */
  pestana: (el) => {
    const k = el.dataset.pestana;
    if (!PESTANAS[k]) return;
    pestanaActiva = k;
    try { history.replaceState(null, "", `#${k}`); } catch { /* sin historial: no pasa nada */ }
    render();
    anunciar(`${PESTANAS[k].label}${seccionAbierta(datos, k) ? "" : ", todavía no habilitada"}.`);
    const panel = $("pc-panel");
    panel?.focus({ preventScroll: true });
    // En el celular la barra queda arriba: se baja hasta el contenido.
    if (window.matchMedia("(max-width: 899px)").matches) {
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  },
};

$("portal-contenido").addEventListener("click", (ev) => {
  const btnDoc = ev.target.closest("[data-doc]");
  if (btnDoc) {
    ev.preventDefault();
    abrirDocumentoGuardado(btnDoc);
    return;
  }

  const btnPdf = ev.target.closest("[data-pdf-url]");
  if (btnPdf) {
    ev.preventDefault();
    const url = btnPdf.dataset.pdfUrl;
    const name = btnPdf.dataset.pdfFilename || "documento.pdf";
    abrirDocumentoPdf(url, name);
    return;
  }

  const el = ev.target.closest("[data-accion]");
  if (!el || el.tagName === "INPUT") return;
  const fn = ACCIONES[el.dataset.accion];
  if (fn) fn(el);
});

$("portal-contenido").addEventListener("change", (ev) => {
  // El input de archivo está oculto y lo dispara el <label>: no lleva
  // data-accion, así que se atiende por id antes de la delegación normal.
  if (ev.target.id === "pc-archivo") {
    if (ev.target.files?.[0]) comprimirImagen(ev.target.files[0]);
    return;
  }

  // Los radios (método de pago, opción de dominio) reportan por 'change',
  // nunca por 'click'.
  const el = ev.target.closest("[data-accion]");
  if (!el || el.tagName !== "INPUT") return;
  const fn = ACCIONES[el.dataset.accion];
  if (fn) fn(el);
});

// Teclado: Enter en el campo de cambios agrega el cambio.
$("portal-contenido").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id === "pc-pilar-cambio") {
    ev.preventDefault();
    const boton = document.querySelector('[data-accion="agregar-cambio-pilar"]');
    if (boton) ACCIONES["agregar-cambio-pilar"](boton);
  }
});

/* ==========================================================================
   Arranque
   ========================================================================== */
(async function iniciar() {
  configurarDialogos();

  $("portal-wa-ayuda").href = enlaceWhatsApp("Hola Ariel, el link de mi proyecto no me funciona.");

  // #pagos, #tareas…: abre directo esa pestaña (sirve para mandar el link
  // apuntando a lo que tiene que hacer). Al volver de Mercado Pago, Pagos.
  const deLaUrl = window.location.hash.replace("#", "");
  if (PESTANAS[deLaUrl]) pestanaActiva = deLaUrl;
  if (VUELVE_DE_PAGO) pestanaActiva = "pagos";

  if (!TOKEN || TOKEN.length < 20) {
    mostrarVista("invalido");
    return;
  }

  try {
    await cargarCotizacionDolar();
    await recargar();
    iniciarActualizacionAutomatica();

    // Si vuelve desde Mercado Pago, el estado lo confirma el webhook y puede
    // tardar unos segundos. Se refresca solo, sin pedirle que recargue.
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
