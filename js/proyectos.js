/**
 * proyectos.js — La página /proyectos: todos los trabajos, en grilla.
 *
 * POR QUE ESTA PAGINA EXISTE
 * --------------------------
 * El landing muestra los primeros 5 con el efecto de tarjetas apiladas. Ese
 * efecto fija cada tarjeta y la apila con el scroll, así que la sección mide
 * ALTO × cantidad de proyectos: con 20 trabajos cargados, el visitante tiene
 * que scrollear varios metros para pasar de largo y llegar al cotizador, que
 * es donde se convierte. Acá entran todos sin ese costo.
 *
 * POR QUE NO REUSA app.js
 * -----------------------
 * app.js trae el cotizador, el generador de PDF, Lenis y los efectos de
 * scroll del landing: unos 40 kB que esta página no usa para nada. Además
 * busca por id un montón de nodos que acá no existen. Este archivo pide los
 * mismos datos a projects.js y dibuja una grilla, nada más.
 *
 * GRILLA Y NO EL MISMO STACK
 * --------------------------
 * Mudar el stack acá sería mudar el problema de lugar, no resolverlo. Una
 * grilla deja comparar trabajos de un vistazo, que es lo que hace alguien
 * que entró justamente a ver todo.
 */

import { getProjects, getCategories } from "./projects.js";
import { escapeHtml, safeUrl, safeImageSrc, LIMITS } from "./security.js";

const $ = (id) => document.getElementById(id);

let proyectos = [];
let categorias = [];
let filtroActivo = "all";

/* ==========================================================================
   Tema
   --------------------------------------------------------------------------
   Misma clave de localStorage que el landing ("theme"), para que elegir claro
   en una página y pasar a la otra no te devuelva al oscuro.
   ========================================================================== */
function iniciarTema() {
  const body = document.body;
  const guardado = document.documentElement.dataset.temaInicial || "dark";

  const aplicar = (tema) => {
    body.classList.toggle("light-theme", tema === "light");
    body.classList.toggle("dark-theme", tema !== "light");
  };
  aplicar(guardado);

  $("theme-toggle")?.addEventListener("click", () => {
    const nuevo = body.classList.contains("dark-theme") ? "light" : "dark";
    aplicar(nuevo);
    try { localStorage.setItem("theme", nuevo); } catch { /* modo privado */ }
  });
}

/* ==========================================================================
   Datos
   ========================================================================== */
const etiquetaCategoria = (id) =>
  categorias.find((c) => c.id === id)?.label || "Web";

/**
 * El dominio que se muestra en la barra del marco de navegador.
 * Sin "https://" ni "www.", que es lo que uno lee en una barra real.
 * Si la URL no es válida devuelve cadena vacía y la barra queda sin texto,
 * que es mejor que mostrar "#" o "undefined".
 */
function dominioDe(url) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return "";
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Los que se ven con el filtro puesto. */
const visibles = () =>
  filtroActivo === "all" ? proyectos : proyectos.filter((p) => p.category === filtroActivo);

/* ==========================================================================
   Filtros
   --------------------------------------------------------------------------
   Solo se dibujan las categorías QUE TIENEN proyectos. Un filtro que lleva a
   "no hay nada en esta categoría" es una puerta que no va a ningún lado, y
   acá es fácil de evitar porque la lista completa ya está en memoria.
   ========================================================================== */
function pintarFiltros() {
  const caja = $("filter-wrapper");
  if (!caja) return;

  const conProyectos = categorias.filter((c) =>
    proyectos.some((p) => p.category === c.id));

  // Con una sola categoría, el filtro no filtra nada: se esconde entero.
  if (conProyectos.length < 2) {
    caja.hidden = true;
    return;
  }
  caja.hidden = false;

  const cuenta = (id) =>
    id === "all" ? proyectos.length : proyectos.filter((p) => p.category === id).length;

  const boton = (id, texto) => `
    <button type="button" class="filter-btn ${filtroActivo === id ? "active" : ""}"
            data-filter="${escapeHtml(id)}" aria-pressed="${filtroActivo === id}">
      ${escapeHtml(texto)}
      <span class="filter-cuenta">${cuenta(id)}</span>
    </button>`;

  caja.innerHTML =
    boton("all", "Todos") +
    conProyectos.map((c) => boton(c.id, c.label)).join("");
}

/* ==========================================================================
   Grilla
   ========================================================================== */
/**
 * Qué posiciones ocupan el doble de ancho en la grilla.
 *
 * Los elegís vos arrastrando en el panel: son el 1.º y el 3.º de tu orden.
 * No hace falta ningún campo nuevo en la base ni una casilla más que tildar.
 *
 * POR QUE EL 1.º Y EL 3.º, Y NO LOS DOS PRIMEROS.
 * Con 3 columnas, una tarjeta doble ocupa 2 y deja 1 libre. Si las dos
 * dobles van seguidas, la segunda no entra en lo que queda de la primera
 * fila y se va a la siguiente: queda un hueco vacío arriba a la derecha.
 * Intercalando una normal entre las dos, cada fila cierra justa:
 *
 *     [ ███ doble ███ ][ una ]
 *     [ ███ doble ███ ][ una ]
 *     [ una ][ una ][ una ]
 *
 * Se podría resolver con grid-auto-flow: dense, pero eso reordena lo que se
 * ve sin reordenar el HTML: el tabulador salta en un orden distinto al
 * visual. Acomodar las posiciones no tiene ese costo.
 *
 * Solo aplica con el filtro en "Todos": dentro de una categoría, destacar
 * dos al azar no significa nada.
 */
const POSICIONES_DESTACADAS = [0, 2];
const DESTACADOS = POSICIONES_DESTACADAS.length;

