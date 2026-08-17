/**
 * api/_lib.js — Utilidades compartidas por las funciones serverless.
 *
 * ATENCION: TODO lo que hay en /api corre en el servidor (Vercel Functions),
 * NUNCA en el navegador. Es el unico lugar donde pueden vivir secretos:
 *
 *   MP_ACCESS_TOKEN        -> permite cobrar en tu nombre en Mercado Pago
 *   MP_WEBHOOK_SECRET      -> valida que un aviso de pago venga de verdad de MP
 *   SUPABASE_SERVICE_ROLE  -> ignora RLS: control total de la base de datos
 *
 * Ninguna de estas variables lleva el prefijo VITE_. Eso es deliberado: Vite
 * incrusta en el bundle publico TODA variable que empiece con VITE_, asi que
 * ponerle ese prefijo a cualquiera de estas seria publicar la llave de la caja
 * fuerte en el codigo fuente de la pagina.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

/* ==========================================================================
   Configuracion
   ========================================================================== */
export function leerConfig() {
  const faltantes = [];

  const cfg = {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE,
    mpAccessToken: process.env.MP_ACCESS_TOKEN,
    mpWebhookSecret: process.env.MP_WEBHOOK_SECRET,
    siteUrl: process.env.SITE_URL || "",
    // Cotizacion de respaldo si la API del dolar no responde. Mercado Pago
    // cobra en ARS: si se manda un precio en USD, el cliente paga 1/1000 de lo
    // que corresponde.
    usdArsFallback: Number(process.env.USD_ARS_FALLBACK || 1250),
  };

  if (!cfg.supabaseUrl) faltantes.push("SUPABASE_URL");
  if (!cfg.serviceRole) faltantes.push("SUPABASE_SERVICE_ROLE");
  if (!cfg.mpAccessToken) faltantes.push("MP_ACCESS_TOKEN");

  return { cfg, faltantes };
}

/**
 * Cliente de Supabase con service_role.
 * Ignora RLS por completo, asi que solo se usa aca adentro y solo para las
 * operaciones puntuales que la funcion necesita.
 */
export function supabaseAdmin(cfg) {
  return createClient(cfg.supabaseUrl, cfg.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ==========================================================================
   Respuestas
   ========================================================================== */
export function json(res, status, cuerpo) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Una respuesta de pago cacheada seria un desastre: el cliente veria el
  // estado viejo o, peor, la preferencia de otra operacion.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).send(JSON.stringify(cuerpo));
}

/** Lee el body crudo. Necesario para el webhook (hay que firmarlo tal cual). */
export async function leerBodyCrudo(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  const trozos = [];
  for await (const t of req) trozos.push(t);
  return Buffer.concat(trozos).toString("utf8");
}

/* ==========================================================================
   Validacion de la firma del webhook de Mercado Pago
   --------------------------------------------------------------------------
   SIN ESTO, EL ENDPOINT ES UN AGUJERO: cualquiera que descubra la URL puede
   mandar un POST diciendo "el pago 123 fue aprobado" y marcarse como pagado
   un proyecto que nunca abono. Por eso el webhook:
     1. valida la firma HMAC que manda MP, y
     2. igual vuelve a consultar el pago a la API de MP antes de escribir nada.
   Nunca se confia en el contenido del POST.

   Mercado Pago firma este texto:
       id:<data.id>;request-id:<x-request-id>;ts:<ts>;
   con HMAC-SHA256 y la clave secreta del webhook, y lo manda en la cabecera
   x-signature con la forma: ts=<ts>,v1=<hash>
   ========================================================================== */
export function validarFirmaMercadoPago({ xSignature, xRequestId, dataId, secreto }) {
  if (!secreto) {
    // Sin secreto configurado no se puede validar. Se rechaza en vez de
    // "dejar pasar por las dudas": un webhook sin verificar no sirve de nada.
    return { ok: false, motivo: "MP_WEBHOOK_SECRET no está configurado." };
  }
  if (!xSignature || !dataId) {
    return { ok: false, motivo: "Faltan cabeceras de firma." };
  }

  let ts = "";
  let v1 = "";
  for (const parte of String(xSignature).split(",")) {
    const [clave, valor] = parte.split("=").map((s) => (s || "").trim());
    if (clave === "ts") ts = valor;
    if (clave === "v1") v1 = valor;
  }

  if (!ts || !v1) return { ok: false, motivo: "Firma con formato inesperado." };

  // Ventana de 5 minutos: sin esto, una notificacion vieja capturada por
  // alguien se puede reenviar indefinidamente (ataque de repeticion).
  const edadSegundos = Math.abs(Date.now() / 1000 - Number(ts) / (String(ts).length > 11 ? 1000 : 1));
  if (!Number.isFinite(edadSegundos) || edadSegundos > 300) {
    return { ok: false, motivo: "Notificación fuera de la ventana de tiempo." };
  }

  // El id va en minusculas segun la especificacion de Mercado Pago.
  const manifiesto = `id:${String(dataId).toLowerCase()};request-id:${xRequestId || ""};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");

  // Comparacion en tiempo constante: un === comun filtra informacion por el
  // tiempo que tarda en fallar y permite reconstruir la firma byte a byte.
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return { ok: false, motivo: "Firma inválida." };

  return crypto.timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, motivo: "Firma inválida." };
}

/* ==========================================================================
   Cotizacion del dolar
   ========================================================================== */
let cacheDolar = { valor: null, ts: 0 };

export async function cotizacionUsdArs(fallback) {
  // 30 minutos de cache: la cotizacion no se mueve tanto y evita depender de
  // un tercero en cada intento de pago.
  if (cacheDolar.valor && Date.now() - cacheDolar.ts < 30 * 60 * 1000) {
    return cacheDolar.valor;
  }

  try {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 4000);

    const r = await fetch("https://dolarapi.com/v1/dolares/blue", { signal: controlador.signal });
    clearTimeout(corte);

    if (r.ok) {
      const d = await r.json();
      const venta = Number(d?.venta);
      if (Number.isFinite(venta) && venta > 0) {
        cacheDolar = { valor: venta, ts: Date.now() };
        return venta;
      }
    }
  } catch (e) {
    console.error("Cotización no disponible, se usa el valor de respaldo:", e?.message || e);
  }

  return fallback;
}

/* ==========================================================================
   Limitador simple por IP
   --------------------------------------------------------------------------
   En memoria y por instancia: no es un rate limit distribuido serio, pero
   corta el abuso trivial (alguien apretando "pagar" en bucle) sin sumar
   infraestructura. El limite de verdad para los datos esta en la base.
   ========================================================================== */
const golpes = new Map();

export function limitar(ip, max = 12, ventanaMs = 60_000) {
  const ahora = Date.now();
  const previos = (golpes.get(ip) || []).filter((t) => ahora - t < ventanaMs);

  if (previos.length >= max) return false;

  previos.push(ahora);
  golpes.set(ip, previos);

  // Poda para que el Map no crezca sin limite en instancias de larga vida.
  if (golpes.size > 2000) {
    for (const [clave, marcas] of golpes) {
      if (marcas.every((t) => ahora - t > ventanaMs)) golpes.delete(clave);
    }
  }
  return true;
}

export function ipDe(req) {
  const reenviada = req.headers["x-forwarded-for"];
  if (typeof reenviada === "string" && reenviada) return reenviada.split(",")[0].trim();
  return req.socket?.remoteAddress || "desconocida";
}
