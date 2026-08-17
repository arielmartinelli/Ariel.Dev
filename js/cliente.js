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
import { guardarResena } from "./reviews.js";

const WHATSAPP = "543516121498";

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

/* Cotización Dólar Oficial y estado de reintentos */
let cotizacionDolarOficial = 1250;
let cotizacionCargada = false;
const pagosPermitidosReintentar = new Set();
const timersEnProceso = new Map();

async function cargarCotizacionDolar() {
  if (cotizacionCargada) return;
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/oficial");
    const data = await res.json();
    if (data && data.venta > 0) {
      cotizacionDolarOficial = Math.round(data.venta);
      cotizacionCargada = true;
    }
  } catch (err) {
    console.error("Error al obtener cotización del dólar:", err);
  }
}

/* ==========================================================================
   Render principal
   ========================================================================== */
/**
 * Determina el Paso activo (1 a 4) según el avance del desarrollo y las confirmaciones del admin:
 * Paso 1: Demo & Desarrollo (Avance, tareas, pedido de cambios, pago 50% adelanto, recibo adelanto)
 * Paso 2: Elección de Dominio (Habilitado cuando el desarrollo está listo al 100% y Ariel presiona 'Desarrollo listo')
 * Paso 3: Pago Final (50%) (Habilitado cuando el dominio está listo y Ariel presiona 'Dominio listo')
 * Paso 4: Publicado (Sitio online publicado con link definitivo y confeti)
 */
function obtenerPasoActual(datos) {
  if (!datos) return 1;
  const { status, desarrollo_listo, dominio_listo, production_url, project_brief = "", admin_notes = "" } = datos;

  if (status === "finalizado" || Boolean(production_url)) {
    return 4; // Paso 4: Publicado
  }

  const tagDominio = String(project_brief).includes("[DOMINIO_LISTO]") || String(admin_notes).includes("[DOMINIO_LISTO]");
  if (status === "dominio_listo" || Boolean(dominio_listo) || tagDominio) {
    return 3; // Paso 3: Pago Final (50%)
  }

  const tagDesarrollo = String(project_brief).includes("[DESARROLLO_LISTO]") || String(admin_notes).includes("[DESARROLLO_LISTO]");
  if (status === "desarrollo_listo" || Boolean(desarrollo_listo) || tagDesarrollo) {
    return 2; // Paso 2: Elección de Dominio
  }

  return 1; // Paso 1: Demo & Desarrollo
}

