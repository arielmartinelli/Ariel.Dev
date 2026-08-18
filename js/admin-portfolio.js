/**
 * admin-portfolio.js — Sección Portfolio del panel.
 *
 * Es el ABM de los proyectos públicos y sus categorías. Antes vivía dentro de
 * js/app.js, mezclado con el sitio público: todo visitante que entraba al
 * portfolio descargaba también este código, aunque nunca fuera a administrarlo.
 * Ahora está en el bundle de /admin y el sitio público no lo ve.
 *
 * La capa de datos (js/projects.js) no cambió: sigue siendo la misma para el
 * panel y para la web pública, con una sola definición de cómo se leen y
 * escriben los proyectos.
 */

import {
  getProjects, addProject, updateProject, deleteProject,
  getCategories, addCategory, deleteCategory,
} from "./projects.js";
import { escapeHtml, safeUrl, sanitizeText, LIMITS, ALLOWED_IMAGE_TYPES } from "./security.js";
import { confirmar, avisar } from "./ui-dialogs.js";
import { anunciar } from "./a11y.js";

const $ = (id) => document.getElementById(id);

/* Categorías base: no se pueden borrar porque el sitio y los filtros asumen
   que existen. La restricción también está en projects.js y en la base. */
const CATEGORIAS_BASE = ["landing", "ecommerce", "portfolio", "custom"];

let imagenBase64 = "";
let editando = null;      // id del proyecto en edición, o null
let categorias = [];

/* ==========================================================================
   Arranque (una sola vez)
   ========================================================================== */
export function iniciarSeccionPortfolio() {
  conectarFormulario();
  conectarSubidaImagen();
  conectarCategorias();
  inicializarTechPresets();
}

export async function refrescarPortfolio() {
  try {
    categorias = await getCategories({ forzar: true });
    pintarSelectCategorias();
    await pintarProyectos();
    pintarCategorias();
  } catch (err) {
    console.error("refrescarPortfolio:", err);
    $("lista-proyectos").innerHTML =
      `<p class="admin-hint admin-error">No se pudieron cargar los proyectos.</p>`;
  }
}

/* ==========================================================================
   Formulario de proyecto
   ========================================================================== */
function conectarFormulario() {
  $("form-proyecto").addEventListener("submit", guardarProyecto);
  $("proj-cancelar").addEventListener("click", salirDeEdicion);
}

