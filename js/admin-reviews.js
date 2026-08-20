/**
 * admin-reviews.js — Sección Reseñas del panel.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * El HTML de la sección ya estaba en admin.html (la pestaña, el título, los
 * botones de compartir el link y el contenedor `#admin-lista-resenas`), pero
 * el JavaScript que lo llena nunca se escribió. Por eso el panel quedaba en
 * «Cargando reseñas…» para siempre, pasara lo que pasara con los permisos.
 *
 * Desde acá se puede: ver todas las reseñas recibidas (publicadas y no),
 * publicarlas o esconderlas de la home, cargarles el link del sitio del
 * cliente y borrarlas.
 *
 * Requiere sesión: las policies RLS de `reviews` solo dejan editar y borrar
 * a un usuario autenticado. Esconder los botones no alcanzaría — el servidor
 * es el que decide.
 */

import {
  obtenerResenas,
  togglePublicarResena,
  eliminarResena,
  actualizarUrlResena,
} from "./reviews.js";
import { escapeHtml, safeUrl, sanitizeText } from "./security.js";
import { confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";

const $ = (id) => document.getElementById(id);

const WHATSAPP = "543517877753";
const LINK_RESENA = `${window.location.origin}/resena`;

let resenas = [];

/* ==========================================================================
   Arranque (una sola vez)
   ========================================================================== */
export function iniciarSeccionResenas() {
  $("btn-copiar-link-resena")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(LINK_RESENA);
      anunciar("Link copiado.");
      avisar("Link copiado", "Pasáselo al cliente para que deje su reseña.", "success");
    } catch {
      avisar("Copialo a mano", `El link es: ${LINK_RESENA}`, "info");
    }
  });

  $("btn-wa-link-resena")?.addEventListener("click", () => {
    const texto =
      "Hola! Si quedaste conforme con la página, me ayudás un montón dejándome " +
      `una reseña acá:\n\n${LINK_RESENA}\n\nTe lleva un minuto. ¡Gracias!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  });

  // Delegación: la lista se vuelve a pintar entera en cada refresco, así que
  // enganchar listeners tarjeta por tarjeta obligaría a re-engancharlos cada
  // vez. Un solo listener en el contenedor sobrevive a todos los repintados.
  $("admin-lista-resenas")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-accion]");
    if (!btn) return;
    const fn = ACCIONES[btn.dataset.accion];
    if (fn) fn(btn.dataset.id, btn);
  });
}

/* ==========================================================================
   Carga y pintado
   ========================================================================== */
export async function refrescarResenas() {
  const cont = $("admin-lista-resenas");
  if (!cont) return;

  const res = await obtenerResenas();
  resenas = res.resenas || [];

  // El error se MUESTRA, no se esconde. Que la lista quedara vacía sin decir
  // por qué es justamente lo que hizo que este problema pasara desapercibido.
  if (!res.ok) {
    cont.innerHTML = `
      <div class="admin-aviso-setup">
        <strong>No se pudieron leer las reseñas</strong>
        <p>${escapeHtml(res.error || "Error desconocido.")}</p>
      </div>`;
    pintarBadge();
    return;
  }

  if (resenas.length === 0) {
    cont.innerHTML = `
      <div class="admin-vacio">
        <div class="admin-vacio-icono" aria-hidden="true">⭐</div>
        <p class="admin-vacio-titulo">Todavía no recibiste ninguna reseña</p>
        <p class="admin-hint">
          Pasale el link a un cliente con el que hayas terminado. Los botones de
          arriba te lo copian o te lo abren en WhatsApp.
        </p>
      </div>`;
    pintarBadge();
    return;
  }

  cont.innerHTML = resenas.map(tarjeta).join("");
  pintarBadge();
}

/** Punto en la pestaña: cuántas reseñas están sin publicar. */
function pintarBadge() {
  const badge = $("badge-resenas");
  if (!badge) return;
  const ocultas = resenas.filter((r) => !r.is_published).length;
  badge.hidden = ocultas === 0;
  badge.setAttribute("aria-label", ocultas ? `${ocultas} reseñas sin publicar` : "");
}

function tarjeta(r) {
  const estrellas = "★".repeat(r.rating || 5) + "☆".repeat(5 - (r.rating || 5));
  const url = safeUrl(r.company_url, "");
  const fecha = r.created_at
    ? new Date(r.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  return `
    <article class="resena-admin ${r.is_published ? "" : "oculta"}">
      <div class="resena-admin-head">
        <div>
          <strong>${escapeHtml(r.client_name || "Sin nombre")}</strong>
          ${r.project_name ? `<span class="resena-admin-proyecto">${escapeHtml(r.project_name)}</span>` : ""}
        </div>
        <div class="resena-admin-meta">
          <span class="resena-admin-estrellas" aria-label="${r.rating || 5} de 5">${estrellas}</span>
          <span class="resena-admin-chip ${r.is_published ? "viva" : ""}">
            ${r.is_published ? "En la web" : "Oculta"}
          </span>
        </div>
      </div>

      <p class="resena-admin-texto">${escapeHtml(r.comment || "")}</p>

      <div class="resena-admin-pie">
        <span class="admin-hint">
          ${escapeHtml(fecha)}${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.company_url)}</a>` : " · sin link del sitio"}
        </span>
        <div class="resena-admin-acciones">
          <button type="button" class="btn btn-sm btn-outline"
                  data-accion="publicar" data-id="${escapeHtml(r.id)}">
            ${r.is_published ? "Ocultar de la web" : "Publicar"}
          </button>
          <button type="button" class="btn btn-sm btn-outline"
                  data-accion="url" data-id="${escapeHtml(r.id)}">
            ${url ? "Cambiar link" : "Agregar link"}
          </button>
          <button type="button" class="btn btn-sm admin-btn-peligro"
                  data-accion="borrar" data-id="${escapeHtml(r.id)}">
            Borrar
          </button>
        </div>
      </div>
    </article>`;
}

