/**
 * El servidor que usan las pruebas.
 *
 * POR QUE NO ALCANZA CON `npx serve`
 * ----------------------------------
 * Porque no manda las cabeceras de producción, y una de ellas puede romper
 * la página entera sin que ninguna prueba se entere.
 *
 * Pasó: el sitio manda un Content-Security-Policy con `default-src 'self'` y
 * sin `frame-src`. En produccion eso hace que el navegador SE NIEGUE a
 * mostrar cualquier sitio ajeno adentro de un marco — las vistas vivas de
 * las tarjetas quedaban en gris, todas. En local andaba perfecto, porque el
 * servidor de pruebas no mandaba ninguna cabecera.
 *
 * Asi que este lee el CSP de public/_headers y lo manda igual que Vercel.
 * Si algun dia alguien ajusta esa politica y rompe algo, las pruebas lo ven
 * antes que el visitante.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.env.RAIZ || "dist";
const PUERTO = Number(process.env.PUERTO || 4178);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** El CSP tal cual lo sirve Vercel, sacado de public/_headers. */
function leerCSP() {
  try {
    const txt = fs.readFileSync("public/_headers", "utf8");
    const m = txt.match(/^\s*Content-Security-Policy:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const CSP = leerCSP();
if (!CSP) console.warn("[servidor] no encontré el CSP en public/_headers: las pruebas van sin él");

http.createServer((req, res) => {
  let ruta = decodeURIComponent(req.url.split("?")[0]);
  if (ruta.endsWith("/")) ruta += "index.html";
  let archivo = path.join(RAIZ, ruta);
  if (!fs.existsSync(archivo) && fs.existsSync(archivo + ".html")) archivo += ".html";

  if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("no está");
  }

  const cabeceras = { "content-type": TIPOS[path.extname(archivo)] || "application/octet-stream" };
  // Solo en los documentos: en un .css o un .js el CSP no hace nada.
  if (CSP && archivo.endsWith(".html")) cabeceras["content-security-policy"] = CSP;

  res.writeHead(200, cabeceras);
  fs.createReadStream(archivo).pipe(res);
}).listen(PUERTO, "127.0.0.1", () => {
  console.log(`servidor en http://127.0.0.1:${PUERTO} (${RAIZ})` + (CSP ? " · con el CSP de producción" : ""));
});
