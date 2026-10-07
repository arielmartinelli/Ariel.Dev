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
 * ESTRUCTURA: UNA TARJETA POR ETAPA
 * ---------------------------------
 * El portal muestra el saludo, el avance, el riel de 5 pasos y UNA sola
 * tarjeta: la de la etapa en la que esta el proyecto. Nada mas.
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
let pasoVista = null;        // null = ver paso activo en vivo; number (0-4) = inspeccionar historial

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
   El riel de 5 pasos
   ========================================================================== */
const PASOS = ["Demo", "Anticipo", "Cambios", "Dominio", "Entrega"];

/** En qué paso del riel cae cada una de las 9 etapas. */
const PASO_DE = {
  demo_pendiente: 0,
  demo_lista: 0,
  anticipo_pendiente: 1,
  en_produccion: 2,
  dominio: 3,
  publicando: 4,
  saldo_pendiente: 4,
  finalizado: 4,
  rechazado: -1,
};

function pintarPasos(status) {
  const activo = PASO_DE[status] ?? -1;
  const terminado = status === "finalizado";
  const pasoVisualizado = pasoVista !== null ? pasoVista : (terminado ? 4 : activo);

  $("pc-pasos").innerHTML = PASOS.map((t, i) => {
    const hecho = terminado || (activo >= 0 && i < activo);
    const esPasoActivoReal = !terminado && i === activo;
    const esSeleccionado = i === pasoVisualizado;

    const esClickeable = i <= activo || hecho;
    const claseHecho = hecho ? "hecho" : "";
    const claseActivo = esSeleccionado ? "activo" : "";
    const claseClickeable = esClickeable ? "clickeable" : "";

    const marca = hecho ? ico("check", "pico pico-sm") : String(i + 1);

    const subTexto = esPasoActivoReal && pasoVista !== null && pasoVista !== activo
      ? `<small class="paso-nota paso-nota-curso">${ico("punto", "pico pico-xs")} en curso</small>`
      : hecho && !esSeleccionado
      ? `<small class="paso-nota paso-nota-listo">${ico("check", "pico pico-xs")} listo</small>`
      : '';

    return `<li class="portal-paso ${claseHecho} ${claseActivo} ${claseClickeable}"
                ${esSeleccionado ? 'aria-current="step"' : ""}
                ${esClickeable ? `data-accion="ver-paso" data-paso="${i}" role="button" tabindex="0" title="Tocá para ver ${t}"` : ""}>
              <span class="portal-paso-n">${marca}</span>
              <span class="portal-paso-t">${t}${subTexto}</span>
            </li>`;
  }).join("");
}

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

  const esTransferencia = metodoElegido === "transferencia";

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

      <div class="portal-ops" role="radiogroup" aria-label="Forma de pago">
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
      </div>

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

