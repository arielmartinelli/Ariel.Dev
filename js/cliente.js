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

const usd = (n) =>
  `USD ${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

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
const TRAZOS = {
  reloj:   '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  ojo:     '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  tarjeta: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h3"/>',
  lista:   '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  globo:   '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  subir:   '<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',
  check:   '<path d="m4.5 12.5 5 5 10-11"/>',
  copiar:  '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/>',
  alerta:  '<path d="M12 4.5 2.8 20h18.4L12 4.5z"/><path d="M12 10v4M12 17.2h.01"/>',
  wa:      '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
  cohete:  '<path d="M13.5 4.5c3.5-2 6-1 6-1s1 2.5-1 6c-1.7 3-5 6-7 7l-4-4c1-2 4-5.3 6-8z"/><path d="M7.5 12.5 4 14l2 2 2 2 1.5-3.5"/>',
  cruz:    '<path d="M7 7l10 10M17 7 7 17"/>',
};
const ico = (k, clase = "pico") =>
  `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true">${TRAZOS[k] || ""}</svg>`;

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

  $("pc-pasos").innerHTML = PASOS.map((t, i) => {
    const hecho = terminado || (activo >= 0 && i < activo);
    const esActivo = !terminado && i === activo;
    const clase = hecho ? "hecho" : esActivo ? "activo" : "";
    const marca = hecho ? ico("check", "pico pico-sm") : String(i + 1);
    return `<li class="portal-paso ${clase}" ${esActivo ? 'aria-current="step"' : ""}>
              <span class="portal-paso-n">${marca}</span>
              <span class="portal-paso-t">${t}</span>
            </li>`;
  }).join("");
}

/* ==========================================================================
   Piezas reutilizables
   ========================================================================== */
