/* Pagos flexibles (migración 14), en un Chromium de verdad.

   PANEL — abre la ficha de un cliente y prueba el bloque de Cobros:
     · que el resumen haga bien la cuenta (total, cobrado, pendiente);
     · que «+ Agregar cobro» mande a la base exactamente lo cargado;
     · que una reserva nueva dispare el recálculo del anticipo;
     · que «Editar» mande el monto y el estado nuevos.

   PORTAL — dibuja los casos y mira el TEXTO que ve el cliente:
     · plan fijado por Ariel (sin opciones para elegir);
     · anticipo con la reserva ya descontada;
     · saldo con la cuenta completa;
     · una cuota pendiente durante la producción;
     · la lista «Tus pagos» del resumen;
     · las pestañas (migración 15): candado, que se abra la que tiene algo
       para hacer, tocar una pestaña, solo transferencia, dominio elegido
       y el link final en Producción.

   Deja capturas en una carpeta temporal (la imprime al final).

   Correr con el sitio compilado servido en :4178 (ver LEEME.md). */
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRASTE } from "./_contraste.mjs";

const OPCIONES = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const BASE = process.env.BASE || "http://127.0.0.1:4178";
const CAPTURAS = mkdtempSync(join(tmpdir(), "pagos-"));
const fallas = [];
const ok = (cond, msg) => { if (!cond) fallas.push(msg); };

const ahora = new Date().toISOString();
const CID = "11111111-1111-1111-1111-111111111111";

/* ==========================================================================
   PANEL
   ========================================================================== */
const CLIENTE = {
  id: CID, client_name: "Sofía y Mara", project_name: "Estudio de Yoga",
  access_token: "a".repeat(40), status: "anticipo_pendiente", is_active: true,
  price_usd: 400, domain_extra_usd: 10, domain_choice: null, domain_name: null,
  whatsapp: "5493510000000", demo_url: "https://demo.vercel.app", production_url: null,
  project_brief: "", proposal_url: null, proposal_filename: null,
  budget_pdf_url: null, budget_pdf_filename: null, brief_pdf_url: null, brief_pdf_filename: null,
  payment_plan: "mitades", plan_fijado: false, client_decision: "continuar",
  secciones: { tareas: false, pagos: false, dominio: false, produccion: false },
  metodos_pago: ["mercadopago", "transferencia"],
  progreso: 30, tareas_total: 0, tareas_hechas: 0, cobrado_usd: 100, pendiente_usd: 100,
  comprobantes_a_revisar: 0, last_seen_at: ahora, view_count: 4, orden: 2,
  created_at: ahora,
};
const PAGOS = [
  { id: "p1", client_id: CID, kind: "reserva", concepto: "Reserva para arrancar", amount_usd: 100, status: "pagado", method: "transferencia", paid_at: ahora, created_at: ahora },
  { id: "p2", client_id: CID, kind: "anticipo", concepto: null, amount_usd: 100, status: "pendiente", method: null, paid_at: null, created_at: ahora },
  { id: "p3", client_id: CID, kind: "otro", concepto: "Logo nuevo", amount_usd: 40, status: "pendiente", method: null, paid_at: null, created_at: ahora },
];
const SESION = {
  access_token: "falso", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "falso",
  user: { id: "u1", aud: "authenticated", role: "authenticated", email: "ariel@test.com",
          app_metadata: {}, user_metadata: {}, created_at: ahora },
};

const nav = await chromium.launch(OPCIONES);

