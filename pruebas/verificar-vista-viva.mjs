/**
 * La vista viva: el sitio de verdad adentro de la tarjeta.
 *
 * Lo que se comprueba, que es lo que de verdad puede romperse sin avisar:
 *
 *   1. NINGUNA TARJETA QUEDA VACIA. Diez de los diecinueve demos se niegan a
 *      mostrarse adentro de un marco. Para esos tiene que aparecer la captura
 *      guardada. Un rectángulo en blanco en el portfolio es peor que la foto
 *      vieja.
 *
 *   2. NO SE CARGAN LAS DIECINUEVE JUNTAS. Cada vista viva es una página
 *      entera: todas a la vez serían diecinueve sitios corriendo en paralelo.
 *      Solo las que están a la vista, y se descargan al alejarse.
 *
 *   3. LA LISTA SIGUE SIENDO LIVIANA. La consulta de proyectos no puede
 *      volver a traer la columna `image`: eran 21,5 MB por visita. Si alguien
 *      vuelve a poner select("*"), esta prueba lo caza.
 *
 *   4. EL MARCO NO SE QUEDA CON LOS CLICS. La tarjeta entera es un link; si
 *      el iframe recibiera los eventos, tocarla no abriría el demo.
 *
 *   5. NUESTRO PROPIO CSP NO BLOQUEA LOS MARCOS. Esta es la que faltaba y
 *      costó caro: el sitio manda `default-src 'self'` y, sin un `frame-src`
 *      que lo contradiga, el navegador se niega a mostrar CUALQUIER sitio
 *      ajeno adentro de un marco. En producción se veían todas las tarjetas
 *      en gris; en local andaba bien, porque el servidor de pruebas no
 *      mandaba ninguna cabecera. Por eso ahora las pruebas se corren con
 *      pruebas/servidor.mjs, que manda el CSP de verdad.
 */
import { chromium } from "playwright";

const OPC = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const CATS = [
  { id: "landing", label: "Landing Page" },
  { id: "custom", label: "Custom App" },
];

/* Mitad y mitad, como en la realidad: unos se dejan mostrar y otros no. */
const PROY = Array.from({ length: 8 }, (_, i) => ({
  id: `11111111-1111-4111-8111-00000000000${i}`,
  title: `Proyecto ${i + 1}`,
  description: "Tienda online con carrito, medios de pago y panel propio.",
  category: CATS[i % 2].id,
  tags: ["HTML", "CSS", "JS"],
  demo_url: i % 2 === 0 ? `https://abierto-${i}.ejemplo.com` : `https://cerrado-${i}.ejemplo.com`,
  position: i,
  is_featured: i === 0,
  created_at: "2026-01-01T00:00:00Z",
}));

const PORTADA =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5"><rect width="8" height="5" fill="#334"/></svg>');

const nav = await chromium.launch(OPC);
const fallas = [];
const ctx = await nav.newContext({ viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();

/* El navegador avisa por consola cuando rechaza un marco. Es la unica senal
   que da: desde el JavaScript de la pagina, un marco bloqueado se ve igual
   que uno que cargo bien. */
const rechazos = [];
p.on("console", (m) => {
  if (/Refused to frame/i.test(m.text())) rechazos.push(m.text().slice(0, 150));
});

let pesoLista = 0;
let pidioImagenEnLaLista = false;
let portadasPedidas = 0;

/* El comodín va PRIMERO: en Playwright gana la ULTIMA ruta registrada, así
   que puesto al final se tragaría también las llamadas a Supabase. */
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) =>
  r.fulfill({ status: 200, contentType: "text/html", body: "<b>sitio</b>" }));

await p.route("**/api/marco-permite*", (r) => {
  const u = new URL(r.request().url()).searchParams.get("u") || "";
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ vivo: u.includes("abierto-") }),
  });
});

await p.route("**/rest/v1/**", (r) => {
  const u = r.request().url();
  if (/categories/.test(u)) {
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATS) });
  }
  if (/reviews/.test(u)) {
    return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  }
  if (/select=image/.test(u)) {           // la portada de respaldo, de a una
    portadasPedidas++;
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ image: PORTADA }) });
  }
  if (/image/.test(decodeURIComponent(u))) pidioImagenEnLaLista = true;
  const cuerpo = JSON.stringify(PROY);
  pesoLista += cuerpo.length;
  return r.fulfill({ status: 200, contentType: "application/json", body: cuerpo });
});

