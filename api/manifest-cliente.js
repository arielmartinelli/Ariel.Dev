/**
 * GET /api/manifest-cliente?t=<token>
 *
 * El "manifiesto de app" del link de cada cliente. Es lo que hace que, al
 * agregar el link a la pantalla de inicio del celular, quede un ícono como
 * el de cualquier app y se abra a PANTALLA COMPLETA, sin la barra del
 * navegador.
 *
 * POR QUÉ NO ES UN ARCHIVO FIJO
 * -----------------------------
 * El manifiesto dice qué dirección abre el ícono (start_url). Cada cliente
 * tiene la suya (/cliente/<token>), así que un archivo único abriría
 * /cliente a secas — "este link no es válido". Se arma acá, por pedido.
 *
 * QUÉ NO HACE
 * -----------
 * No consulta la base ni devuelve datos del proyecto: solo repite el token
 * que ya vino en la URL, después de validar que tenga forma de token. El
 * nombre del ícono es genérico ("Mi proyecto") a propósito, para no exponer
 * nada a quien pruebe tokens al azar contra este endpoint.
 */
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    return res.end();
  }

  const url = new URL(req.url, "http://localhost");
  const token = String(url.searchParams.get("t") || "");
  const valido = FORMATO_TOKEN.test(token);

  const manifiesto = {
    name: "Mi proyecto · Ariel.Dev",
    short_name: "Mi proyecto",
    description: "El avance de tu página web, tus pagos y tus cambios, en un solo lugar.",
    lang: "es-AR",
    start_url: valido ? `/cliente/${token}` : "/cliente",
    scope: "/cliente/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#070913",
    theme_color: "#070913",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  // Lleva el token: igual que la página del portal, no se guarda en caches.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.end(JSON.stringify(manifiesto));
}