async function render() {
  if (!datos) return;

  await cargarCotizacionDolar();

  const {
    client_name, project_name, project_brief, status, demo_url, price_usd,
    domain_choice, domain_name, domain_extra_usd, total_usd,
    progreso, production_url, tareas = [], pagos = [],
  } = datos;

  const pasoActual = obtenerPasoActual(datos);

  // --- Encabezado ---
  $("pc-nombre").textContent = client_name || "";
  $("pc-proyecto").textContent = project_name || "Tu proyecto";
  document.title = `${project_name || "Tu proyecto"} | Seguimiento`;

  const briefLimpio = (project_brief || "").replace(/\[(DESARROLLO_LISTO|DOMINIO_LISTO)\]/g, "").trim();
  const brief = $("pc-brief");
  brief.textContent = briefLimpio;
  brief.hidden = !briefLimpio;

  const meta = ESTADOS[status] || { label: status, color: "#64748b" };
  const chip = $("pc-estado");
  chip.textContent = meta.label;
  chip.style.setProperty("--chip-color", meta.color);

  // --- Bloque demo ---
  const enDemo = status === "demo_lista" && pasoActual === 1;
  mostrarBloque("pc-bloque-demo", enDemo);
  if (enDemo && demo_url) {
    const link = $("pc-demo-link");
    link.href = safeUrl(demo_url, "#");
    link.hidden = false;
  } else if (enDemo) {
    $("pc-demo-link").hidden = true;
  }
  $("pc-anticipo-monto").textContent = usd((Number(price_usd) || 0) * 0.5);

  // --- Progreso (Visible para transparencia) ---
  mostrarBloque("pc-bloque-progreso", true);
  mostrarBloque("pc-hero-progreso", true);
  pintarProgreso(progreso, tareas, domain_choice);

  // --- Dominio: SE MUESTRA ÚNICAMENTE EN PASO 2 ---
  const mostrarDominio = pasoActual === 2;
  mostrarBloque("pc-bloque-dominio", mostrarDominio);
  if (mostrarDominio) {
    $("pc-dom-precio").textContent = `+${usd(domain_extra_usd)}`;
    if (demo_url) {
      $("pc-dom-vercel-desc").textContent =
        `El mismo de tu demo (${dominioLegible(demo_url)}). Sin costo adicional.`;
    }
  }

  // --- Pagos: Filtrados por el Paso Actual ---
  mostrarBloque("pc-bloque-pagos", pagos.length > 0);
  if (pagos.length > 0) {
    const totalUsdNum = Number(total_usd || 0);
    const totalArsNum = Math.round(totalUsdNum * cotizacionDolarOficial);
    $("pc-total").innerHTML = `Total: ${usd(total_usd)} <span style="font-size:0.85rem; font-weight:normal; opacity:0.8;">(≈ $${totalArsNum.toLocaleString("es-AR")} ARS)</span>`;

    let pagosVisibles = pagos;
    if (pasoActual === 1) {
      // En Paso 1: Únicamente el Adelanto (50%)
      pagosVisibles = pagos.filter((p) => p.kind === "anticipo");
    } else if (pasoActual === 2) {
      // En Paso 2: Adelanto + Dominio (si es propio)
      pagosVisibles = pagos.filter((p) => p.kind === "anticipo" || p.kind === "dominio");
    }
    // En Pasos 3 y 4: Todos los pagos (incluyendo Saldo 50%)

    pintarPagos(pagosVisibles, pasoActual);
  }

  // --- Pedido de cambios extra (Habilitado en Pasos 1 y 2) ---
  mostrarBloque("pc-bloque-pedido", pasoActual === 1 || pasoActual === 2);

  // --- Final / Publicado: SE MUESTRA ÚNICAMENTE EN PASO 4 ---
  const finalizado = pasoActual === 4 && Boolean(production_url);
  mostrarBloque("pc-bloque-final", finalizado);
  if (finalizado) {
    const linkFinal = $("pc-final-link");
    if (linkFinal) linkFinal.href = safeUrl(production_url, "#");
  }

  // --- Dejanos tu Reseña (Aparece al finalizar en Paso 4) ---
  const mostrarResena = pasoActual === 4 || finalizado || progreso >= 99;
  mostrarBloque("pc-bloque-resena", mostrarResena);
  if (mostrarResena) {
    const inputEmpresa = $("pc-resena-empresa");
    if (inputEmpresa && !inputEmpresa.value) {
      inputEmpresa.value = domain_name || (production_url ? production_url.replace(/^https?:\/\//, "") : "");
    }
  }

  // --- Roadmap Timeline ---
  actualizarRoadmap(pasoActual);
  if (pasoActual === 4) verificarCelebracion(status, progreso);

  // --- Links de WhatsApp contextualizados ---
  const asunto = `Hola Ariel, te escribo por el proyecto "${project_name || ""}".`;
  ["pc-wa-footer", "pc-wa-rechazo", "portal-wa-ayuda", "pc-wa-floating"].forEach((id) => {
    const el = $(id);
    if (el) el.href = enlaceWhatsApp(asunto);
  });

  // PDF Recibo
  $("pc-btn-descargar-pdf")?.addEventListener("click", () => generarReciboPDF(pasoActual === 1 ? 'anticipo' : 'total'));

  mostrarVista("contenido");
}

function actualizarRoadmap(pasoActual) {
  const steps = document.querySelectorAll(".roadmap-step");
  const lines = document.querySelectorAll(".roadmap-line");
  if (!steps.length) return;

  steps.forEach((st) => {
    const sNum = Number(st.dataset.step);
    st.classList.remove("active", "completed");
    if (sNum < pasoActual) {
      st.classList.add("completed");
    } else if (sNum === pasoActual) {
      st.classList.add(pasoActual === 4 ? "completed" : "active");
    }
  });

  lines.forEach((ln, idx) => {
    ln.classList.toggle("completed", idx < pasoActual - 1);
  });
}

let confetiLanzado = false;
function verificarCelebracion(status, progreso) {
  if ((status === "finalizado" || progreso === 100) && !confetiLanzado) {
    confetiLanzado = true;
    if (typeof window.confetti === "function") {
      window.confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }
}

function esIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function esMovil() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

let html2pdfPromise = null;
function loadHtml2Pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (html2pdfPromise) return html2pdfPromise;

  html2pdfPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/html2pdf.bundle.min.js";
    script.onload = () => resolve(window.html2pdf);
    script.onerror = () => {
      html2pdfPromise = null;
      reject(new Error("No se pudo cargar la librería PDF."));
    };
    document.head.appendChild(script);
  });
  return html2pdfPromise;
}

