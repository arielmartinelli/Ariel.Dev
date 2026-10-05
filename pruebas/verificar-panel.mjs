/* Enciende el panel con una sesion y datos falsos. No prueba la logica de
   negocio: prueba que las pantallas DIBUJEN sin romperse, que es lo que se
   arriesga al tocar los iconos de cinco archivos a la vez. */
import { chromium } from "playwright";
import { CONTRASTE } from "./_contraste.mjs";

const OPCIONES = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";
const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const ahora = new Date().toISOString();
const CLIENTES = [{
  id: "11111111-1111-1111-1111-111111111111",
  client_name: "Lucía Fernández", project_name: "Pastelería Dulce Hogar",
  access_token: "a".repeat(40), status: "en_produccion", is_active: true,
  price_usd: 420, domain_extra_usd: 10, domain_choice: "propio", domain_name: "dulcehogar.com.ar",
  whatsapp: "5493510000000", demo_url: "https://demo.vercel.app", production_url: null,
  project_brief: "Catálogo.", proposal_url: null, proposal_filename: null,
  budget_pdf_url: null, budget_pdf_filename: null, brief_pdf_url: null, brief_pdf_filename: null,
  payment_plan: "mitades", client_decision: "acepta", admin_notes: "",
  progreso: 60, tareas_total: 2, tareas_hechas: 1, cobrado_usd: 215, pendiente_usd: 215,
  comprobantes_a_revisar: 1, last_seen_at: ahora, view_count: 240, orden: 1,
  created_at: ahora, updated_at: ahora,
}];
const TAREAS = [
  { id: 1, client_id: CLIENTES[0].id, title: "Cargar productos", done: true, is_done: true, source: "ariel", pdf_name: "catalogo.pdf", pdf_data: "x", created_at: ahora, position: 1 },
  { id: 2, client_id: CLIENTES[0].id, title: "Cambiar el color", done: false, is_done: false, source: "cliente", created_at: ahora, position: 2 },
];
const PAGOS = [
  { id: "p1", client_id: CLIENTES[0].id, kind: "anticipo", amount_usd: 215, status: "pagado", method: "transferencia", paid_at: ahora, created_at: ahora, receipt_number: 12 },
  { id: "p2", client_id: CLIENTES[0].id, kind: "saldo", amount_usd: 215, status: "en_revision", method: "transferencia", created_at: ahora },
];
const RESENAS = [{ id: "r1", client_name: "Juan", project_name: "Kiosco", rating: 4, comment: "Muy bueno.", is_published: true, company_url: null, created_at: ahora }];
const PROYECTOS = [{ id: "pr1", title: "Dulce Hogar", description: "Sitio", tags: "React,CSS", image_url: null, project_url: null, category: "landing", position: 1, created_at: ahora }];

const SESION = {
  access_token: "falso", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "falso",
  user: { id: "u1", aud: "authenticated", role: "authenticated", email: "ariel@test.com",
          app_metadata: {}, user_metadata: {}, created_at: ahora },
};

const nav = await chromium.launch(OPCIONES);
const fallas = [];

for (const ancho of [390, 1280]) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 1000 } });
  // supabase-js levanta la sesion de localStorage al arrancar. La clave es la
  // que configura js/supabase.js (storageKey: "arieldev-auth"): con cualquier
  // otra, el cliente arranca sin sesion y el panel se queda en el login.
  await ctx.addInitScript((s) => {
    localStorage.setItem("arieldev-auth", JSON.stringify(s));
  }, SESION);

  const p = await ctx.newPage();
  p.on("pageerror", (e) => fallas.push(`@${ancho}: pageerror ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) fallas.push(`@${ancho}: console ${m.text().slice(0, 120)}`); });

  const tabla = (url) =>
    /v_clientes_panel|\/clients/.test(url) ? CLIENTES :
    /client_tasks/.test(url) ? TAREAS :
    /payments/.test(url) ? PAGOS :
    /reviews/.test(url) ? RESENAS :
    /projects/.test(url) ? PROYECTOS : [];

  await ctx.route("**/auth/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...SESION, data: { session: SESION, user: SESION.user } }) }));
  await ctx.route("**/rest/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tabla(r.request().url())) }));

  await p.goto(`${BASE}/admin.html`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);

  // Si la sesion no prendio, el test no prueba nada: hay que saberlo.
  const entro = await p.evaluate(() => !document.getElementById("admin-shell").classList.contains("hidden"));
  if (!entro) { fallas.push(`@${ancho}: el panel no abrio (sesion falsa rechazada) — este test no verifico nada`); await ctx.close(); continue; }

  for (const vista of ["resumen", "clientes", "portfolio", "resenas"]) {
    await p.evaluate((v) => {
      document.querySelectorAll(".admin-vista").forEach((s) => s.classList.add("hidden"));
      document.getElementById("vista-" + v)?.classList.remove("hidden");
    }, vista);
    // Abrir la ficha del cliente, que es donde viven la mayoria de los iconos
    if (vista === "clientes") {
      const fila = p.locator("#lista-clientes [data-id], #lista-clientes .admin-cliente").first();
      if (await fila.count()) { await fila.click().catch(() => {}); await p.waitForTimeout(500); }
    }
    await p.waitForTimeout(300);

    const r = await p.evaluate(() => {
      const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
      const emojis = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue.trim();
        if (t && EMO.test(t) && n.parentElement?.getClientRects().length) emojis.push(t.slice(0, 40));
      }
      const apilados = [];
      for (const svg of document.querySelectorAll("svg.pico")) {
        const pa = svg.parentElement;
        if (!pa || !pa.getClientRects().length) continue;
        const rs = svg.getBoundingClientRect();
        if (rs.width < 8) { apilados.push(`sin tamaño: ${pa.className}`); continue; }
        const nodo = [...pa.childNodes].find((x) => x.nodeType === 3 && x.nodeValue.trim());
        if (!nodo) continue;
        const ra = document.createRange(); ra.selectNodeContents(nodo);
        const rt = ra.getBoundingClientRect();
        if (!rt.height) continue;
        if (Math.min(rs.bottom, rt.bottom) - Math.max(rs.top, rt.top) < Math.min(rs.height, rt.height) * 0.4)
          apilados.push(`apilado: ${pa.className} · ${nodo.nodeValue.trim().slice(0, 28)}`);
      }
      return { emojis, apilados, iconos: document.querySelectorAll("svg.pico").length,
               desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });

    for (const c of await p.evaluate(CONTRASTE))
      fallas.push(`${vista} @${ancho}: contraste → ${c}`);
    for (const e of r.emojis)   fallas.push(`${vista} @${ancho}: emoji visible → ${e}`);
    for (const a of r.apilados) fallas.push(`${vista} @${ancho}: ${a}`);
    if (r.desborde > 2)         fallas.push(`${vista} @${ancho}: desborde ${r.desborde}px`);
    console.log(`  ${vista.padEnd(12)} @${ancho} · ${r.iconos} íconos`);
  }
  await ctx.close();
}

await nav.close();
console.log("\n" + (fallas.length ? "FALLAS:\n" + [...new Set(fallas)].join("\n") : "✔ el panel dibuja bien y sin emojis"));
