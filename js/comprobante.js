/**
 * comprobante.js — El recibo que el cliente se lleva en PDF.
 *
 * POR QUE EXISTE
 * --------------
 * Hasta ahora, cuando un cliente pagaba, lo unico que le quedaba era la
 * pantalla del portal diciendo "acreditado". Eso alcanza mientras el
 * proyecto esta en curso, pero no despues: el cliente cierra el link, pasan
 * seis meses, y no tiene nada en la mano que diga cuanto pago, cuando, y por
 * que. Un recibo descargable es la diferencia entre "me acuerdo que pague" y
 * "tengo el papel".
 *
 * ESTO NO ES UNA FACTURA
 * ----------------------
 * Es un recibo propio. No es un comprobante fiscal de AFIP y el PDF lo dice
 * por escrito, en el pie, sin letra chica. Esa aclaracion no es un tramite:
 * si el cliente guarda esto creyendo que es una factura y despues su
 * contador la pide, el problema vuelve. Mejor que quede claro de entrada.
 *
 * DE DONDE SALEN LOS DATOS
 * ------------------------
 * Todos de `portal_obtener`, que el portal ya pidio. El numero de recibo lo
 * asigna Postgres cuando el pago pasa a 'pagado' (migracion 12) y no se
 * calcula aca a proposito: un numero armado en el navegador cambiaria en
 * cada descarga, y entonces el numero que tiene el cliente no existiria en
 * ningun lado.
 *
 * html2pdf se carga SOLO cuando el cliente aprieta el boton. Son ~700 kB:
 * hacerlos bajar a todos los que entran al portal, cuando la mayoria nunca
 * descarga un recibo, es regalar el primer render.
 */

import { escapeHtml } from "./security.js";

/* Los datos del emisor. Si cambian, se cambian en UN lugar. */
export const EMISOR = {
  nombre:   "Ariel.Dev",
  titular:  "Ariel Martinelli",
  rubro:    "Desarrollo y diseño web",
  email:    "ariel.martinelli.dev@gmail.com",
  whatsapp: "+54 351 612 1498",
  lugar:    "Córdoba, Argentina",
  sitio:    "arieldev.com.ar",
};

const CONCEPTO = {
  anticipo: "Anticipo del 50% — desarrollo web",
  saldo:    "Saldo final — desarrollo web",
  total:    "Pago total del proyecto — desarrollo web",
  dominio:  "Dominio propio",
};

const METODO = {
  mercadopago:    "Mercado Pago",
  transferencia:  "Transferencia bancaria",
  efectivo:       "Efectivo",
  otro:           "Otro",
};

/* ==========================================================================
   Formato
   ========================================================================== */

/**
 * R-<anio>-<numero>.
 *
 * A proposito NO se usa el formato 0001-00000001: ese es el de un
 * comprobante fiscal argentino, y un cliente que lo ve asume factura. La R
 * adelante y el año legible dejan claro de un vistazo que es otra cosa.
 */
export function numeroRecibo(nro, fechaISO) {
  if (!nro) return null;
  const anio = fechaISO ? new Date(fechaISO).getFullYear() : new Date().getFullYear();
  return `R-${anio}-${String(nro).padStart(4, "0")}`;
}

function fechaLarga(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR",
    { day: "2-digit", month: "long", year: "numeric" });
}

const pesos = (n) =>
  Number(n) ? `$${Math.round(Number(n)).toLocaleString("es-AR")} ARS` : null;

