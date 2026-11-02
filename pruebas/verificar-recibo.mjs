/* Prueba del comprobante de punta a punta: que el boton aparezca solo cuando
   corresponde, que el PDF se genere de verdad (no que "no tire error") y que
   el contenido diga lo que tiene que decir. */
import { chromium } from "playwright";

/* En un entorno con Chromium ya instalado aparte, se le pasa la ruta con
   CHROMIUM=/ruta/al/binario. Sin eso usa el que bajo `npx playwright
   install`, que es el caso normal en tu maquina. */
const OPCIONES = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:4178";
const SALIDA = process.env.SALIDA || join(tmpdir(), "arieldev-recibos");
mkdirSync(SALIDA, { recursive: true });

const base = {
  ok: true, client_name: "Lucía Fernández", project_name: "Pastelería Dulce Hogar",
  status: "finalizado", progreso: 100, demo_url: "https://demo.vercel.app",
  production_url: "https://dulcehogar.com.ar",
  price_usd: 420, domain_extra_usd: 10, total_usd: 430, payment_plan: "mitades",
  domain_choice: "propio", domain_name: "dulcehogar.com.ar",
  project_brief: "Catálogo y pedidos por WhatsApp.",
  tareas: [], created_at: "2026-06-01T12:00:00Z", client_decision: "acepta",
  // Desde la migración 15 los comprobantes viven en la pestaña Pagos.
  secciones: { tareas: true, pagos: true, dominio: true, produccion: true },
  proposal_url: null, proposal_es_pdf: false, budget_es_pdf: false, brief_es_pdf: false,
  pagos: [
    { kind: "anticipo", amount_usd: 215, amount_ars: 290250, status: "pagado",
      paid_at: "2026-06-10T14:30:00Z", method: "transferencia",
      nro_recibo: 12, recibo_fecha: "2026-06-10T14:30:00Z" },
    { kind: "saldo", amount_usd: 215, amount_ars: null, status: "pagado",
      paid_at: "2026-08-02T10:05:00Z", method: "mercadopago",
      nro_recibo: 18, recibo_fecha: "2026-08-02T10:05:00Z" },
  ],
};

const CASOS = [
  ["dos pagos acreditados",      base, 2],
  ["saldo todavia pendiente",    { ...base, status: "saldo_pendiente", progreso: 92,
                                   pagos: [base.pagos[0], { ...base.pagos[1], status: "pendiente", nro_recibo: null, paid_at: null }] }, 1],
  ["pago viejo sin numerar",     { ...base, pagos: [{ ...base.pagos[0], nro_recibo: null }, base.pagos[1]] }, 1],
  ["nada cobrado todavia",       { ...base, status: "anticipo_pendiente", progreso: 45,
                                   pagos: [{ ...base.pagos[0], status: "pendiente", nro_recibo: null, paid_at: null }] }, 0],
];

const nav = await chromium.launch(OPCIONES);
const fallas = [];

for (const [nombre, datos, esperados] of CASOS) {
  const ctx = await nav.newContext({ viewport: { width: Number(process.env.ANCHO || 1280), height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fallas.push(`${nombre}: pageerror ${e}`));
  await p.route("**/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await p.route("**/rest/v1/rpc/portal_obtener*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(datos) }));
  await p.goto(`${BASE}/cliente.html?t=${"a".repeat(40)}#pagos`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);

  const botones = p.locator('[data-accion="bajar-recibo"]');
  const n = await botones.count();
  if (n !== esperados) fallas.push(`${nombre}: ${n} botones de recibo, se esperaban ${esperados}`);
  console.log(`${nombre.padEnd(26)} · ${n} boton(es)`);

  if (n > 0) {
    // Texto del boton
    const txt = (await botones.first().innerText()).replace(/\s+/g, " ");
    console.log(`  ${"".padEnd(24)}   «${txt}»`);
    if (!/R-\d{4}-\d{4}/.test(txt)) fallas.push(`${nombre}: el boton no muestra el numero de recibo → «${txt}»`);

    // ¿El PDF se genera de verdad?
    // Como un cliente real: baja hasta el botón antes de tocarlo. El PDF en
    // blanco dependía justamente de dónde estaba la página al generarlo.
    await botones.first().scrollIntoViewIfNeeded();
    await p.mouse.wheel(0, 400);
    const esperaDescarga = p.waitForEvent("download", { timeout: 25000 });
    await botones.first().click();
    try {
      const d = await esperaDescarga;
      const ruta = `${SALIDA}/${nombre.replace(/\s+/g, "_")}.pdf`;
      await d.saveAs(ruta);
      const bytes = statSync(ruta).size;
      console.log(`  ${"".padEnd(24)}   archivo: ${d.suggestedFilename()} (${Math.round(bytes / 1024)} kB)`);
      if (bytes < 8000) fallas.push(`${nombre}: el PDF salio de ${bytes} bytes — probablemente vacio`);

      // EL TAMAÑO NO ALCANZA. Un recibo en blanco pesaba 22 kB y pasaba este
      // control: así se escapó el bug del PDF vacío. Si hay pdftoppm
      // (poppler), se dibuja la página y se cuenta cuánta tinta tiene.
      try {
        // PGM en escala de grises: "P5\n<ancho> <alto>\n255\n" + un byte por píxel.
        const pgm = execFileSync("pdftoppm", ["-r", "30", "-gray", "-singlefile", ruta]);
        const cab = pgm.toString("latin1", 0, 40).match(/^P5\s+(\d+)\s+(\d+)\s+\d+\s/);
        const pixeles = cab ? pgm.subarray(cab[0].length) : pgm;
        let tinta = 0;
        for (const b of pixeles) if (b < 160) tinta++;
        console.log(`  ${"".padEnd(24)}   tinta: ${tinta} píxeles oscuros`);
        if (tinta < 200) fallas.push(`${nombre}: el PDF se descargó pero está EN BLANCO`);
      } catch {
        console.log(`  ${"".padEnd(24)}   (sin pdftoppm: no se pudo mirar el contenido, solo el tamaño)`);
      }
      if (!/^R-\d{4}-\d{4}-/.test(d.suggestedFilename())) fallas.push(`${nombre}: nombre de archivo raro → ${d.suggestedFilename()}`);
    } catch (e) {
      fallas.push(`${nombre}: no se descargo ningun archivo (${e.message.split("\n")[0]})`);
    }
  }
  await ctx.close();
}

await nav.close();
console.log("\n" + (fallas.length ? "FALLAS:\n" + fallas.join("\n") : "✔ comprobantes OK"));
console.log("PDFs en:", SALIDA, readdirSync(SALIDA));
