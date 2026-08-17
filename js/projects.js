import { supabase, isSupabaseConfigured } from "./supabase.js";

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
 */

// Semilla inicial. SOLO se usa si la tabla esta vacia o si no hay conexion.
const DEFAULT_PROJECTS = [
  {
    id: "proj-1",
    title: "Aura Store",
    description:
      "Plataforma e-commerce de indumentaria exclusiva. Integra catálogo interactivo con filtros dinámicos, carrito flotante de alta conversión, simulación de pagos y diseño responsivo ultra minimalista.",
    category: "ecommerce",
    image: "/images/aura-store.webp",
    tags: ["HTML5", "CSS Grid", "JS Vanilla", "E-commerce"],
    demoUrl: "https://aura-store-demo.example.com",
  },
  {
    id: "proj-2",
    title: "Apex SaaS Landing",
    description:
      "Landing page de alto impacto para software en la nube (SaaS). Diseñada con enfoque en captación de leads, animaciones fluidas al hacer scroll, tiempos de carga ultra rápidos (<1s) y optimización SEO integral.",
    category: "landing",
    image: "/images/apex-landing.webp",
    tags: ["Landing Page", "CSS Flexbox", "Intersection Observer"],
    demoUrl: "https://apex-saas-demo.example.com",
  },
  {
    id: "proj-3",
    title: "Lens & Light",
    description:
      "Portfolio cinematográfico y fotográfico de alta gama. Cuenta con galería interactiva en cuadrícula Masonry, visor inmersivo de fotos en pantalla completa, tema oscuro nativo y transiciones visuales de calidad premium.",
    category: "portfolio",
    image: "/images/lens-light.webp",
    tags: ["Portfolio", "Masonry CSS", "Animations", "Modal Gallery"],
    demoUrl: "https://lens-light-demo.example.com",
  },
  {
    id: "proj-4",
    title: "TaskFlow Dashboard",
    description:
      "Web App interactiva para la gestión inteligente de proyectos y tareas. Incluye tableros Kanban con tecnología Drag & Drop, seguimiento de progreso en tiempo real y métricas visuales de productividad.",
    category: "custom",
    image: "/images/taskflow.webp",
    tags: ["Custom App", "Drag & Drop", "Charts", "Local Storage"],
    demoUrl: "https://taskflow-demo.example.com",
  },
];

const DEFAULT_CATEGORIES = [
  { id: "landing", label: "Landing Page" },
  { id: "ecommerce", label: "E-Commerce" },
  { id: "portfolio", label: "Portfolio" },
  { id: "custom", label: "Custom App" },
  { id: "invitacion", label: "Tarjeta de Invitación" },
];

const CLAVE_PROYECTOS = "portfolio_projects";
const CLAVE_CATEGORIAS = "portfolio_categories";

/* ==========================================================================
   Cache en memoria (evita pedir lo mismo 4 veces en el mismo render)
   ========================================================================== */
const TTL_CACHE_MS = 10_000;
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
    return Array.isArray(parseado) ? parseado : porDefecto;
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
    createdAt: p.created_at || null,
  };
}

/** Frontend -> DB. Un solo lugar donde se define el shape que viaja. */
function mapProjectToDB(p) {
  return {
    title: p.title,
    description: p.description,
    category: p.category,
    image: p.image,
    tags: p.tags,
    demo_url: p.demoUrl,
  };
}

/* ==========================================================================
   1. Lectura de proyectos
   ========================================================================== */
export async function getProjects({ forzar = false } = {}) {
  if (!forzar && cache.projects && cacheVigente(cache.projectsAt)) {
    return cache.projects;
  }

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Tabla vacia: sembrar los ejemplos, pero solo si hay sesion de admin.
    if (!data || data.length === 0) {
      const { data: sesion } = await supabase.auth.getSession();
      if (sesion?.session) {
        await supabase.from("projects").insert(DEFAULT_PROJECTS.map(mapProjectToDB));
        const { data: nuevos } = await supabase
          .from("projects")
          .select("*")
          .order("created_at", { ascending: true });
        const listos = (nuevos || []).map(mapProjectFromDB);
        cache.projects = listos;
        cache.projectsAt = Date.now();
        return listos;
      }
      // Visitante sin datos en la base: se muestran los ejemplos para que la
      // seccion no quede vacia, pero NO se escribe nada.
      return DEFAULT_PROJECTS;
    }

    const listos = data.map(mapProjectFromDB);
    cache.projects = listos;
    cache.projectsAt = Date.now();
    escribirLocal(CLAVE_PROYECTOS, listos); // respaldo para modo offline
    return listos;
  } catch (e) {
    console.error("Supabase no disponible, se usa el respaldo local:", e?.message || e);
    const respaldo = leerLocal(CLAVE_PROYECTOS, DEFAULT_PROJECTS);
    cache.projects = respaldo;
    cache.projectsAt = Date.now();
    return respaldo;
  }
}

/* ==========================================================================
   2. Lectura de categorias
   ========================================================================== */
export async function getCategories({ forzar = false } = {}) {
  if (!forzar && cache.categories && cacheVigente(cache.categoriesAt)) {
    return cache.categories;
  }

  try {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      const { data: sesion } = await supabase.auth.getSession();
      if (sesion?.session) {
        await supabase.from("categories").insert(DEFAULT_CATEGORIES);
        const { data: nuevas } = await supabase
          .from("categories")
          .select("*")
          .order("created_at", { ascending: true });
        cache.categories = nuevas || DEFAULT_CATEGORIES;
        cache.categoriesAt = Date.now();
        return cache.categories;
      }
      return DEFAULT_CATEGORIES;
    }

    cache.categories = data;
    cache.categoriesAt = Date.now();
    escribirLocal(CLAVE_CATEGORIAS, data);
    return data;
  } catch (e) {
    console.error("Supabase no disponible (categorías), respaldo local:", e?.message || e);
    // El resultado del respaldo tambien se cachea. Sin esto, cada llamada
    // vuelve a intentar contra un servidor que no responde y se paga el
    // timeout completo otra vez: con dos llamadas seguidas, el visitante
    // espera el doble para ver una pagina que ya podria estar pintada.
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
    const { data, error } = await supabase
      .from("projects")
      .insert([mapProjectToDB(project)])
      .select();

    if (error) throw error;
    return { ok: true, persistido: true, data };
  } catch (e) {
    console.error("Error al agregar proyecto:", e?.message || e);
    const proyectos = leerLocal(CLAVE_PROYECTOS, [...DEFAULT_PROJECTS]);
    proyectos.push({ ...project, id: `local-${Date.now()}` });
    escribirLocal(CLAVE_PROYECTOS, proyectos);
    return { ok: true, persistido: false, error: motivoNoPersistido(e) };
  }
}

export async function updateProject(project) {
  invalidarCache();
  try {
    const { data, error } = await supabase
      .from("projects")
      .update(mapProjectToDB(project))
      .eq("id", project.id)
      .select();

    if (error) throw error;

    // Un UPDATE que no toca ninguna fila devuelve [] sin error: pasa cuando el
    // id ya no existe o cuando RLS filtra la fila. Antes se contaba como exito.
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
    let proyectos = leerLocal(CLAVE_PROYECTOS, [...DEFAULT_PROJECTS]);
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
    const proyectos = leerLocal(CLAVE_PROYECTOS, [...DEFAULT_PROJECTS]).filter((p) => p.id !== id);
    escribirLocal(CLAVE_PROYECTOS, proyectos);
    return { ok: true, persistido: false, error: motivoNoPersistido(e) };
  }
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
