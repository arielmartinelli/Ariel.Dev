// Proyectos por defecto para poblar el portfolio inicialmente (usando SVGs integrados estéticos)
const DEFAULT_PROJECTS = [
  {
    id: "proj-1",
    title: "Aura Store",
    description: "Tienda online de indumentaria con carrito de compras interactivo, filtros avanzados y pasarela de pago simulada. Diseño ultra minimalista.",
    category: "ecommerce",
    image: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%238a2be2"/><stop offset="100%" stop-color="%234a00e0"/></linearGradient></defs><rect width="800" height="500" fill="url(%23g1)"/><circle cx="400" cy="250" r="150" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="20"/><path d="M350 200 L450 200 L480 380 L320 380 Z" fill="rgba(255,255,255,0.1)" stroke="white" stroke-width="6" stroke-linejoin="round"/><circle cx="370" cy="200" r="15" fill="none" stroke="white" stroke-width="4"/><circle cx="430" cy="200" r="15" fill="none" stroke="white" stroke-width="4"/><text x="400" y="440" fill="white" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">AURA STORE</text></svg>`,
    tags: ["HTML5", "CSS Grid", "JS Vanilla", "E-commerce"],
    demoUrl: "https://aura-store-demo.example.com"
  },
  {
    id: "proj-2",
    title: "Apex SaaS Landing",
    description: "Landing page de alta conversión para una plataforma de software en la nube, optimizada para SEO con animaciones al hacer scroll y diseño móvil impecable.",
    category: "landing",
    image: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2300c6ff"/><stop offset="100%" stop-color="%230072ff"/></linearGradient></defs><rect width="800" height="500" fill="url(%23g2)"/><path d="M250 380 L350 200 L450 320 L550 150 L650 250" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="550" cy="150" r="15" fill="white"/><text x="400" y="440" fill="white" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">APEX LANDING</text></svg>`,
    tags: ["Landing Page", "CSS Flexbox", "Intersection Observer"],
    demoUrl: "https://apex-saas-demo.example.com"
  },
  {
    id: "proj-3",
    title: "Lens & Light",
    description: "Portfolio fotográfico y cinematográfico interactivo con galería de imágenes en cuadrícula masonry, visor a pantalla completa y tema oscuro nativo.",
    category: "portfolio",
    image: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23ff007f"/><stop offset="100%" stop-color="%237f00ff"/></linearGradient></defs><rect width="800" height="500" fill="url(%23g3)"/><rect x="250" y="180" width="300" height="200" rx="20" fill="rgba(255,255,255,0.1)" stroke="white" stroke-width="6"/><circle cx="400" cy="280" r="50" fill="none" stroke="white" stroke-width="6"/><circle cx="500" cy="220" r="10" fill="white"/><text x="400" y="440" fill="white" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">LENS &amp; LIGHT</text></svg>`,
    tags: ["Portfolio", "Masonry CSS", "Animations", "Modal Gallery"],
    demoUrl: "https://lens-light-demo.example.com"
  },
  {
    id: "proj-4",
    title: "TaskFlow Dashboard",
    description: "Aplicación de gestión de tareas con sistema Drag and Drop, tableros Kanban interactivos y estadísticas de productividad visuales.",
    category: "custom",
    image: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g4" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2311998e"/><stop offset="100%" stop-color="%2338ef7d"/></linearGradient></defs><rect width="800" height="500" fill="url(%23g4)"/><rect x="200" y="150" width="110" height="200" rx="10" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="4"/><rect x="340" y="150" width="110" height="200" rx="10" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="4"/><rect x="480" y="150" width="110" height="200" rx="10" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="4"/><line x1="220" y1="180" x2="290" y2="180" stroke="white" stroke-width="4" stroke-linecap="round"/><line x1="360" y1="180" x2="430" y2="180" stroke="white" stroke-width="4" stroke-linecap="round"/><line x1="360" y1="210" x2="410" y2="210" stroke="white" stroke-width="4" stroke-linecap="round"/><text x="400" y="440" fill="white" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">TASKFLOW DASHBOARD</text></svg>`,
    tags: ["Custom App", "Drag & Drop", "Charts", "Local Storage"],
    demoUrl: "https://taskflow-demo.example.com"
  }
];

// Obtiene los proyectos guardados en localStorage o inicializa con los por defecto si no existen
export function getProjects() {
  const stored = localStorage.getItem("portfolio_projects");
  if (!stored) {
    localStorage.setItem("portfolio_projects", JSON.stringify(DEFAULT_PROJECTS));
    return DEFAULT_PROJECTS;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    console.error("Error parseando los proyectos guardados", e);
    return DEFAULT_PROJECTS;
  }
}

// Guarda una lista de proyectos en localStorage
export function saveProjects(projects) {
  localStorage.setItem("portfolio_projects", JSON.stringify(projects));
}

// Agrega un proyecto nuevo
export function addProject(project) {
  const projects = getProjects();
  project.id = "proj-" + Date.now();
  projects.push(project);
  saveProjects(projects);
  return projects;
}

// Elimina un proyecto por id
export function deleteProject(id) {
  let projects = getProjects();
  projects = projects.filter(p => p.id !== id);
  saveProjects(projects);
  return projects;
}

// Modifica un proyecto existente
export function updateProject(updatedProject) {
  let projects = getProjects();
  projects = projects.map(p => p.id === updatedProject.id ? updatedProject : p);
  saveProjects(projects);
  return projects;
}

// Categorías por defecto para poblar la página inicialmente
const DEFAULT_CATEGORIES = [
  { id: "landing", label: "Landing Page" },
  { id: "ecommerce", label: "E-Commerce" },
  { id: "portfolio", label: "Portfolio" },
  { id: "custom", label: "Custom App" }
];

// Obtiene las categorías del almacenamiento o inicializa con las por defecto
export function getCategories() {
  const stored = localStorage.getItem("portfolio_categories");
  if (!stored) {
    localStorage.setItem("portfolio_categories", JSON.stringify(DEFAULT_CATEGORIES));
    return DEFAULT_CATEGORIES;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    console.error("Error parseando las categorías guardadas", e);
    return DEFAULT_CATEGORIES;
  }
}

// Guarda la lista de categorías
export function saveCategories(categories) {
  localStorage.setItem("portfolio_categories", JSON.stringify(categories));
}

// Agrega una nueva categoría
export function addCategory(label) {
  const categories = getCategories();
  const id = label.toLowerCase()
                  .trim()
                  .replace(/[\s_]+/g, "-")
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\-]/g, "");
  
  if (!id) {
    return { error: "El nombre de la categoría no es válido." };
  }
  if (categories.some(c => c.id === id)) {
    return { error: "La categoría ya existe." };
  }
  const newCat = { id, label: label.trim() };
  categories.push(newCat);
  saveCategories(categories);
  return { success: true, categories };
}

// Elimina una categoría (excepto las por defecto)
export function deleteCategory(id) {
  const defaultIds = ["landing", "ecommerce", "portfolio", "custom"];
  if (defaultIds.includes(id)) {
    return { error: "No se pueden eliminar las categorías base por defecto." };
  }
  let categories = getCategories();
  categories = categories.filter(c => c.id !== id);
  saveCategories(categories);
  return { success: true, categories };
}
