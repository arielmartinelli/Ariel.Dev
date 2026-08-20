/**
 * reviews.js — Reseñas de clientes.
 *
 * LA BASE ES LA ÚNICA FUENTE DE VERDAD
 * ------------------------------------
 * La versión anterior tenía tres orígenes de datos compitiendo, y por eso el
 * sitio mostraba testimonios inventados mientras escondía los reales:
 *
 *   1. La tabla `reviews` de Supabase — la buena.
 *   2. localStorage, precargado con TRES reseñas falsas escritas a mano
 *      («Mariano López», «Camila Fernández», «Gonzalo Peralta»).
 *   3. Un respaldo que metía la reseña como JSON dentro de
 *      `clients.admin_notes` del primer cliente que encontrara.
 *
 * Cuando la lectura de `reviews` fallaba —y fallaba siempre, porque a la
 * tabla le faltaba el GRANT para el rol público— el código lo interpretaba
 * como «no hay reseñas» y pasaba al respaldo. Resultado: la home mostraba las
 * tres falsas, con nombre y apellido, y ninguna de las reales.
 *
 * Los respaldos 2 y 3 se eliminan por completo:
 *
 *   - Las reseñas falsas se van. Un testimonio inventado con nombre propio no
 *     es un dato de relleno: es algo que hay que poder sostener si alguien
 *     pregunta.
 *   - Escribir en `admin_notes` era peor que inútil. Elegía UN cliente
 *     cualquiera (`.limit(1)`), le ensuciaba sus notas privadas, y la lectura
 *     de vuelta exponía esas notas al sitio público. Notas privadas usadas
 *     como buzón público.
 *
 * localStorage queda solo como caché de lectura: si la red falla, se muestra
 * lo último que YA se había traído de la base. Nunca inventa nada.
 *
 * Ver supabase/migracion-06-resenas-permisos.sql.
 */

import { supabase } from "./supabase.js";

const CACHE_KEY = "arieldev_resenas_cache_v2";

/* ==========================================================================
   Caché de lectura
   ========================================================================== */
function leerCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function guardarCache(lista) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(lista || []));
  } catch {
    // Modo incógnito o storage lleno: no es motivo para romper nada.
  }
}

/* ==========================================================================
   Lectura
   ========================================================================== */

/**
 * Todas las reseñas. Con sesión de Ariel trae también las despublicadas;
 * sin sesión, las policies RLS devuelven solo las publicadas.
 *
 * Devuelve { ok, resenas, error, desdeCache } — el `ok` importa: sin él, un
 * fallo de permisos era indistinguible de «todavía no hay reseñas», que es
 * exactamente lo que escondió este problema durante semanas.
 */
export async function obtenerResenas() {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("No se pudieron leer las reseñas:", error.message);
    return {
      ok: false,
      resenas: leerCache(),
      desdeCache: true,
      error: mensajeReseña(error),
    };
  }

  const resenas = data || [];
  guardarCache(resenas);
  return { ok: true, resenas, desdeCache: false, error: null };
}

/** Compatibilidad con el panel: devuelve el array pelado. */
export async function obtenerResenasAdmin() {
  const { resenas } = await obtenerResenas();
  return resenas;
}

/** Las que van en la home. */
export async function obtenerResenasPublicas() {
  const { resenas } = await obtenerResenas();
  return resenas.filter((r) => r.is_published);
}

/* ==========================================================================
   Escritura
   ========================================================================== */

/**
 * Guarda una reseña nueva.
 *
 * OJO: antes esta función devolvía `{ ok: true }` SIEMPRE, incluso cuando no
 * había guardado nada en ningún lado. El cliente veía «¡gracias por tu
 * reseña!» y su texto se perdía. Ahora, si la base rechaza, se devuelve el
 * error y la pantalla lo dice.
 */
export async function guardarResena({ client_name, project_name, company_url, rating, comment }) {
  const fila = {
    client_name: String(client_name || "").trim(),
    project_name: String(project_name || "").trim() || null,
    company_url: String(company_url || "").trim() || null,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: String(comment || "").trim(),
    is_published: true,
  };

  if (!fila.client_name || fila.comment.length < 2) {
    return { ok: false, error: "Falta tu nombre o el comentario." };
  }

  const { data, error } = await supabase.from("reviews").insert([fila]).select();

  if (error) {
    console.error("No se pudo guardar la reseña:", error.message);
    return { ok: false, error: mensajeReseña(error) };
  }

  return { ok: true, resena: data?.[0] || fila };
}

/** Publicar o despublicar. Solo con sesión: lo exige la policy RLS. */
export async function togglePublicarResena(id, publicar) {
  const { error } = await supabase
    .from("reviews")
    .update({ is_published: Boolean(publicar) })
    .eq("id", id);

  if (error) {
    console.error("togglePublicarResena:", error.message);
    return { ok: false, error: mensajeReseña(error) };
  }
  return { ok: true };
}

export async function eliminarResena(id) {
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) {
    console.error("eliminarResena:", error.message);
    return { ok: false, error: mensajeReseña(error) };
  }
  return { ok: true };
}

export async function actualizarUrlResena(id, company_url) {
  const url = String(company_url || "").trim();
  const { error } = await supabase
    .from("reviews")
    .update({ company_url: url || null })
    .eq("id", id);

  if (error) {
    console.error("actualizarUrlResena:", error.message);
    return { ok: false, error: mensajeReseña(error) };
  }
  return { ok: true };
}

/* ==========================================================================
   Errores en castellano
   ========================================================================== */
function mensajeReseña(error) {
  const msg = String(error?.message || "");
  const code = String(error?.code || "");

  // El error que causó todo esto. Merece un mensaje que diga qué hacer.
  if (code === "42501" || /permission denied/i.test(msg)) {
    return "La base no está dando permiso para leer o escribir las reseñas. " +
           "Falta correr supabase/migracion-06-resenas-permisos.sql en Supabase.";
  }
  if (code === "PGRST205" || code === "42P01" || /schema cache|does not exist/i.test(msg)) {
    return "La tabla de reseñas todavía no existe en Supabase. " +
           "Corré supabase/migracion-06-resenas-permisos.sql.";
  }
  if (/violates row-level security/i.test(msg)) {
    return "La base rechazó la reseña. Revisá que el nombre y el comentario no estén vacíos.";
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return "Sin conexión con el servidor. Probá de nuevo en un momento.";
  }
  return "No se pudo completar la operación con las reseñas.";
}
