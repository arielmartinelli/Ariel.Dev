import { supabase, supabasePublico, isSupabaseConfigured } from "./supabase.js";

/**
 * projects.js — Acceso a datos de proyectos y categorias.
 *
 * BUGS CORREGIDOS EN ESTA VERSION
 * -------------------------------
 *
 * 1. LAS EDICIONES DE LOS PROYECTOS BASE SE PERDIAN (grave).
 *    La version anterior, cada vez que leia de la base, comparaba cada fila
 *    contra DEFAULT_PROJECTS por titulo y, si coincidian, PISABA la imagen y
 *    la descripcion con los valores por defecto — y ademas disparaba un
 *    UPDATE a Supabase para dejarlo escrito. Efecto practico: editabas
 *    "Aura Store" desde el panel, aparecia "actualizado con exito", y al
 *    recargar volvia el texto viejo. El dato correcto se sobrescribia solo.
 *    Los defaults ahora se usan UNICAMENTE como semilla inicial cuando la
 *    tabla esta vacia. Lo que esta en la base manda siempre.
 *
 * 2. LOS ERRORES DE ESCRITURA SE MOSTRABAN COMO EXITO (grave).
 *    Si Supabase rechazaba un INSERT (por RLS, por sesion vencida o por estar
 *    offline), el catch escribia en localStorage y devolvia normalmente. El
 *    panel entonces anunciaba "Proyecto agregado con exito" aunque en el
 *    servidor no existiera nada: el proyecto se veia en TU navegador y en
 *    ningun otro. Ahora toda escritura devuelve { ok, persistido, error } y
 *    el panel avisa cuando el guardado quedo solo en local.
 *
 * 3. LECTURAS REPETIDAS. getProjects() se llamaba varias veces seguidas
 *    (render + cada click de editar). Se agrega una cache corta en memoria.
 *
 * 4. PROYECTOS DE EJEMPLO EN LUGAR DE LOS REALES (grave).
 *    Había una lista de proyectos de ejemplo (Aura Store, Apex SaaS…) que se
 *    usaba como respaldo: si la lectura fallaba, el sitio la mostraba como si
 *    fueran trabajos tuyos. Y si la tabla venía vacía con una sesión
 *    iniciada, ¡los insertaba en la base real! Bastaba una sesión vencida en
 *    un navegador para que ese navegador mostrara trabajos inventados.
 *    Ahora:
 *      - las lecturas públicas van por supabasePublico (sin sesión);
 *      - no existen proyectos de ejemplo: si falla, se usa la última lista
 *        REAL guardada en ese navegador o, si no hay, se avisa;
 *      - nada se inserta solo en la base;
 *      - las claves de localStorage cambiaron (_v2) para que las copias
 *        viejas contaminadas con los de ejemplo no se lean más.
 */

// Semilla inicial. SOLO se usa si la tabla esta vacia o si no hay conexion.
const DEFAULT_CATEGORIES = [
  { id: "landing", label: "Landing Page" },
  { id: "ecommerce", label: "E-Commerce" },
  { id: "portfolio", label: "Portfolio" },
  { id: "custom", label: "Custom App" },
  { id: "invitacion", label: "Tarjeta de Invitación" },
];

const CLAVE_PROYECTOS = "portfolio_projects_v2";
const CLAVE_CATEGORIAS = "portfolio_categories_v2";

// Las copias de antes pueden tener los proyectos de ejemplo mezclados: se
// borran una vez y listo.
try {
  localStorage.removeItem("portfolio_projects");
  localStorage.removeItem("portfolio_categories");
} catch { /* almacenamiento bloqueado (modo privado): nada que limpiar */ }
const CLAVE_ORDEN_PROYECTOS = "portfolio_projects_order";

/* ==========================================================================
   Cache en memoria (evita pedir lo mismo varias veces) + Estrategia SWR (0ms)
   ========================================================================== */
const TTL_CACHE_MS = 60_000;
const cache = { projects: null, projectsAt: 0, categories: null, categoriesAt: 0 };

export function invalidarCache() {
  cache.projects = null;
  cache.categories = null;
}

function cacheVigente(sello) {
  return sello && Date.now() - sello < TTL_CACHE_MS;
}

/* ==========================================================================
   Helpers de almacenamiento local (respaldo de solo lectura)
   ========================================================================== */
