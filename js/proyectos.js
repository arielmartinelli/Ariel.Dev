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

  caja.setAttribute("aria-busy", "false");
  caja.innerHTML =
    boton("all", "Todos") +
    conProyectos.map((c) => boton(c.id, c.label)).join("");
}

/* ==========================================================================
   Grilla
   ========================================================================== */
/**
 * Los destacados ocupan el doble de ancho y los marcás con la casilla del
 * panel (`is_featured`). Antes eran las posiciones 1.ª y 3.ª fijas; quedó
 * mejor así, porque el orden y el destaque pasan a ser dos decisiones
 * separadas.
 *
 * Lo que sigue valiendo del diseño viejo: con 3 columnas, una tarjeta doble
 * ocupa 2 y deja 1 libre, así que DOS destacadas seguidas dejan un hueco
 * vacío arriba a la derecha. Si marcás varias, conviene que no queden
 * pegadas en el orden.
 */

/**
 * Tarjeta fantasma mientras llegan los datos.
 *
 * Usa EXACTAMENTE las mismas clases que tarjeta() — .pcard, .pcard-img-box,
 * .marco-nav, .pcard-cuerpo — y solo cambia el contenido por huesos. No hay
 * ni un alto inventado acá: el alto lo calcula el mismo CSS que la tarjeta de
 * verdad, así que cuando llegan los proyectos no se mueve un pixel.
 *
 * Si algún día cambia el alto de la tarjeta real, este sigue igual solo,
 * porque no lo sabe: lo hereda.
 */
function tarjetaFantasma(destacada = false) {
  return `
    <div class="pcard${destacada ? " pcard-destacada" : ""}" data-esqueleto aria-hidden="true">
      <div class="pcard-img-box">
        <div class="marco-nav">
          <div class="marco-nav-barra">
            <span class="marco-nav-punto"></span>
            <span class="marco-nav-punto"></span>
            <span class="marco-nav-punto"></span>
            <span class="marco-nav-url hueso">&nbsp;</span>
          </div>
          <div class="marco-nav-pantalla"><div class="hueso hueso-bloque"></div></div>
        </div>
      </div>
      <div class="pcard-cuerpo">
        <h2 class="pcard-titulo"><span class="hueso hueso-titulo">&nbsp;</span></h2>
        <p class="pcard-desc hueso-parrafo">
          <span class="hueso hueso-linea"></span>
          <span class="hueso hueso-linea"></span>
          <span class="hueso hueso-linea"></span>
        </p>
        <div class="pcard-tags">
          <span class="hueso hueso-pildora"></span>
          <span class="hueso hueso-pildora"></span>
          <span class="hueso hueso-pildora"></span>
        </div>
        <span class="pcard-link"><span class="hueso hueso-chico">&nbsp;</span></span>
      </div>
    </div>`;
}

/** Cuántas fantasmas se dibujan mientras no sabemos cuántos proyectos hay. */
const FANTASMAS = 6;

function pintarFantasmas() {
  const grilla = $("listado");
  if (!grilla) return;
  grilla.setAttribute("aria-busy", "true");

  /* Si el HTML ya trajo fantasmas, no se redibujan. Cada redibujo es un
     reacomodo que el visitante ve: pasar de 3 a 6 y después a los reales son
     DOS saltos donde debería haber uno. */
  if (grilla.querySelector("[data-esqueleto]")) return;
  /* La primera va destacada porque casi siempre hay alguna: así el esqueleto
     se parece a lo que viene y el reacomodo final es menor. */
  grilla.classList.add("con-destacados");
  grilla.innerHTML = Array.from({ length: FANTASMAS },
    (_, i) => tarjetaFantasma(i === 0)).join("");
}

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
  const destacada = Boolean(p.isFeatured) ? " pcard-destacada" : "";

  /* data-id: FLIP necesita reconocer la MISMA tarjeta antes y después de
     filtrar para saber de dónde a dónde viaja. Sin un id estable, cada
     redibujo son tarjetas nuevas y no hay viaje que animar. */
  const id = escapeHtml(String(p.id));

  const abre = tieneDemo
    ? `<a class="pcard${destacada}" data-id="${id}" href="${escapeHtml(demo)}" target="_blank" rel="noopener noreferrer">`
    : `<article class="pcard pcard-sin-demo${destacada}" data-id="${id}">`;
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


/* ==========================================================================
   El filtro con las tarjetas viajando (FLIP)
   --------------------------------------------------------------------------
   Al filtrar, la lista no se redibuja de golpe: las tarjetas que siguen
   deslizan hasta su nueva posición y las que se van se desvanecen.

   La técnica se llama FLIP, por sus cuatro pasos:

     First   — anotar dónde está cada tarjeta ANTES de tocar nada.
     Last    — cambiar el DOM y dejar que el navegador calcule las posiciones
               nuevas (esto es instantáneo y el ojo no lo ve).
     Invert  — poner cada tarjeta, con un transform, en el lugar VIEJO. Para
               el navegador ya está en el sitio nuevo; visualmente no se
               movió.
     Play    — sacar el transform y animar la vuelta a cero.

   Se anima `transform` y no `top`/`left` a propósito: transform no toca el
   layout, así que el navegador no recalcula nada en cada cuadro y la
   animación corre en el compositor. Animando posiciones reales, con 20
   tarjetas se nota el tirón en un celular.

   Y por qué no la View Transitions API, que haría esto en tres líneas:
   todavía no la tienen Firefox ni Safari en versiones viejas, y el respaldo
   habría que escribirlo igual. FLIP funciona en todos lados y son 30 líneas.
   ========================================================================== */
