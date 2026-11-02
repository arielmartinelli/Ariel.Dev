/* ==========================================================================
   Vista viva: el sitio de verdad adentro de la tarjeta
   --------------------------------------------------------------------------
   Antes cada tarjeta mostraba una captura. Ahora muestra el sitio corriendo,
   en chiquito y se puede recorrer con la rueda o el dedo.

   TRES DECISIONES QUE NO SON OBVIAS

   1. El iframe se dibuja a 1280px de ancho y después se achica con
      `transform: scale()`. No se le pone `width: 100%`.
      Si se le pusiera el ancho de la tarjeta (unos 560px), el sitio de
      adentro creería que está en una pantalla de 560px y mostraría su
      versión de CELULAR: menú de hamburguesa, una columna, todo apilado.
      Lo que queremos mostrar es cómo se ve en una computadora. Dibujándolo
      a 1280 y achicándolo, el sitio cree que está en una pantalla grande y
      se ve como se ve de verdad.

   2. El iframe NO recibe clics (`pointer-events: none`).
      La tarjeta entera es un link que abre el demo; si el iframe se quedara
      con los clics, tocarla no haría nada. Sin clics, el que scrollea es el
      contenedor de acá, no la página de adentro — que además, al ser de otro
      dominio, no podríamos controlar aunque quisiéramos.

   3. Se carga solo lo que está a la vista, y se descarga al alejarse.
      Cada vista viva es una página entera: 19 a la vez serían 19 sitios
      corriendo en paralelo. Con el observador, en pantalla hay tres o
      cuatro; el resto no existe hasta que te acercás.

   LOS SITIOS QUE NO SE DEJAN MOSTRAR
   Diez de los diecinueve demos mandan una cabecera que prohíbe mostrarlos
   adentro de un marco. Y el navegador NO avisa cuando bloquea: lo medí, y
   desde acá "cargó bien", "lo bloquearon" y "ni existe" se ven idénticos —
   el evento `load` salta igual y todo lo demás tira el mismo error de
   seguridad por ser otro dominio.

   Por eso antes de poner el marco se le pregunta a /api/marco-permite, que
   corre en el servidor y sí puede leer las cabeceras. Si dice que no, se
   muestra la captura vieja que quedó guardada en la base, pedida de a una y
   solo para ese proyecto. Si tampoco hay captura, queda el nombre del sitio.
   Nunca un rectángulo vacío.
   ========================================================================== */
import { portadaDe } from "./projects.js";

/** Ancho con el que el sitio de adentro cree que lo están mirando. */
const ANCHO_LOGICO = 1280;

/**
 * Alto de la "pantalla" con la que el sitio de adentro cree que lo miran.
 *
 * ACA ESTUVO EL ERROR, Y VALE LA PENA DEJARLO ESCRITO.
 * Primero fueron 2600px, para poder recorrer el sitio hacia abajo. Resultado:
 * se veía la portada y después todo en blanco. Dos motivos, los dos de
 * fondo y ninguno arreglable desde acá:
 *
 *   1. Una sección con `height: 100vh` mide el alto de SU ventana. En un
 *      marco de 2600px, la portada pasa a medir 2600px: ocupa todo y el
 *      resto queda empujado fuera de la vista.
 *
 *   2. Casi todos tus demos hacen aparecer las secciones al scrollear. Esa
 *      aparición la dispara el scroll DE ADENTRO del marco — y el marco
 *      nunca scrollea: lo que se movía era la caja de afuera. Las secciones
 *      se quedaban esperando, invisibles, para siempre. Eso era el blanco.
 *
 *   Y no se puede arreglar scrolleando el marco por dentro: es otro dominio,
 *   el navegador no deja tocarlo. Es una pared, no un detalle.
 *
 * Así que la vista viva muestra UNA pantalla: la portada del sitio, como se
 * ve en una notebook, andando de verdad. Sin recorrerla. Comprobado contra
 * los demos reales: a 2600px la página salía medio vacía, a 820 sale entera.
 */
const ALTO_LOGICO = 820;

/**
 * El contenido de .marco-nav-pantalla para un proyecto con demo.
 * Devuelve "" si no hay una URL usable: el llamador decide qué poner.
 */