function leerLocal(clave, porDefecto) {
  try {
    const guardado = localStorage.getItem(clave);
    if (!guardado) return porDefecto;
    const parseado = JSON.parse(guardado);
    return parseado !== null && typeof parseado === "object" ? parseado : porDefecto;
  } catch {
    // JSON corrupto: no tiene sentido conservarlo.
    try {
      localStorage.removeItem(clave);
    } catch { /* almacenamiento bloqueado (modo privado) */ }
    return porDefecto;
  }
}

function escribirLocal(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    // Cuota llena o almacenamiento deshabilitado: no es fatal.
    return false;
  }
}

/** DB (snake_case) -> Frontend (camelCase). Sin pisar nada. */
function mapProjectFromDB(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    category: p.category,
    image: p.image || "",
    tags: Array.isArray(p.tags) ? p.tags : [],
    demoUrl: p.demo_url || "#",
    position: typeof p.position === "number" ? p.position : 0,
    isFeatured: p.is_featured !== undefined ? Boolean(p.is_featured) : Boolean(p.isFeatured),
    createdAt: p.created_at || null,
  };
}

/** Frontend -> DB. Un solo lugar donde se define el shape que viaja. */
function mapProjectToDB(p, incluirPosicion = true) {
  const item = {
    title: p.title,
    description: p.description,
    category: p.category,
    image: p.image,
    tags: p.tags,
    demo_url: p.demoUrl,
    is_featured: Boolean(p.isFeatured),
  };
  if (incluirPosicion && typeof p.position === "number") {
    item.position = p.position;
  }
  return item;
}

/* ==========================================================================
   1. Lectura de proyectos (Carga instantánea en 0ms mediante SWR)
   ========================================================================== */
export async function getProjects({ forzar = false } = {}) {
  // 1. Memoria vigente
  if (!forzar && cache.projects && cacheVigente(cache.projectsAt)) {
    return cache.projects;
  }

  // 2. Respuesta instantánea desde LocalStorage (0ms)
  if (!forzar && !cache.projects) {
    const localGuardado = leerLocal(CLAVE_PROYECTOS, null);
    if (Array.isArray(localGuardado) && localGuardado.length > 0) {
      cache.projects = localGuardado;
      cache.projectsAt = Date.now();
      // Revalidación asíncrona en segundo plano sin bloquear la vista
      setTimeout(() => revalidarProyectosEnSegundoPlano(), 50);
      return cache.projects;
    }
  }

  // 3. Primera visita o forzado: consulta directa a Supabase
  return await fetchProyectosDeSupabase();
}

async function revalidarProyectosEnSegundoPlano() {
  try {
    const actualizados = await fetchProyectosDeSupabase();
    if (actualizados && Array.isArray(actualizados)) {
      window.dispatchEvent(new CustomEvent("projects-updated", { detail: actualizados }));
    }
  } catch (e) {
    console.debug("Revalidación asíncrona en segundo plano omitida:", e?.message || e);
  }
}

async function fetchProyectosDeSupabase() {
  try {
    let data, error;
    const resPos = await supabasePublico
      .from("projects")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (resPos.error) {
      const resFallback = await supabasePublico
        .from("projects")
        .select("*")
        .order("created_at", { ascending: true });
      data = resFallback.data;
      error = resFallback.error;
    } else {
      data = resPos.data;
      error = resPos.error;
    }

    if (error) throw error;

    // Tabla vacía: no hay trabajos publicados. Se devuelve vacío (la página
    // lo dice) en vez de inventar proyectos.
    if (!data || data.length === 0) {
      cache.projects = [];
      cache.projectsAt = Date.now();
      escribirLocal(CLAVE_PROYECTOS, []);
      return [];
    }

    const orderMap = leerLocal(CLAVE_ORDEN_PROYECTOS, {});
    const listos = data.map(mapProjectFromDB);
    listos.forEach((p) => {
      if (typeof orderMap[p.id] === "number") {
        p.position = orderMap[p.id];
      }
    });
    listos.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    cache.projects = listos;
    cache.projectsAt = Date.now();
    escribirLocal(CLAVE_PROYECTOS, listos);
    return listos;
  } catch (e) {
    console.error("Supabase no disponible, se usa el respaldo local:", e?.message || e);
    const orderMap = leerLocal(CLAVE_ORDEN_PROYECTOS, {});
    // Solo la última lista REAL que vio este navegador. Si no hay, vacío:
    // la página avisa que no pudo cargar, que es la verdad.
    const respaldo = leerLocal(CLAVE_PROYECTOS, []);
    respaldo.forEach((p) => {
      if (typeof orderMap[p.id] === "number") {
        p.position = orderMap[p.id];
      }
    });
    respaldo.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    cache.projects = respaldo;
    cache.projectsAt = Date.now();
    return respaldo;
  }
}