function tarjeta(p, i, enTodos) {
  // Todo esto sale de la base y se trata como no confiable: se escapa en
  // contexto HTML y se validan los esquemas de las URL.
  const img = escapeHtml(safeImageSrc(p.image));
  const titulo = escapeHtml(p.title);
  const demo = safeUrl(p.demoUrl);
  const tieneDemo = demo && demo !== "#";

  const tags = (p.tags || [])
    .slice(0, LIMITS.TAGS_COUNT)
    .map((t) => `<span class="tag">${escapeHtml(String(t).trim().slice(0, LIMITS.TAG))}</span>`)
    .join("");

  // La tarjeta entera es el link cuando hay demo. Un <article> con un link
  // chiquito adentro obliga a apuntar; así el objetivo táctil es la tarjeta.
  const destacada = enTodos && POSICIONES_DESTACADAS.includes(i) ? " pcard-destacada" : "";

  const abre = tieneDemo
    ? `<a class="pcard${destacada}" href="${escapeHtml(demo)}" target="_blank" rel="noopener noreferrer">`
    : `<article class="pcard pcard-sin-demo${destacada}">`;
  const cierra = tieneDemo ? "</a>" : "</article>";

  return `
    ${abre}
      <div class="pcard-img-box">
        <!-- Marco de navegador. Ver .marco-nav en styles.css: va en CSS y no
             quemado en el .webp para que valga también para los proyectos que
             subas mañana desde el panel, sin reprocesar nada. -->
        <div class="marco-nav">
          <div class="marco-nav-barra" aria-hidden="true">
            <span class="marco-nav-punto"></span>
            <span class="marco-nav-punto"></span>
            <span class="marco-nav-punto"></span>
            <span class="marco-nav-url">${escapeHtml(dominioDe(p.demoUrl))}</span>
          </div>
          <div class="marco-nav-pantalla">
            ${img
              ? `<img src="${img}" alt="Captura del sitio ${titulo}" class="pcard-img"
                      width="1376" height="768" loading="lazy" decoding="async"
                      onerror="this.closest('.pcard-img-box').classList.add('sin-imagen'); this.remove();">`
              : ""}
          </div>
        </div>
        <span class="pcard-tag">${escapeHtml(etiquetaCategoria(p.category))}</span>
      </div>
      <div class="pcard-cuerpo">
        <h2 class="pcard-titulo">${titulo}</h2>
        <p class="pcard-desc">${escapeHtml(p.description || "")}</p>
        ${tags ? `<div class="pcard-tags">${tags}</div>` : ""}
        ${tieneDemo ? `
          <span class="pcard-link">
            Visitar demo
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
            </svg>
          </span>` : ""}
      </div>
    ${cierra}`;
}

function pintarGrilla() {
  const grilla = $("listado");
  const conteo = $("proyectos-conteo");
  if (!grilla) return;

  const lista = visibles();
  grilla.setAttribute("aria-busy", "false");

  if (conteo) {
    const n = proyectos.length;
    conteo.textContent = n === 1
      ? "1 trabajo publicado."
      : `${n} trabajos publicados. Tocá cualquiera para ver la demo en vivo.`;
  }

  if (lista.length === 0) {
    grilla.innerHTML = `<p class="proyectos-aviso">No hay proyectos en esta categoría.</p>`;
    return;
  }

  const enTodos = filtroActivo === "all";
  /* El mosaico necesita al menos una fila completa después de los
     destacados; con menos, se arma solo y queda peor que la grilla pareja. */
  grilla.classList.toggle("con-destacados", enTodos && lista.length >= 5);
  grilla.innerHTML = lista.map((p, i) => tarjeta(p, i, enTodos)).join("");
}

/* ==========================================================================
   Arranque
   ========================================================================== */
async function iniciar() {
  iniciarTema();

  const grilla = $("listado");

  try {
    // En paralelo: son dos consultas independientes y en serie el visitante
    // espera la suma de las dos.
    [proyectos, categorias] = await Promise.all([getProjects(), getCategories()]);
  } catch (err) {
    console.error("No se pudieron cargar los proyectos:", err?.message || err);
    proyectos = [];
    categorias = [];
  }

  if (!Array.isArray(proyectos) || proyectos.length === 0) {
    grilla.setAttribute("aria-busy", "false");
    grilla.innerHTML = `
      <p class="proyectos-aviso">
        No pudimos cargar los proyectos en este momento.
        <a href="/#portfolio">Volvé a la portada</a> o probá de nuevo en un rato.
      </p>`;
    const conteo = $("proyectos-conteo");
    if (conteo) conteo.textContent = "";
    $("filter-wrapper")?.setAttribute("hidden", "");
    return;
  }

    pintarFiltros();
    pintarGrilla();

    window.addEventListener("projects-updated", (ev) => {
      if (Array.isArray(ev.detail) && ev.detail.length > 0) {
        proyectos = ev.detail;
        pintarFiltros();
        pintarGrilla();
      }
    });

    // Scroll del header
    window.addEventListener("scroll", () => {
      const header = document.querySelector(".header");
      if (!header) return;
      if (window.scrollY > 20) {
        header.classList.add("scrolled");
      } else {
        header.classList.remove("scrolled");
      }
    }, { passive: true });

    // Delegación: los botones se vuelven a dibujar, así que escuchar en el
    // contenedor evita tener que recolgar los listeners cada vez.
    $("filter-wrapper")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".filter-btn");
      if (!btn || btn.dataset.filter === filtroActivo) return;
      filtroActivo = btn.dataset.filter;
      pintarFiltros();
      pintarGrilla();
    });
}

iniciar();
