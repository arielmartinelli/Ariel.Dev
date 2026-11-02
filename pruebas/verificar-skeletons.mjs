/**
 * Lo unico que importa de un skeleton: que mida lo mismo que el contenido.
 *
 * Si mide distinto, la pagina brinca cuando llegan los datos y lo que la
 * persona estaba por tocar se corre de lugar. Por eso esta prueba no mira
 * como se ve: compara el ALTO del esqueleto contra el alto de la tarjeta
 * real, y mide el CLS (Cumulative Layout Shift) de punta a punta.
 *
 * El limite de CLS "bueno" de Google es 0.1. Acá se exige 0.05.
 *
 * POR QUE 0.05 Y NO 0.02.
 * Con los esqueletos puestos, el CLS que queda NO lo causan ellos: lo causa
 * la tipografia web. El <h1> "Todos los proyectos" se dibuja primero con la
 * fuente de respaldo (dos renglones) y cuando llega Outfit pasa a uno solo;
 * eso corre 45px todo lo que tiene debajo. Comprobado bloqueando las fuentes:
 *
 *     con tipografia web      CLS 0.0322   el h1 mide 90px y pasa a 45px
 *     tipografia bloqueada    CLS 0.0023   el h1 mide 90px siempre
 *
 * O sea: la parte que le toca a los esqueletos es 0.0023. El resto es un
 * problema aparte (se arregla con &display=optional en el link de Google
 * Fonts, o con un @font-face de respaldo con size-adjust afinado) y no tiene
 * que ver con esta prueba.
 */
import { chromium } from "playwright";
const OPC = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const CATS=[{id:"landing",label:"Landing Page"},{id:"ecommerce",label:"E-Commerce"},
            {id:"portfolio",label:"Portfolio"},{id:"custom",label:"Custom App"}];
const IMGS=["/images/aura-store.webp","/images/apex-landing.webp","/images/lens-light.webp","/images/taskflow.webp"];
const PROY=Array.from({length:9},(_,i)=>({id:`p${i}`,title:`Proyecto ${i+1}`,
  description:"Tienda online con carrito, medios de pago integrados y panel propio para cargar productos.",
  category:CATS[i%4].id,image:IMGS[i%4],tags:["HTML","CSS","JS"],
  demo_url:`https://sitio${i}.com.ar`,position:i,is_featured:i===0,
  created_at:"2026-01-01T00:00:00Z"}));

const nav = await chromium.launch(OPC);
const fallas = [];

async function medir(ancho, ruta, selector, { retardo = 700 } = {}) {
  const ctx = await nav.newContext({ viewport:{ width:ancho, height:1000 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type:"layout-shift", buffered:true });
  });
  await p.route("**/rest/v1/**", async (r) => {
    await new Promise(s => setTimeout(s, retardo));   // red lenta a proposito
    const u = r.request().url();
    r.fulfill({ status:200, contentType:"application/json",
      body: JSON.stringify(/categories/.test(u) ? CATS : /reviews/.test(u) ? [] : PROY) });
  });
  await p.route(/dolarapi|bluelytics/, (r) =>
    r.fulfill({ status:200, contentType:"application/json", body:'{"venta":1550}' }));

  await p.goto(`${BASE}${ruta}`, { waitUntil:"commit" });

  // Medir el fantasma ANTES de que lleguen los datos
  await p.waitForSelector(`${selector}[data-esqueleto]`, { timeout:10000 }).catch(()=>{});
  await p.waitForTimeout(250);
  const fantasma = await p.evaluate((sel) => {
    const e = document.querySelector(`${sel}[data-esqueleto]`);
    return e ? Math.round(e.getBoundingClientRect().height) : null;
  }, selector);

  // Y ahora el real
  await p.waitForFunction((sel) =>
    document.querySelector(`${sel}:not([data-esqueleto])`), selector, { timeout:15000 }).catch(()=>{});
  await p.waitForTimeout(1800);
  const r = await p.evaluate((sel) => {
    const e = document.querySelector(`${sel}:not([data-esqueleto])`);
    return { real: e ? Math.round(e.getBoundingClientRect().height) : null,
             cls: Number((window.__cls||0).toFixed(4)),
             quedanFantasmas: document.querySelectorAll("[data-esqueleto]").length };
  }, selector);

  await ctx.close();
  return { fantasma, ...r };
}

const CASOS = [
  [1280, "/proyectos.html", ".pcard", "tarjeta de /proyectos"],
  [ 390, "/proyectos.html", ".pcard", "tarjeta de /proyectos (celular)"],
  [1280, "/index.html",     ".stage-card", "tarjeta del landing"],
  [ 390, "/index.html",     ".stage-card", "tarjeta del landing (celular)"],
];

console.log("pantalla                           fantasma    real   diferencia    CLS");
for (const [w, ruta, sel, nombre] of CASOS) {
  const m = await medir(w, ruta, sel);
  const dif = (m.fantasma !== null && m.real !== null) ? Math.abs(m.fantasma - m.real) : null;
  console.log(`${nombre.padEnd(34)} ${String(m.fantasma ?? "—").padStart(6)}px ${String(m.real ?? "—").padStart(6)}px`
    + `${(dif === null ? "—" : dif + "px").padStart(11)}  ${String(m.cls).padStart(7)}`);

  if (m.fantasma === null) fallas.push(`${nombre}: no se dibujó ningún esqueleto`);
  if (m.real === null)     fallas.push(`${nombre}: no llegó a dibujarse el contenido real`);
  if (dif !== null && dif > 24)
    fallas.push(`${nombre}: el esqueleto mide ${dif}px distinto al contenido — la página brinca`);
  if (m.cls > 0.05)
    fallas.push(`${nombre}: CLS ${m.cls} (se pide ≤ 0.05)`);
  if (m.quedanFantasmas > 0)
    fallas.push(`${nombre}: quedaron ${m.quedanFantasmas} esqueletos después de cargar`);
}

await nav.close();
console.log("\n" + (fallas.length ? "FALLAS:\n- " + fallas.join("\n- ")
                                  : "✔ los esqueletos miden lo mismo que el contenido y nada brinca"));