async function generarReciboPDF(kindFilter = "total", botonTarget = null) {
  if (!datos) {
    avisar("Cargando...", "Esperá a que carguen los datos del proyecto.", "info");
    return;
  }

  const { client_name, project_name, total_usd, price_usd, pagos = [] } = datos;
  const fechaHoy = new Date().toLocaleDateString("es-AR");
  const refNum = `REC-${Math.floor(1000 + Math.random() * 9000)}`;

  const esAnticipo = kindFilter === "anticipo";
  const esSaldo = kindFilter === "saldo";

  const pagoAnticipo = pagos.find(p => p.kind === "anticipo");
  const totalUsdNum = Number(total_usd || price_usd || 0);
  const totalArsNum = Math.round(totalUsdNum * cotizacionDolarOficial);

  let tituloDoc = "RESUMEN DE CUENTA Y COMPROBANTE DE PAGO";
  let notaInformativa = "Documento generado digitalmente por Ariel.Dev · Panel de seguimiento privado.";
  let pagosAMostrar = pagos;

  if (esAnticipo) {
    tituloDoc = "COMPROBANTE DE PAGO ADELANTADO (50%)";
    notaInformativa = "Este comprobante certifica el cobro del 50% de anticipo inicial para dar comienzo a la producción. El saldo del 50% restante se abonará al finalizar el desarrollo previo a la publicación del sitio.";
    pagosAMostrar = pagoAnticipo ? [pagoAnticipo] : [];
  } else if (esSaldo) {
    tituloDoc = "RECIBO FINAL Y CANCELACIÓN DE CUENTA";
    notaInformativa = "Este comprobante certifica la cancelación total del proyecto web con la acreditación previa del 50% de anticipo inicial.";
  }

  const pagosFilasHTML = pagosAMostrar.map(p => {
    const pUsd = Number(p.amount_usd || 0);
    const pArs = Math.round(pUsd * cotizacionDolarOficial);
    const est = p.status === 'pagado' ? 'PAGADO' : p.status === 'en_revision' ? 'EN REVISIÓN' : 'PENDIENTE';
    const colorEst = p.status === 'pagado' ? '#16a34a' : '#ea580c';

    return `
      <tr>
        <td><strong>${ETIQUETA_PAGO[p.kind] || p.kind}</strong></td>
        <td><span style="color: ${colorEst}; font-weight: 700;">${est}</span></td>
        <td class="price-col">$${pUsd.toLocaleString("es-AR")}</td>
        <td class="price-col">$${pArs.toLocaleString("es-AR")}</td>
      </tr>
    `;
  }).join('');

  let resumenAcreditacionesHTML = "";
  if (!esAnticipo && pagoAnticipo) {
    const anticipoPagado = pagoAnticipo.status === "pagado";
    const montoAnticipoUsd = Number(pagoAnticipo.amount_usd || 0);

    resumenAcreditacionesHTML = `
      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; font-size: 0.9rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>Monto Total del Proyecto:</span>
          <strong>USD $${totalUsdNum.toLocaleString("es-AR")}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; color: ${anticipoPagado ? '#16a34a' : '#64748b'}; margin-bottom: 6px;">
          <span>Pago Previo Acreditado (50% Adelanto):</span>
          <strong>${anticipoPagado ? `- USD $${montoAnticipoUsd.toLocaleString("es-AR")}` : 'Pendiente'}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 0.95rem; font-weight: 700;">
          <span>Saldo Restante a Cancelar:</span>
          <span>USD $${(totalUsdNum - (anticipoPagado ? montoAnticipoUsd : 0)).toLocaleString("es-AR")}</span>
        </div>
      </div>
    `;
  }

  // Contenedor idéntico al de exportarPDF() en app.js para evitar lienzos en blanco
  const container = document.createElement("div");
  container.id = "recibo-print-container";
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.width = "1px";
  container.style.height = "1px";
  container.style.overflow = "hidden";
  container.style.background = "transparent";
  container.style.zIndex = "99999";
  container.style.pointerEvents = "none";

  const tempDiv = document.createElement("div");
  tempDiv.id = "recibo-print-temp";
  tempDiv.style.width = "750px";
  tempDiv.style.background = "#ffffff";
  tempDiv.style.boxSizing = "border-box";

  const htmlContent = `
    <style>
      .pdf-container {
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        color: #1e293b;
        background-color: #ffffff;
        padding: 0;
        line-height: 1.5;
        font-size: 13px;
        box-sizing: border-box;
      }
      .pdf-header-bar {
        background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
        padding: 24px 40px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .pdf-header-bar .logo {
        font-family: system-ui, sans-serif;
        font-weight: 800;
        font-size: 1.8rem;
        color: #ffffff;
        letter-spacing: -0.5px;
      }
      .pdf-header-bar .logo span { opacity: 0.85; }
      .pdf-header-bar .doc-meta { text-align: right; color: rgba(255,255,255,0.9); font-size: 0.85rem; }
      .pdf-header-bar .quote-ref {
        font-family: monospace;
        font-weight: 700;
        font-size: 0.9rem;
        color: #fff;
        background: rgba(255,255,255,0.2);
        padding: 3px 10px;
        border-radius: 4px;
        display: inline-block;
        margin-bottom: 4px;
      }
      .pdf-body { padding: 28px 40px 20px 40px; }
      .pdf-title {
        font-family: system-ui, sans-serif;
        font-size: 1.5rem;
        font-weight: 700;
        color: #0f172a;
        margin: 0 0 18px 0;
        padding-bottom: 10px;
        border-bottom: 2px solid #e2e8f0;
      }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 22px;
      }
      .info-card {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 14px 16px;
      }
      .info-card h4 {
        margin: 0 0 6px 0;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #6366f1;
        font-weight: 600;
      }
      .info-card p { margin: 3px 0; font-size: 0.9rem; color: #334155; }
      .pdf-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      .pdf-table th {
        background-color: #f1f5f9;
        color: #0f172a;
        font-weight: 600;
        text-align: left;
        padding: 10px 14px;
        font-size: 0.85rem;
        text-transform: uppercase;
        border-bottom: 2px solid #cbd5e1;
      }
      .pdf-table td {
        padding: 10px 14px;
        font-size: 0.9rem;
        border-bottom: 1px solid #e2e8f0;
        color: #334155;
      }
      .price-col { text-align: right; font-weight: 500; }
      .totals-section { display: flex; justify-content: flex-end; margin-bottom: 20px; }
      .totals-table { width: 340px; border-collapse: collapse; }
      .totals-table td { padding: 6px 12px; font-size: 0.9rem; }
      .totals-table tr.grand-total td {
        font-size: 1.15rem;
        font-weight: 700;
        color: #6366f1;
        border-top: 2px solid #e2e8f0;
        padding-top: 8px;
      }
      .totals-table tr.grand-total-ars td {
        font-size: 1.05rem;
        font-weight: 600;
        color: #06b6d4;
      }
      .note-box {
        background: #f8fafc;
        border-left: 3px solid #6366f1;
        padding: 12px 16px;
        border-radius: 4px;
        margin-bottom: 20px;
        font-size: 0.85rem;
        color: #475569;
      }
      .pdf-footer {
        border-top: 2px solid #e2e8f0;
        padding-top: 12px;
        margin-top: 15px;
        font-size: 0.8rem;
        color: #64748b;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      .pdf-footer p { margin: 2px 0; }
      .pdf-footer span { color: #334155; font-weight: 500; }
      .pdf-footer .brand { font-weight: 700; color: #6366f1; font-size: 0.9rem; }
    </style>
    <div class="pdf-container">
      <div class="pdf-header-bar">
        <div class="logo">Ariel<span>.Dev</span></div>
        <div class="doc-meta">
          <div class="quote-ref">${refNum}</div>
          <p>${fechaHoy}</p>
        </div>
      </div>

      <div class="pdf-body">
        <h1 class="pdf-title">${tituloDoc}</h1>

        <div class="info-grid">
          <div class="info-card">
            <h4>Cliente / Destinatario</h4>
            <p style="font-weight: 600; color: #0f172a;">${escapeHtml(client_name || 'Cliente')}</p>
          </div>
          <div class="info-card">
            <h4>Proyecto</h4>
            <p style="font-weight: 600; color: #0f172a;">${escapeHtml(project_name || 'Proyecto Web')}</p>
          </div>
          <div class="info-card">
            <h4>Desarrollador</h4>
            <p style="font-weight: 600; color: #0f172a;">Ariel Martinelli</p>
            <p>Córdoba, Argentina</p>
          </div>
          <div class="info-card">
            <h4>Cotización Dólar</h4>
            <p><strong>Dólar Oficial:</strong> $${cotizacionDolarOficial.toLocaleString("es-AR")} ARS</p>
          </div>
        </div>

        <table class="pdf-table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Estado</th>
              <th class="price-col">Monto USD</th>
              <th class="price-col">ARS Estimado</th>
            </tr>
          </thead>
          <tbody>
            ${pagosFilasHTML}
          </tbody>
        </table>

        ${resumenAcreditacionesHTML}

        <div class="totals-section">
          <table class="totals-table">
            <tr class="grand-total">
              <td>Total USD</td>
              <td style="text-align: right;">$${totalUsdNum.toLocaleString("es-AR")}</td>
            </tr>
            <tr class="grand-total-ars">
              <td>Total ARS</td>
              <td style="text-align: right;">$${totalArsNum.toLocaleString("es-AR")}</td>
            </tr>
          </table>
        </div>

        <div class="note-box">
          ${notaInformativa}
        </div>

        <div class="pdf-footer">
          <div>
            <p>Email: <span>ariel.martinelli.dev@gmail.com</span></p>
            <p>WhatsApp: <span>+54 351 612 1498</span></p>
            <p>Córdoba, Argentina</p>
          </div>
          <div style="text-align: right;">
            <div class="brand">Ariel.Dev</div>
            <p>arieldev.com.ar</p>
          </div>
        </div>
      </div>
    </div>
  `;

  tempDiv.innerHTML = htmlContent;
  container.appendChild(tempDiv);
  document.body.appendChild(container);

  const safeFilePart = (project_name || "Proyecto").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60);
  const pdfFilename = esAnticipo ? `Recibo_Adelanto_50_${safeFilePart}.pdf` : `Recibo_Final_${safeFilePart}.pdf`;

  const opt = {
    margin: 0,
    filename: pdfFilename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: esMovil() ? 1.5 : 2,
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      windowWidth: 750
    },
    pagebreak: { mode: 'avoid-all' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  Swal.fire({
    title: "Generando tu recibo...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    await loadHtml2Pdf();
    const blob = await html2pdf().set(opt).from(tempDiv).outputPdf("blob");
    const url = URL.createObjectURL(blob);

    if (esIOS()) {
      Swal.fire({
        icon: "success",
        title: "Recibo listo",
        html: `<p>Tocá el botón para abrirlo y luego usá <strong>Compartir → Guardar en Archivos</strong>.</p>
               <a href="${url}" target="_blank" rel="noopener noreferrer"
                  class="btn btn-primary" style="margin-top:12px; display:inline-block;">
                  Abrir recibo
               </a>`,
        showConfirmButton: false,
        showCloseButton: true,
      });
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = pdfFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      Swal.close();
    }

    setTimeout(() => {
      container.remove();
      URL.revokeObjectURL(url);
    }, 120000);
  } catch (err) {
    console.error("Error generando recibo PDF:", err);
    container.remove();
    avisar("Error", "No se pudo generar el recibo PDF.", "error");
  }
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

  const wrap = $("pc-barra-wrap");
  wrap.setAttribute("aria-valuenow", String(pct));
  wrap.setAttribute("aria-valuetext", `${pct} por ciento completado`);

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

function pintarPagos(pagos, pasoActual = 1) {
  const cont = $("pc-pagos");
  cont.innerHTML = "";

  if (pasoActual === 3) {
    const avisoPaso3 = document.createElement("div");
    avisoPaso3.className = "portal-nota-paso3";
    avisoPaso3.style.cssText = "background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); color: #ffffff; padding: 14px 16px; border-radius: 8px; margin-bottom: 16px; font-weight: 600; font-size: 0.95rem; box-shadow: 0 4px 12px rgba(99,102,241,0.25);";
    avisoPaso3.innerHTML = "🚀 ¡Tu proyecto está en el último paso! Aboná el 50% restante para subir tu página a producción.";
    cont.appendChild(avisoPaso3);
  }

  pagos.forEach((p) => {
    const pagado = p.status === "pagado";
    const enRevision = p.status === "en_revision";
    const esReintentado = pagosPermitidosReintentar.has(p.kind);
    const enProceso = p.status === "en_proceso" && !esReintentado;

    // Si está en_proceso pero pasaron 60s, se activa timeout automático
    if (enProceso && !timersEnProceso.has(p.kind)) {
      const timerId = setTimeout(() => {
        pagosPermitidosReintentar.add(p.kind);
        timersEnProceso.delete(p.kind);
        render();
      }, 60000); // 60 segundos
      timersEnProceso.set(p.kind, timerId);
    }

    const fila = document.createElement("div");
    fila.className = `portal-pago ${pagado ? "pagado" : ""} ${enRevision ? "en-revision" : ""}`;

    const estadoTexto = pagado
      ? "Pagado"
      : enRevision
        ? "Comprobante enviado · lo estoy revisando"
        : enProceso
          ? "Procesando en Mercado Pago…"
          : "Pendiente";

    const amountUsd = Number(p.amount_usd || 0);
    const amountArs = Math.round(amountUsd * cotizacionDolarOficial);
    const montoArsStr = amountArs.toLocaleString("es-AR");
    const cotizStr = cotizacionDolarOficial.toLocaleString("es-AR");

    fila.innerHTML = `
      <div class="portal-pago-info">
        <span class="portal-pago-tipo">${escapeHtml(ETIQUETA_PAGO[p.kind] || p.kind)}</span>
        <span class="portal-pago-estado">
          ${escapeHtml(estadoTexto)}
          ${enProceso ? `<button type="button" class="btn btn-outline btn-xs portal-pago-reintentar" data-reintentar="${p.kind}">Cambiar medio / Reintentar</button>` : ''}
        </span>
      </div>
      <div class="portal-pago-monto-container">
        <div class="portal-pago-monto">${escapeHtml(usd(p.amount_usd))}</div>
        <div class="portal-pago-submonto">
          ≈ $${montoArsStr} ARS
          <span class="portal-pago-cotiz">(Dólar oficial: $${cotizStr} ARS)</span>
        </div>
      </div>
    `;

    const esAnticipo = p.kind === "anticipo";
    const btnPdfItem = document.createElement("button");
    btnPdfItem.type = "button";
    btnPdfItem.className = "btn btn-outline btn-xs mt-2";
    btnPdfItem.style.display = "block";
    btnPdfItem.style.marginLeft = "auto";
    btnPdfItem.innerHTML = `📄 Recibo ${esAnticipo ? 'Adelanto 50%' : 'Final'}`;
    btnPdfItem.addEventListener("click", () => generarReciboPDF(p.kind, btnPdfItem));

    const montoContainer = fila.querySelector(".portal-pago-monto-container");
    if (montoContainer) montoContainer.appendChild(btnPdfItem);

    const btnReintentar = fila.querySelector("[data-reintentar]");
    if (btnReintentar) {
      btnReintentar.addEventListener("click", () => {
        pagosPermitidosReintentar.add(p.kind);
        if (timersEnProceso.has(p.kind)) {
          clearTimeout(timersEnProceso.get(p.kind));
          timersEnProceso.delete(p.kind);
        }
        render();
      });
    }

    if (!pagado && !enRevision && (!enProceso || esReintentado)) {
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

  const amountUsd = Number(pago.amount_usd || 0);
  const amountArs = Math.round(amountUsd * cotizacionDolarOficial);
  const montoArsStr = amountArs.toLocaleString("es-AR");
  const cotizStr = cotizacionDolarOficial.toLocaleString("es-AR");

  $("pc-transf-concepto").textContent = ETIQUETA_PAGO[pago.kind] || pago.kind;
  $("pc-transf-monto").innerHTML = `${usd(pago.amount_usd)} <span style="font-size:0.85rem; font-weight:normal; opacity:0.85; display:block; margin-top:2px;">(≈ $${montoArsStr} ARS — Dólar oficial: $${cotizStr} ARS)</span>`;
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

$("pc-form-resena")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const estrellas = Number($("pc-resena-estrellas").value) || 5;
  const empresa = sanitizeText($("pc-resena-empresa").value, 120);
  const comentario = sanitizeText($("pc-resena-comentario").value, 1000);

  if (!comentario) {
    avisar("Falta tu comentario", "Escribí unas palabras sobre tu experiencia.", "warning");
    return;
  }

  const btn = $("pc-btn-enviar-resena");
  btn.disabled = true;
  btn.textContent = "Enviando…";

  try {
    await guardarResena({
      client_name: datos?.client_name || "Cliente",
      project_name: datos?.project_name || "Proyecto Web",
      company_url: empresa,
      rating: estrellas,
      comment: comentario,
    });

    $("pc-form-resena").reset();
    avisar(
      "¡Muchas gracias por tu reseña!",
      "Tu comentario fue recibido y se mostrará destacado en mi página web.",
      "success"
    );
  } catch (err) {
    console.error("Error enviando reseña:", err);
    avisar("Error", "No se pudo registrar la reseña. Probá de nuevo.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "⭐ Publicar mi Reseña";
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
let pollingInterval = null;
function iniciarPollingLive() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    if (document.hidden || !TOKEN) return;
    try {
      const nuevosDatos = await portalObtener(TOKEN);
      if (nuevosDatos && JSON.stringify(nuevosDatos) !== JSON.stringify(datos)) {
        datos = nuevosDatos;
        render();
      }
    } catch (err) {
      // Silencioso
    }
  }, 3500); // Actualización en tiempo real cada 3.5s
}

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
    iniciarPollingLive();

    // Si el cliente vuelve desde Mercado Pago, el estado del pago lo confirma
    // el webhook y puede tardar unos segundos. Se refresca una vez sin que el
    // cliente tenga que recargar a mano.
    if (VUELVE_DE_PAGO) {
      avisar("Procesando tu pago", "Apenas Mercado Pago lo confirme se actualiza acá solo.", "info");
      setTimeout(recargar, 3000);
      setTimeout(recargar, 8000);
    }
  } catch (err) {
    console.error(err);
    mostrarVista("invalido");
  }
})();