for (const ancho of [390, 1280]) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 1100 } });
  await ctx.addInitScript((s) => localStorage.setItem("arieldev-auth", JSON.stringify(s)), SESION);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fallas.push(`panel @${ancho}: pageerror ${e}`));

  const escrituras = [];
  await ctx.route("**/auth/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ...SESION, data: { session: SESION, user: SESION.user } }) }));
  await ctx.route("**/rest/v1/**", (r) => {
    const req = r.request();
    const url = req.url();
    if (req.method() !== "GET") {
      escrituras.push({ metodo: req.method(), url, cuerpo: req.postDataJSON?.() ?? req.postData() });
      const rpc = /rpc\/admin_configurar_plan/.test(url)
        ? { ok: true, plan: "mitades", status: "anticipo_pendiente", avisos: [] }
        : /rpc\//.test(url) ? { ok: true }
        : /\/clients/.test(url) ? [{ id: CID }]   // el panel exige la fila de vuelta
        : [];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rpc) });
    }
    const filas = /v_clientes_panel|\/clients/.test(url) ? [CLIENTE]
      : /payments/.test(url) ? PAGOS : [];
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(filas) });
  });

  await p.goto(`${BASE}/admin.html`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    document.querySelectorAll(".admin-vista").forEach((s) => s.classList.add("hidden"));
    document.getElementById("vista-clientes")?.classList.remove("hidden");
  });
  await p.locator("#lista-clientes .admin-cliente-head").first().click();
  await p.waitForSelector(".cobros-kpis", { timeout: 4000 }).catch(() => {});

  const bloque = p.locator(".admin-cobros");
  ok(await bloque.count() === 1, `panel @${ancho}: no aparece el bloque de Cobros`);

  const kpis = await p.locator(".cobros-kpis dd").allTextContents();
  // Total 400 + 40 de extra = 440 · cobrado 100 · pendiente 140 · sin programar 400-200 = 200
  ok(kpis[0]?.includes("440"), `panel @${ancho}: total del proyecto debería ser 440 y dice ${kpis[0]}`);
  ok(kpis[1]?.includes("100"), `panel @${ancho}: cobrado debería ser 100 y dice ${kpis[1]}`);
  ok(kpis[2]?.includes("140"), `panel @${ancho}: pendiente debería ser 140 y dice ${kpis[2]}`);
  ok(kpis[3]?.includes("200"), `panel @${ancho}: sin programar debería ser 200 y dice ${kpis[3]}`);
  ok(await p.locator(".admin-pago").count() === 3, `panel @${ancho}: tendría que haber 3 filas de cobro`);
  ok(await p.locator('[data-campo="plan"]').inputValue() === "mitades", `panel @${ancho}: el plan no viene seleccionado`);

  // Solo lo del bloque nuevo: el contraste de las pestañas del panel es un
  // pendiente conocido (ver LEEME.md) y no tiene que ver con esto.
  for (const c of await p.evaluate(CONTRASTE))
    if (!/admin-tab/.test(c) && /cobro|pago|Agregar|Recalcular|Aplicar|Marcar|Editar|Eliminar/i.test(c))
      fallas.push(`panel @${ancho}: contraste → ${c}`);
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(desborde <= 2, `panel @${ancho}: desborde horizontal de ${desborde}px`);

  await bloque.scrollIntoViewIfNeeded();
  await bloque.screenshot({ path: join(CAPTURAS, `panel-cobros-${ancho}.png`) });

  // --- Agregar una reserva ---
  await p.locator('[data-accion="nuevo-cobro"]').click();
  await p.waitForSelector(".cobro-form");
  await p.waitForTimeout(600);   // que termine la animación de entrada
  await p.screenshot({ path: join(CAPTURAS, `panel-agregar-${ancho}.png`) });
  await p.fill("#cf-concepto", "Seña por WhatsApp");
  await p.fill("#cf-monto", "50");
  ok(await p.locator("#cf-estado").inputValue() === "pagado", `panel @${ancho}: una reserva nueva debería venir como pagada`);
  await p.selectOption("#cf-medio", "efectivo");
  await p.locator(".swal2-confirm").click();
  await p.waitForTimeout(700);

  const alta = escrituras.find((e) => e.metodo === "POST" && /\/payments/.test(e.url));
  const fila = Array.isArray(alta?.cuerpo) ? alta.cuerpo[0] : alta?.cuerpo;
  ok(fila?.kind === "reserva" && Number(fila?.amount_usd) === 50 && fila?.status === "pagado"
     && fila?.method === "efectivo" && fila?.concepto === "Seña por WhatsApp",
     `panel @${ancho}: el alta mandó otra cosa: ${JSON.stringify(fila)}`);
  ok(escrituras.some((e) => /rpc\/admin_configurar_plan/.test(e.url)),
     `panel @${ancho}: después de cargar la reserva no se recalculó el anticipo`);
  await p.locator(".swal2-confirm").click().catch(() => {});   // cierra el aviso de éxito
  await p.waitForTimeout(400);

  // --- Editar el extra: monto y estado ---
  escrituras.length = 0;
  await p.waitForSelector(".admin-pago");
  await p.locator(".admin-pago").nth(2).getByRole("button", { name: /^Editar/ }).click();
  await p.waitForSelector(".cobro-form");
  await p.fill("#cf-monto", "45");
  await p.selectOption("#cf-estado", "pagado");
  await p.locator(".swal2-confirm").click();
  await p.waitForTimeout(700);
  const edicion = escrituras.find((e) => e.metodo === "PATCH" && /\/payments/.test(e.url));
  ok(edicion && Number(edicion.cuerpo?.amount_usd) === 45 && edicion.cuerpo?.status === "pagado"
     && edicion.cuerpo?.paid_at && edicion.url.includes("p3"),
     `panel @${ancho}: la edición mandó otra cosa: ${JSON.stringify(edicion)}`);
  ok(edicion?.cuerpo?.amount_ars === null, `panel @${ancho}: al cambiar el monto tiene que soltar el importe en pesos de MP`);

  // --- Pestañas del link (migración 15): cada interruptor guarda solo ---
  await p.locator(".swal2-confirm").click().catch(() => {});
  await p.waitForSelector(".swal2-container", { state: "detached", timeout: 3000 }).catch(() => {});
  escrituras.length = 0;
  const sw = p.locator('[data-pestana="pagos"]');
  ok(await sw.count() === 1, `panel @${ancho}: no aparece el interruptor de la pestaña Pagos`);
  // Como lo haría una persona: tocando la fila del interruptor.
  await p.locator('.pestana-switch:has([data-pestana="pagos"])').click();
  await p.waitForTimeout(500);
  const pst = escrituras.find((e) => e.metodo === "PATCH" && /\/clients/.test(e.url));
  ok(pst?.cuerpo?.secciones?.pagos === true && pst?.cuerpo?.secciones?.tareas === false,
     `panel @${ancho}: abrir Pagos mandó otra cosa: ${JSON.stringify(pst?.cuerpo)}`);
  await p.locator(".admin-pestanas").screenshot({ path: join(CAPTURAS, `panel-pestanas-${ancho}.png`) });

  // --- Condiciones: apagar Mercado Pago ---
  escrituras.length = 0;
  await p.locator('[data-campo="cb-medio"][value="mercadopago"]').uncheck();
  await p.locator('[data-accion="guardar-condiciones"]').click();
  await p.waitForTimeout(500);
  const cond = escrituras.find((e) => e.metodo === "PATCH" && /\/clients/.test(e.url));
  ok(JSON.stringify(cond?.cuerpo?.metodos_pago) === '["transferencia"]',
     `panel @${ancho}: los medios de pago mandaron otra cosa: ${JSON.stringify(cond?.cuerpo)}`);

  console.log(`  panel @${ancho}: kpis ${kpis.join(" | ")}`);
  await ctx.close();
}