/* ==========================================================================
   2. Lectura de categorias (Carga instantánea en 0ms mediante SWR)
   ========================================================================== */
export async function getCategories({ forzar = false } = {}) {
  if (!forzar && cache.categories && cacheVigente(cache.categoriesAt)) {
    return cache.categories;
  }

  if (!forzar && !cache.categories) {
    const localGuardado = leerLocal(CLAVE_CATEGORIAS, null);
    if (Array.isArray(localGuardado) && localGuardado.length > 0) {
      cache.categories = localGuardado;
      cache.categoriesAt = Date.now();
      setTimeout(() => fetchCategoriasDeSupabase(), 50);
      return cache.categories;
    }
  }

  return await fetchCategoriasDeSupabase();
}

async function fetchCategoriasDeSupabase() {
  try {
    const { data, error } = await supabasePublico
      .from("categories")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Sin categorías en la base: se usan las básicas solo para dibujar los
    // filtros. Son etiquetas (Landing, E-commerce…), no datos inventados, y
    // ya no se insertan solas en la base.
    if (!data || data.length === 0) {
      cache.categories = DEFAULT_CATEGORIES;
      cache.categoriesAt = Date.now();
      return DEFAULT_CATEGORIES;
    }

    cache.categories = data;
    cache.categoriesAt = Date.now();
    escribirLocal(CLAVE_CATEGORIAS, data);
    return data;
  } catch (e) {
    console.error("Supabase no disponible (categorías), respaldo local:", e?.message || e);
    const respaldo = leerLocal(CLAVE_CATEGORIAS, DEFAULT_CATEGORIES);
    cache.categories = respaldo;
    cache.categoriesAt = Date.now();
    return respaldo;
  }
}

/* ==========================================================================
   3-5. Escrituras de proyectos
   --------------------------------------------------------------------------
   Todas devuelven { ok, persistido, error }:
     ok         -> la operacion se completo en algun lado
     persistido -> quedo guardada EN EL SERVIDOR (lo unico que cuenta)
     error      -> mensaje para mostrar al usuario
   El panel usa `persistido` para no cantar victoria cuando solo se guardo en
   el navegador local.
   ========================================================================== */

function motivoNoPersistido(e) {
  if (!isSupabaseConfigured) {
    return "Falta configurar Supabase (.env). El cambio quedó solo en este navegador.";
  }
  const msg = String(e?.message || e || "");
  if (/JWT|session|not authenticated|401/i.test(msg)) {
    return "Tu sesión venció. Volvé a iniciar sesión para guardar en el servidor.";
  }
  if (/row-level security|permission|403/i.test(msg)) {
    return "El servidor rechazó la escritura (permisos). El cambio quedó solo en este navegador.";
  }
  if (/fetch|network|Failed to fetch/i.test(msg)) {
    return "Sin conexión con el servidor. El cambio quedó solo en este navegador.";
  }
  return "No se pudo guardar en el servidor. El cambio quedó solo en este navegador.";
}

export async function addProject(project) {
  invalidarCache();
  try {
    let payload = mapProjectToDB(project, true);
    let { data, error } = await supabase
      .from("projects")
      .insert([payload])
      .select();

    if (error && /position/i.test(error.message)) {
      payload = mapProjectToDB(project, false);
      const resRetry = await supabase
        .from("projects")
        .insert([payload])
        .select();
      data = resRetry.data;
      error = resRetry.error;
    }

    if (error) throw error;
    return { ok: true, persistido: true, data };
  } catch (e) {
    console.error("Error al agregar proyecto:", e?.message || e);
    const proyectos = leerLocal(CLAVE_PROYECTOS, [...(cache.projects || [])]);
    proyectos.push({ ...project, id: `local-${Date.now()}` });
    escribirLocal(CLAVE_PROYECTOS, proyectos);
    return { ok: true, persistido: false, error: motivoNoPersistido(e) };
  }
}