/* ==========================================================================
   Acciones
   ========================================================================== */
const ACCIONES = {
  publicar: async (id, btn) => {
    const r = resenas.find((x) => String(x.id) === String(id));
    if (!r) return;

    btn.disabled = true;
    const res = await togglePublicarResena(id, !r.is_published);
    btn.disabled = false;

    if (!res.ok) {
      avisar("No se pudo cambiar", res.error, "error");
      return;
    }
    await refrescarResenas();
    anunciar(r.is_published ? "Reseña oculta." : "Reseña publicada.");
  },

  url: async (id) => {
    const r = resenas.find((x) => String(x.id) === String(id));
    if (!r) return;

    const { value, isConfirmed } = await pedirTexto(
      "Link del sitio del cliente",
      "Se muestra debajo de la reseña, en la home.",
      r.company_url || ""
    );
    if (!isConfirmed) return;

    const limpio = sanitizeText(value || "", 253);
    if (limpio && !safeUrl(limpio.startsWith("http") ? limpio : `https://${limpio}`, "")) {
      avisar("Link inválido", "Escribí una dirección tipo elcliente.com", "warning");
      return;
    }

    const res = await actualizarUrlResena(id, limpio);
    if (!res.ok) {
      avisar("No se pudo guardar", res.error, "error");
      return;
    }
    await refrescarResenas();
  },

  borrar: async (id) => {
    const r = resenas.find((x) => String(x.id) === String(id));
    const ok = await confirmar({
      titulo: "¿Borrar esta reseña?",
      texto: `Se elimina para siempre la reseña de ${r?.client_name || "este cliente"}. ` +
             "Si solo querés sacarla de la web, usá «Ocultar» y la podés volver a publicar cuando quieras.",
      confirmar: "Sí, borrar",
      peligroso: true,
    });
    if (!ok) return;

    const res = await eliminarResena(id);
    if (!res.ok) {
      avisar("No se pudo borrar", res.error, "error");
      return;
    }
    await refrescarResenas();
    anunciar("Reseña borrada.");
  },
};

/** Cuadro de texto simple, sobre el mismo SweetAlert2 que usa el resto. */
async function pedirTexto(titulo, texto, valor) {
  const S = window.Swal;
  if (!S) {
    const v = window.prompt(`${titulo}\n${texto}`, valor);
    return { value: v ?? "", isConfirmed: v !== null };
  }
  return S.fire({
    title: titulo,
    text: texto,
    input: "text",
    inputValue: valor,
    inputPlaceholder: "elcliente.com",
    showCancelButton: true,
    confirmButtonText: "Guardar",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#6366f1",
    reverseButtons: true,
  });
}
