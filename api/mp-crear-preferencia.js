/**
 * POST /api/mp-crear-preferencia
 *
 * Crea una preferencia de Checkout Pro y devuelve el init_point (la URL de
 * Mercado Pago a la que se manda al cliente).
 *
 * Body: { token: "<token del portal>", kind: "anticipo" | "saldo" | "total" | "cuota" | "otro" | ... }
 *
 * ------------------------------------------------------------------------
 * POR QUE ESTO NO PUEDE ESTAR EN EL NAVEGADOR
 * ------------------------------------------------------------------------
 * Crear una preferencia exige el MP_ACCESS_TOKEN de la cuenta. Ese token
 * permite cobrar, consultar y reembolsar en tu nombre. Si estuviera en el
 * bundle, cualquiera lo lee con Ctrl+U. Por eso vive solo aca.
 *
 * ------------------------------------------------------------------------
 * REGLA DE ORO DE ESTE ARCHIVO
 * ------------------------------------------------------------------------
 * EL MONTO NO SE RECIBE DEL CLIENTE. Se calcula en el servidor a partir del
 * precio guardado en la base. Si el importe viniera en el body, alguien
 * podria mandar { amount: 1 } y pagar un dolar por un proyecto de 800.
 * El navegador solo dice QUE quiere pagar, nunca CUANTO.
 */

import {
  leerConfig, supabaseAdmin, json, cotizacionUsdArs, limitar, ipDe,
} from "./_lib.js";

const TITULOS = {
  anticipo: "Anticipo — desarrollo web",
  saldo: "Saldo final — desarrollo web",
  dominio: "Dominio propio (.com) — registro y configuración",
  total: "Desarrollo web — pago total",
  reserva: "Reserva — desarrollo web",
  cuota: "Cuota — desarrollo web",
  otro: "Adicional — desarrollo web",
};

/* Cuántas cuotas se le ofrecen al cliente.
   Solo el plan de 3 cuotas: es UN cobro por el total y el que lo divide en
   tres es el banco del cliente, no nosotros. El pago total del plan «único»
   usa el mismo tipo de cobro ('total') pero va en un pago: por eso se decide
   por el PLAN y no por el tipo. */
