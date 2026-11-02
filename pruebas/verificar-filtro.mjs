/**
 * El filtro con tarjetas que viajan (FLIP).
 *
 * Lo que se verifica, y por que:
 *   - Que haya animaciones de verdad al filtrar. Un `transform` escrito y
 *     borrado en el mismo cuadro no se ve; getAnimations() dice si el
 *     navegador realmente esta animando.
 *   - Que se animen SOLO transform/opacity. Animar top/left o width obliga a
 *     recalcular el layout en cada cuadro, que es justo lo que hace que un
 *     filtro "se sienta barato" en un celular.
 *   - Que con «menos movimiento» no se anime nada.
 *   - Que al terminar, el filtro haya filtrado de verdad.
 */
import { chromium } from "playwright";
const OPC = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const CATS=[{id:"landing",label:"Landing Page"},{id:"ecommerce",label:"E-Commerce"},
            {id:"portfolio",label:"Portfolio"},{id:"custom",label:"Custom App"}];
const PROY=Array.from({length:12},(_,i)=>({id:`p${i}`,title:`Proyecto ${i+1}`,
  description:"Tienda online con carrito y panel propio.",category:CATS[i%4].id,
  image:"/images/aura-store.webp",tags:["HTML"],demo_url:`https://s${i}.com.ar`,
  position:i,is_featured:i===0,created_at:"2026-01-01T00:00:00Z"}));

const nav = await chromium.launch(OPC);
const fallas = [];

for (const reduce of [false, true]) {
  const ctx = await nav.newContext({ viewport:{width:1280,height:1000},
    reducedMotion: reduce ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  await p.route("**/rest/v1/**",(r)=>{const u=r.request().url();
    r.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify(/categories/.test(u)?CATS:/reviews/.test(u)?[]:PROY)});});
  await p.goto(`${BASE}/proyectos.html`,{waitUntil:"networkidle"});
  await p.waitForFunction(()=>document.querySelectorAll(".pcard[data-id]").length>0,{timeout:12000});
  await p.waitForTimeout(600);

  const antes = await p.evaluate(()=>document.querySelectorAll(".pcard[data-id]").length);

  // Tocar el filtro y mirar las animaciones EN EL MOMENTO
  const r = await p.evaluate(() => {
    const btn = document.querySelector('.filter-btn[data-filter="ecommerce"]');
    btn.click();
    const anims = document.getAnimations()
      .filter(a => a.effect?.target?.classList?.contains("pcard"));
    const props = new Set();
    for (const a of anims) for (const k of a.effect.getKeyframes())
      for (const prop of Object.keys(k))
        if (!["offset","composite","computedOffset","easing"].includes(prop)) props.add(prop);
    return { cuantas: anims.length, propiedades: [...props] };
  });

  await p.waitForTimeout(900);
  const despues = await p.evaluate(()=>({
    tarjetas: document.querySelectorAll(".pcard[data-id]").length,
    categorias: [...new Set([...document.querySelectorAll(".pcard-tag")].map(e=>e.textContent.trim()))],
    transformSobrante: [...document.querySelectorAll(".pcard")]
      .filter(e=>e.style.transform && e.style.transform!=="none").length,
  }));

  const etq = reduce ? "con «menos movimiento»" : "normal";
  console.log(`${etq.padEnd(24)} ${antes} → ${despues.tarjetas} tarjetas · ${r.cuantas} animaciones · ${r.propiedades.join("+") || "—"}`);

  if (reduce) {
    if (r.cuantas > 0) fallas.push(`${etq}: animó ${r.cuantas} tarjetas y no debería animar ninguna`);
  } else {
    if (r.cuantas === 0) fallas.push(`${etq}: no se animó ninguna tarjeta — el viaje no está ocurriendo`);
    const malas = r.propiedades.filter(x => !["transform","opacity"].includes(x));
    if (malas.length) fallas.push(`${etq}: anima propiedades que tocan el layout: ${malas.join(", ")}`);
  }
  if (despues.categorias.length > 1)
    fallas.push(`${etq}: después de filtrar quedaron varias categorías: ${despues.categorias.join(" / ")}`);
  if (despues.transformSobrante)
    fallas.push(`${etq}: ${despues.transformSobrante} tarjetas quedaron con un transform pegado`);

  await ctx.close();
}

await nav.close();
console.log("\n" + (fallas.length ? "FALLAS:\n- " + fallas.join("\n- ")
                                  : "✔ las tarjetas viajan, solo con transform/opacity, y se respeta «menos movimiento»"));
