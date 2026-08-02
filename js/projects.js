import { supabase } from "./supabase.js";

// Proyectos por defecto para poblar el portfolio inicialmente si la DB está vacía
const DEFAULT_PROJECTS = [
  {
    id: "proj-1",
    title: "Aura Store",
    description: "Plataforma e-commerce de indumentaria exclusiva. Integra catálogo interactivo con filtros dinámicos, carrito flotante de alta conversión, simulación de pagos y diseño responsivo ultra minimalista.",
    category: "ecommerce",
    image: "/images/aura-store.webp",
    tags: ["HTML5", "CSS Grid", "JS Vanilla", "E-commerce"],
    demoUrl: "https://aura-store-demo.example.com"
  },
  {
    id: "proj-2",
    title: "Apex SaaS Landing",
    description: "Landing page de alto impacto para software en la nube (SaaS). Diseñada con enfoque en captación de leads, animaciones fluidas al hacer scroll, tiempos de carga ultra rápidos (<1s) y optimización SEO integral.",
    category: "landing",
    image: "/images/apex-landing.webp",
    tags: ["Landing Page", "CSS Flexbox", "Intersection Observer"],
    demoUrl: "https://apex-saas-demo.example.com"
  },
  {
    id: "proj-3",
    title: "Lens & Light",
    description: "Portfolio cinematográfico y fotográfico de alta gama. Cuenta con galería interactiva en cuadrícula Masonry, visor inmersivo de fotos en pantalla completa, tema oscuro nativo y transiciones visuales de calidad premium.",
    category: "portfolio",
    image: "/images/lens-light.webp",
    tags: ["Portfolio", "Masonry CSS", "Animations", "Modal Gallery"],
    demoUrl: "https://lens-light-demo.example.com"
  },
  {
    id: "proj-4",
    title: "TaskFlow Dashboard",
    description: "Web App interactiva para la gestión inteligente de proyectos y tareas. Incluye tableros Kanban con tecnología Drag & Drop, seguimiento de progreso en tiempo real y métricas visuales de productividad.",
    category: "custom",
    image: "/images/taskflow.webp",
    tags: ["Custom App", "Drag & Drop", "Charts", "Local Storage"],
    demoUrl: "https://taskflow-demo.example.com"
  }
];

// Categorías por defecto
const DEFAULT_CATEGORIES = [
  { id: "landing", label: "Landing Page" },
  { id: "ecommerce", label: "E-Commerce" },
  { id: "portfolio", label: "Portfolio" },
  { id: "custom", label: "Custom App" },
  { id: "invitacion", label: "Tarjeta de Invitación" }
];

// 1. Obtener proyectos (Asíncrono con Supabase)
export async function getProjects() {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Si la base de datos está vacía, intentamos popularla si hay sesión iniciada (Ariel logueado)
    if (data.length === 0) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        const mapped = DEFAULT_PROJECTS.map(p => ({
          title: p.title,
          description: p.description,
          category: p.category,
          image: p.image,
          tags: p.tags,
          demo_url: p.demoUrl
        }));
        await supabase.from("projects").insert(mapped);
        const { data: newData } = await supabase.from("projects").select("*").order("created_at", { ascending: true });
        return (newData || []).map(mapProjectFromDB);
      }
      return DEFAULT_PROJECTS;
    }

    // Si Supabase devuelve datos, sincronizamos imágenes SVG o viejas con las nuevas portadas
    data.forEach(p => {
      const def = DEFAULT_PROJECTS.find(dp => dp.title.toLowerCase().trim() === (p.title || "").toLowerCase().trim() || dp.id === p.id);
      if (def && (p.image?.startsWith("data:image/svg") || p.description !== def.description)) {
        supabase.from("projects").update({
          image: def.image,
          description: def.description
        }).eq("id", p.id).then(() => {}).catch(() => {});
      }
    });

    return data.map(mapProjectFromDB);
  } catch (e) {
    console.error("Supabase: Error al traer proyectos, usando LocalStorage como respaldo:", e);
    const stored = localStorage.getItem("portfolio_projects");
    if (!stored) {
      localStorage.setItem("portfolio_projects", JSON.stringify(DEFAULT_PROJECTS));
      return DEFAULT_PROJECTS;
    }
    let parsed = JSON.parse(stored);
    parsed = parsed.map(p => {
      const def = DEFAULT_PROJECTS.find(dp => dp.title.toLowerCase().trim() === (p.title || "").toLowerCase().trim() || dp.id === p.id);
      if (def) {
        return {
          ...p,
          description: def.description,
          image: def.image
        };
      }
      return p;
    });
    localStorage.setItem("portfolio_projects", JSON.stringify(parsed));
    return parsed;
  }
}

// Mapper de formato DB (snake_case) a Frontend (camelCase)
function mapProjectFromDB(p) {
  const def = DEFAULT_PROJECTS.find(dp => 
    dp.title.toLowerCase().trim() === (p.title || "").toLowerCase().trim() || 
    dp.id === p.id
  );

  let finalImage = p.image;
  if (!finalImage || finalImage.startsWith("data:image/svg") || (def && finalImage !== def.image)) {
    finalImage = def ? def.image : (p.image || "");
  }

  let finalDescription = p.description;
  if (def && (!finalDescription || finalDescription !== def.description)) {
    finalDescription = def.description;
  }

  return {
    id: p.id,
    title: p.title,
    description: finalDescription,
    category: p.category,
    image: finalImage,
    tags: p.tags || [],
    demoUrl: p.demo_url || "#"
  };
}