async function guardarProyecto(e) {
  e.preventDefault();

  const boton = $("proj-submit");
  // Sin esto, dos clics rápidos creaban el proyecto dos veces.
  if (boton.disabled) return;

  const title = sanitizeText($("proj-title").value, LIMITS.TITLE);
  const description = sanitizeText($("proj-desc").value, LIMITS.DESCRIPTION);
  const category = sanitizeText($("proj-category").value, LIMITS.CATEGORY);
  const rawDemo = $("proj-demo").value.trim();

  const tags = $("proj-tags").value
    .split(",")
    .map((t) => sanitizeText(t, LIMITS.TAG))
    .filter(Boolean)
    .slice(0, LIMITS.TAGS_COUNT);

  if (!title || !description) {
    avisar("Faltan datos", "El título y la descripción son obligatorios.", "warning");
    return;
  }

  // Solo http/https: bloquea javascript: y similares en el enlace de demo.
  const demoUrl = rawDemo ? safeUrl(rawDemo, "") : "#";
  if (rawDemo && !demoUrl) {
    avisar("Enlace inválido", "El link de la demo debe empezar con http:// o https://", "error");
    return;
  }

  let image = imagenBase64;
  if (!image && editando) {
    // Editando sin subir imagen nueva: se conserva la actual.
    const existentes = await getProjects();
    image = existentes.find((p) => p.id === editando)?.image || "";
  }
  if (!image) image = portadaGenerada(title);

  const datos = { title, description, category, image, tags, demoUrl };

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Guardando…";

  try {
    const res = editando
      ? await updateProject({ ...datos, id: editando })
      : await addProject(datos);

    if (!res.ok) {
      avisar("No se pudo guardar", res.error || "Intentá de nuevo.", "error");
      return;
    }

    const eraEdicion = Boolean(editando);
    salirDeEdicion();
    await refrescarPortfolio();

    // El mensaje refleja lo que pasó de verdad: si Supabase rechazó la
    // escritura, el proyecto quedó SOLO en este navegador y hay que decirlo.
    if (res.persistido) {
      avisar(
        eraEdicion ? "Actualizado" : "Publicado",
        eraEdicion ? "Los cambios ya están en el servidor." : "El proyecto ya se ve en tu web.",
        "success"
      );
    } else {
      avisar("Guardado solo en este equipo", res.error || "", "warning");
    }
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

/**
 * Portada de respaldo cuando no se sube imagen: un degradado con el título.
 * El título se escapa y el SVG entero se codifica — sin eso, un título con
 * `</text><script>` rompe el marcado y queda guardado así en la base.
 */
function portadaGenerada(title) {
  const hue = Math.floor(Math.random() * 360);
  const label = escapeHtml(title.toUpperCase().slice(0, 40));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">` +
    `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="hsl(${hue}, 80%, 45%)"/>` +
    `<stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 85%, 25%)"/></linearGradient></defs>` +
    `<rect width="800" height="500" fill="url(%23g)"/>` +
    `<text x="400" y="260" fill="white" font-family="sans-serif" font-size="36" font-weight="bold" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PRESET_TECNOLOGIAS = [
  "HTML5", "CSS3", "JavaScript", "TypeScript", "Node.js", "Python",
  "React", "Next.js", "Vite", "TailwindCSS", "Bootstrap", "Vue", "Express",
  "Supabase", "Firebase", "PostgreSQL", "MongoDB", "Vercel",
  "Mercado Pago", "WhatsApp API", "E-Commerce", "Carrito", "Dashboard", "Responsive", "Modo Oscuro", "SEO", "Auth System", "Drag & Drop", "Charts"
];

function inicializarTechPresets() {
  const cont = $("tech-presets-container");
  if (!cont) return;

  cont.innerHTML = PRESET_TECNOLOGIAS.map((tech) => `
    <button type="button" class="tech-badge-btn" data-tech="${escapeHtml(tech)}">
      + ${escapeHtml(tech)}
    </button>
  `).join("");

  cont.querySelectorAll(".tech-badge-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleTechTag(btn.dataset.tech);
    });
  });

  const inputTags = $("proj-tags");
  if (inputTags) {
    inputTags.addEventListener("input", actualizarEstadoBadgeTech);
  }
}

function toggleTechTag(tech) {
  const input = $("proj-tags");
  if (!input) return;

  let tags = input.value.split(",").map((t) => t.trim()).filter(Boolean);
  const index = tags.findIndex((t) => t.toLowerCase() === tech.toLowerCase());

  if (index >= 0) {
    tags.splice(index, 1);
  } else {
    tags.push(tech);
  }

  input.value = tags.join(", ");
  actualizarEstadoBadgeTech();
}

function actualizarEstadoBadgeTech() {
  const input = $("proj-tags");
  const cont = $("tech-presets-container");
  if (!input || !cont) return;

  const actualTags = input.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  cont.querySelectorAll(".tech-badge-btn").forEach((btn) => {
    const techLower = btn.dataset.tech.toLowerCase();
    const activo = actualTags.includes(techLower);
    btn.classList.toggle("activo", activo);
    btn.textContent = activo ? `✓ ${btn.dataset.tech}` : `+ ${btn.dataset.tech}`;
  });
}

function entrarEnEdicion(proyecto) {
  editando = proyecto.id;

  $("proj-title").value = proyecto.title;
  $("proj-category").value = proyecto.category;
  $("proj-demo").value = proyecto.demoUrl === "#" ? "" : proyecto.demoUrl;
  $("proj-tags").value = (proyecto.tags || []).join(", ");
  $("proj-desc").value = proyecto.description;
  actualizarEstadoBadgeTech();

  imagenBase64 = proyecto.image;
  $("image-preview").src = proyecto.image;
  $("image-preview").classList.remove("hidden");
  $("upload-dropzone").classList.add("hidden");

  $("proj-form-titulo").textContent = "Editar proyecto";
  $("proj-submit").textContent = "Guardar cambios";
  $("proj-cancelar").classList.remove("hidden");

  $("proj-title").focus();
  $("proj-title").scrollIntoView({ behavior: "smooth", block: "center" });
  anunciar(`Editando ${proyecto.title}`);
}

function salirDeEdicion() {
  editando = null;
  imagenBase64 = "";

  $("form-proyecto").reset();
  actualizarEstadoBadgeTech();
  $("image-preview").classList.add("hidden");
  $("image-preview").src = "";
  $("upload-dropzone").classList.remove("hidden");

  $("proj-form-titulo").textContent = "Cargar nuevo proyecto";
  $("proj-submit").textContent = "Agregar proyecto";
  $("proj-cancelar").classList.add("hidden");
}

/* ==========================================================================
   Subida de imagen
   ========================================================================== */
function conectarSubidaImagen() {
  const zona = $("upload-dropzone");
  const input = $("proj-image");

  zona.addEventListener("click", () => input.click());
  input.addEventListener("change", (e) => procesarArchivo(e.target.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add("dragover"); }));

  ["dragleave", "drop"].forEach((ev) =>
    zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove("dragover"); }));

  zona.addEventListener("drop", (e) => procesarArchivo(e.dataTransfer.files[0]));

  $("image-preview").addEventListener("click", () => input.click());
}

function procesarArchivo(file) {
  if (!file) return;

  // Se valida el tipo declarado Y, más abajo, el contenido real. Confiar solo
  // en la extensión permite subir cualquier cosa renombrada a .png.
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    avisar("Formato no permitido", "Usá PNG, JPG, WEBP, GIF o AVIF. Los SVG están bloqueados por seguridad.", "error");
    return;
  }

  if (file.size > LIMITS.IMAGE_BYTES) {
    const mb = (LIMITS.IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    avisar("Imagen muy pesada", `El máximo es ${mb} MB. Comprimila antes de subirla.`, "error");
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => avisar("Error", "No se pudo leer el archivo.", "error");

  reader.onload = (e) => {
    const resultado = String(e.target.result || "");
    if (!/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(resultado)) {
      avisar("Archivo inválido", "El contenido no corresponde a una imagen soportada.", "error");
      return;
    }
    imagenBase64 = resultado;
    $("image-preview").src = resultado;
    $("image-preview").classList.remove("hidden");
    $("upload-dropzone").classList.add("hidden");
  };

  reader.readAsDataURL(file);
}

/* ==========================================================================
   Lista de proyectos
   ========================================================================== */
async function pintarProyectos() {
  const cont = $("lista-proyectos");
  const proyectos = await getProjects({ forzar: true });

  cont.innerHTML = "";

  if (proyectos.length === 0) {
    cont.innerHTML = `<p class="admin-hint">Todavía no hay proyectos publicados.</p>`;
    return;
  }

  proyectos.forEach((p) => {
    const item = document.createElement("div");
    item.className = "admin-proyecto-item";

    const meta = document.createElement("div");
    meta.className = "admin-proyecto-meta";
    meta.innerHTML = `
      <div class="admin-proyecto-nombre">${escapeHtml(p.title)}</div>
      <div class="admin-proyecto-cat">${escapeHtml(etiquetaCategoria(p.category))}</div>`;

    const editar = document.createElement("button");
    editar.type = "button";
    editar.className = "admin-icon-btn editar";
    editar.setAttribute("aria-label", `Editar ${p.title}`);
    editar.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    editar.addEventListener("click", () => entrarEnEdicion(p));

    const borrar = document.createElement("button");
    borrar.type = "button";
    borrar.className = "admin-icon-btn borrar";
    borrar.setAttribute("aria-label", `Eliminar ${p.title}`);
    borrar.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    borrar.addEventListener("click", () => borrarProyecto(p));

    const acciones = document.createElement("div");
    acciones.append(editar, borrar);

    item.append(meta, acciones);
    cont.appendChild(item);
  });
}

async function borrarProyecto(p) {
  const ok = await confirmar({
    titulo: "¿Eliminar proyecto?",
    texto: `Se va a borrar "${p.title}" de tu web. Esta acción no se puede deshacer.`,
    confirmar: "Sí, eliminar",
    peligroso: true,
  });
  if (!ok) return;

  const res = await deleteProject(p.id);
  if (editando === p.id) salirDeEdicion();
  await refrescarPortfolio();

  if (res.persistido) {
    avisar("Eliminado", "El proyecto ya no se ve en tu web.", "success");
  } else {
    avisar("Eliminado solo en este equipo", res.error || "", "warning");
  }
}

function etiquetaCategoria(id) {
  return categorias.find((c) => c.id === id)?.label || id || "Sin categoría";
}

/* ==========================================================================
   Categorías
   ========================================================================== */
function conectarCategorias() {
  const input = $("nueva-categoria");

  const crear = async () => {
    const label = input.value.trim();
    if (!label) {
      avisar("Falta el nombre", "Escribí cómo se va a llamar la categoría.", "warning");
      return;
    }

    const res = await addCategory(label);
    if (res.error) {
      avisar("No se pudo crear", res.error, "error");
      return;
    }

    input.value = "";
    await refrescarPortfolio();
    avisar("Categoría creada", res.aviso || `"${label}" ya está disponible.`,
      res.persistido ? "success" : "warning");
  };

  $("btn-agregar-categoria").addEventListener("click", crear);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); crear(); }
  });
}

function pintarSelectCategorias() {
  const select = $("proj-category");
  const seleccionada = select.value;

  select.innerHTML = "";
  categorias.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    select.appendChild(opt);
  });

  // Conservar la selección si esa categoría todavía existe.
  if (seleccionada && categorias.some((c) => c.id === seleccionada)) {
    select.value = seleccionada;
  }
}

function pintarCategorias() {
  const cont = $("lista-categorias");
  cont.innerHTML = "";

  if (categorias.length === 0) {
    cont.innerHTML = `<p class="admin-hint">No hay categorías cargadas.</p>`;
    return;
  }

  categorias.forEach((c) => {
    const esBase = CATEGORIAS_BASE.includes(c.id);

    const item = document.createElement("div");
    item.className = "admin-categoria-item";

    const nombre = document.createElement("div");
    nombre.className = "admin-categoria-nombre";
    nombre.textContent = c.label;

    const borrar = document.createElement("button");
    borrar.type = "button";
    borrar.className = "admin-icon-btn borrar";
    borrar.disabled = esBase;
    borrar.title = esBase ? "Las categorías base no se pueden borrar" : `Eliminar ${c.label}`;
    borrar.setAttribute("aria-label", borrar.title);
    borrar.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>`;

    if (!esBase) {
      borrar.addEventListener("click", async () => {
        const ok = await confirmar({
          titulo: "¿Eliminar categoría?",
          texto: `Se va a borrar "${c.label}".`,
          confirmar: "Sí, eliminar",
          peligroso: true,
        });
        if (!ok) return;

        const res = await deleteCategory(c.id);
        if (res.error) {
          avisar("No se pudo eliminar", res.error, "error");
          return;
        }
        await refrescarPortfolio();
        avisar("Eliminada", res.aviso || "La categoría se borró.",
          res.persistido ? "success" : "warning");
      });
    }

    item.append(nombre, borrar);
    cont.appendChild(item);
  });
}