/* ==========================================================================
   PORTAL
   ========================================================================== */
const baseCliente = {
  client_name: "Sofía", project_name: "Estudio de Yoga", project_brief: "",
  demo_url: "https://demo.vercel.app", price_usd: 400, domain_extra_usd: 10,
  domain_choice: null, domain_name: null, total_usd: 400, client_decision: "continuar",
  progreso: 30, created_at: ahora, tareas: [], payment_plan: "mitades", plan_fijado: false, pagos: [],
};
const reservaPagada = { kind: "reserva", concepto: "Reserva para arrancar", amount_usd: 100, status: "pagado",
                        paid_at: ahora, method: "transferencia", nro_recibo: 21, recibo_fecha: ahora };

const abiertas = (o = {}) => ({ tareas: false, pagos: false, dominio: false, produccion: false, ...o });

/* [nombre, datos, chequeos(texto), pestaña a abrir por URL (opcional), botón de la barra a tocar (opcional)] */
const CASOS = [
  ["demo · plan fijado personalizado", {
    status: "demo_lista", client_decision: null, payment_plan: "personalizado", plan_fijado: true,
    secciones: abiertas(),
    pagos: [reservaPagada,
      { kind: "cuota", concepto: "Cuota 1", amount_usd: 150, status: "pendiente" },
      { kind: "cuota", concepto: "Cuota 2", amount_usd: 150, status: "pendiente" }],
  }, (t) => [
    [t.includes("Plan acordado"), "no muestra el plan fijado"],
    [!t.includes("¿Cómo preferís pagarlo?"), "con plan fijado no tendría que ofrecer opciones"],
    [t.includes("Cuota 2"), "no lista las cuotas del plan acordado"],
    [t.includes("de reserva"), "no avisa la reserva ya pagada"],
  ]],
  ["demo · el cliente elige", { status: "demo_lista", client_decision: null, payment_plan: null, secciones: abiertas() }, (t) => [
    [t.includes("Pago total") && t.includes("3 cuotas") && t.includes("Mitad y mitad"), "faltan opciones de plan"],
  ]],
  ["anticipo con reserva", {
    status: "anticipo_pendiente", secciones: abiertas({ pagos: true }),
    pagos: [reservaPagada, { kind: "anticipo", amount_usd: 100, status: "pendiente" }],
  }, (t) => [
    [t.includes("Anticipo para arrancar"), "con Pagos abierta y un pago pendiente tendría que abrir en Pagos"],
    [t.includes("Ya descontamos tu reserva"), "no dice que descontó la reserva"],
    [/tus pagos/i.test(t), "falta la lista de pagos"],
  ]],
  ["saldo con la cuenta", {
    status: "saldo_pendiente", domain_choice: "propio", domain_name: "yoga.com.ar", total_usd: 410,
    secciones: abiertas({ pagos: true, tareas: true, dominio: true }),
    pagos: [reservaPagada,
      { kind: "anticipo", amount_usd: 100, status: "pagado", paid_at: ahora, nro_recibo: 22 },
      { kind: "saldo", amount_usd: 210, status: "pendiente" }],
  }, (t) => [
    [t.includes("Valor del proyecto") && t.includes("Dominio propio") && t.includes("Total a pagar"), "el desglose del saldo está incompleto"],
    [t.includes("Reserva para arrancar"), "el desglose no muestra la reserva descontada"],
  ]],
  ["cuota pendiente en producción", {
    status: "en_produccion", payment_plan: "personalizado", plan_fijado: true,
    secciones: abiertas({ pagos: true, tareas: true }),
    pagos: [{ kind: "cuota", concepto: "Cuota 1", amount_usd: 200, status: "pagado", paid_at: ahora },
            { kind: "cuota", concepto: "Cuota 2", amount_usd: 200, status: "pendiente" }],
  }, (t) => [
    [t.includes("Cuota 2") && t.includes("USD 200"), "Pagos no muestra la cuota pendiente"],
  ]],
  ["tocar la pestaña Tareas", {
    status: "en_produccion", secciones: abiertas({ pagos: true, tareas: true }),
    tareas: [{ id: 1, title: "Cambiar el logo", done: true, source: "cliente" }],
  }, (t) => [
    [t.includes("Contame qué querés cambiar") && t.includes("Cambiar el logo"), "al tocar Tareas no se ve la lista"],
  ], null, "tareas"],
  ["pestañas cerradas", {
    status: "en_produccion", secciones: abiertas(),
    pagos: [{ kind: "anticipo", amount_usd: 200, status: "pagado", paid_at: ahora }],
  }, (t) => [
    [t.includes("todavía no está habilitada"), "una pestaña cerrada no explica por qué"],
    [!t.includes("Contame qué querés cambiar"), "con Tareas cerrada no tendría que dejar cargar cambios"],
  ], "tareas"],
  ["solo transferencia", {
    status: "anticipo_pendiente", secciones: abiertas({ pagos: true }), metodos_pago: ["transferencia"],
    pagos: [{ kind: "anticipo", amount_usd: 200, status: "pendiente" }],
  }, (t) => [
    [!t.includes("Pagar con Mercado Pago"), "Mercado Pago apagado y el botón sigue"],
    [t.includes("Alias"), "con solo transferencia tendría que mostrar los datos"],
  ]],
  ["dominio ya elegido", {
    status: "en_produccion", secciones: abiertas({ dominio: true }),
    domain_choice: "propio", domain_name: "yoga.com.ar",
  }, (t) => [
    [t.includes("La dirección de tu página") && t.includes("yoga.com.ar"), "no muestra el dominio elegido"],
  ], "dominio"],
  ["producción con link", {
    status: "finalizado", secciones: abiertas({ pagos: true, produccion: true }),
    production_url: "https://yoga.com.ar",
    pagos: [{ kind: "total", amount_usd: 400, status: "pagado", paid_at: ahora }],
  }, (t) => [
    [t.includes("Tu página está en línea") && t.includes("Abrir mi página"), "Producción no muestra el link final"],
  ]],
];