const cuotasPara = (kind, plan) => (kind === "total" && plan === "cuotas3" ? 3 : 1);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Método no permitido." });
  }

  const ip = ipDe(req);
  if (!limitar(ip, 12, 60_000)) {
    return json(res, 429, { error: "Demasiados intentos. Esperá un minuto." });
  }

  const { cfg, faltantes } = leerConfig();
  if (faltantes.length) {
    console.error("Faltan variables de entorno:", faltantes.join(", "));
    return json(res, 503, { 
      error: `El sistema de pagos no está disponible. Faltan configurar en Vercel: ${faltantes.join(", ")}` 
    });
  }

  let cuerpo;
  try {
    cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return json(res, 400, { error: "Solicitud inválida." });
  }

  const token = String(cuerpo.token || "").trim();
  const kind = String(cuerpo.kind || "").trim();

  if (token.length < 20) return json(res, 401, { error: "Link inválido." });
  if (!TITULOS[kind]) return json(res, 400, { error: "Tipo de pago inválido." });

  const db = supabaseAdmin(cfg);

  try {
    // 1. El token identifica al cliente. Se busca en el servidor, con
    //    service_role, porque la clave publica no tiene acceso a esta tabla.
    const { data: cliente, error: errCliente } = await db
      .from("clients")
      .select("id, client_name, project_name, price_usd, domain_extra_usd, domain_choice, payment_plan, metodos_pago, status, is_active")
      .eq("access_token", token)
      .maybeSingle();

    if (errCliente) throw errCliente;
    if (!cliente || !cliente.is_active) {
      return json(res, 401, { error: "Link inválido o vencido." });
    }

    // 1b. Ariel puede apagar Mercado Pago para un cliente (migración 15).
    //     El portal ya no muestra el botón, pero esto es lo que lo hace
    //     cumplir: el botón se puede forzar desde la consola del navegador.
    const medios = Array.isArray(cliente.metodos_pago) ? cliente.metodos_pago : null;
    if (medios && !medios.includes("mercadopago")) {
      return json(res, 403, { error: "Este proyecto se paga por transferencia. Escribime si necesitás otra opción." });
    }

    // 2. El pago tiene que existir y estar pendiente. Esto evita cobrar dos
    //    veces lo mismo si el cliente deja la pestaña abierta y vuelve a
    //    apretar el botón después de haber pagado.
    //
    //    Con cuotas y extras puede haber VARIAS filas del mismo tipo: se toma
    //    la más vieja que siga sin pagar, igual que portal_subir_comprobante().
    //    El cliente nunca elige cuál: siempre se paga en orden.
    const { data: filas, error: errPago } = await db
      .from("payments")
      .select("id, kind, amount_usd, status, concepto, cuotas_mp")
      .eq("client_id", cliente.id)
      .eq("kind", kind)
      .order("created_at", { ascending: true });

    if (errPago) throw errPago;
    if (!filas || filas.length === 0) return json(res, 404, { error: "Ese pago todavía no está habilitado." });

    const pago = filas.find((f) => f.status !== "pagado");
    if (!pago) return json(res, 409, { error: "Este pago ya figura como abonado." });

    // 3. El monto sale de la base, jamás del body. Ver la nota de arriba.
    const montoUsd = Number(pago.amount_usd);
    if (!Number.isFinite(montoUsd) || montoUsd <= 0) {
      return json(res, 409, { error: "El monto de este pago no está definido. Escribime por WhatsApp." });
    }

    // Cuotas: las que fijó Ariel en ese cobro (migración 15) o, si no fijó
    // nada, las del plan.
    const cuotasFijadas = Number(pago.cuotas_mp);
    const cuotasDelPago = pago.cuotas_mp != null && Number.isInteger(cuotasFijadas)
      && cuotasFijadas >= 1 && cuotasFijadas <= 24
      ? cuotasFijadas
      : cuotasPara(kind, cliente.payment_plan);

    const cotizacion = await cotizacionUsdArs(cfg.usdArsFallback);
    const montoArs = Math.round(montoUsd * cotizacion);

    // 4. URL base para volver. Se toma de una variable de entorno y, si no
    //    está, del host de la propia petición — nunca de un dato del cliente,
    //    que permitiría redirigir el "volver" a un sitio de phishing.
    const base = cfg.siteUrl || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const volver = `${base}/cliente/${encodeURIComponent(token)}`;

    const preferencia = {
      items: [
        {
          id: `${cliente.id}-${kind}`,
          title: pago.concepto ? `${TITULOS[kind]} · ${pago.concepto}`.slice(0, 250) : TITULOS[kind],
          description: `${cliente.project_name} — ${cliente.client_name}`,
          quantity: 1,
          currency_id: "ARS",
          unit_price: montoArs,
        },
      ],
      // external_reference es el hilo que ata el pago con la fila de la base.
      // El webhook lo usa para saber qué marcar. Sin esto habría que adivinar.
      external_reference: `${cliente.id}:${kind}:${pago.id}`,
      metadata: { client_id: cliente.id, payment_id: pago.id, kind, usd: montoUsd, cotizacion },

      // CUOTAS
      // `installments` es el MÁXIMO de cuotas que Mercado Pago le ofrece al
      // cliente, y `default_installments` la que viene preseleccionada.
      //
      // ACÁ NO VA excluded_payment_types CON account_money.
      // Lo intenté para forzar el pago con tarjeta (el saldo en cuenta no se
      // puede financiar en cuotas) y Mercado Pago rechaza la preferencia
      // entera con «account_money cannot be excluded». No es un permiso que
      // falte ni una cuenta mal configurada: la documentación dice que el
      // dinero en cuenta NO se puede excluir, punto.
      // https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/payment-methods
      //
      // Y está bien que sea así: si el cliente prefiere pagar todo junto con
      // su saldo, cobrás lo mismo y antes. Las cuotas las elige él en la
      // pantalla de Mercado Pago, con la tarjeta.
      //
      // OJO: que las cuotas sean SIN INTERÉS no se decide acá. Eso se
      // configura en la cuenta de Mercado Pago (Tu negocio → Costos →
      // Cuotas sin interés) y el costo lo absorbe el vendedor. Sin esa
      // promoción activa, Mercado Pago igual ofrece 3 cuotas pero CON
      // interés para el cliente. Ver MANTENIMIENTO.md.
      payment_methods: {
        installments: cuotasDelPago,
        default_installments: cuotasDelPago,
      },
      back_urls: {
        success: `${volver}?pago=ok`,
        pending: `${volver}?pago=pendiente`,
        failure: `${volver}?pago=error`,
      },
      auto_return: "approved",
      notification_url: `${base}/api/mp-webhook`,
      statement_descriptor: "ARIELDEV",
      // 24 h para pagar: pasado ese plazo la cotización ya no es la misma.
      expires: true,
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const respuesta = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.mpAccessToken}`,
        "Content-Type": "application/json",
        // Si el cliente aprieta dos veces, Mercado Pago devuelve la MISMA
        // preferencia en lugar de crear dos cobros distintos.
        "X-Idempotency-Key": `${pago.id}-${montoArs}`,
      },
      body: JSON.stringify(preferencia),
    });

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok || !datos.init_point) {
      console.error("Mercado Pago rechazó la preferencia:", respuesta.status, datos);
      const mpMsg = datos.message || (datos.cause && datos.cause[0] && datos.cause[0].description) || `Error HTTP ${respuesta.status}`;
      return json(res, 502, { error: `Mercado Pago rechazó el pago: ${mpMsg}` });
    }

    // 5. Se guarda la preferencia y se pasa a "en_proceso" para que el portal
    //    muestre "Procesando…" y no ofrezca pagar de nuevo mientras tanto.
    await db
      .from("payments")
      .update({ mp_preference_id: datos.id, status: "en_proceso", method: "mercadopago", amount_ars: montoArs })
      .eq("id", pago.id);

    return json(res, 200, {
      init_point: datos.init_point,
      preference_id: datos.id,
      amount_ars: montoArs,
      amount_usd: montoUsd,
    });
  } catch (err) {
    console.error("Error creando la preferencia:", err?.message || err);
    return json(res, 500, { error: "No se pudo iniciar el pago. Escribime por WhatsApp y lo resolvemos." });
  }
}
