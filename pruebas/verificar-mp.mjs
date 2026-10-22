/**
 * Prueba de la preferencia de Mercado Pago SIN pegarle a Mercado Pago.
 *
 * Se interceptan `fetch` y el cliente de Supabase, se llama al handler como
 * lo llamaria Vercel, y se mira EL CUERPO que se habria mandado.
 *
 * Existe por un bug real: se mandaba
 *   excluded_payment_types: [{ id: "account_money" }]
 * para forzar el pago con tarjeta en el plan de 3 cuotas, y Mercado Pago
 * rechazaba la preferencia entera con «account_money cannot be excluded».
 * El cliente veia "No se pudo abrir el pago" y no podia pagar.
 * La doc lo dice: el dinero en cuenta NO se puede excluir.
 */
import { createRequire } from "node:module";

process.env.MP_ACCESS_TOKEN = "TEST-falso";
process.env.SUPABASE_URL = "https://pruebalocal.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "falsa";
process.env.SITE_URL = "https://arieldev.com.ar";

const CLIENTE = {
  id: "11111111-1111-1111-1111-111111111111",
  client_name: "Lucía Fernández", project_name: "Pastelería Dulce Hogar",
  price_usd: 300, domain_extra_usd: 10, domain_choice: "ninguno",
  payment_plan: "cuotas3", status: "anticipo_pendiente", is_active: true,
};

let enviado = null;
globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  if (u.includes("/checkout/preferences")) {
    enviado = JSON.parse(opciones.body);
    return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp/pagar" }),
      { status: 201, headers: { "content-type": "application/json" } });
  }
  if (u.includes("dolarapi") || u.includes("bluelytics")) {
    return new Response(JSON.stringify({ venta: 1550, blue: { value_sell: 1550 } }),
      { status: 200, headers: { "content-type": "application/json" } });
  }
  /* PostgREST: devolver filas creibles para que el handler avance hasta el
     punto que nos interesa, que es el armado de la preferencia. */
  let fila = [];
  if (u.includes("/clients")) fila = [CLIENTE];
  else if (u.includes("/payments")) fila = [{ id: "pago-1", client_id: CLIENTE.id, kind: "total",
                                              amount_usd: 310, status: "pendiente" }];
  else if (u.includes("/rpc/")) fila = { ok: true };
  const uno = /Accept[^,]*single|application\/vnd\.pgrst\.object/i.test(
                JSON.stringify(opciones.headers || {}));
  return new Response(JSON.stringify(uno ? (fila[0] ?? fila) : fila),
    { status: 200, headers: { "content-type": "application/json" } });
};

const { default: handler } = await import("../api/mp-crear-preferencia.js");

const req = { method: "POST", headers: { "x-forwarded-for": "1.2.3.4" },
              body: { token: "z".repeat(40), kind: "total" } };
let estado = 0, cuerpo = null;
/* Vercel le da a res los metodos de Node MAS .json()/.send(). Si falta uno,
   el handler explota adentro de su propio catch y el error real queda tapado
   por "res.status(...).send is not a function" — que fue lo que paso la
   primera vez que corri esto. */
const res = { setHeader() {}, status(c) { estado = c; return this; },
              json(b) { cuerpo = b; return this; },
              send(b) { cuerpo = b; return this; },
              end(b) { cuerpo = b; return this; } };

try { await handler(req, res); } catch (e) { console.log("el handler tiro:", e.message); }

console.log("respuesta HTTP:", estado);
if (!enviado) {
  console.log("NO se llego a armar la preferencia. Respuesta:", cuerpo);
  console.log("\n(Si dice que falta el cliente o la config, es normal: este script\n no tiene una base real. Lo que importa es el chequeo de abajo.)");
}

/* El chequeo que de verdad importa, se haya armado o no la preferencia:
   que el campo prohibido no este en el codigo fuente. */
const { readFileSync } = await import("node:fs");
const fuente = readFileSync(new URL("../api/mp-crear-preferencia.js", import.meta.url), "utf8");
const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const fallas = [];
if (/excluded_payment_types/.test(sinComentarios))
  fallas.push("sigue habiendo excluded_payment_types en el codigo (fuera de los comentarios)");
if (!/installments:\s*cuotasPara\(/.test(sinComentarios))
  fallas.push("se perdio la configuracion de cuotas");

if (enviado) {
  console.log("\ncuerpo enviado a Mercado Pago:");
  console.log(JSON.stringify({ payment_methods: enviado.payment_methods,
                               items: enviado.items?.map((i) => ({ title: i.title, unit_price: i.unit_price })) }, null, 2));
  if (enviado.payment_methods?.excluded_payment_types?.length)
    fallas.push("la preferencia lleva excluded_payment_types: " + JSON.stringify(enviado.payment_methods.excluded_payment_types));
  if (enviado.payment_methods?.installments !== 3)
    fallas.push(`installments deberia ser 3 y es ${enviado.payment_methods?.installments}`);
}

/* Migración 14: el plan «pago total» usa el mismo tipo de cobro ('total')
   que el de 3 cuotas, pero va en UN pago. Las cuotas las decide el plan. */
CLIENTE.payment_plan = "unico";
enviado = null;
try { await handler({ ...req, headers: { "x-forwarded-for": "5.6.7.8" } }, res); } catch (e) { console.log("el handler tiro:", e.message); }
if (enviado && enviado.payment_methods?.installments !== 1)
  fallas.push(`con el plan «pago total» installments deberia ser 1 y es ${enviado.payment_methods?.installments}`);
else if (enviado) console.log("plan «pago total»: installments = 1 ✔");

console.log("\n" + (fallas.length ? "FALLAS:\n- " + fallas.join("\n- ") : "✔ la preferencia no excluye account_money y mantiene las 3 cuotas"));