export async function updateProject(project) {
  invalidarCache();
  try {
    let payload = mapProjectToDB(project, true);
    let { data, error } = await supabase
      .from("projects")
      .update(payload)
      .eq("id", project.id)
      .select();

    if (error && /position/i.test(error.message)) {
      payload = mapProjectToDB(project, false);
      const resRetry = await supabase
        .from("projects")
        .update(payload)
        .eq("id", project.id)
        .select();
      data = resRetry.data;
      error = resRetry.error;
    }

    if (error) throw error;

    if (!data || data.length === 0) {
      return {
        ok: false,
        persistido: false,
        error: "No se actualizó ninguna fila. El proyecto pudo haber sido eliminado.",
      };
    }
    return { ok: true, persistido: true, data };
  } catch (e) {
    console.error("Error al actualizar proyecto:", e?.message || e);
    let proyectos = leerLocal(CLAVE_PROYECTOS, [...(cache.projects || [])]);
    proyectos = proyectos.map((p) => (p.id === project.id ? project : p));
    escribirLocal(CLAVE_PROYECTOS, proyectos);
    return { ok: true, persistido: false, error: motivoNoPersistido(e) };
  }
}

export async function deleteProject(id) {
  invalidarCache();
  try {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
    return { ok: true, persistido: true };
  } catch (e) {
    console.error("Error al eliminar proyecto:", e?.message || e);
    const proyectos = leerLocal(CLAVE_PROYECTOS, [...(cache.projects || [])]).filter((p) => p.id !== id);
    escribirLocal(CLAVE_PROYECTOS, proyectos);
    return { ok: true, persistido: false, error: motivoNoPersistido(e) };
  }
}

export async function reorderProjects(orderedProjects) {
  invalidarCache();

  const orderMap = {};
  orderedProjects.forEach((p, index) => {
    p.position = index;
    orderMap[p.id] = index;
  });
  escribirLocal(CLAVE_ORDEN_PROYECTOS, orderMap);

  let algunError = false;
  try {
    for (const p of orderedProjects) {
      const { error } = await supabase
        .from("projects")
        .update({ position: p.position })
        .eq("id", p.id);
      if (error) algunError = true;
    }
  } catch (e) {
    algunError = true;
  }

  cache.projects = orderedProjects;
  cache.projectsAt = Date.now();
  escribirLocal(CLAVE_PROYECTOS, orderedProjects);

  return { ok: true, persistido: !algunError };
}

/* ==========================================================================
   6-7. Categorias
   ========================================================================== */
export function slugificar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function addCategory(label) {
  // BUG CORREGIDO: el slug se calculaba con .toLowerCase() ANTES de normalizar
  // los acentos, asi que "Invitación" y "Invitacion" generaban ids distintos y
  // se podian crear categorias duplicadas que el filtro luego no encontraba.
  const id = slugificar(label);
  if (!id) return { error: "El nombre de la categoría no es válido." };

  invalidarCache();
  try {
    const { data: existente } = await supabase.from("categories").select("id").eq("id", id);
    if (existente && existente.length > 0) {
      return { error: "La categoría ya existe." };
    }

    const { error } = await supabase.from("categories").insert([{ id, label: label.trim() }]);
    if (error) throw error;
    return { success: true, persistido: true };
  } catch (e) {
    console.error("Error al crear categoría:", e?.message || e);
    const categorias = leerLocal(CLAVE_CATEGORIAS, [...DEFAULT_CATEGORIES]);
    if (categorias.some((c) => c.id === id)) return { error: "La categoría ya existe." };
    categorias.push({ id, label: label.trim() });
    escribirLocal(CLAVE_CATEGORIAS, categorias);
    return { success: true, persistido: false, aviso: motivoNoPersistido(e) };
  }
}

export async function deleteCategory(id) {
  const BASE_NO_BORRABLES = ["landing", "ecommerce", "portfolio", "custom"];
  if (BASE_NO_BORRABLES.includes(id)) {
    return { error: "No se pueden eliminar las categorías base por defecto." };
  }

  // Antes se borraba la categoria sin mirar si tenia proyectos: esos proyectos
  // quedaban con una category huerfana y desaparecian de todos los filtros
  // sin explicacion. Ahora se avisa.
  try {
    const { data: enUso } = await supabase.from("projects").select("id").eq("category", id).limit(1);
    if (enUso && enUso.length > 0) {
      return { error: "Hay proyectos usando esta categoría. Reasignalos antes de borrarla." };
    }
  } catch {
    /* si falla la comprobacion seguimos: el borrado local no rompe nada */
  }

  invalidarCache();
  try {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw error;
    return { success: true, persistido: true };
  } catch (e) {
    console.error("Error al eliminar categoría:", e?.message || e);
    const categorias = leerLocal(CLAVE_CATEGORIAS, [...DEFAULT_CATEGORIES]).filter((c) => c.id !== id);
    escribirLocal(CLAVE_CATEGORIAS, categorias);
    return { success: true, persistido: false, aviso: motivoNoPersistido(e) };
  }
}
