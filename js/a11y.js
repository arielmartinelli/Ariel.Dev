/**
 * a11y.js — Utilidades de accesibilidad para dialogos y paneles.
 *
 * Problemas que resuelve (todos detectados en la auditoria):
 *
 *  - El panel admin no se cerraba con Escape. Un modal sin Escape incumple
 *    WCAG 2.1.2 (sin trampas de teclado) y frustra a cualquiera que use el
 *    teclado a diario.
 *  - El foco se quedaba detras del panel: al abrirlo y tabular, el recorrido
 *    seguia por los links de la pagina de fondo, que estaban visualmente
 *    tapados. Quien navega con teclado o lector de pantalla se perdia.
 *  - El fondo seguia scrolleando con el panel abierto.
 */

const SELECTOR_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Encierra el foco dentro de `contenedor` y devuelve una funcion para soltarlo.
 *
 * @param {HTMLElement} contenedor  Elemento del modal.
 * @param {() => void}  alCerrar    Se llama cuando el usuario presiona Escape.
 * @returns {() => void}            Liberar: restaura foco, scroll y listeners.
 */
export function atraparFoco(contenedor, alCerrar) {
  if (!contenedor) return () => {};

  const focoPrevio = document.activeElement;
  const scrollPrevio = document.body.style.overflow;

  // Evita que el fondo se desplace detras del modal.
  document.body.style.overflow = "hidden";

  // OJO con offsetParent: devuelve null para CUALQUIER elemento dentro de un
  // ancestro `position: fixed`, y el panel admin es fixed. Usarlo como prueba
  // de visibilidad devolvia una lista vacia, asi que el foco inicial nunca se
  // colocaba dentro del panel. getClientRects() sí funciona ahí: vacío
  // significa realmente no renderizado (display:none, hidden, o colapsado).
  const visibles = () =>
    Array.from(contenedor.querySelectorAll(SELECTOR_FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0 && !el.closest("[hidden]")
    );

  function alPresionarTecla(e) {
    // Si hay un SweetAlert2 abierto, es el dialogo mas alto de la pila:
    // que maneje el el teclado, no el panel de abajo.
    if (document.body.classList.contains("swal2-shown")) return;

    if (e.key === "Escape") {
      e.preventDefault();
      if (typeof alCerrar === "function") alCerrar();
      return;
    }

    if (e.key !== "Tab") return;

    const items = visibles();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }

    const primero = items[0];
    const ultimo = items[items.length - 1];

    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    } else if (!contenedor.contains(document.activeElement)) {
      // El foco se escapo al fondo: lo traemos de vuelta.
      e.preventDefault();
      primero.focus();
    }
  }

  document.addEventListener("keydown", alPresionarTecla, true);

  // Foco inicial dentro del panel, no en el botón que quedó atrás.
  //
  // No alcanza con un requestAnimationFrame: el panel entra con una
  // transición de `visibility` de 0.3s y, mientras sigue en `visibility:
  // hidden`, .focus() es un no-op silencioso — el foco se quedaba en el botón
  // "Panel Administrador" del fondo. Por eso se reintenta hasta que agarra,
  // cubriendo toda la duración de la animación.
  const momentos = [0, 60, 180, 340];
  const temporizadores = momentos.map((ms) =>
    setTimeout(() => {
      if (contenedor.contains(document.activeElement)) return; // ya está adentro
      const items = visibles();
      if (items.length) items[0].focus();
    }, ms)
  );

  return function liberar() {
    // Se cancelan los reintentos: si el panel se cierra rápido, un focus()
    // tardío se lo robaría a lo que el usuario esté usando después.
    temporizadores.forEach(clearTimeout);
    document.removeEventListener("keydown", alPresionarTecla, true);
    document.body.style.overflow = scrollPrevio;
    if (focoPrevio && typeof focoPrevio.focus === "function") {
      focoPrevio.focus();
    }
  };
}

/**
 * Anuncia un mensaje a lectores de pantalla sin interrumpir al usuario.
 * Se usa para cambios que ocurren sin recargar (filtros, progreso, guardado).
 */
let regionViva = null;

export function anunciar(mensaje) {
  if (!regionViva) {
    regionViva = document.createElement("div");
    regionViva.setAttribute("role", "status");
    regionViva.setAttribute("aria-live", "polite");
    regionViva.setAttribute("aria-atomic", "true");
    regionViva.style.cssText =
      "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;";
    document.body.appendChild(regionViva);
  }
  // Se vacia primero para que un mensaje repetido igual se vuelva a anunciar.
  regionViva.textContent = "";
  setTimeout(() => {
    regionViva.textContent = mensaje;
  }, 60);
}
