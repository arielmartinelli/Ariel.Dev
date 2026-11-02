/**
 * El panel de resultados del hero.
 *
 * Lo que se comprueba:
 *
 *   1. SE VE ENTERO. La tarjeta que lo contiene tiene `overflow: hidden`:
 *      si el panel mide más que ella, lo de abajo desaparece sin avisar. Pasó
 *      una vez, con el alto fijo de 380px que había quedado de la caja de
 *      código.
 *
 *   2. EL CARTEL DE "VISTA DEMOSTRATIVA" ESTA VISIBLE. Los números son
 *      inventados. Si alguien los toma por resultados de un cliente, el
 *      problema no es de diseño. Tiene que estar a la vista, no al pasar el
 *      mouse ni tapado por otra cosa.
 *
 *   3. LOS CONTADORES LLEGAN AL NUMERO. Arrancan en cero y suben; si la
 *      animación se corta, queda un número que no es el que corresponde.
 *
 *   4. CON "MENOS MOVIMIENTO" SE VE TODO IGUAL. Sin dibujo ni conteo, pero
 *      con los números finales y las líneas dibujadas — no en blanco.
 *
 *   5. NO HAY DESBORDE HORIZONTAL en ningún ancho.
 */
import { chromium } from "playwright";
import { CONTRASTE } from "./_contraste.mjs";

const OPC = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const ESPERADO = { Visitas: "2.847", Consultas: "46", Conversión: "1.6%", Carga: "0.9s" };

const nav = await chromium.launch(OPC);
const fallas = [];

async function mirar(ancho, { tema = "oscuro", quieto = false } = {}) {
  const ctx = await nav.newContext({
    viewport: { width: ancho, height: 950 },
    reducedMotion: quieto ? "reduce" : "no-preference",
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fallas.push(`${ancho}px: error de JS — ${String(e).slice(0, 110)}`));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<b>demo</b>" }));
  await p.route("**/rest/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  if (tema === "claro") await p.addInitScript(() => localStorage.setItem("theme", "light"));

  await p.goto(`${BASE}/`, { waitUntil: "commit" });
  await p.waitForSelector("#panel-demo .pd-kpi", { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(4200);     // 2s de pantalla de carga + la animación

  const r = await p.evaluate(() => {
    const pd = document.getElementById("panel-demo");
    if (!pd) return null;
    const caja = pd.getBoundingClientRect();
    const tarjeta = document.querySelector(".card-inner")?.getBoundingClientRect();
    const demo = pd.querySelector(".pd-demo");
    const dr = demo?.getBoundingClientRect();

    // ¿Hay algo encima del cartel de "vista demostrativa"?
    let tapado = false;
    if (dr && dr.width) {
      const x = dr.left + dr.width / 2;
      const y = dr.top + dr.height / 2;
      const arriba = document.elementFromPoint(x, y);
      tapado = !(arriba === demo || demo.contains(arriba) || arriba?.contains(demo));
    }

    return {
      alto: Math.round(caja.height),
      altoTarjeta: Math.round(tarjeta?.height || 0),
      valores: Object.fromEntries([...pd.querySelectorAll(".pd-kpi")].map((k) => [
        k.querySelector(".pd-kpi-rotulo")?.textContent.trim(),
        k.querySelector(".pd-kpi-valor")?.textContent.trim(),
      ])),
      graficos: pd.querySelectorAll(".pd-grafico").length,
      // una línea "dibujada" es la que ya no tiene el guion corrido
      lineasDibujadas: [...pd.querySelectorAll(".pd-linea")]
        .filter((l) => Math.abs(parseFloat(getComputedStyle(l).strokeDashoffset) || 0) < 1).length,
      demoVisible: Boolean(dr && dr.width > 0 && dr.height > 0),
      demoTapado: tapado,
      tabla: Boolean(pd.querySelector("table")),
      desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  const etiqueta = `${ancho}px ${tema}${quieto ? " · menos movimiento" : ""}`;
  if (!r) {
    fallas.push(`${etiqueta}: no se dibujó el panel`);
    await ctx.close();
    return;
  }

  console.log(`  ${etiqueta.padEnd(34)} panel ${String(r.alto).padStart(4)}px / tarjeta ${String(r.altoTarjeta).padStart(4)}px` +
              ` · ${r.graficos} gráficos · ${r.lineasDibujadas} líneas dibujadas · ${Object.values(r.valores).join(" ")}`);

  if (r.alto > r.altoTarjeta + 1) {
    fallas.push(`${etiqueta}: el panel mide ${r.alto}px y la tarjeta ${r.altoTarjeta}px — se corta abajo`);
  }
  if (!r.demoVisible) fallas.push(`${etiqueta}: el cartel "Vista demostrativa" no se ve`);
  if (r.demoTapado)   fallas.push(`${etiqueta}: hay algo tapando el cartel "Vista demostrativa"`);
  if (r.graficos !== 2) fallas.push(`${etiqueta}: tendría que haber 2 gráficos y hay ${r.graficos}`);
  if (r.lineasDibujadas !== 2) {
    fallas.push(`${etiqueta}: ${r.lineasDibujadas} de 2 líneas quedaron dibujadas`);
  }
  if (!r.tabla) fallas.push(`${etiqueta}: falta la tabla con los datos en texto`);
  if (r.desborde > 2) fallas.push(`${etiqueta}: desborde horizontal de ${r.desborde}px`);

  for (const [rotulo, esperado] of Object.entries(ESPERADO)) {
    if (r.valores[rotulo] !== esperado) {
      fallas.push(`${etiqueta}: "${rotulo}" quedó en ${r.valores[rotulo]} y tendría que decir ${esperado}`);
    }
  }

  for (const c of await p.evaluate(CONTRASTE)) {
    if (/pd-|panel-demo|Visitas|Consultas|Conversión|Carga|demostrativa/i.test(c)) {
      fallas.push(`${etiqueta}: contraste → ${c}`);
    }
  }

  await ctx.close();
}

console.log("panel de resultados del hero:");
await mirar(1440);
await mirar(1440, { tema: "claro" });
await mirar(1024);
await mirar(390);
await mirar(1440, { quieto: true });

await nav.close();
console.log("\n" + (fallas.length
  ? "FALLAS:\n- " + fallas.join("\n- ")
  : "✔ el panel entra entero, dice que es una demo y los números llegan"));
