/**
 * Lo unico que importa de un skeleton: que mida lo mismo que el contenido.
 *
 * Si mide distinto, la pagina brinca cuando llegan los datos y lo que la
 * persona estaba por tocar se corre de lugar. Por eso esta prueba no mira
 * como se ve: compara el ALTO del esqueleto contra el alto de la tarjeta
 * real, y mide el CLS (Cumulative Layout Shift) de punta a punta.
 *
 * El limite de CLS "bueno" de Google es 0.1. Aca se exige 0.05.
 *
 * LA VUELTA DE CALENTAMIENTO, Y POR QUE ESTA
 * ------------------------------------------
 * Cada caso carga la pagina DOS veces y mide la segunda. No es para maquillar
 * el numero: es porque la primera carga de un proceso nuevo mide el entorno y
 * no la pagina. Con la cache fria, los archivos tardan distinto cada vez y el
 * CLS saltaba a 0,30 en la primera corrida despues de compilar, para dar
 * 0,009 en las dos siguientes, sin que cambiara una linea.
 *
 * Lo comprobe antes de poner esto: el mismo caso, solo, da 0,0007.
 *
 * Y de paso: durante un tiempo esta prueba dijo que el CLS que quedaba era
 * culpa de la tipografia web. ERA FALSO. Medido de nuevo, con la tipografia
 * bloqueada y con la tipografia tardando 1,8 segundos, el CLS no se mueve
 * (0,0011 en los dos casos) y el <h1> mide lo mismo. La explicacion anterior
 * estaba escrita acá y no era cierta.
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

/* 1400 ms y no 700: es el margen para medir el esqueleto antes de que
   lleguen los datos. Con 700 la medicion caia a veces justo despues del
   repintado y la prueba decia "no se dibujo ningun esqueleto" sin que
   hubiera nada roto. */
async function medir(ancho, ruta, selector, { retardo = 1400 } = {}) {
  const ctx = await nav.newContext({ viewport:{ width:ancho, height:1000 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__cls = 0;
    /* Se guarda tambien QUIEN se movio. Cuando esto falla, el numero solo no
       sirve: lo que hace falta es el nombre del elemento que empujo. */
    window.__culpables = [];
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        if (e.value > 0.01) {
          window.__culpables.push(
            `${Math.round(e.startTime)}ms ${e.value.toFixed(3)} -> ` +
            (e.sources || []).map((s) => {
              const n = s.node;
              return ((n?.id || n?.className || n?.tagName || "?") + "").slice(0, 36);
            }).join(" . ")
          );
        }
      }
    }).observe({ type:"layout-shift", buffered:true });
  });
  await p.route("**/rest/v1/**", async (r) => {
    await new Promise(s => setTimeout(s, retardo));   // red lenta a proposito
    const u = r.request().url();
    r.fulfill({ status:200, contentType:"application/json",
      body: JSON.stringify(/categories/.test(u) ? CATS : /reviews/.test(u) ? [] : PROY) });
  });
  await p.route(/dolarapi|bluelytics/, (r) =>
    r.fulfill({ status:200, contentType:"application/json", body:'{"venta":1550}' }));

  /* Vuelta de calentamiento: se carga, se descarta y se vuelve a empezar.
     Lo que se mide es la segunda. Ver el comentario de arriba. */
  await p.goto(`${BASE}${ruta}`, { waitUntil:"load" }).catch(() => {});
  await p.waitForTimeout(400);
  /* Y se borra lo que la vuelta de calentamiento dejó guardado. Sin esto, la
     segunda carga lee los proyectos del localStorage y los pinta de una: el
     esqueleto no llega a existir y la prueba no tiene qué medir. */
  await p.evaluate(() => {
    window.__cls = 0;
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* bloqueado */ }
  }).catch(() => {});

  await p.goto(`${BASE}${ruta}`, { waitUntil:"commit" });

  // Medir el fantasma ANTES de que lleguen los datos
  await p.waitForSelector(`${selector}[data-esqueleto]`, { timeout:10000 }).catch(()=>{});
  await p.waitForTimeout(150);
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
             culpables: window.__culpables || [],
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
  if (m.cls > 0.05) {
    fallas.push(`${nombre}: CLS ${m.cls} (se pide <= 0.05)` +
      (m.culpables?.length ? "\n    lo movio: " + m.culpables.join("\n    lo movio: ") : ""));
  }
  if (m.quedanFantasmas > 0)
    fallas.push(`${nombre}: quedaron ${m.quedanFantasmas} esqueletos después de cargar`);
}


/* --------------------------------------------------------------------------
   El portal del cliente
   --------------------------------------------------------------------------
   Acá no alcanza con comparar un alto total: el panel de la pestaña abierta
   depende de los datos (cuántas tareas, cuántos pagos) y el esqueleto no
   puede saberlo antes de que lleguen. Lo que SÍ tiene que coincidir es todo
   lo que está ARRIBA del panel, porque si eso mide distinto se corre la
   página entera. El panel es el último bloque: si se estira, abajo solo
   tiene el pie.

   Por eso se miden tres bloques por separado en vez del total.
   -------------------------------------------------------------------------- */
