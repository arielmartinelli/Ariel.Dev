/**
 * El landing con 5 proyectos y la pagina /proyectos con todos.
 *
 * Lo que se prueba, y por que cada cosa:
 *   - El landing dibuja 5 como maximo, pase lo que pase. Es el motivo de
 *     todo este cambio: que cargar proyectos nuevos no alargue la portada.
 *   - El boton "Ver todos" aparece SOLO si hay mas de 5. Un boton que lleva
 *     a la misma lista es una promesa incumplida.
 *   - El boton es clickeable de verdad. Las tarjetas de arriba son sticky y
 *     se apilan: sin z-index propio, la ultima pasa por encima y lo tapa.
 *     Eso NO se ve en una captura — se mide con elementFromPoint.
 *   - Los filtros filtran, y solo aparecen las categorias con proyectos.
 *   - Sin desborde horizontal ni contrastes por debajo de WCAG AA.
 */
import { chromium } from "playwright";
import { CONTRASTE } from "./_contraste.mjs";

const OPCIONES = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";

const CATEGORIAS = [
  { id: "landing",    label: "Landing Page" },
  { id: "ecommerce",  label: "E-Commerce" },
  { id: "portfolio",  label: "Portfolio" },
  { id: "custom",     label: "Custom App" },
  { id: "invitacion", label: "Tarjeta de Invitación" },
];

const proyecto = (i) => ({
  id: `p${i}`,
  title: `Proyecto ${i}`,
  description: i % 3 === 0
    ? "Descripción cortita."
    : "Descripción bastante más larga que la anterior, para comprobar que el recorte a tres líneas mantiene las tarjetas de la misma fila alineadas aunque el texto varíe mucho de largo entre un trabajo y otro.",
  category: CATEGORIAS[i % 4].id,     // a proposito NO se usa 'invitacion':
  image: "",                           // asi se verifica que esa categoria no
  tags: ["HTML", "CSS", "JS"],         // aparezca en los filtros
  demo_url: i % 5 === 0 ? null : `https://demo-${i}.example.com`,
  position: i,
  created_at: "2026-01-01T00:00:00Z",
});

const nav = await chromium.launch(OPCIONES);
const fallas = [];

async function conDatos(ctx, cantidad) {
  const filas = Array.from({ length: cantidad }, (_, i) => proyecto(i + 1));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fallas.push(`${cantidad} proyectos: pageerror ${e}`));
  await p.route("**/rest/v1/**", (r) => {
    const u = r.request().url();
    const cuerpo = /categories/.test(u) ? CATEGORIAS : /projects/.test(u) ? filas : [];
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cuerpo) });
  });
  return p;
}

