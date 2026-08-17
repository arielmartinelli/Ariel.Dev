/**
 * POST /api/mp-webhook
 *
 * Recibe los avisos de Mercado Pago y marca los pagos como acreditados.
 * Esta URL se configura en: Mercado Pago -> Tus integraciones -> Webhooks.
 *
 * ------------------------------------------------------------------------
 * ESTE ES EL ENDPOINT MAS SENSIBLE DE TODO EL PROYECTO
 * ------------------------------------------------------------------------
 * Es publico (Mercado Pago tiene que poder llamarlo) y decide quien figura
 * como que pago. Un endpoint que le crea al POST que recibe es un endpoint
 * que regala trabajo: alguien manda "pago aprobado" y listo.
 *
 * Tres defensas, en este orden:
 *
 *   1. FIRMA. Se valida el HMAC de la cabecera x-signature contra
 *      MP_WEBHOOK_SECRET. Sin firma valida, no se sigue.
 *
 *   2. VERIFICACION EN LA FUENTE. Aunque la firma sea valida, el estado NO se
 *      toma del cuerpo del POST: se vuelve a preguntar a la API de Mercado
 *      Pago por ese pago (GET /v1/payments/<id>) usando el access token. Lo
 *      unico que se cree es lo que responde Mercado Pago directamente.
 *
 *   3. MONTO. Se compara lo efectivamente aprobado contra lo que se esperaba
 *      cobrar. Un pago de $100 no acredita un saldo de $400.000.
 *
 * Ademas es IDEMPOTENTE: Mercado Pago reintenta las notificaciones, asi que
 * el mismo aviso puede llegar varias veces. Procesarlo dos veces no debe
 * duplicar nada.
 */

import {
  leerConfig, supabaseAdmin, json, validarFirmaMercadoPago, leerBodyCrudo,
} from "./_lib.js";