for (const ancho of [390, 1280]) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 1400 } });
  for (const [nombre, parche, chequeos, hash, clic] of CASOS) {
    const datos = { ...baseCliente, ...parche };
    const p = await ctx.newPage();
    p.on("pageerror", (e) => fallas.push(`portal ${nombre} @${ancho}: pageerror ${e}`));
    await p.route("**/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await p.route("**/rest/v1/rpc/portal_obtener*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(datos) }));
    await p.goto(`${BASE}/cliente.html?t=${"a".repeat(40)}${hash ? `#${hash}` : ""}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    if (clic) {
      await p.locator(`.portal-nav-btn[data-pestana="${clic}"]`).click();
      await p.waitForTimeout(400);
      ok(await p.locator(`.portal-nav-btn[data-pestana="${clic}"][aria-current="page"]`).count() === 1,
         `portal ${nombre} @${ancho}: la pestaña tocada no queda marcada`);
    }

    const texto = await p.evaluate(() => document.body.innerText);
    for (const [cond, msg] of chequeos(texto)) ok(cond, `portal ${nombre} @${ancho}: ${msg}`);
    ok(await p.locator(".portal-nav-btn").count() === 5, `portal ${nombre} @${ancho}: la barra no tiene las 5 pestañas`);
    // Las cerradas se marcan con candado (en el celular el texto chico se
    // oculta, así que se mira la clase y no el texto).
    const cerradas = Object.entries(datos.secciones || {}).filter(([, v]) => !v).length;
    ok(await p.locator(".portal-nav-btn.bloqueada").count() === cerradas,
       `portal ${nombre} @${ancho}: tendría que haber ${cerradas} pestañas con candado`);
    for (const c of await p.evaluate(CONTRASTE)) fallas.push(`portal ${nombre} @${ancho}: contraste → ${c}`);
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(desborde <= 2, `portal ${nombre} @${ancho}: desborde ${desborde}px`);

    await p.screenshot({ path: join(CAPTURAS, `portal-${nombre.replace(/\W+/g, "-")}-${ancho}.png`), fullPage: true });
    console.log(`  portal ${nombre.padEnd(34)} @${ancho} ok`);
    await p.close();
  }
  await ctx.close();
}

await nav.close();
console.log(`\nCapturas en ${CAPTURAS}`);
console.log(fallas.length ? "\nFALLAS:\n" + [...new Set(fallas)].join("\n") : "\n✔ panel y portal manejan bien los pagos flexibles");
process.exitCode = fallas.length ? 1 : 0;
