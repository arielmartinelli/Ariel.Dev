import { sanitizeText } from "./security.js";
import { avisar } from "./ui-dialogs.js";
import { guardarResena } from "./reviews.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form-publico-resena");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nombre = sanitizeText(document.getElementById("resena-nombre").value, 100);
    const estrellas = Number(document.getElementById("resena-estrellas").value) || 5;
    const empresa = sanitizeText(document.getElementById("resena-empresa").value, 100);
    const comentario = sanitizeText(document.getElementById("resena-comentario").value, 1000);

    if (!nombre || !comentario) {
      avisar("Campos requeridos", "Ingresá tu nombre y tu comentario.", "warning");
      return;
    }

    const btn = document.getElementById("btn-enviar-publico");
    btn.disabled = true;
    btn.textContent = "Guardando reseña…";

    try {
      const res = await guardarResena({
        client_name: nombre,
        project_name: empresa || "Proyecto Web",
        company_url: "", // El link del sitio web lo asigna Ariel desde el panel de administración
        rating: estrellas,
        comment: comentario,
      });

      // Antes esto no se miraba: guardarResena devolvía ok:true siempre, así
      // que el cliente veía la pantalla de éxito con el confeti aunque su
      // reseña no se hubiera guardado en ningún lado.
      if (!res?.ok) {
        avisar("No se pudo enviar", res?.error || "Probá de nuevo en un momento.", "error");
        return;
      }

      document.getElementById("card-form-resena").classList.add("hidden");
      document.getElementById("card-exito-resena").classList.remove("hidden");

      if (typeof window.confetti === "function") {
        window.confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }
    } catch (err) {
      console.error("Error guardando reseña:", err);
      avisar("No se pudo enviar", "Ocurrió un error. Por favor probá nuevamente.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "⭐ Publicar mi Reseña";
    }
  });
});