export default async function handler(req, res) {
  // Mercado Pago reintenta ante cualquier respuesta que no sea 2xx. Por eso
  // varios caminos devuelven 200 aunque no hagan nada: son casos donde
  // reintentar no cambiaria el resultado y solo generaria ruido.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Método no permitido." });
  }

  const { cfg, faltantes } = leerConfig();
  if (faltantes.length) {
    console.error("Webhook sin configurar. Faltan:", faltantes.join(", "));
    // 503 para que Mercado Pago reintente cuando esté configurado.
    return json(res, 503, { error: "No disponible." });
  }

  const crudo = await leerBodyCrudo(req);
  let aviso = {};
  try {
    aviso = crudo ? JSON.parse(crudo) : {};
  } catch {
    return json(res, 200, { ignorado: "cuerpo ilegible" });
  }

  // El id llega por query (?data.id=) o dentro del cuerpo, según el tipo.
  const url = new URL(req.url, "http://localhost");
  const dataId = url.searchParams.get("data.id") || aviso?.data?.id || "";
  const tipo = url.searchParams.get("type") || aviso?.type || aviso?.topic || "";

  // Solo interesan los avisos de pagos. El resto (merchant_order, etc.) se
  // acepta y se descarta: devolver error haría que MP reintente para siempre.
  if (tipo !== "payment") {
    return json(res, 200, { ignorado: `tipo ${tipo || "desconocido"}` });
  }

  // ---- Defensa 1: firma ----
  const firma = validarFirmaMercadoPago({
    xSignature: req.headers["x-signature"],
    xRequestId: req.headers["x-request-id"],
    dataId,
    secreto: cfg.mpWebhookSecret,
  });

  if (!firma.ok) {
    console.warn("Webhook rechazado:", firma.motivo);
    // 401 y no 200: si de verdad es Mercado Pago, el panel de webhooks lo
    // muestra como fallo y el problema se ve en vez de pasar desapercibido.
    return json(res, 401, { error: "Firma inválida." });
  }

  const db = supabaseAdmin(cfg);

  try {
    // ---- Defensa 2: preguntarle a la fuente ----
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${cfg.mpAccessToken}` },
    });

    if (!r.ok) {
      console.error("No se pudo consultar el pago en Mercado Pago:", r.status);
      // 500 -> Mercado Pago reintenta. Puede ser un problema momentáneo.
      return json(res, 500, { error: "No se pudo verificar el pago." });
    }

    const pagoMp = await r.json();
    const estadoMp = pagoMp?.status;                 // approved | rejected | pending ...
    const referencia = String(pagoMp?.external_reference || "");
    const montoAprobado = Number(pagoMp?.transaction_amount);

    // external_reference lo armó nuestra función: "<client_id>:<kind>:<payment_id>"
    const [clientId, kind, paymentId] = referencia.split(":");
    if (!clientId || !kind || !paymentId) {
      console.warn("Pago sin referencia reconocible:", referencia);
      return json(res, 200, { ignorado: "sin referencia" });
    }

    const { data: pago, error: errPago } = await db
      .from("payments")
      .select("id, client_id, kind, amount_ars, amount_usd, status, mp_payment_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (errPago) throw errPago;
    if (!pago) return json(res, 200, { ignorado: "pago inexistente" });

    // ---- Idempotencia ----
    if (pago.status === "pagado" && pago.mp_payment_id === String(dataId)) {
      return json(res, 200, { ok: true, repetido: true });
    }

    // ---- Estados que no acreditan ----
    if (estadoMp !== "approved") {
      const nuevoEstado = ["rejected", "cancelled"].includes(estadoMp) ? "rechazado" : "en_proceso";
      await db.from("payments").update({ status: nuevoEstado, mp_payment_id: String(dataId) }).eq("id", pago.id);
      return json(res, 200, { ok: true, estado: nuevoEstado });
    }

    // ---- Defensa 3: el monto tiene que coincidir ----
    // Se tolera 1% por redondeo de la cotización entre que se creó la
    // preferencia y que se pagó. Cualquier diferencia mayor NO se acredita
    // sola: queda registrada para revisarla a mano.
    const esperado = Number(pago.amount_ars);
    if (Number.isFinite(esperado) && esperado > 0) {
      const desvio = Math.abs(montoAprobado - esperado) / esperado;
      if (desvio > 0.01) {
        console.error(
          `Monto no coincide en el pago ${pago.id}: esperado ${esperado} ARS, recibido ${montoAprobado} ARS.`
        );
        await db.from("payments")
          .update({ status: "en_proceso", mp_payment_id: String(dataId) })
          .eq("id", pago.id);
        return json(res, 200, { ok: true, revisar: "monto no coincide" });
      }
    }

    // ---- Acreditación ----
    const { error: errUpdate } = await db
      .from("payments")
      .update({
        status: "pagado",
        method: "mercadopago",
        mp_payment_id: String(dataId),
        paid_at: new Date().toISOString(),
        amount_ars: montoAprobado,
      })
      .eq("id", pago.id);

    if (errUpdate) throw errUpdate;

    // Al acreditarse el saldo final, el proyecto pasa a finalizado. Se hace
    // acá y no en el navegador porque este es el único punto que sabe, con
    // certeza verificada contra Mercado Pago, que el dinero entró.
    if (kind === "saldo") {
      const { data: pendientes } = await db
        .from("payments")
        .select("id")
        .eq("client_id", clientId)
        .neq("status", "pagado");

      if (!pendientes || pendientes.length === 0) {
        await db.from("clients").update({ status: "finalizado" }).eq("id", clientId);
      }
    }

    console.log(`Pago acreditado: ${kind} del cliente ${clientId} (MP ${dataId}).`);
    return json(res, 200, { ok: true });
  } catch (err) {
    console.error("Error procesando el webhook:", err?.message || err);
    // 500 para que Mercado Pago reintente: perder una acreditación es peor
    // que procesar el mismo aviso dos veces (que ya está contemplado arriba).
    return json(res, 500, { error: "Error interno." });
  }
}