await p.goto(`${BASE}/proyectos.html`, { waitUntil: "commit" });
await p.waitForFunction(
  () => document.querySelectorAll(".pcard:not([data-esqueleto])").length > 0,
  null, { timeout: 15000 }
).catch(() => fallas.push("no se llegó a dibujar ninguna tarjeta"));
await p.waitForTimeout(1500);

/* --- 3. la lista sigue liviana --- */
console.log(`la lista de proyectos pesó ${(pesoLista / 1024).toFixed(1)} kB` +
            (pidioImagenEnLaLista ? "  ← ¡incluye la columna image!" : ""));
if (pidioImagenEnLaLista) {
  fallas.push("la consulta de proyectos volvió a pedir la columna `image` (eran 21,5 MB por visita)");
}

/* --- 2. no se cargan todas juntas --- */
const alPrincipio = await p.evaluate(() => document.querySelectorAll(".vista-viva iframe").length);
const cuantas = await p.evaluate(() => document.querySelectorAll(".vista-viva").length);
console.log(`marcos cargados al entrar: ${alPrincipio} de ${cuantas} tarjetas`);
if (alPrincipio >= cuantas) {
  fallas.push(`se cargaron los ${alPrincipio} sitios de una vez: la carga diferida no está funcionando`);
}

/* --- 1. ninguna tarjeta vacía, recorriéndolas de a una --- */
console.log("\ntarjeta por tarjeta, mientras está a la vista:");
const total = await p.evaluate(() => document.querySelectorAll(".pcard").length);
for (let i = 0; i < total; i++) {
  await p.evaluate((k) => document.querySelectorAll(".pcard")[k]
    .scrollIntoView({ block: "center" }), i);
  await p.waitForTimeout(650);
  const e = await p.evaluate((k) => {
    const c = document.querySelectorAll(".pcard")[k];
    const v = c.querySelector(".vista-viva");
    return {
      t: c.querySelector(".pcard-titulo")?.textContent.trim() || "?",
      q: !v ? "sin vista"
        : v.querySelector("iframe") ? "en vivo"
        : v.querySelector(".vista-viva-foto") ? "foto"
        : "VACIA",
    };
  }, i);
  console.log(`  ${e.t.padEnd(16)} ${e.q}`);
  if (e.q === "VACIA") fallas.push(`"${e.t}" quedó sin nada: ni el sitio en vivo ni la captura`);
}
console.log(`portadas de respaldo pedidas: ${portadasPedidas}`);

/* --- 5. nuestro propio CSP --- */
if (rechazos.length) {
  fallas.push(
    `el navegador rechazo ${rechazos.length} marco(s) por culpa de NUESTRO CSP. ` +
    `Falta 'frame-src' en public/_headers y vercel.json:\n    ${rechazos[0]}`
  );
}
console.log(`\nmarcos rechazados por nuestro CSP: ${rechazos.length}`);

/* --- 4. el marco no se queda con los clics --- */
const dejaPasar = await p.evaluate(() => {
  const f = document.querySelector(".vista-viva iframe");
  return f ? getComputedStyle(f).pointerEvents === "none" : null;
});
if (dejaPasar === false) {
  fallas.push("el iframe recibe los clics: tocar la tarjeta no va a abrir el demo");
}
console.log(`\nel marco deja pasar los clics a la tarjeta: ${dejaPasar === null ? "(no había marco)" : dejaPasar ? "sí" : "NO"}`);

/* --- y que al alejarse se descarguen --- */
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(1200);
const alFinal = await p.evaluate(() => document.querySelectorAll(".vista-viva iframe").length);
console.log(`marcos vivos después de volver arriba: ${alFinal} de ${cuantas}`);
if (alFinal >= cuantas) {
  fallas.push("los marcos no se descargan al salir de la pantalla: quedan todos los sitios corriendo");
}

await nav.close();
console.log("\n" + (fallas.length
  ? "FALLAS:\n- " + fallas.join("\n- ")
  : "✔ ninguna tarjeta vacía, la lista sigue liviana y los marcos se cargan de a poco"));
