/**
 * security.js — Utilidades de defensa del lado del cliente.
 *
 * IMPORTANTE: esto es una segunda línea de defensa. La autorización real
 * vive en las políticas RLS de Supabase (ver SECURITY.md). Nada de lo que
 * se ejecuta en el navegador puede considerarse un control de acceso.
 */

/**
 * Escapa los cinco caracteres que permiten romper el contexto HTML.
 * Se usa en TODA interpolación dentro de innerHTML.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Devuelve la URL solo si usa un esquema seguro.
 * Bloquea javascript:, data:text/html, vbscript: y similares, que permiten
 * ejecutar código si se inyectan en un href o src.
 */
const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

export function safeUrl(value, fallback = "#") {
  if (!value) return fallback;
  const raw = String(value).trim();
  if (raw === "#") return "#";
  try {
    const parsed = new URL(raw, window.location.origin);
    return SAFE_PROTOCOLS.includes(parsed.protocol) ? parsed.href : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Igual que safeUrl pero acepta imágenes embebidas en base64,
 * restringidas a formatos de imagen conocidos (nunca svg+xml: puede
 * contener <script> y se ejecuta en contexto de la página).
 */
const SAFE_IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Patrones activos prohibidos dentro de un SVG. Un SVG cargado vía <img> no
 * ejecuta scripts en navegadores modernos, pero se filtra igual por si el
 * mismo valor termina en otro contexto (object, embed, navegación directa).
 */
const SVG_ACTIVE_CONTENT = /<\s*script|\son\w+\s*=|xlink:href|<\s*foreignObject|<\s*use|javascript:/i;

export function safeImageSrc(value, fallback = "") {
  if (!value) return fallback;
  const raw = String(value).trim();

  if (raw.startsWith("data:image/svg+xml")) {
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return fallback;
    }
    return SVG_ACTIVE_CONTENT.test(decoded) ? fallback : raw;
  }

  if (raw.startsWith("data:")) {
    return SAFE_IMAGE_DATA.test(raw) ? raw : fallback;
  }
  return safeUrl(raw, fallback);
}

/** Límites de entrada: evitan abuso de almacenamiento y payloads gigantes. */
export const LIMITS = {
  IMAGE_BYTES: 2 * 1024 * 1024, // 2 MB
  TITLE: 120,
  DESCRIPTION: 600,
  TAG: 30,
  TAGS_COUNT: 8,
  NAME: 80,
  SUBJECT: 150,
  MESSAGE: 2000,
  CATEGORY: 40,
};

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
];

/** Recorta y normaliza texto libre antes de persistirlo. */
export function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "") // caracteres de control
    .trim()
    .slice(0, maxLength);
}

/** Validación de email razonable (no exhaustiva por diseño: RFC 5322 es inmanejable). */
export function isValidEmail(value) {
  const email = String(value ?? "").trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
}
