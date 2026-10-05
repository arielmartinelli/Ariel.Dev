import { chromium } from "playwright";

/* En un entorno con Chromium ya instalado aparte, se le pasa la ruta con
   CHROMIUM=/ruta/al/binario. Sin eso usa el que bajo `npx playwright
   install`, que es el caso normal en tu maquina. */
const OPCIONES = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const EMO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const PORTAL = {
  ok: true, nombre: "Lucía", proyecto: "Pastelería Dulce Hogar",
  status: "demo_lista", progreso: 35, demo_url: "https://demo.vercel.app",
  price_usd: 420, domain_extra_usd: 10, payment_plan: null,
  proposal_url: null, proposal_es_pdf: false, budget_es_pdf: true,
  descripcion: "Sitio con catálogo y pedidos por WhatsApp.",
  domain_choice: "ninguno", domain_name: null,
  tareas: [], pagos: [], cambios: [], wa: "543516121498",
  anticipo_pagado: false, saldo_pagado: false, hay_pago_pendiente: false,
};

const navegador = await chromium.launch(OPCIONES);
const problemas = [];
let ETQ = "";

async function revisar(pagina, ruta, antesDeMedir, etiqueta = "") {
  const p = await pagina.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") errores.push("console: " + m.text()); });

  ETQ = etiqueta ? `${ruta} (${etiqueta})` : ruta;
  if (ruta.includes("cliente")) {
    /* El catch-all va PRIMERO a proposito: en Playwright gana la ULTIMA
       ruta registrada, asi que al final se tragaba la RPC y el portal
       recibia [] en vez de los datos de la etapa. */
    await p.route("**/rest/v1/**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await p.route("**/rest/v1/rpc/portal_obtener*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PORTAL) }));
  }

  await p.goto(`${BASE}/${ruta}${ruta.includes("cliente") ? "?t=".padEnd(3, "") + "a".repeat(40) : ""}`,
    { waitUntil: "networkidle" });
  if (antesDeMedir) await antesDeMedir(p);
  await p.waitForTimeout(500);

  // 1. ¿Queda algún emoji en el texto visible?
  const textos = await p.evaluate(() => {
    const salida = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue.trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || !el.offsetParent && el.tagName !== "BODY") continue;
      salida.push({ t, donde: el.className || el.tagName });
    }
    return salida;
  });
  for (const { t, donde } of textos) {
    if (EMO.test(t)) problemas.push(`${ETQ}: emoji en texto visible → ${JSON.stringify(t.slice(0, 50))} (${donde})`);
  }

  // 2. ¿Algún .pico quedó en su propio renglón, arriba del texto que acompaña?
  const apilados = await p.evaluate(() => {
    const malos = [];
    for (const svg of document.querySelectorAll("svg.pico")) {
      const padre = svg.parentElement;
      if (!padre) continue;
      /* Un ícono dentro de una tarjeta oculta mide 0x0 y eso no es un
         problema: lo que importa es cómo se ve cuando SÍ se muestra. */
      if (!padre.getClientRects().length) continue;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) { malos.push(["sin tamaño", padre.className, r.width, r.height]); continue; }
      // ¿hay texto hermano?
      const texto = Array.from(padre.childNodes)
        .filter((n) => n.nodeType === 3 && n.nodeValue.trim()).map((n) => n.nodeValue.trim()).join(" ");
      if (!texto) continue;
      // Medir la primera línea de texto del padre
      const rango = document.createRange();
      const nodo = Array.from(padre.childNodes).find((n) => n.nodeType === 3 && n.nodeValue.trim());
      rango.selectNodeContents(nodo);
      const rt = rango.getBoundingClientRect();
      if (!rt.height) continue;
      const solapa = Math.min(r.bottom, rt.bottom) - Math.max(r.top, rt.top);
      if (solapa < Math.min(r.height, rt.height) * 0.4) {
        malos.push(["apilado", padre.className || padre.tagName, texto.slice(0, 40), Math.round(r.top), Math.round(rt.top)]);
      }
    }
    return malos;
  });
  for (const m of apilados) problemas.push(`${ETQ}: ícono ${m.join(" | ")}`);

  // 3. ¿Scroll horizontal?
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (desborde > 2) problemas.push(`${ETQ}: desborde horizontal de ${desborde}px`);

  const cuenta = await p.evaluate(() => document.querySelectorAll("svg.pico").length);
  for (const e of errores) problemas.push(`${ETQ}: ${e}`);
  console.log(`${ETQ.padEnd(28)} · ${cuenta} íconos · ${errores.length} errores JS`);
  await p.close();
}

for (const ancho of [390, 1280]) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: 900 } });
  console.log(`\n── ${ancho}px ──`);
  await revisar(ctx, "index.html");
  await revisar(ctx, "resena.html");
  await revisar(ctx, "resena.html", async (p) => {
    // Mostrar la tarjeta de éxito, que normalmente está oculta
    await p.evaluate(() => {
      document.getElementById("card-form-resena").style.display = "none";
      document.getElementById("card-exito-resena").classList.remove("hidden");
    });
  }, "éxito");
  await revisar(ctx, "admin.html", async (p) => {
    await p.evaluate(() => {
      document.getElementById("admin-login").style.display = "none";
      document.getElementById("admin-shell").classList.remove("hidden");
      document.getElementById("vista-resenas").classList.remove("hidden");
      document.getElementById("aviso-revisar").removeAttribute("hidden");
    });
  }, "reseñas");
  await revisar(ctx, "cliente.html");
  await ctx.close();
}

await navegador.close();
console.log("\n" + (problemas.length ? "PROBLEMAS:\n" + problemas.join("\n") : "✔ sin problemas"));