const dolares = (n) =>
  `USD ${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ==========================================================================
   El documento
   ========================================================================== */

/**
 * Devuelve el HTML del recibo.
 *
 * Todo el estilo va inline y en unidades absolutas (mm, pt), no con las
 * variables del portal: html2pdf rasteriza este nodo fuera de la pantalla, y
 * ahi no hay tema oscuro ni `rem` que signifiquen lo mismo. Un recibo que se
 * imprime tiene que ser negro sobre blanco.
 */
export function htmlComprobante({ pago, datos, cotizacion }) {
  const nro = numeroRecibo(pago.nro_recibo, pago.recibo_fecha || pago.paid_at);

  // El monto en pesos: primero el que quedo guardado con el pago (es el del
  // dia en que se cobro), y solo si no hay, se estima con la cotizacion de
  // hoy — avisando que es una referencia, porque no es lo que se cobro.
  const arsGuardado = pesos(pago.amount_ars);
  const arsEstimado = !arsGuardado && cotizacion
    ? pesos(Number(pago.amount_usd || 0) * cotizacion) : null;

  const filas = [
    ["Recibo N°", nro || "—"],
    ["Fecha de pago", fechaLarga(pago.recibo_fecha || pago.paid_at)],
    ["Medio de pago", METODO[pago.method] || "—"],
    ["Proyecto", datos.project_name || "—"],
  ];

  return `
    <div style="width:190mm;padding:14mm 13mm;box-sizing:border-box;
                background:#fff;color:#1a1a1a;
                font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                font-size:10.5pt;line-height:1.55;">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;
                  border-bottom:2px solid #1a1a1a;padding-bottom:7mm;margin-bottom:9mm;">
        <div>
          <div style="font-size:19pt;font-weight:700;letter-spacing:-0.4pt;">${escapeHtml(EMISOR.nombre)}</div>
          <div style="color:#555;font-size:9pt;margin-top:1mm;">${escapeHtml(EMISOR.rubro)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:8.5pt;letter-spacing:1.4pt;text-transform:uppercase;color:#777;">Recibo de pago</div>
          <div style="font-size:15pt;font-weight:700;margin-top:1.5mm;">${escapeHtml(nro || "—")}</div>
        </div>
      </div>

      <div style="margin-bottom:8mm;">
        <div style="font-size:8.5pt;letter-spacing:1.2pt;text-transform:uppercase;color:#777;margin-bottom:2mm;">Recibí de</div>
        <div style="font-size:13pt;font-weight:600;">${escapeHtml(datos.client_name || "—")}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8mm;">
        <tbody>
          ${filas.map(([k, v], i) => `
            <tr style="${i % 2 ? "background:#fafafa;" : ""}">
              <td style="padding:2.6mm 3mm;color:#555;width:42%;border-bottom:1px solid #eee;">${escapeHtml(k)}</td>
              <td style="padding:2.6mm 3mm;font-weight:600;border-bottom:1px solid #eee;">${escapeHtml(String(v))}</td>
            </tr>`).join("")}
        </tbody>
      </table>

      <div style="border:1px solid #e3e3e3;border-radius:3mm;overflow:hidden;margin-bottom:8mm;">
        <div style="display:flex;justify-content:space-between;padding:4mm 5mm;background:#fafafa;
                    border-bottom:1px solid #e3e3e3;font-size:8.5pt;letter-spacing:1pt;
                    text-transform:uppercase;color:#777;">
          <span>Concepto</span><span>Importe</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:5mm;">
          <span style="max-width:60%;">${escapeHtml(CONCEPTO[pago.kind] || "Desarrollo web")}</span>
          <span style="text-align:right;">
            <span style="font-size:15pt;font-weight:700;">${escapeHtml(dolares(pago.amount_usd))}</span>
            ${arsGuardado ? `<div style="color:#555;font-size:9.5pt;margin-top:1mm;">${escapeHtml(arsGuardado)}</div>` : ""}
            ${arsEstimado ? `<div style="color:#777;font-size:8.5pt;margin-top:1mm;">equivale a ${escapeHtml(arsEstimado)} al cambio de hoy</div>` : ""}
          </span>
        </div>
      </div>

      <div style="background:#f4f8f4;border-left:3px solid #2f9e44;padding:4mm 5mm;
                  border-radius:0 2mm 2mm 0;margin-bottom:9mm;">
        <strong style="color:#1f7a2e;">Pago acreditado.</strong>
        Este importe figura como cobrado y no hay nada pendiente sobre este concepto.
      </div>

      <!-- La aclaracion va ARRIBA del pie y en texto normal, no como letra
           chica al final: es lo que evita que el cliente guarde esto
           creyendo que tiene una factura. -->
      <div style="border:1px dashed #c9c9c9;padding:4mm 5mm;border-radius:2mm;
                  font-size:9pt;color:#444;margin-bottom:8mm;">
        <strong>No válido como factura.</strong>
        Es un recibo propio, emitido como constancia del pago. No es un
        comprobante fiscal de AFIP. Si necesitás factura, escribime y la
        gestiono aparte.
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;
                  border-top:1px solid #e3e3e3;padding-top:5mm;font-size:8.5pt;color:#666;">
        <div>
          <div>${escapeHtml(EMISOR.titular)}</div>
          <div>${escapeHtml(EMISOR.email)}</div>
          <div>${escapeHtml(EMISOR.whatsapp)}</div>
          <div>${escapeHtml(EMISOR.lugar)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;color:#1a1a1a;font-size:10pt;">${escapeHtml(EMISOR.sitio)}</div>
          <div style="margin-top:1mm;">Emitido el ${escapeHtml(fechaLarga(new Date().toISOString()))}</div>
        </div>
      </div>
    </div>`;
}

/* ==========================================================================
   Generar el archivo
   ========================================================================== */

let cargando = null;

/** Trae html2pdf la primera vez que alguien pide un recibo, no antes. */
function cargarHtml2Pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (cargando) return cargando;

  cargando = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/html2pdf.bundle.min.js";
    s.onload = () => resolve(window.html2pdf);
    s.onerror = () => {
      cargando = null;     // que se pueda reintentar si fallo la red
      reject(new Error("No se pudo cargar el generador de PDF."));
    };
    document.head.appendChild(s);
  });
  return cargando;
}

/** Nombre de archivo sin sorpresas: nada de barras ni acentos raros. */
function nombreArchivo(datos, pago) {
  const proyecto = String(datos.project_name || "proyecto")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // saca los acentos
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "proyecto";
  const nro = numeroRecibo(pago.nro_recibo, pago.recibo_fecha || pago.paid_at) || "recibo";
  return `${nro}-${proyecto}.pdf`;
}

/**
 * Arma el recibo y lo descarga.
 *
 * El nodo se monta fuera de la pantalla en vez de en un iframe: html2canvas
 * necesita que el elemento este en el documento y con estilos resueltos para
 * medirlo. `left:-10000px` lo saca de la vista sin sacarlo del layout, que es
 * lo que pasaria con display:none — ahi mediria 0x0 y el PDF saldria vacio.
 */
export async function descargarComprobante({ pago, datos, cotizacion }) {
  if (!pago || pago.status !== "pagado") {
    throw new Error("Todavía no hay un pago acreditado para este concepto.");
  }

  const html2pdf = await cargarHtml2Pdf();

  const caja = document.createElement("div");
  caja.setAttribute("aria-hidden", "true");
  caja.style.cssText = "position:fixed;left:-10000px;top:0;width:190mm;background:#fff;";
  caja.innerHTML = htmlComprobante({ pago, datos, cotizacion });
  document.body.appendChild(caja);

  try {
    await html2pdf()
      .set({
        margin: 0,
        filename: nombreArchivo(datos, pago),
        image: { type: "jpeg", quality: 0.98 },
        // scale 2 y no 3: a 3 el archivo pesa el doble y en un recibo de
        // texto plano la diferencia no se ve ni impresa.
        html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(caja.firstElementChild)
      .save();
  } finally {
    // En el finally: si html2pdf falla a mitad de camino, el nodo igual se
    // saca. Si no, queda colgado del body y se acumula uno por intento.
    caja.remove();
  }
}