/* ==========================================================================
   Una función por etapa
   --------------------------------------------------------------------------
   Cada una devuelve el HTML completo de su tarjeta. No hay estado compartido
   entre ellas: lo que no devuelve una etapa, sencillamente no existe en
   pantalla.
   ========================================================================== */
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
        <li><span>2</span><div><b>Anticipo del 50%</b><small>Con eso arranco a trabajar en serio.</small></div></li>
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

        <p class="portal-ruta-tit">¿Cómo preferís pagarlo?</p>
        <div class="portal-ops" role="radiogroup" aria-label="Forma de pago">
          <label class="portal-op">
            <input type="radio" name="plan" value="mitades" checked>
            <span class="portal-op-marca" aria-hidden="true"></span>
            <span class="portal-op-txt"><b>Mitades</b>
              <small>${escapeHtml(usd(precio / 2))} para arrancar y ${escapeHtml(usd(precio / 2))} cuando la página está publicada.</small></span>
          </label>
          <label class="portal-op">
            <input type="radio" name="plan" value="cuotas3">
            <span class="portal-op-marca" aria-hidden="true"></span>
            <span class="portal-op-txt"><b>3 cuotas sin interés</b>
              <small>${escapeHtml(usd(precio))} con tarjeta en Mercado Pago. Lo pagás una vez y la tarjeta te lo divide en 3.</small></span>
            <span class="portal-op-precio libre">Sin recargo</span>
          </label>
        </div>

        ${nota("Elegís ahora y después, si querés cambiar, me escribís y lo vemos. El dominio propio, si lo elegís más adelante, se suma al final.")}

        <div class="portal-acciones">
          <button type="button" class="btn btn-exito" data-accion="continuar">
            ${ico("check", "pico pico-sm")} Sí, quiero continuar
          </button>
          <button type="button" class="btn btn-suave" data-accion="no-continuar">Por ahora no</button>
        </div>`,
    });
  },

  anticipo_pendiente: (d) => {
    // El plan de 3 cuotas genera UN cobro por el total; el de mitades, el
    // anticipo del 50%. La tarjeta es la misma, cambian el monto y el texto.
    const enCuotas = d.payment_plan === "cuotas3";
    const pago = pagoDe(enCuotas ? "total" : "anticipo");
    const monto = pago?.amount_usd ?? (enCuotas ? Number(d.price_usd) : Number(d.price_usd) / 2);
    const totalUsd = Number(d.total_usd) || 0;

    return tarjetaPago({
      kind: enCuotas ? "total" : "anticipo",
      titulo: enCuotas ? "Pago en 3 cuotas sin interés" : "Anticipo del 50%",
      bajada: enCuotas
        ? "Pagás una sola vez con tarjeta y Mercado Pago te lo divide en 3 cuotas sin interés. Apenas se acredita arranco y se te habilita la lista de cambios."
        : "Con el anticipo arranco a trabajar y se te habilita la lista de cambios para dejar la página a tu gusto.",
      monto,
      detalle: `
        <div class="portal-monto-box" style="margin: 8px 0 18px;">
          <p class="portal-monto">
            <b>${escapeHtml(usd(monto))}</b>
            <span>${enCuotas ? "el proyecto completo" : `de ${escapeHtml(usd(totalUsd))} totales`}</span>
          </p>
          <p style="font-size: 1.05rem; font-weight: 700; color: #4ade80; margin-top: 2px;">
            ≡ ${escapeHtml(ars(monto))}
            <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); margin-left: 6px;">(Cotización Dólar hoy: $${cotizacionDolar.toLocaleString("es-AR")} ARS/USD)</span>
          </p>
          ${enCuotas ? `<p class="portal-cuotas-hint">3 cuotas de ${escapeHtml(usd(monto / 3))} · ${escapeHtml(ars(monto / 3))} cada una</p>` : ""}
        </div>`,
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
      titulo: "Elegí la dirección de tu página",
      bajada: "Ya están todos los cambios hechos. Falta decidir con qué dirección va a quedar publicada.",
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
    const pago = pagoDe("saldo");
    const monto = pago?.amount_usd ?? Number(d.price_usd) / 2;
    const extra = d.domain_choice === "propio" ? Number(d.domain_extra_usd || 0) : 0;
    const base = Number(monto) - extra;

    const detalle = `
      <div class="portal-desglose">
        <div><span>Saldo del desarrollo (50%)</span><span>${escapeHtml(usd(base))} <small style="color:var(--text-secondary); font-weight:500;">(${ars(base)})</small></span></div>
        ${extra > 0
          ? `<div><span>Dominio propio${d.domain_name ? ` · ${escapeHtml(d.domain_name)}` : ""}</span><span>${escapeHtml(usd(extra))} <small style="color:var(--text-secondary); font-weight:500;">(${ars(extra)})</small></span></div>`
          : ""}
        <div><span>Total a pagar</span><span style="color: #4ade80;">${escapeHtml(usd(monto))} · ${ars(monto)}</span></div>
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
        ${nota(`Pagos al día: ${escapeHtml(usd(cobrado))} (${ars(cobrado)}) de ${escapeHtml(usd(d.total_usd))}.`, "ok", "check")}
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
   Historial navegable de pasos anteriores
   --------------------------------------------------------------------------
   Permite al cliente hacer clic en cualquier paso completado (Demo, Anticipo,
   Cambios, Dominio, Entrega) para consultar su historial, recuperar el enlace
   de la demo, verificar que el anticipo figura pagado, etc.
   ========================================================================== */