export function pantallaViva(url, titulo, id) {
  if (!url || url === "#") return "";
  const u = escapar(url);
  const t = escapar(titulo || "");
  const p = escapar(id == null ? "" : id);
  return `
    <div class="vista-viva" data-demo="${u}" data-proyecto="${p}">
      <!-- Queda abajo de todo. Si el sitio no se deja mostrar en un marco,
           esto es lo que ve el visitante en vez de un rectángulo vacío. -->
      <span class="vista-viva-fondo" aria-hidden="true">${t}</span>
      <div class="vista-viva-lienzo"></div>
    </div>`;
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

let observador = null;
let medidor = null;

/**
 * Enciende las vistas vivas que haya dentro de `raiz`.
 * Se puede llamar todas las veces que haga falta: las que ya estaban
 * enganchadas no se vuelven a enganchar.
 */
export function activarVistasVivas(raiz = document) {
  const cajas = raiz.querySelectorAll?.(".vista-viva:not([data-viva])");
  if (!cajas || !cajas.length) return;

  if (!observador) {
    /* 300px de margen: el marco empieza a cargar un poco antes de entrar en
       pantalla, así llega dibujado y no se lo ve aparecer. Al alejarse 300px
       se descarga. */
    observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (e.isIntersecting) {
            e.target.dataset.aLaVista = "1";
            encender(e.target);
          } else {
            delete e.target.dataset.aLaVista;
            apagar(e.target);
          }
        }
      },
      { rootMargin: "300px 0px" }
    );
  }

  /* Un solo ResizeObserver para todas: la escala depende del ancho de la
     tarjeta, que cambia al rotar el celular o agrandar la ventana. */
  if (!medidor) {
    medidor = new ResizeObserver((entradas) => {
      for (const e of entradas) escalar(e.target);
    });
  }

  for (const caja of cajas) {
    caja.dataset.viva = "1";
    escalar(caja);
    medidor.observe(caja);
    observador.observe(caja);
  }
}

function escalar(caja) {
  const ancho = caja.clientWidth;
  if (!ancho) return;
  const escala = ancho / ANCHO_LOGICO;
  caja.style.setProperty("--viva-escala", escala);
}

/* Lo que contestó /api/marco-permite para cada sitio, mientras dure la
   pestaña. Sin esto, volver de un filtro a otro vuelve a preguntar por los
   mismos diecinueve. */
const permiso = new Map();

function consultarPermiso(url) {
  if (permiso.has(url)) return permiso.get(url);
  const pedido = fetch(`/api/marco-permite?u=${encodeURIComponent(url)}`)
    .then((r) => (r.ok ? r.json() : { vivo: false }))
    .then((d) => Boolean(d?.vivo))
    /* Si la consulta falla, se asume que NO: mejor mostrar la captura que
       arriesgarse a un marco en blanco. */
    .catch(() => false);
  permiso.set(url, pedido);
  return pedido;
}

async function encender(caja) {
  const lienzo = caja.querySelector(".vista-viva-lienzo");
  if (!lienzo || lienzo.firstChild || caja.dataset.cargando) return;
  caja.dataset.cargando = "1";

  let deja = false;
  try {
    deja = await consultarPermiso(caja.dataset.demo);
  } finally {
    delete caja.dataset.cargando;
  }

  // Se alejó mientras preguntábamos: ya no hace falta cargar nada.
  if (!caja.isConnected || !caja.dataset.aLaVista) return;

  if (!deja) return mostrarPortada(caja);

  const marco = document.createElement("iframe");
  marco.src = caja.dataset.demo;
  marco.width = ANCHO_LOGICO;
  marco.height = ALTO_LOGICO;
  marco.scrolling = "no";          // navegadores viejos
  marco.loading = "lazy";
  marco.title = "";                       // decorativo: el link ya nombra el sitio
  marco.setAttribute("aria-hidden", "true");
  marco.tabIndex = -1;
  marco.setAttribute("referrerpolicy", "no-referrer");

  /* SIN allow-top-navigation y SIN allow-forms, a propósito. Lo primero
     evita que una página de adentro se lleve la pestaña entera del
     visitante; lo segundo, que alguien confunda un formulario de la vista
     previa con uno tuyo y escriba datos ahí. */
  marco.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");

  lienzo.appendChild(marco);
}

/** El respaldo: la captura guardada en la base, pedida solo para este. */
async function mostrarPortada(caja) {
  if (caja.querySelector(".vista-viva-foto")) return;
  const src = await portadaDe(caja.dataset.proyecto);
  if (!src || !caja.isConnected) return;

  const foto = document.createElement("img");
  foto.src = src;
  foto.className = "vista-viva-foto";
  foto.alt = "";
  foto.decoding = "async";
  foto.loading = "lazy";
  caja.appendChild(foto);
}

function apagar(caja) {
  const lienzo = caja.querySelector(".vista-viva-lienzo");
  /* Se borra el iframe entero, no se esconde: esconderlo deja la página de
     adentro viva, con sus temporizadores y sus pedidos de red corriendo.
     La foto de respaldo SÍ se deja: no cuesta nada y evita que la tarjeta
     parpadee cada vez que entra y sale de la pantalla. */
  if (lienzo) lienzo.replaceChildren();
}