function tarjeta({ icono, tono = "", titulo, bajada, cuerpo = "" }) {
  return `
    <section class="portal-etapa">
      <div class="portal-etapa-cab">
        <span class="portal-etapa-ico ${tono}">${ico(icono)}</span>
        <div>
          <h2>${escapeHtml(titulo)}</h2>
          ${bajada ? `<p class="portal-etapa-sub">${bajada}</p>` : ""}
        </div>
      </div>
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
  return `
    <div class="portal-datos">
      <div class="portal-dato">
        <span><small>Alias</small><b>${escapeHtml(d.alias)}</b></span>
        <button type="button" class="portal-copiar" data-accion="copiar" data-valor="${escapeHtml(d.alias)}">
          ${ico("copiar", "pico pico-sm")} Copiar
        </button>
      </div>
      <div class="portal-dato"><span><small>Titular</small><b>${escapeHtml(d.titular)}</b></span></div>
      <div class="portal-dato"><span><small>Banco</small><b>${escapeHtml(d.banco)}</b></span></div>
      <div class="portal-dato"><span><small>Importe</small><b>${escapeHtml(usd(monto))}</b></span></div>
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
        cartelDeEspera("Comprobante en revisión", `${usd(pago.amount_usd)} · enviado el ${fecha(pago.comprobante_fecha)}`) +
        nota("Si necesitás que lo mire ya, escribime por WhatsApp y lo destrabo en el momento.", "warn", "alerta"),
    });
  }

  const esTransferencia = metodoElegido === "transferencia";

  return tarjeta({
    icono: "tarjeta", titulo, bajada,
    cuerpo: `
      ${detalle || `<p class="portal-monto"><b>${escapeHtml(usd(monto))}</b></p>`}

      <div class="portal-ops" role="radiogroup" aria-label="Forma de pago">
        <label class="portal-op">
          <input type="radio" name="metodo" value="mercadopago" data-accion="metodo" ${esTransferencia ? "" : "checked"}>
          <span class="portal-op-marca" aria-hidden="true"></span>
          <span class="portal-op-txt"><b>Mercado Pago</b>
            <small>Tarjeta, débito o dinero en cuenta. Se acredita al instante.</small></span>
        </label>
        <label class="portal-op">
          <input type="radio" name="metodo" value="transferencia" data-accion="metodo" ${esTransferencia ? "checked" : ""}>
          <span class="portal-op-marca" aria-hidden="true"></span>
          <span class="portal-op-txt"><b>Transferencia</b>
            <small>Transferís y subís la foto del comprobante.</small></span>
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
    return tarjeta({
      icono: "ojo",
      titulo: "Tu demo está lista",
      bajada: "Miralá con calma, desde la computadora y desde el celular. Si te convence cómo va, arrancamos con tu página de verdad.",
      cuerpo: `
        <div class="portal-acciones">
          <a class="btn btn-primary" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
            ${ico("ojo", "pico pico-sm")} Ver la demo
          </a>
        </div>
        <p class="portal-url">${escapeHtml(d.demo_url || "")}</p>
        ${nota(`Si continuás, el primer paso es el <strong>anticipo del 50%</strong>. El otro 50% se paga recién cuando la página está publicada y funcionando.`)}
        <div class="portal-acciones">
          <button type="button" class="btn btn-exito" data-accion="continuar">
            ${ico("check", "pico pico-sm")} Sí, quiero continuar
          </button>
          <button type="button" class="btn btn-suave" data-accion="no-continuar">Por ahora no</button>
        </div>`,
    });
  },

  anticipo_pendiente: (d) => tarjetaPago({
    kind: "anticipo",
    titulo: "Anticipo del 50%",
    bajada: "Con el anticipo arranco a trabajar y se te habilita la lista de cambios para dejar la página a tu gusto.",
    monto: pagoDe("anticipo")?.amount_usd ?? Number(d.price_usd) / 2,
    detalle: `<p class="portal-monto">
        <b>${escapeHtml(usd(pagoDe("anticipo")?.amount_usd ?? Number(d.price_usd) / 2))}</b>
        <span>de ${escapeHtml(usd(d.total_usd))} totales</span></p>`,
    pago: pagoDe("anticipo"),
  }),

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
        <div><span>Saldo del desarrollo (50%)</span><span>${escapeHtml(usd(base))}</span></div>
        ${extra > 0
          ? `<div><span>Dominio propio${d.domain_name ? ` · ${escapeHtml(d.domain_name)}` : ""}</span><span>${escapeHtml(usd(extra))}</span></div>`
          : ""}
        <div><span>Total a pagar</span><span>${escapeHtml(usd(monto))}</span></div>
      </div>`;

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
        ${nota(`Pagos al día: ${escapeHtml(usd(cobrado))} de ${escapeHtml(usd(d.total_usd))}.`, "ok", "check")}
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

  pintarPasos(d.status);

  // Si llega una etapa que este build no conoce (porque falta correr una
  // migración, o al revés), no se muestra una pantalla en blanco.
  const pintar = ETAPAS[d.status];
  $("pc-etapa").innerHTML = pintar
    ? pintar(d)
    : tarjeta({
        icono: "info", tono: "espera",
        titulo: "Estamos trabajando en tu proyecto",
        bajada: "Te aviso por WhatsApp en cuanto haya novedades.",
      });

  $("pc-wa-footer").href = enlaceWhatsApp(`Hola Ariel! Te escribo por "${d.project_name || "mi proyecto"}".`);

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

  continuar: async (el) => {
    const ok = await confirmar({
      titulo: "¿Arrancamos?",
      texto: "Al confirmar se genera el anticipo del 50%. Cuando se acredite vas a poder cargar todos los cambios que quieras.",
      confirmar: "Sí, arrancamos",
      cancelar: "Volver",
      icono: "question",
    });
    if (!ok) return;

    el.disabled = true;
    const res = await portalDecidir(TOKEN, "continuar");
    el.disabled = false;

    if (!res?.ok) {
      avisar("No se pudo confirmar", res?.error || "Probá de nuevo.", "error");
      return;
    }
    await recargar();
    avisar("¡Buenísimo!", "Te dejé el anticipo listo para pagar acá abajo.", "success");
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
};

$("pc-etapa").addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-accion]");
  if (!el || el.tagName === "INPUT") return;
  const fn = ACCIONES[el.dataset.accion];
  if (fn) fn(el);
});

$("pc-etapa").addEventListener("change", (ev) => {
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

// Enter en el campo de cambios = tocar "Agregar".
$("pc-etapa").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || ev.target.id !== "pc-cambio") return;
  ev.preventDefault();
  const boton = document.querySelector('[data-accion="agregar-cambio"]');
  if (boton) ACCIONES["agregar-cambio"](boton);
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
    await recargar();

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