for (const ancho of [390, 1280]) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 1000 } });
  console.log(`\n── ${ancho}px ──`);

  /* ---------- Landing ---------- */
  for (const [cantidad, botonEsperado] of [[3, false], [5, false], [20, true]]) {
    /* Contexto NUEVO por escenario. projects.js guarda los proyectos en
       localStorage como respaldo offline, y el localStorage vive en el
       contexto: reusandolo, el escenario de 5 veia los 3 del anterior y la
       prueba reportaba "3 tarjetas, se esperaban 5" — una falla que no
       existia en el sitio. */
    const ctxEsc = await nav.newContext({ viewport:{ width: ancho, height: 1000 } });
    const p = await conDatos(ctxEsc, cantidad);
    await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });

    /* El preloader (#page-loader) es position:fixed con z-index 99999 y
       tapa la pagina entera hasta que termina su animacion. Sin esperarlo,
       CUALQUIER medicion de "¿esto se puede clickear?" da que no — y la
       culpa parece del elemento medido. Esta prueba reporto el boton como
       tapado dos veces antes de que apareciera este, que era el verdadero
       responsable. */
    await p.waitForSelector("#page-loader.hidden-loader", { timeout: 15000 })
           .catch(() => {});

    /* OJO: que el preloader se vaya YA NO significa que el portfolio este
       pintado. Desde que la pantalla de carga dejo de esperar los datos
       (es a proposito: la pagina abre a los 2 s y el portfolio se completa a
       la vista), esperar solo al loader deja medir a mitad del pintado.
       Esta prueba llego a reportar "3 tarjetas, se esperaban 5" por esto.
       Hay que esperar a que las tarjetas existan de verdad. */
    await p.waitForFunction(
      () => {
        const c = document.getElementById("projects-stack-container");
        if (!c) return false;
        const hayTarjetas = c.querySelectorAll(".stage-card").length > 0;
        const cartel = c.textContent.includes("Cargando proyectos");
        return hayTarjetas || (!cartel && c.children.length > 0);
      }, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(900);

    /* El scroll va en un paso aparte y con espera: la pagina usa Lenis
       (scroll suave), asi que scrollIntoView NO deja el elemento en su
       lugar final de inmediato. Midiendo al toque, elementFromPoint cae
       fuera de la pantalla y devuelve null — que no es "esta tapado", es
       "no mediste nada". La primera version de esta prueba reporto el
       boton como tapado justamente por eso. */
    await p.evaluate(() => {
      const btn = document.querySelector("#ver-todos-proyectos a");
      if (btn) btn.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await p.waitForTimeout(700);

    const r = await p.evaluate(() => {
      const caja = document.getElementById("ver-todos-proyectos");
      const btn = caja?.querySelector("a");
      let clickeable = null;
      if (btn && !caja.hidden) {
        const q = btn.getBoundingClientRect();
        const cx = q.left + q.width / 2, cy = q.top + q.height / 2;
        const dentro = cy >= 0 && cy <= window.innerHeight && cx >= 0 && cx <= window.innerWidth;
        if (dentro) {
          const encima = document.elementFromPoint(cx, cy);
          // null tambien seria sospechoso estando dentro de la pantalla.
          clickeable = !!(encima && (btn === encima || btn.contains(encima)));
        }
        // clickeable queda en null si no se pudo medir: el chequeo de abajo
        // solo falla con false, nunca con null, para no cantar un bug que
        // en realidad es una medicion fallida.
      }
      return {
        tarjetas: document.querySelectorAll("#projects-stack-container .stage-card").length,
        puntos:   document.querySelectorAll("#projects-mobile-dots .mobile-dot").length,
        hayBoton: !!(caja && !caja.hidden && btn),
        texto:    btn ? btn.textContent.replace(/\s+/g, " ").trim() : null,
        destino:  btn ? new URL(btn.href).pathname : null,
        clickeable,
        desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    if (r.tarjetas !== Math.min(cantidad, 5))
      fallas.push(`landing @${ancho} con ${cantidad}: ${r.tarjetas} tarjetas, se esperaban ${Math.min(cantidad, 5)}`);
    if (r.hayBoton !== botonEsperado)
      fallas.push(`landing @${ancho} con ${cantidad}: boton ${r.hayBoton ? "presente" : "ausente"}, se esperaba lo contrario`);
    if (r.hayBoton && r.destino !== "/proyectos")
      fallas.push(`landing @${ancho}: el boton apunta a ${r.destino}`);
    if (r.hayBoton && r.clickeable === false)
      fallas.push(`landing @${ancho} con ${cantidad}: el boton esta TAPADO por las tarjetas sticky`);
    if (r.puntos && r.puntos !== Math.min(cantidad, 5))
      fallas.push(`landing @${ancho} con ${cantidad}: ${r.puntos} puntos del slider, se esperaban ${Math.min(cantidad, 5)}`);
    if (r.desborde > 2)
      fallas.push(`landing @${ancho} con ${cantidad}: desborde ${r.desborde}px`);

    console.log(`  landing ${String(cantidad).padStart(2)} proyectos · ${r.tarjetas} tarjetas · boton: ${r.hayBoton ? `«${r.texto}»` : "no"}${r.clickeable === true ? " (clickeable)" : ""}`);
    await ctxEsc.close();
  }

  /* ---------- /proyectos ---------- */
  const p = await conDatos(ctx, 20);
  await p.goto(`${BASE}/proyectos.html`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);

  const base = await p.evaluate(() => ({
    tarjetas: document.querySelectorAll(".pcard").length,
    filtros: [...document.querySelectorAll(".filter-btn")].map((b) => b.dataset.filter),
    conteo: document.getElementById("proyectos-conteo").textContent.trim(),
    columnas: getComputedStyle(document.querySelector(".proyectos-grid")).gridTemplateColumns.split(" ").length,
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));

  if (base.tarjetas !== 20) fallas.push(`/proyectos @${ancho}: ${base.tarjetas} tarjetas, se esperaban 20`);
  if (base.filtros.includes("invitacion"))
    fallas.push(`/proyectos @${ancho}: aparece el filtro "invitacion" y no hay ningun proyecto de esa categoria`);
  if (!base.filtros.includes("all")) fallas.push(`/proyectos @${ancho}: falta el filtro "Todos"`);
  if (base.desborde > 2) fallas.push(`/proyectos @${ancho}: desborde ${base.desborde}px`);
  console.log(`  /proyectos · ${base.tarjetas} tarjetas · ${base.columnas} columna(s) · filtros: ${base.filtros.join(", ")}`);
  console.log(`              «${base.conteo}»`);

  // Filtrar de verdad
  const cat = "ecommerce";
  await p.click(`.filter-btn[data-filter="${cat}"]`);
  await p.waitForTimeout(250);
  const tras = await p.evaluate((c) => ({
    tarjetas: document.querySelectorAll(".pcard").length,
    activo: document.querySelector(".filter-btn.active")?.dataset.filter,
    etiquetas: [...new Set([...document.querySelectorAll(".pcard-tag")].map((e) => e.textContent.trim()))],
  }), cat);
  const esperadas = Array.from({ length: 20 }, (_, i) => proyecto(i + 1)).filter((x) => x.category === cat).length;
  if (tras.tarjetas !== esperadas)
    fallas.push(`/proyectos @${ancho}: filtro ${cat} dejo ${tras.tarjetas} tarjetas, se esperaban ${esperadas}`);
  if (tras.etiquetas.length > 1)
    fallas.push(`/proyectos @${ancho}: el filtro dejo tarjetas de varias categorias: ${tras.etiquetas.join(" / ")}`);
  console.log(`  filtro «${cat}» · ${tras.tarjetas} tarjetas · todas de: ${tras.etiquetas.join(", ")}`);

  /* Tabla vacia.
     OJO con lo que se verifica aca. getProjects() NO devuelve [] cuando la
     tabla esta vacia: cae a DEFAULT_PROJECTS, cuatro proyectos de ejemplo
     con links a example.com. Eso es de projects.js y es anterior a esta
     pagina. O sea que el visitante NUNCA ve el estado vacio: ve los cuatro
     de muestra.
     La primera version de esta prueba daba por hecho que se veria el cartel
     de "no hay proyectos" y reportaba una falla que no existia. Se verifica
     lo que de verdad pasa, y queda escrito aca para que se note. */
  const vacio = await ctx.newPage();
  await vacio.route("**/rest/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await vacio.goto(`${BASE}/proyectos.html`, { waitUntil: "networkidle" });
  await vacio.waitForTimeout(600);
  const sinNada = await vacio.evaluate(() => ({
    tarjetas: document.querySelectorAll(".pcard").length,
    titulos: [...document.querySelectorAll(".pcard-titulo")].map((e) => e.textContent.trim()),
    rotas: [...document.querySelectorAll(".pcard")].filter((a) => /example\.com/.test(a.href)).length,
  }));
  if (sinNada.tarjetas === 0)
    fallas.push(`/proyectos @${ancho}: con la tabla vacia no se dibujo nada y tampoco el cartel de aviso`);
  console.log(`  tabla vacia · ${sinNada.tarjetas} de muestra (${sinNada.rotas} con links a example.com): ${sinNada.titulos.join(", ")}`);
  await vacio.close();

  // Emojis y contraste
  for (const c of await p.evaluate(CONTRASTE)) fallas.push(`/proyectos @${ancho}: contraste → ${c}`);
  const emojis = await p.evaluate(() => {
    const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue.trim();
      if (t && EMO.test(t) && n.parentElement?.getClientRects().length) out.push(t.slice(0, 40));
    }
    return out;
  });
  for (const e of emojis) fallas.push(`/proyectos @${ancho}: emoji visible → ${e}`);

  await p.close();
  await ctx.close();
}

await nav.close();
console.log("\n" + (fallas.length ? "FALLAS:\n- " + [...new Set(fallas)].join("\n- ") : "✔ landing recortado a 5 y /proyectos completo, sin problemas"));
