/**
 * Cuanto tarda la pantalla de carga en irse, y por que.
 *
 * El reloj lo lleva la PAGINA con performance.now(), que cuenta desde el
 * inicio de la navegacion. Medir desde Node mezcla el arranque del navegador
 * y da numeros que no significan nada (mas latencia = "mas rapido"). Me paso
 * la primera vez que escribi esta prueba.
 */
import { chromium } from "playwright";
const OPC = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const CATS=[{id:"landing",label:"Landing"},{id:"ecommerce",label:"E-Commerce"},
            {id:"portfolio",label:"Portfolio"},{id:"custom",label:"Custom"}];
const PROY=Array.from({length:5},(_,i)=>({id:`p${i}`,title:`P${i+1}`,description:"x",
  category:CATS[i%4].id,image:"",tags:["A"],demo_url:"https://e.com",position:i,
  created_at:"2026-01-01T00:00:00Z"}));

const ESCENARIOS = [
  ["Supabase instantaneo",         0, false, 1280],
  ["Supabase a 600 ms",          600, false, 1280],
  ["Supabase a 1500 ms (3G)",   1500, false, 1280],
  ["Supabase a 1500 ms, celular",1500, false, 390],
  ["Supabase CAIDO",              -1, false, 1280],
  ["Con «menos movimiento»",       0, true,  1280],
];

const nav = await chromium.launch(OPC);
const filas = [];
for (const [nombre, retardo, reduce, ancho] of ESCENARIOS) {
  const ctx = await nav.newContext({ viewport:{width:ancho,height:900},
    reducedMotion: reduce ? "reduce" : "no-preference", hasTouch: ancho<768 });
  const p = await ctx.newPage();
  await p.route("**/rest/v1/**", async (r)=>{
    if (retardo<0) return;
    if (retardo) await new Promise(s=>setTimeout(s,retardo));
    const u=r.request().url();
    r.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify(/categories/.test(u)?CATS:/reviews/.test(u)?[]:PROY)});
  });
  await p.route(/dolarapi|bluelytics/, async (r)=>{
    if (retardo<0) return;
    if (retardo) await new Promise(s=>setTimeout(s,retardo));
    r.fulfill({status:200,contentType:"application/json",body:'{"venta":1550}'});
  });

  await p.goto(`${BASE}/index.html`, { waitUntil:"commit" });
  const r = await p.evaluate(async () => {
    const hasta = performance.now() + 11000;
    let cierre=null, completo=null;
    while (performance.now() < hasta) {
      if (document.getElementById("loader-typewriter")?.textContent === "Ariel.Dev" && completo===null)
        completo = Math.round(performance.now());
      if (document.getElementById("page-loader")?.classList.contains("hidden-loader")) {
        cierre = Math.round(performance.now()); break;
      }
      await new Promise(s => requestAnimationFrame(s));
    }
    const fcp = performance.getEntriesByType("paint").find(x=>x.name==="first-contentful-paint");
    return { cierre, completo, fcp: fcp?Math.round(fcp.startTime):null };
  });
  filas.push([nombre, r]);
  await ctx.close();
}
await nav.close();

console.log("escenario                        se va a   nombre completo   pintado   espera de mas");
for (const [n,r] of filas) {
  const espera = (r.cierre!==null && r.fcp!==null) ? r.cierre - r.fcp : null;
  console.log(n.padEnd(30)
    + (r.cierre===null?"NUNCA":r.cierre+" ms").padStart(9)
    + ((r.completo??"-")+" ms").padStart(18)
    + ((r.fcp??"-")+" ms").padStart(10)
    + (espera===null?"-":espera+" ms").padStart(15));
}
const malos = filas.filter(([,r])=>r.cierre===null);
console.log("\n" + (malos.length ? "FALLA: el loader no se fue nunca en: " + malos.map(([n])=>n).join(", ")
                                 : "✔ la pantalla de carga siempre se va"));