const ETAPAS_HISTORIAL = {
  // Paso 0: Demo
  0: (d) => {
    const link = safeUrl(d.demo_url, "");
    return tarjeta({
      icono: "ojo", tono: "listo",
      titulo: "Paso 1: Demo del proyecto (Aprobada)",
      bajada: "Esta fue la versión previa de prueba que revisaste y confirmaste.",
      cuerpo: `
        ${link ? `
          <div class="portal-acciones">
            <a class="btn btn-outline" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
              ${ico("ojo", "pico pico-sm")} Ver la demo
            </a>
          </div>
          <p class="portal-url">${escapeHtml(d.demo_url || "")}</p>` : ""}
        ${nota("Demo aprobada y confirmada. El proyecto continuó a la fase de desarrollo.", "ok", "check")}
        <div class="portal-acciones" style="margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" data-accion="reiniciar-paso" data-decision="reabrir_demo" data-nombre-paso="Demo">
            ↺ Retomar proyecto desde la Demo
          </button>
          <button type="button" class="btn btn-primary btn-sm" data-accion="volver-paso-actual">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Volver al paso en curso
          </button>
        </div>`,
    });
  },

  // Paso 1: Anticipo
  1: (d) => {
    const pago = pagoDe("anticipo");
    const monto = pago?.amount_usd ?? Number(d.price_usd) / 2;
    const fechaPago = pago?.comprobante_fecha ? fecha(pago.comprobante_fecha) : "registrado";
    const estadoTexto = pago?.status === "pagado" ? "Acreditado" : "Aprobado";

    return tarjeta({
      icono: "tarjeta", tono: "listo",
      titulo: "Paso 2: Anticipo del 50% (Pagado)",
      bajada: "El anticipo fue recibido y confirmado correctamente.",
      cuerpo: `
        <div class="portal-espera" style="border-color: rgba(34, 197, 94, 0.35); background: rgba(34, 197, 94, 0.06); text-align: left; padding: 20px 24px; justify-content: space-between; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; border-radius: 16px;">
          <div>
            <strong class="portal-hito-ok">${ico("checkCirculo", "pico")} Anticipo del 50% acreditado</strong>
            <small style="color: var(--text-secondary); font-size: 0.92rem; margin-top: 4px; display: block;">
              ${usd(monto)} (${ars(monto)}) · ${estadoTexto} (${fechaPago})
            </small>
          </div>
          <span style="background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 5px 14px; border-radius: 20px; font-size: 0.82rem; font-weight: 700;">
            100% Pagado
          </span>
        </div>
        ${nota("Pago del 50% registrado correctamente. Con este paso abonado se habilitó el desarrollo y la lista de cambios.", "ok", "check")}
        <div class="portal-acciones" style="margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" data-accion="reiniciar-paso" data-decision="volver_anticipo" data-nombre-paso="Anticipo">
            ↺ Retomar paso de Anticipo
          </button>
          <button type="button" class="btn btn-primary btn-sm" data-accion="volver-paso-actual">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Volver al paso en curso
          </button>
        </div>`,
    });
  },

  // Paso 2: Cambios
  2: (d) => {
    const tareas = d.tareas || [];
    const hechas = tareas.filter((t) => t.done).length;

    const lista = tareas.length
      ? `<ul class="portal-cambios">
          ${tareas.map((t) => `
            <li class="portal-cambio ok">
              <span class="portal-cambio-est">${ico("check", "pico pico-sm")}</span>
              <div><p>${escapeHtml(t.title)}</p>
                <small>Listo${t.source === "cliente" ? " · lo pediste vos" : ""}</small></div>
            </li>`).join("")}
        </ul>`
      : `<p class="portal-vacio">Se completó la producción del proyecto sin cambios pendientes.</p>`;

    return tarjeta({
      icono: "lista", tono: "listo",
      titulo: "Paso 3: Lista de Cambios (Completados)",
      bajada: `Resumen de las ${hechas} tareas ajustadas y completadas en tu página.`,
      cuerpo: `
        ${lista}
        ${nota("Todos los cambios fueron completados y validados satisfactoriamente.", "ok", "check")}
        <div class="portal-acciones" style="margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" data-accion="reiniciar-paso" data-decision="volver_cambios" data-nombre-paso="Cambios">
            ↺ Retomar paso de Cambios
          </button>
          <button type="button" class="btn btn-primary btn-sm" data-accion="volver-paso-actual">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Volver al paso en curso
          </button>
        </div>`,
    });
  },

  // Paso 3: Dominio
  3: (d) => {
    const propio = d.domain_choice === "propio";
    const nombreDom = d.domain_name || "";
    const demoUrl = (d.demo_url || "").replace(/^https?:\/\//, "");

    return tarjeta({
      icono: "globo", tono: "listo",
      titulo: "Paso 4: Dirección web (Confirmada)",
      bajada: "Dirección seleccionada y configurada para publicar tu sitio.",
      cuerpo: `
        <div class="portal-datos" style="margin-bottom: 16px;">
          <div class="portal-dato">
            <span><small>Modalidad</small><b>${propio ? "Dominio Propio" : "Dirección incluida"}</b></span>
          </div>
          <div class="portal-dato">
            <span><small>Dirección configurada</small><b style="color: #4ade80;">${escapeHtml(propio ? nombreDom : demoUrl)}</b></span>
          </div>
        </div>
        ${nota("Dirección confirmada y lista para la publicación.", "ok", "check")}
        <div class="portal-acciones" style="margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" data-accion="reiniciar-paso" data-decision="volver_dominio" data-nombre-paso="Dominio">
            ↺ Retomar paso de Dominio
          </button>
          <button type="button" class="btn btn-primary btn-sm" data-accion="volver-paso-actual">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Volver al paso en curso
          </button>
        </div>`,
    });
  },

  // Paso 4: Entrega
  4: (d) => {
    const pago = pagoDe("saldo");
    const pagado = pago?.status === "pagado" || d.status === "finalizado";
    const prod = safeUrl(d.production_url, "");

    if (pagado && prod) {
      return ETAPAS.finalizado(d);
    }

    if (pago?.status === "pagado") {
      return tarjeta({
        icono: "check", tono: "listo",
        titulo: "Paso 5: Saldo del proyecto (Abonado)",
        bajada: "El pago del saldo final fue acreditado correctamente.",
        cuerpo: `
          ${nota(`Saldo pagado: ${escapeHtml(usd(pago.amount_usd))} (${ars(pago.amount_usd)}).`, "ok", "check")}
          <div class="portal-acciones" style="margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary btn-sm" data-accion="volver-paso-actual">
              ← Volver al paso en curso
            </button>
          </div>`,
      });
    }

    return ETAPAS[d.status] ? ETAPAS[d.status](d) : ETAPAS.saldo_pendiente(d);
  },
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
  anticipo: "Anticipo 50%",
  saldo:    "Saldo final",
  total:    "Pago total",
  dominio:  "Dominio propio",
};

function bloqueComprobantes(d) {
  const conRecibo = (d.pagos || []).filter((p) => p.status === "pagado" && p.nro_recibo);
  if (!conRecibo.length) return "";

  return `
    <div class="portal-recibos">
      <p class="portal-recibos-tit">${ico("recibo", "pico pico-sm")} Tus comprobantes</p>
      ${conRecibo.map((p) => `
        <button type="button" class="portal-resumen-link portal-recibo-btn"
                data-accion="bajar-recibo" data-kind="${escapeHtml(p.kind)}">
          ${ico("descargar", "pico pico-sm")}
          <span class="portal-recibo-txt">
            <b>${escapeHtml(CONCEPTO_CORTO[p.kind] || "Pago")}</b>
            <small>${escapeHtml(numeroRecibo(p.nro_recibo, p.recibo_fecha || p.paid_at) || "")} · ${escapeHtml(usd(p.amount_usd))}</small>
          </span>
        </button>`).join("")}
      <p class="portal-recibos-nota">No válido como factura.</p>
    </div>`;
}

/* ==========================================================================
   Resumen del proyecto (columna derecha en pantalla ancha)
   ========================================================================== */
function panelResumen(d) {
  const pagos = d.pagos || [];
  const pagado = pagos.filter((p) => p.status === "pagado")
                      .reduce((a, p) => a + Number(p.amount_usd || 0), 0);
  const total = Number(d.total_usd) || 0;
  const resta = Math.max(0, total - pagado);

  const demo = safeUrl(d.demo_url, "");
  const prod = safeUrl(d.production_url, "");

  const filas = [
    { label: "Presupuesto", usdVal: usd(total), arsVal: ars(total) },
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
      <h3>Tu proyecto</h3>
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
        <div><dt>Dirección</dt><dd class="corta">${escapeHtml(dominio)}</dd></div>
      </dl>

      ${prod ? `
        <a class="portal-resumen-link" href="${escapeHtml(prod)}" target="_blank" rel="noopener noreferrer">
          ${ico("globo", "pico pico-sm")} Ver mi página
        </a>` : demo ? `
        <a class="portal-resumen-link" href="${escapeHtml(demo)}" target="_blank" rel="noopener noreferrer">
          ${ico("ojo", "pico pico-sm")} Ver la demo
        </a>` : ""}

      ${botonDocumento(d, "propuesta", "portal-resumen-link")}
      ${botonDocumento(d, "presupuesto", "portal-resumen-link")}
      ${botonDocumento(d, "descripcion", "portal-resumen-link")}

      ${bloqueComprobantes(d)}

      <a class="portal-resumen-link solo-ancho" target="_blank" rel="noopener noreferrer"
         href="${escapeHtml(enlaceWhatsApp(`Hola Ariel! Te escribo por "${d.project_name || "mi proyecto"}".`))}">
        ${ico("wa", "pico pico-sm")} Escribirme
      </a>
    </div>`;
}

function panelPilares(d) {
  const demoUrl = safeUrl(d.demo_url, "");
  const brief = d.project_brief || "";
  const tareas = d.tareas || [];
  const hechas = tareas.filter((t) => t.done).length;
  const pct = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

  // 1. Tarjeta Demo
  const cardDemo = `
    <div class="pilar-card">
      <div class="pilar-card-head">
        <span class="pilar-ico pilar-ico-demo">${ico("ojo")}</span>
        <div>
          <h3 class="pilar-card-tit">Demo en Vivo</h3>
          <span class="pilar-card-sub">${demoUrl ? "Versión preliminar interactiva" : "En desarrollo"}</span>
        </div>
      </div>
      <div class="pilar-card-body">
        ${demoUrl ? `
          <p class="pilar-desc">Podés revisar el diseño, animación y estructura de tu página en vivo:</p>
          <a class="btn btn-primary btn-block" href="${escapeHtml(demoUrl)}" target="_blank" rel="noopener noreferrer" style="margin-top:10px;">
            ${ico("ojo", "pico pico-sm")} Abrir la demo
          </a>
          <span class="pilar-url">${escapeHtml(d.demo_url || "")}</span>
        ` : `
          <p class="pilar-desc">Tu demo está en preparación. Apenas la publique vas a poder probarla directamente desde acá.</p>
          <div class="pilar-badge-espera">${ico("reloj", "pico pico-sm")} En proceso de armado</div>
        `}
      </div>
    </div>`;

  // 2. Tarjeta Propuesta y Descripción del Proyecto

  const cardPropuesta = `
    <div class="pilar-card">
      <div class="pilar-card-head">
        <span class="pilar-ico pilar-ico-propuesta">${ico("lista")}</span>
        <div>
          <h3 class="pilar-card-tit">Propuesta y Descripción</h3>
          <span class="pilar-card-sub">Alcance, brief y especificaciones</span>
        </div>
      </div>
      <div class="pilar-card-body">
        ${brief ? `
          <div class="pilar-brief-box" style="margin-bottom: 12px;">
            <p style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">Descripción del proyecto:</p>
            <p style="white-space:pre-wrap;">${escapeHtml(brief)}</p>
          </div>
        ` : ""}

        <div class="pilar-docs">
          ${botonDocumento(d, "propuesta", "btn btn-outline btn-block")}
          ${botonDocumento(d, "presupuesto", "btn btn-outline btn-block")}
          ${botonDocumento(d, "descripcion", "btn btn-outline btn-block")}
        </div>

        ${!brief && !hayDocumento(d, "propuesta") && !hayDocumento(d, "presupuesto") && !hayDocumento(d, "descripcion")
          ? `<p class="pilar-desc">Propuesta general acordada para el desarrollo de tu sitio web.</p>` : ""}
      </div>
    </div>`;

  // 3. Tarjeta Tareas (Cuadradito de Tareas)
  const puedePedirCambio = ["en_produccion", "dominio"].includes(d.status);

  const listaTareasHtml = tareas.length
    ? `<ul class="pilar-tareas-list">
        ${tareas.map((t) => `
          <li class="pilar-tarea-item ${t.done ? "hecha" : ""}">
            <span class="pilar-tarea-icon">${ico(t.done ? "check" : "reloj", "pico pico-sm")}</span>
            <div class="pilar-tarea-info">
              <span class="pilar-tarea-txt">${escapeHtml(t.title)}</span>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:2px;">
                <small class="pilar-tarea-sub">${t.done ? "Listo" : "Pendiente"}${t.source === "cliente" ? " · tu pedido" : ""}</small>
                ${t.tiene_pdf ? `
                  <button type="button" class="pilar-pdf-chip" data-doc="tarea" data-doc-tarea="${escapeHtml(String(t.id))}" data-doc-nombre="${escapeHtml(t.pdf_name || "Tarea.pdf")}">
                    ${ico("documento", "pico pico-sm")} ${escapeHtml(t.pdf_name || "Ver PDF adjunto")}
                  </button>
                ` : ""}
              </div>
            </div>
          </li>
        `).join("")}
      </ul>
      <div class="portal-avance" style="margin-top:14px;">
        <b>${hechas} de ${tareas.length} completadas</b>
        <span class="portal-avance-barra"><i style="transform:scaleX(${pct / 100})"></i></span>
        <b>${pct}%</b>
      </div>`
    : `<p class="portal-vacio">Aún no hay tareas cargadas en la lista.</p>`;

  const cardTareas = `
    <div class="pilar-card pilar-card-tareas">
      <div class="pilar-card-head">
        <span class="pilar-ico pilar-ico-tareas">${ico("check")}</span>
        <div>
          <h3 class="pilar-card-tit">Cuadradito de Tareas</h3>
          <span class="pilar-card-sub">${tareas.length ? `${hechas} de ${tareas.length} completadas (${pct}%)` : "Alcance del proyecto"}</span>
        </div>
      </div>
      <div class="pilar-card-body">
        ${listaTareasHtml}

        ${puedePedirCambio ? `
          <div class="pilar-nuevo-cambio-wrap" style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border);">
            <p style="font-size:0.85rem; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Sumar un nuevo cambio o pedido:</p>
            <div class="portal-fila-campo" style="flex-wrap:wrap; gap:8px;">
              <input type="text" id="pc-pilar-cambio" maxlength="400" placeholder="Ej: cambiar el color del botón de contacto" style="flex:1; min-width:180px;">
              <label class="btn btn-outline btn-sm" style="cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                ${ico("documento", "pico pico-sm")} PDF
                <input type="file" id="pc-pilar-pdf" accept="application/pdf" style="display:none">
              </label>
              <button type="button" class="btn btn-primary btn-sm" data-accion="agregar-cambio-pilar">Agregar</button>
            </div>
            <span id="pc-pilar-pdf-nombre" class="admin-hint" style="font-size:0.75rem; margin-top:4px; display:block;"></span>
          </div>
        ` : ""}
      </div>
    </div>`;

  return cardDemo + cardPropuesta + cardTareas;
}

/* ==========================================================================
   Render
   ========================================================================== */
function render() {
  if (!datos) return;

  const d = datos;
  const progreso = Number(d.progreso) || 0;

  $("pc-saludo").textContent = `Hola, ${d.client_name || ""}`.replace(/,\s*$/, "");
  $("pc-proyecto").textContent = d.project_name || "";
  $("pc-progreso-num").textContent = String(progreso);

  $("pc-barra").style.transform = `scaleX(${progreso / 100})`;
  $("pc-barra-wrap").setAttribute("aria-valuenow", String(progreso));

  const pasoActivo = PASO_DE[d.status] ?? -1;
  const terminado = d.status === "finalizado";

  // Si pasoVista está fuera de rango o apunta a un paso futuro no disponible, reseteamos a null
  if (pasoVista !== null && !terminado && pasoVista > pasoActivo) {
    pasoVista = null;
  }

  pintarPasos(d.status);

  // Si pasoVista != null y pasoVista < pasoActivo (o terminado), renderiza historial
  let htmlEtapa = "";
  if (pasoVista !== null && (pasoVista < pasoActivo || terminado) && ETAPAS_HISTORIAL[pasoVista]) {
    htmlEtapa = ETAPAS_HISTORIAL[pasoVista](d);
  } else {
    const pintar = ETAPAS[d.status];
    htmlEtapa = pintar
      ? pintar(d)
      : tarjeta({
          icono: "info", tono: "espera",
          titulo: "Estamos trabajando en tu proyecto",
          bajada: "Te aviso por WhatsApp en cuanto haya novedades.",
        });
  }

  $("pc-etapa").innerHTML = htmlEtapa;

  const conResumen = ["anticipo_pendiente", "en_produccion", "dominio",
                      "publicando", "saldo_pendiente", "finalizado"];
  const hayResumen = conResumen.includes(d.status);
  $("pc-resumen").innerHTML = hayResumen ? panelResumen(d) : "";

  document.querySelector(".portal-columnas")
          ?.classList.toggle("sin-resumen", !hayResumen);

  const pilaresEl = $("pc-pilares");
  if (pilaresEl) {
    pilaresEl.innerHTML = panelPilares(d);

    const pilarPdfInput = $("pc-pilar-pdf");
    const pilarPdfNombre = $("pc-pilar-pdf-nombre");
    if (pilarPdfInput && pilarPdfNombre) {
      pilarPdfInput.addEventListener("change", () => {
        if (pilarPdfInput.files && pilarPdfInput.files[0]) {
          pilarPdfNombre.textContent = `${ico("documento", "pico pico-sm")} PDF adjunto listo: ${pilarPdfInput.files[0].name}`;
        } else {
          pilarPdfNombre.textContent = "";
        }
      });
    }
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
    (d.pagos || []).map((p) => [p.kind, p.status, p.amount_usd]),
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
    foco && $("pc-etapa")?.contains(foco) &&
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
    const pago = pagoDe(el.dataset.kind);
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
    const plan = document.querySelector('input[name="plan"]:checked')?.value || "mitades";
    const precio = Number(datos?.price_usd) || 0;

    const detalle = plan === "cuotas3"
      ? `Vas a pagar ${usd(precio)} en 3 cuotas sin interés con tarjeta, desde Mercado Pago. Con eso arranco y se te habilita la lista de cambios.`
      : `Vas a pagar ${usd(precio / 2)} ahora para arrancar, y los otros ${usd(precio / 2)} cuando la página esté publicada.`;

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
    await recargar();
    avisar("¡Buenísimo!",
           plan === "cuotas3"
             ? "Te dejé el pago listo acá abajo. Al entrar a Mercado Pago elegí 3 cuotas."
             : "Te dejé el anticipo listo para pagar acá abajo.",
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
    avisar("Listo", "Ya me pongo con la publicación. Te aviso apenas esté.", "success");
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

  "ver-paso": (el) => {
    const p = parseInt(el.dataset.paso, 10);
    if (isNaN(p)) return;
    const pasoActivo = PASO_DE[datos?.status] ?? -1;
    const terminado = datos?.status === "finalizado";

    if (!terminado && p > pasoActivo) {
      avisar("Paso pendiente", "Este paso se habilitará a medida que avances en el proyecto.", "info");
      return;
    }

    if (p === pasoActivo && !terminado) {
      pasoVista = null;
    } else {
      pasoVista = p;
    }
    render();
  },

  "volver-paso-actual": () => {
    pasoVista = null;
    render();
  },

  "reiniciar-paso": async (el) => {
    const dec = el.dataset.decision || "reabrir_demo";
    const nombrePaso = el.dataset.nombrePaso || "Demo";
    const ok = await confirmar({
      titulo: `¿Retomar el proyecto desde el paso ${nombrePaso}?`,
      texto: `El estado del proyecto en vivo se actualizará y volverá activamente a la etapa de «${nombrePaso}».`,
      confirmar: `Sí, volver a ${nombrePaso}`,
      cancelar: "Volver",
      icono: "question",
    });
    if (!ok) return;

    el.disabled = true;
    const res = await portalDecidir(TOKEN, dec);
    el.disabled = false;

    if (!res?.ok) {
      avisar("No se pudo reiniciar el paso", res?.error || "Probá de nuevo.", "error");
      return;
    }
    pasoVista = null;
    await recargar();
    avisar("Paso retornado", `El proyecto volvió activamente al paso de «${nombrePaso}».`, "success");
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

// Teclado: Enter en el campo de cambios o Enter/Espacio en el riel de pasos.
$("portal-contenido").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id === "pc-cambio") {
    ev.preventDefault();
    const boton = document.querySelector('[data-accion="agregar-cambio"]');
    if (boton) ACCIONES["agregar-cambio"](boton);
    return;
  }

  if (ev.key === "Enter" || ev.key === " ") {
    const el = ev.target.closest('[data-accion="ver-paso"]');
    if (el) {
      ev.preventDefault();
      const fn = ACCIONES["ver-paso"];
      if (fn) fn(el);
    }
  }
});

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