const DURACION_VIAJE = 420;

/** Anota dónde está cada tarjeta ahora, indexado por el id del proyecto. */
function anotarPosiciones() {
  const mapa = new Map();
  for (const el of $("listado").querySelectorAll(".pcard[data-id]")) {
    mapa.set(el.dataset.id, el.getBoundingClientRect());
  }
  return mapa;
}

/**
 * Hace viajar cada tarjeta desde donde estaba hasta donde quedó.
 * Las que no estaban antes (entran por el filtro) aparecen con un fundido
 * corto en vez de viajar desde la nada.
 */
function reproducirViaje(antes) {
  const grilla = $("listado");
  if (!grilla) return;

  /* Si la persona pidió menos movimiento, no se anima nada: el cambio de
     lista ya es la respuesta a lo que tocó, y la animación no aporta
     información que no esté. */
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const el of grilla.querySelectorAll(".pcard[data-id]")) {
    const previo = antes.get(el.dataset.id);
    const ahora = el.getBoundingClientRect();

    if (!previo) {
      el.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }],
                 { duration: 260, easing: "ease-out" });
      continue;
    }

    const dx = previo.left - ahora.left;
    const dy = previo.top - ahora.top;
    // Un viaje de menos de 2px no se ve; animarlo solo gasta.
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;

    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: DURACION_VIAJE, easing: "cubic-bezier(.22,.61,.36,1)" }
    );
  }
}

/** Las que sobreviven al filtro nuevo, por id. */
function idsQueQuedan(filtro) {
  const lista = filtro === "all" ? proyectos : proyectos.filter((p) => p.category === filtro);
  return new Set(lista.map((p) => String(p.id)));
}

let cambiando = false;

/**
 * Cambia el filtro con las tarjetas en movimiento.
 *
 * Primero se desvanecen las que se van (140 ms, apenas perceptible como
 * espera) y recién ahí se redibuja y arranca el viaje de las que quedan. Si
 * se hiciera todo junto, las que se van desaparecerían de golpe en el mismo
 * cuadro en que las otras empiezan a moverse, y el ojo lee eso como un
 * parpadeo, no como una transición.
 *
 * `cambiando` evita que dos toques seguidos se pisen: sin eso, el segundo
 * anota posiciones a mitad del viaje del primero y las tarjetas saltan.
 */
async function cambiarFiltro(nuevo) {
  if (cambiando) return;
  const grilla = $("listado");
  if (!grilla) return;

  const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  cambiando = true;

  try {
    if (!sinMovimiento) {
      const quedan = idsQueQuedan(nuevo);
      const salen = [...grilla.querySelectorAll(".pcard[data-id]")]
        .filter((el) => !quedan.has(el.dataset.id));

      if (salen.length) {
        await Promise.all(salen.map((el) =>
          el.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.97)" }],
                     { duration: 140, easing: "ease-in", fill: "forwards" }).finished
            .catch(() => {})   // si la animación se cancela, seguimos igual
        ));
      }
    }

    const antes = anotarPosiciones();   // First
    filtroActivo = nuevo;
    pintarFiltros();
    pintarGrilla();                     // Last
    reproducirViaje(antes);             // Invert + Play
  } finally {
    cambiando = false;
  }
}

function pintarGrilla() {
  const grilla = $("listado");
  const conteo = $("proyectos-conteo");
  if (!grilla) return;

  const lista = visibles();
  grilla.setAttribute("aria-busy", "false");

  if (conteo) {
    conteo.removeAttribute("aria-busy");
    const n = proyectos.length;
    conteo.textContent = n === 1
      ? "1 trabajo publicado."
      : `${n} trabajos publicados. Tocá cualquiera para ver la demo en vivo.`;
  }

  if (lista.length === 0) {
    grilla.innerHTML = `<p class="proyectos-aviso">No hay proyectos en esta categoría.</p>`;
    return;
  }

  const hayDestacados = lista.some((p) => Boolean(p.isFeatured));
  grilla.classList.toggle("con-destacados", hayDestacados);
  grilla.innerHTML = lista.map((p, i) => tarjeta(p, i, filtroActivo === "all")).join("");
}

/* ==========================================================================
   Arranque
   ========================================================================== */
async function iniciar() {
  iniciarTema();

  const grilla = $("listado");

  /* Las fantasmas se dibujan ANTES de pedir los datos, no después: si se
     dibujaran al recibir la respuesta no servirían para nada, que es
     justamente el momento en que ya hay contenido real. */
  pintarFantasmas();

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
      cambiarFiltro(btn.dataset.filter);
    });
}

iniciar();
