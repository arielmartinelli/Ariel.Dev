/**
 * iconos.js — El set de íconos del producto.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * Antes había tres formas distintas de poner un ícono conviviendo en la misma
 * pantalla:
 *
 *   1. Los trazos SVG definidos adentro de cliente.js (solo el portal).
 *   2. Emojis sueltos: 📄 💵 ⚠️ ⚙️ 👤 📭 💸 ⭐.
 *   3. Glifos tipográficos: ✓ ✕ ● ○ ★ ☆.
 *
 * Los emojis son el problema serio de los tres. Un 📄 lo dibuja la fuente del
 * sistema, así que se ve distinto en Windows, en Android y en iPhone; no
 * hereda el color del texto (queda a todo color al lado de un ícono gris); no
 * escala con la tipografía; y el lector de pantalla lo lee en voz alta con un
 * nombre que nadie eligió ("página de cara arriba"). Puesto al lado de un
 * ícono de trazo fino y bien alineado, es lo que delata que la pantalla se
 * armó apurada.
 *
 * Los glifos ✓ ✕ ● ○ son menos graves pero cambian de grosor y de alineación
 * vertical según la fuente, así que tampoco empatan con los SVG.
 *
 * Acá está todo en un solo lugar: mismo `viewBox`, mismo grosor de trazo,
 * `currentColor` para que tomen el color del texto que los rodea, y
 * `aria-hidden` porque el texto al lado ya dice lo que el ícono repite.
 */

/* Cada entrada es solo el contenido del <svg>. El envoltorio lo pone ico(). */
export const TRAZOS = {
  // --- Estado y flujo ---
  reloj:     '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  check:     '<path d="m4.5 12.5 5 5 10-11"/>',
  checkCirculo: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.6"/>',
  cruz:      '<path d="M7 7l10 10M17 7 7 17"/>',
  mas:       '<path d="M12 5v14M5 12h14"/>',
  punto:     '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  circulo:   '<circle cx="12" cy="12" r="5"/>',
  alerta:    '<path d="M12 4.5 2.8 20h18.4L12 4.5z"/><path d="M12 10v4M12 17.2h.01"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/>',

  // --- Objetos del proyecto ---
  casa:      '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h5v-5.5h3V20h5V9.5"/>',
  ojo:       '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  documento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  lista:     '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  globo:     '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  cohete:    '<path d="M13.5 4.5c3.5-2 6-1 6-1s1 2.5-1 6c-1.7 3-5 6-7 7l-4-4c1-2 4-5.3 6-8z"/><path d="M7.5 12.5 4 14l2 2 2 2 1.5-3.5"/>',
  engranaje: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',

  // --- Plata ---
  tarjeta:   '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h3"/>',
  billete:   '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v.01M18 14v.01"/>',
  recibo:    '<path d="M5 3h14v18l-2.3-1.6L14.4 21 12 19.4 9.6 21l-2.3-1.6L5 21z"/><path d="M9 8h6M9 12h6"/>',

  // --- Contacto (pie del sitio público) ---
  pin:       '<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  sobre:     '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  telefono:  '<path d="M7.5 3.5h-3a1.5 1.5 0 0 0-1.5 1.6c.4 5.6 3.3 10.3 8.4 13.1 3 1.6 6 2.3 8.1 2.3a1.5 1.5 0 0 0 1.5-1.5v-2.8a1.5 1.5 0 0 0-1.3-1.5l-3-.4a1.5 1.5 0 0 0-1.4.6l-.9 1.2a13 13 0 0 1-5-5l1.2-.9a1.5 1.5 0 0 0 .6-1.4l-.4-3a1.5 1.5 0 0 0-1.5-1.3z"/>',
  camara:    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.01"/>',
  rayo:      '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  corazon:   '<path d="M12 20s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 3.1C19.5 15.4 12 20 12 20z"/>',

  // --- Rubros (páginas de ventajas) ---
  carrito:   '<path d="M3 4h2.2l2.3 11.2h10.3L20 7H6"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
  bolsa:     '<path d="M4.5 8h15l-1.2 12.5H5.7z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>',
  movil:     '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.6h3"/>',
  monitor:   '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M9 21h6M12 17v4"/>',
  prohibido: '<circle cx="12" cy="12" r="9"/><path d="m6 18 12-12"/>',

  // --- Personas y varios ---
  persona:   '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  estrella:  '<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.8l5.9-.8z"/>',
  bandeja:   '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5h13l2.5 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
  subir:     '<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',
  descargar: '<path d="M12 4v12"/><path d="m6.5 10.5 5.5 5.5 5.5-5.5"/><path d="M4 20h16"/>',
  copiar:    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  candado:   '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  wa:        '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
};

/**
 * Devuelve el `<svg>` listo para meter en una plantilla.
 *
 * `relleno` sirve para los íconos que se usan llenos y vacíos (la estrella de
 * las reseñas): con relleno pinta el interior, sin relleno queda el contorno.
 */
export function ico(nombre, clase = "pico", { relleno = false } = {}) {
  const trazo = TRAZOS[nombre];
  if (!trazo) return "";
  const estilo = relleno ? ' fill="currentColor" stroke="none"' : "";
  return `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true"${estilo}>${trazo}</svg>`;
}

/**
 * Estrellas de una reseña, en SVG.
 * Antes eran "★".repeat(n) + "☆".repeat(5-n): dos caracteres distintos cuyo
 * grosor y tamaño dependen de la fuente instalada, así que la fila quedaba
 * despareja. Acá las cinco son el mismo dibujo y solo cambia el relleno.
 */
export function estrellas(cantidad = 5, clase = "pico pico-sm") {
  const n = Math.max(0, Math.min(5, Number(cantidad) || 0));
  return Array.from({ length: 5 }, (_, i) =>
    ico("estrella", `${clase} ${i < n ? "estrella-llena" : "estrella-vacia"}`, { relleno: i < n })
  ).join("");
}
