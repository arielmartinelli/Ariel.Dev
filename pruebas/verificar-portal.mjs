/* Recorre el portal del cliente etapa por etapa. Cada etapa dibuja una
   tarjeta distinta, así que una sola pasada no alcanza para decir que no
   quedó ningún emoji ni ningún ícono apilado. */
import { chromium } from "playwright";
import { CONTRASTE } from "./_contraste.mjs";

/* En un entorno con Chromium ya instalado aparte, se le pasa la ruta con
   CHROMIUM=/ruta/al/binario. Sin eso usa el que bajo `npx playwright
   install`, que es el caso normal en tu maquina. */
const OPCIONES = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const EMO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const base = {
  ok: true, nombre: "Lucía", proyecto: "Pastelería Dulce Hogar",
  demo_url: "https://demo.vercel.app", price_usd: 420, domain_extra_usd: 10,
  proposal_url: null, proposal_es_pdf: false,
  budget_pdf_url: null, budget_es_pdf: true,
  descripcion: "Sitio con catálogo y pedidos por WhatsApp.",
  domain_choice: "ninguno", domain_name: null, payment_plan: null,
  tareas: [
    { id: 1, titulo: "Cargar los productos", done: true,  source: "ariel", pdf_name: "catalogo.pdf", tiene_pdf: true },
    { id: 2, titulo: "Formulario de contacto", done: false, source: "cliente" },
  ],
  pagos: [], cambios: [], wa: "543516121498",
  anticipo_pagado: false, saldo_pagado: false, hay_pago_pendiente: false,
  last_seen_at: null, view_count: 3,
};

const ETAPAS = [
  ["demo_pendiente",    { status: "demo_pendiente", progreso: 10, demo_url: null }],
  ["demo_lista",        { status: "demo_lista", progreso: 30 }],
  ["anticipo mitades",  { status: "anticipo_pendiente", progreso: 45, payment_plan: "mitades",
                          pagos: [{ id: 9, kind: "anticipo", amount_usd: 210, status: "pendiente" }] }],
  ["anticipo cuotas3",  { status: "anticipo_pendiente", progreso: 45, payment_plan: "cuotas3",
                          pagos: [{ id: 9, kind: "total", amount_usd: 430, status: "pendiente" }] }],
  ["en_produccion",     { status: "en_produccion", progreso: 60, anticipo_pagado: true,
                          pagos: [{ id: 9, kind: "anticipo", amount_usd: 210, status: "pagado" }],
                          cambios: [{ id: 3, texto: "Cambiar el color del botón", done: false },
                                    { id: 4, texto: "Sumar el logo nuevo", done: true }] }],
  ["dominio",           { status: "dominio", progreso: 75, anticipo_pagado: true }],
  ["publicando",           { status: "publicando", progreso: 85, anticipo_pagado: true,
                          domain_choice: "propio", domain_name: "dulcehogar.com.ar" }],
  ["saldo_pendiente",   { status: "saldo_pendiente", progreso: 92, anticipo_pagado: true,
                          domain_choice: "propio", domain_name: "dulcehogar.com.ar",
                          pagos: [{ id: 9, kind: "anticipo", amount_usd: 210, status: "pagado" },
                                  { id: 10, kind: "saldo", amount_usd: 220, status: "pendiente" }] }],
  ["finalizado",        { status: "finalizado", progreso: 100, anticipo_pagado: true, saldo_pagado: true,
                          domain_choice: "propio", domain_name: "dulcehogar.com.ar",
                          pagos: [{ id: 9, kind: "anticipo", amount_usd: 210, status: "pagado" },
                                  { id: 10, kind: "saldo", amount_usd: 220, status: "pagado" }] }],
  ["rechazado",         { status: "rechazado", progreso: 10 }],
];

const nav = await chromium.launch(OPCIONES);
const problemas = [];

for (const ancho of [390, 1280]) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 1000 } });
  console.log(`\n── ${ancho}px ──`);
  for (const [nombre, parche] of ETAPAS) {
    const datos = { ...base, ...parche };
    const p = await ctx.newPage();
    p.on("pageerror", (e) => problemas.push(`${nombre} @${ancho}: pageerror ${e}`));
    /* El catch-all va PRIMERO a proposito: en Playwright gana la ULTIMA
       ruta registrada, asi que al final se tragaba la RPC y el portal
       recibia [] en vez de los datos de la etapa. */
    await p.route("**/rest/v1/**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await p.route("**/rest/v1/rpc/portal_obtener*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(datos) }));
    await p.goto(`${BASE}/cliente.html?t=${"a".repeat(40)}`, { waitUntil: "networkidle" });
    await p.waitForTimeout 
      ? await p.waitForTimeout(400) : null;

    const r = await p.evaluate(() => {
      const malos = { emojis: [], apilados: [], chicos: [] };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const EMO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue.trim();
        if (!t || !EMO.test(t)) continue;
        const el = n.parentElement;
        if (!el || !el.getClientRects().length) continue;
        malos.emojis.push(`${t.slice(0, 40)} (${el.className || el.tagName})`);
      }
      for (const svg of document.querySelectorAll("svg.pico")) {
        const padre = svg.parentElement;
        if (!padre || !padre.getClientRects().length) continue;
        const rs = svg.getBoundingClientRect();
        if (rs.width < 8 || rs.height < 8) { malos.chicos.push(`${padre.className} ${Math.round(rs.width)}x${Math.round(rs.height)}`); continue; }
        const nodo = Array.from(padre.childNodes).find((n) => n.nodeType === 3 && n.nodeValue.trim());
        if (!nodo) continue;
        const rango = document.createRange(); rango.selectNodeContents(nodo);
        const rt = rango.getBoundingClientRect();
        if (!rt.height) continue;
        const solapa = Math.min(rs.bottom, rt.bottom) - Math.max(rs.top, rt.top);
        if (solapa < Math.min(rs.height, rt.height) * 0.4)
          malos.apilados.push(`${padre.className} · ${nodo.nodeValue.trim().slice(0, 32)}`);
      }
      return { ...malos,
        iconos: document.querySelectorAll("svg.pico").length,
        desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        etapaVisible: (document.getElementById("pc-etapa")?.textContent || "").trim().slice(0, 42) };
    });

    for (const c of await p.evaluate(CONTRASTE))
      problemas.push(`${nombre} @${ancho}: contraste → ${c}`);
    for (const e of r.emojis)   problemas.push(`${nombre} @${ancho}: emoji → ${e}`);
    for (const a of r.apilados) problemas.push(`${nombre} @${ancho}: ícono apilado → ${a}`);
    for (const c of r.chicos)   problemas.push(`${nombre} @${ancho}: ícono sin tamaño → ${c}`);
    if (r.desborde > 2)         problemas.push(`${nombre} @${ancho}: desborde ${r.desborde}px`);
    console.log(`  ${nombre.padEnd(22)} ${String(r.iconos).padStart(3)} íconos · ${r.etapaVisible}`);
    await p.close();
  }
  await ctx.close();
}
await nav.close();
console.log("\n" + (problemas.length ? "PROBLEMAS:\n" + problemas.join("\n") : "✔ ninguna etapa con emojis, íconos apilados ni desborde"));