// 2. Obtener categorías
export async function getCategories() {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Poblar las categorías por defecto en Supabase si está vacío y hay sesión de Ariel
    if (data.length === 0) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        const mapped = DEFAULT_CATEGORIES.map(c => ({ id: c.id, label: c.label }));
        await supabase.from("categories").insert(mapped);
        const { data: newData } = await supabase.from("categories").select("*").order("created_at", { ascending: true });
        return newData || DEFAULT_CATEGORIES;
      }
      return DEFAULT_CATEGORIES;
    }

    return data;
  } catch (e) {
    console.error("Supabase: Error al traer categorías, usando LocalStorage como respaldo:", e);
    const stored = localStorage.getItem("portfolio_categories");
    if (!stored) {
      localStorage.setItem("portfolio_categories", JSON.stringify(DEFAULT_CATEGORIES));
      return DEFAULT_CATEGORIES;
    }
    return JSON.parse(stored);
  }
}

// 3. Agregar proyecto nuevo
export async function addProject(project) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .insert([{
        title: project.title,
        description: project.description,
        category: project.category,
        image: project.image,
        tags: project.tags,
        demo_url: project.demoUrl
      }])
      .select();

    if (error) throw error;
    return data;
  } catch (e) {
    console.error("Supabase: Error al agregar proyecto, guardando en LocalStorage:", e);
    const stored = localStorage.getItem("portfolio_projects");
    const projects = stored ? JSON.parse(stored) : [...DEFAULT_PROJECTS];
    project.id = "proj-" + Date.now();
    projects.push(project);
    localStorage.setItem("portfolio_projects", JSON.stringify(projects));
    return projects;
  }
}

// 4. Modificar proyecto existente
export async function updateProject(project) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .update({
        title: project.title,
        description: project.description,
        category: project.category,
        image: project.image,
        tags: project.tags,
        demo_url: project.demoUrl
      })
      .eq("id", project.id)
      .select();

    if (error) throw error;
    return data;
  } catch (e) {
    console.error("Supabase: Error al actualizar proyecto, guardando en LocalStorage:", e);
    const stored = localStorage.getItem("portfolio_projects");
    let projects = stored ? JSON.parse(stored) : [...DEFAULT_PROJECTS];
    projects = projects.map(p => p.id === project.id ? project : p);
    localStorage.setItem("portfolio_projects", JSON.stringify(projects));
    return projects;
  }
}

// 5. Eliminar proyecto por id
export async function deleteProject(id) {
  try {
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id);

    if (error) throw error;
  } catch (e) {
    console.error("Supabase: Error al eliminar proyecto, actualizando LocalStorage:", e);
    const stored = localStorage.getItem("portfolio_projects");
    let projects = stored ? JSON.parse(stored) : [...DEFAULT_PROJECTS];
    projects = projects.filter(p => p.id !== id);
    localStorage.setItem("portfolio_projects", JSON.stringify(projects));
  }
}

// 6. Agregar una nueva categoría
export async function addCategory(label) {
  const id = label.toLowerCase()
                  .trim()
                  .replace(/[\s_]+/g, "-")
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\-]/g, "");

  if (!id) {
    return { error: "El nombre de la categoría no es válido." };
  }

  try {
    // Comprobar si ya existe
    const { data: existing } = await supabase
      .from("categories")
      .select("id")
      .eq("id", id);

    if (existing && existing.length > 0) {
      return { error: "La categoría ya existe." };
    }

    const { error } = await supabase
      .from("categories")
      .insert([{ id, label: label.trim() }]);

    if (error) throw error;
    return { success: true };
  } catch (e) {
    console.error("Supabase: Error al crear categoría, guardando en LocalStorage:", e);
    const stored = localStorage.getItem("portfolio_categories");
    const categories = stored ? JSON.parse(stored) : [...DEFAULT_CATEGORIES];
    if (categories.some(c => c.id === id)) {
      return { error: "La categoría ya existe." };
    }
    categories.push({ id, label: label.trim() });
    localStorage.setItem("portfolio_categories", JSON.stringify(categories));
    return { success: true };
  }
}

// 7. Eliminar una categoría
export async function deleteCategory(id) {
  const defaultIds = ["landing", "ecommerce", "portfolio", "custom"];
  if (defaultIds.includes(id)) {
    return { error: "No se pueden eliminar las categorías base por defecto." };
  }

  try {
    const { error } = await supabase
      .from("categories")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return { success: true };
  } catch (e) {
    console.error("Supabase: Error al eliminar categoría, actualizando LocalStorage:", e);
    const stored = localStorage.getItem("portfolio_categories");
    let categories = stored ? JSON.parse(stored) : [...DEFAULT_CATEGORIES];
    categories = categories.filter(c => c.id !== id);
    localStorage.setItem("portfolio_categories", JSON.stringify(categories));
    return { success: true };
  }
}