const PORTAL = {
  ok:true, client_name:"Lucía", project_name:"Pastelería Dulce Hogar",
  status:"en_produccion", progreso:60, demo_url:"https://demo.vercel.app",
  price_usd:420, total_usd:430, domain_extra_usd:10, plan_fijado:true,
  proposal_url:null, proposal_es_pdf:false, budget_pdf_url:null, budget_es_pdf:true,
  project_brief:"Sitio con catálogo y pedidos por WhatsApp.", secciones:{},
  domain_choice:"ninguno", domain_name:null, production_url:null, payment_plan:"mitades",
  tareas:[{id:1,titulo:"Cargar los productos",done:true,source:"ariel"},
          {id:2,titulo:"Formulario de contacto",done:false,source:"cliente"}],
  pagos:[{id:9,kind:"anticipo",amount_usd:210,status:"pagado"}],
  cambios:[], metodos_pago:[], wa:"543516121498",
  anticipo_pagado:true, saldo_pagado:false, hay_pago_pendiente:false,
  last_seen_at:null, view_count:3,
};

/* Los bloques del portal que el esqueleto tiene que clavar, y cuánto se le
   tolera a cada uno. El panel va con tolerancia abierta a propósito: se
   mide para que quede a la vista, no para que falle. */
const BLOQUES = [
  [".portal-hero",         "el saludo y el avance",  4],
  [".portal-avance-card",  "el anillo de avance",    2],
  [".portal-nav",          "la barra de pestañas",   4],
  [".portal-panel",        "el panel (informativo)", Infinity],
];

async function medirPortal(ancho) {
  const ctx = await nav.newContext({ viewport:{ width:ancho, height:1000 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__cls = 0;
    /* Se guarda tambien QUIEN se movio. Cuando esto falla, el numero solo no
       sirve: lo que hace falta es el nombre del elemento que empujo. */
    window.__culpables = [];
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        if (e.value > 0.01) {
          window.__culpables.push(
            `${Math.round(e.startTime)}ms ${e.value.toFixed(3)} -> ` +
            (e.sources || []).map((s) => {
              const n = s.node;
              return ((n?.id || n?.className || n?.tagName || "?") + "").slice(0, 36);
            }).join(" . ")
          );
        }
      }
    }).observe({ type:"layout-shift", buffered:true });
  });
  // El catch-all va PRIMERO: en Playwright gana la ULTIMA ruta registrada.
  await p.route("**/rest/v1/**", (r) =>
    r.fulfill({ status:200, contentType:"application/json", body:"[]" }));
  await p.route("**/rest/v1/rpc/portal_obtener*", async (r) => {
    await new Promise(s => setTimeout(s, 900));
    r.fulfill({ status:200, contentType:"application/json", body:JSON.stringify(PORTAL) });
  });

  await p.goto(`${BASE}/cliente.html?t=${"a".repeat(40)}`, { waitUntil:"commit" });
  await p.waitForSelector("#portal-cargando .portal-dash", { timeout:10000 }).catch(()=>{});
  await p.waitForTimeout(250);
  /* Ojo: esta función se ejecuta DENTRO del navegador, así que no puede
     cerrar sobre variables de acá. Todo lo que necesita va en un argumento. */
  const altos = ({ raiz, sels }) => sels.map((s) => {
    const e = document.querySelector(`${raiz} ${s}`);
    return e ? Math.round(e.getBoundingClientRect().height) : null;
  });
  const sels = BLOQUES.map(([s]) => s);
  const fantasma = await p.evaluate(altos, { raiz:"#portal-cargando", sels });

  await p.waitForFunction(() =>
    !document.querySelector("#portal-contenido")?.classList.contains("hidden"),
    null, { timeout:15000 }).catch(()=>{});
  await p.waitForTimeout(1500);
  const real = await p.evaluate(altos, { raiz:"#portal-contenido", sels });
  const cls  = await p.evaluate(() => Number((window.__cls||0).toFixed(4)));
  const sobran = await p.evaluate(() =>
    document.querySelectorAll("#portal-contenido [data-esqueleto]").length);

  await ctx.close();
  return { fantasma, real, cls, sobran };
}

console.log("\npantalla  bloque del portal                  fantasma    real   diferencia    CLS");
for (const ancho of [1280, 390]) {
  const m = await medirPortal(ancho);
  BLOQUES.forEach(([sel, nombre, tope], i) => {
    const f = m.fantasma[i], r = m.real[i];
    const dif = (f !== null && r !== null) ? Math.abs(f - r) : null;
    console.log(`${String(ancho+"px").padEnd(9)} ${nombre.padEnd(26)} ${String(f ?? "—").padStart(6)}px `
      + `${String(r ?? "—").padStart(6)}px ${(dif === null ? "—" : dif+"px").padStart(10)}`
      + (i === 0 ? `  ${String(m.cls).padStart(7)}` : ""));
    if (f === null) fallas.push(`portal @${ancho}: no se dibujó el esqueleto de ${nombre}`);
    if (r === null) fallas.push(`portal @${ancho}: no llegó a dibujarse ${nombre}`);
    if (dif !== null && dif > tope)
      fallas.push(`portal @${ancho}: ${nombre} mide ${dif}px distinto (se tolera ${tope}px)`);
  });
  if (m.cls > 0.05) fallas.push(`portal @${ancho}: CLS ${m.cls} (se pide ≤ 0.05)`);
  if (m.sobran > 0) fallas.push(`portal @${ancho}: quedaron ${m.sobran} esqueletos después de cargar`);
}

await nav.close();
console.log("\n" + (fallas.length ? "FALLAS:\n- " + fallas.join("\n- ")
                                  : "✔ los esqueletos miden lo mismo que el contenido y nada brinca"));
