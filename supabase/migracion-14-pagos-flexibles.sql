-- ============================================================================
--  MIGRACION 14 — Pagos flexibles: plan, reserva y cobros editables
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--  Requiere las migraciones 11, 12 y 13 ya aplicadas.
--
--  ------------------------------------------------------------------------
--  POR QUE
--  ------------------------------------------------------------------------
--  El esquema de cobros era rigido: el plan lo elegia solo el cliente (mitades
--  o 3 cuotas) y los montos salian siempre de una formula fija. El caso real
--  que lo rompio: un cliente pago una RESERVA antes de arrancar y el sistema
--  igual le pedia el anticipo completo del 50%, sin descontar nada.
--
--  ------------------------------------------------------------------------
--  QUE TRAE
--  ------------------------------------------------------------------------
--   1. DOS PLANES NUEVOS, ademas de 'mitades' y 'cuotas3':
--        'unico'         -> el 100% en un pago (transferencia o MP en 1 pago)
--        'personalizado' -> los cobros los arma Ariel a mano desde el panel
--
--   2. EL PLAN LO PUEDE FIJAR ARIEL (clients.plan_fijado). Si esta fijado, el
--      cliente ya no elige: ve el plan acordado en su link.
--
--   3. TRES TIPOS DE COBRO NUEVOS / ACLARADOS
--        'reserva' -> plata a cuenta del precio, cobrada antes de arrancar.
--                     Se DESCUENTA sola del anticipo o del pago total.
--        'cuota'   -> una parte del precio (plan personalizado). Varias.
--        'otro'    -> un EXTRA fuera del presupuesto (ya existia). Varios.
--      Y una columna 'concepto' para que cada cobro diga que es.
--
--   4. EL SALDO FINAL PASA A SER "LO QUE FALTA":
--        precio + dominio propio - todo lo ya cobrado o programado a cuenta
--      Antes era 50% fijo. Con reservas o montos editados a mano el saldo
--      quedaba mal y no habia forma de verlo hasta el momento de cobrar.
--
--   5. ARREGLA UN COBRO FANTASMA MAS: admin_mover_flujo() llamaba siempre a
--      asegurar_cobro(..., 'anticipo'). Con el plan de 3 cuotas eso creaba un
--      anticipo del 50% AL LADO del pago total. Ahora asegurar_cobro traduce
--      'anticipo' al cobro inicial que corresponde al plan.
--
--   6. Varios cobros del mismo tipo (cuotas, extras): el comprobante y Mercado
--      Pago toman siempre el PRIMERO PENDIENTE de ese tipo.
--
--  Lo PAGADO no se borra ni se recalcula en ningun paso.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — Columnas y restricciones
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS concepto text;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_concepto_len;
ALTER TABLE public.payments ADD CONSTRAINT payments_concepto_len
  CHECK (concepto IS NULL OR char_length(concepto) <= 200);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind IN ('anticipo', 'saldo', 'dominio', 'total', 'otro', 'reserva', 'cuota'));

-- El indice unico parcial NO cambia: anticipo/saldo/dominio/total siguen
-- siendo uno por cliente; reserva, cuota y otro admiten varios.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS plan_fijado boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_payment_plan_valido;
ALTER TABLE public.clients ADD CONSTRAINT clients_payment_plan_valido
  CHECK (payment_plan IS NULL OR payment_plan IN ('mitades', 'cuotas3', 'unico', 'personalizado'));

-- Los cobros manuales viejos guardaban el concepto en receipt_note (la
-- columna de la nota del comprobante). Se pasa a su lugar. Solo los que no
-- tienen comprobante: en esos receipt_note era el concepto y nada mas.
UPDATE public.payments
   SET concepto = left(receipt_note, 200)
 WHERE kind = 'otro' AND concepto IS NULL
   AND receipt_note IS NOT NULL AND receipt_image IS NULL;


-- ---------------------------------------------------------------------------
-- PASO 1 — Cuanto del precio ya esta cubierto
--
--   Suma lo cobrado O PROGRAMADO a cuenta del precio: reservas, anticipo,
--   pago total y cuotas. Cuenta tambien lo pendiente a proposito: si el
--   anticipo sigue sin pagar al cerrar el proyecto, el saldo no tiene que
--   volver a pedir esa misma plata.
--
--   'otro' (extras) y 'dominio' NO entran: no son parte del precio.
--   SECURITY INVOKER: las policies RLS deciden que filas se ven.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cubierto_a_cuenta(p_client_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(sum(amount_usd), 0)
    FROM public.payments
   WHERE client_id = p_client_id
     AND kind IN ('reserva', 'anticipo', 'total', 'cuota');
$$;

REVOKE ALL ON FUNCTION public.cubierto_a_cuenta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cubierto_a_cuenta(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 2 — asegurar_cobro() entiende los 4 planes y la reserva
--
--   'anticipo' y 'total' se piden como "el cobro inicial" y aca se traducen
--   al que corresponde al plan. Asi admin_mover_flujo, que siempre pide
--   'anticipo', deja de crear un anticipo fantasma en el plan de 3 cuotas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asegurar_cobro(p_client_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c          public.clients%ROWTYPE;
  v_plan     text;
  v_kind     text;
  v_monto    numeric;
  v_extra    numeric;
  v_reservas numeric;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND OR c.price_usd <= 0 THEN RETURN; END IF;

  v_plan := COALESCE(c.payment_plan, 'mitades');
  v_kind := p_kind;

  IF p_kind IN ('anticipo', 'total') THEN
    -- En el plan personalizado los cobros los arma Ariel: nada automatico.
    IF v_plan = 'personalizado' THEN RETURN; END IF;
    v_kind := CASE WHEN v_plan IN ('cuotas3', 'unico') THEN 'total' ELSE 'anticipo' END;
  END IF;

  SELECT COALESCE(sum(amount_usd), 0) INTO v_reservas
    FROM public.payments WHERE client_id = p_client_id AND kind = 'reserva';

  -- Dominio propio: si quedo un cobro 'dominio' viejo ya pagado aparte, no
  -- se vuelve a sumar en el saldo.
  v_extra := CASE WHEN c.domain_choice = 'propio' THEN c.domain_extra_usd ELSE 0 END;
  v_extra := GREATEST(v_extra - COALESCE((
               SELECT sum(amount_usd) FROM public.payments
                WHERE client_id = p_client_id AND kind = 'dominio' AND status = 'pagado'), 0), 0);

  IF v_kind = 'total' THEN
    v_monto := c.price_usd - v_reservas;

  ELSIF v_kind = 'anticipo' THEN
    v_monto := round(c.price_usd * 0.5, 2) - v_reservas;

  ELSIF v_kind = 'saldo' THEN
    -- Lo que falta, no un 50% fijo.
    v_monto := c.price_usd + v_extra - public.cubierto_a_cuenta(p_client_id);

  ELSE
    RETURN;
  END IF;

  v_monto := round(GREATEST(v_monto, 0), 2);

  -- Un cobro de cero no se crea: el cliente veria una pantalla de pago por
  -- USD 0. Pasa cuando la reserva cubre todo el anticipo.
  IF v_monto <= 0 THEN RETURN; END IF;

  INSERT INTO public.payments (client_id, kind, amount_usd, status, concepto)
  VALUES (p_client_id, v_kind, v_monto, 'pendiente', NULL)
  ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo','saldo','dominio','total')
  DO NOTHING;
END$$;

REVOKE ALL ON FUNCTION public.asegurar_cobro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asegurar_cobro(uuid, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 3 — ¿Ya puede arrancar la produccion?
--
--   Regla unica, usada por el trigger, por el panel y por el portal:
--   esta esperando el pago inicial, no queda ningun anticipo/total sin pagar
--   y ya entro al menos un peso a cuenta del precio.
--
--   Cubre el caso que motivo esta migracion: la reserva alcanza para todo el
--   anticipo -> no se crea un cobro de cero -> el proyecto arranca solo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revisar_inicio(p_client_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_estado text;
BEGIN
  SELECT status INTO v_estado FROM public.clients WHERE id = p_client_id;

  IF v_estado = 'anticipo_pendiente'
     AND NOT EXISTS (SELECT 1 FROM public.payments
                      WHERE client_id = p_client_id
                        AND kind IN ('anticipo', 'total')
                        AND status <> 'pagado')
     AND EXISTS     (SELECT 1 FROM public.payments
                      WHERE client_id = p_client_id
                        AND kind IN ('reserva', 'anticipo', 'total', 'cuota')
                        AND status = 'pagado') THEN
    UPDATE public.clients SET status = 'en_produccion' WHERE id = p_client_id;
    RETURN 'en_produccion';
  END IF;

  RETURN v_estado;
END$$;

REVOKE ALL ON FUNCTION public.revisar_inicio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revisar_inicio(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 4 — El trigger de pagos con los tipos nuevos
--
--   Sigue siendo el UNICO lugar donde un pago mueve el flujo (MP, panel o
--   comprobante aprobado: da igual por donde entro).
--
--   Cierre: en 'saldo_pendiente', CUALQUIER pago que deje todo saldado cierra
--   el proyecto. Antes solo lo hacia el cobro 'saldo', y en el plan
--   personalizado el ultimo pago puede ser una cuota.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avanzar_por_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
BEGIN
  IF NEW.status <> 'pagado' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pagado' THEN RETURN NEW; END IF;

  SELECT status INTO v_estado FROM public.clients WHERE id = NEW.client_id;

  IF v_estado = 'anticipo_pendiente'
     AND NEW.kind IN ('reserva', 'anticipo', 'total', 'cuota') THEN
    PERFORM public.revisar_inicio(NEW.client_id);

  ELSIF v_estado = 'saldo_pendiente'
     AND NOT EXISTS (SELECT 1 FROM public.payments
                      WHERE client_id = NEW.client_id AND status <> 'pagado') THEN
    UPDATE public.clients SET status = 'finalizado' WHERE id = NEW.client_id;
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS payments_avanzan_flujo ON public.payments;
CREATE TRIGGER payments_avanzan_flujo
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.avanzar_por_pago();


-- ---------------------------------------------------------------------------
-- PASO 5 — Ariel fija el plan desde el panel
--
--   admin_configurar_plan(cliente, plan, fijar)
--
--   * Guarda el plan. Con fijar = true el cliente ya no lo elige.
--   * Si el cliente ya acepto (etapa >= anticipo), rehace el cobro inicial
--     con el monto correcto, DESCONTANDO las reservas cargadas.
--   * Si la reserva cubre todo, el proyecto pasa solo a produccion.
--
--   Se llama tambien despues de cargar o editar una reserva, para que el
--   anticipo se recalcule.
--
--   No toca nada si hay un pago en curso (checkout de MP abierto o un
--   comprobante esperando aprobacion): borrar ese cobro dejaria la plata
--   sin fila donde acreditarse.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_configurar_plan(
  p_client_id uuid,
  p_plan      text,
  p_fijar     boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c        public.clients%ROWTYPE;
  v_avisos text[] := '{}';
  v_estado text;
BEGIN
  IF p_plan IS NULL OR p_plan NOT IN ('mitades', 'cuotas3', 'unico', 'personalizado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Plan inválido.');
  END IF;

  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'No se encontró el cliente (o la sesión no tiene permiso).');
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments
              WHERE client_id = p_client_id
                AND kind IN ('anticipo', 'total')
                AND status IN ('en_proceso', 'en_revision')) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Hay un pago inicial en curso (Mercado Pago abierto o un comprobante para revisar). Resolvelo antes de cambiar el plan.');
  END IF;

  UPDATE public.clients
     SET payment_plan = p_plan, plan_fijado = COALESCE(p_fijar, true)
   WHERE id = p_client_id;

  -- Solo se arma el cobro inicial si el cliente ya acepto. Antes de eso el
  -- plan queda guardado y el cliente lo ve fijado en su link.
  IF public.orden_etapa(c.status) >= 2 THEN
    IF EXISTS (SELECT 1 FROM public.payments
                WHERE client_id = p_client_id
                  AND kind IN ('anticipo', 'total') AND status = 'pagado') THEN
      -- Ya cobraste un pago inicial: no se crea otro. Lo que falte se cobra
      -- con el saldo final o con cuotas que agregues a mano.
      DELETE FROM public.payments
       WHERE client_id = p_client_id AND kind IN ('anticipo', 'total')
         AND status IN ('pendiente', 'rechazado');
      v_avisos := array_append(v_avisos,
        'Ya hay un pago inicial cobrado: el resto queda para el saldo final (o agregá cuotas a mano).');
    ELSE
      DELETE FROM public.payments
       WHERE client_id = p_client_id AND kind IN ('anticipo', 'total')
         AND status IN ('pendiente', 'rechazado');
      PERFORM public.asegurar_cobro(p_client_id, 'anticipo');
    END IF;

    v_estado := public.revisar_inicio(p_client_id);
    IF v_estado = 'en_produccion' AND c.status = 'anticipo_pendiente' THEN
      v_avisos := array_append(v_avisos,
        'Lo cobrado ya cubre el pago inicial: el proyecto pasó a producción.');
    END IF;

    IF p_plan = 'personalizado' AND NOT EXISTS (
         SELECT 1 FROM public.payments
          WHERE client_id = p_client_id AND kind = 'cuota' AND status <> 'pagado') THEN
      v_avisos := array_append(v_avisos,
        'Plan personalizado: agregá las cuotas con «+ Agregar cobro».');
    END IF;
  END IF;

  SELECT * INTO c FROM public.clients WHERE id = p_client_id;

  RETURN jsonb_build_object(
    'ok', true,
    'plan', c.payment_plan,
    'plan_fijado', c.plan_fijado,
    'status', c.status,
    'avisos', to_jsonb(v_avisos)
  );
END$$;

REVOKE ALL ON FUNCTION public.admin_configurar_plan(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_configurar_plan(uuid, text, boolean) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 6 — Recalcular el saldo final
--
--   Borra el saldo SIN PAGAR y SIN PAGO EN CURSO y lo vuelve a crear con lo
--   que falta hoy. Es lo que hace el boton «Recalcular el saldo» del panel.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_recalcular_saldo(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_monto numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments
              WHERE client_id = p_client_id AND kind = 'saldo'
                AND status IN ('en_proceso', 'en_revision')) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'El saldo tiene un pago en curso (Mercado Pago o comprobante). Resolvelo primero.');
  END IF;

  DELETE FROM public.payments
   WHERE client_id = p_client_id AND kind = 'saldo'
     AND status IN ('pendiente', 'rechazado');

  PERFORM public.asegurar_cobro(p_client_id, 'saldo');

  SELECT amount_usd INTO v_monto FROM public.payments
   WHERE client_id = p_client_id AND kind = 'saldo';

  RETURN jsonb_build_object('ok', true, 'monto', COALESCE(v_monto, 0));
END$$;

REVOKE ALL ON FUNCTION public.admin_recalcular_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recalcular_saldo(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 7 — admin_cerrar_o_cobrar: el saldo se calcula con los numeros de hoy
--
--   Mismo cuerpo que la migracion 11 + una linea: antes de pedir el saldo se
--   borra el saldo viejo sin pagar. Sin eso, si entre medio cargaste una
--   reserva o editaste un monto, quedaba el importe viejo (asegurar_cobro usa
--   ON CONFLICT DO NOTHING y no lo pisa).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cerrar_o_cobrar(p_client_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c public.clients%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  DELETE FROM public.payments
   WHERE client_id = p_client_id AND kind = 'saldo'
     AND status IN ('pendiente', 'rechazado');

  PERFORM public.asegurar_cobro(p_client_id, 'saldo');

  -- ¿Quedo algo sin pagar? Si no, el proyecto esta terminado.
  IF EXISTS (SELECT 1 FROM public.payments
              WHERE client_id = p_client_id AND status <> 'pagado') THEN
    UPDATE public.clients SET status = 'saldo_pendiente' WHERE id = p_client_id;
    RETURN 'saldo_pendiente';
  END IF;

  UPDATE public.clients SET status = 'finalizado' WHERE id = p_client_id;
  RETURN 'finalizado';
END$$;

REVOKE ALL ON FUNCTION public.admin_cerrar_o_cobrar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cerrar_o_cobrar(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 8 — portal_decidir: respeta el plan fijado y acepta 'unico'
--
--   Cuerpo tomado de la migracion 13 (la version que esta corriendo), con
--   cambios solo en el bloque del plan. Lo de "volver atras" de la 07 y la
--   limpieza de fantasmas de la 13 quedan iguales.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_decidir(p_token text, p_decision text, p_cambios text[] DEFAULT NULL::text[], p_plan text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c     public.clients%ROWTYPE;
  v_kind text;
  v_plan text;
BEGIN
  IF p_decision NOT IN ('continuar', 'no_continuar', 'reabrir_demo', 'reset_demo',
                        'volver_demo', 'volver_anticipo', 'volver_cambios', 'volver_dominio') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisión inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  -- --- Volver a un paso anterior (migracion 07) --------------------------
  IF p_decision IN ('reabrir_demo', 'reset_demo', 'volver_demo') THEN
    UPDATE public.clients
       SET status = 'demo_lista', client_decision = NULL, decision_at = NULL
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'demo_lista');
  END IF;

  IF p_decision = 'volver_anticipo' THEN
    UPDATE public.clients SET status = 'anticipo_pendiente' WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'anticipo_pendiente');
  END IF;

  IF p_decision = 'volver_cambios' THEN
    UPDATE public.clients SET status = 'en_produccion' WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'en_produccion');
  END IF;

  IF p_decision = 'volver_dominio' THEN
    UPDATE public.clients SET status = 'dominio' WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'dominio');
  END IF;

  -- --- Decidir sobre la demo ---------------------------------------------
  IF c.status <> 'demo_lista' OR COALESCE(c.demo_url, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Todavía no hay una demo lista para revisar.');
  END IF;

  IF c.client_decision IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya registramos tu respuesta.');
  END IF;

  IF p_decision = 'no_continuar' THEN
    UPDATE public.clients
       SET client_decision = 'no_continuar', decision_at = now(), status = 'rechazado'
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'rechazado');
  END IF;

  -- --- El plan -----------------------------------------------------------
  IF c.plan_fijado AND c.payment_plan IS NOT NULL THEN
    -- Lo acordo Ariel con el cliente: lo que mande el navegador no cuenta.
    v_plan := c.payment_plan;
  ELSE
    -- 'personalizado' no se ofrece al cliente: solo lo puede fijar Ariel.
    IF p_plan IS NULL OR p_plan NOT IN ('mitades', 'cuotas3', 'unico') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Elegí cómo querés pagar antes de continuar.');
    END IF;

    -- Si YA HAY PLATA COBRADA (migracion 13), el plan no se cambia.
    IF EXISTS (SELECT 1 FROM public.payments
                WHERE client_id = c.id AND status = 'pagado'
                  AND kind IN ('anticipo', 'total')) THEN
      v_plan := COALESCE(c.payment_plan, p_plan);
    ELSE
      v_plan := p_plan;
    END IF;
  END IF;

  v_kind := CASE WHEN v_plan IN ('cuotas3', 'unico') THEN 'total'
                 WHEN v_plan = 'personalizado' THEN NULL
                 ELSE 'anticipo' END;

  -- Limpieza del plan anterior (migracion 13). Solo lo NO pagado y sin un
  -- pago en curso. Reservas, cuotas y extras no se tocan: los cargo Ariel.
  DELETE FROM public.payments
   WHERE client_id = c.id
     AND status IN ('pendiente', 'rechazado')
     AND kind IN ('anticipo', 'saldo', 'total')
     AND (v_kind IS NULL OR kind <> v_kind);

  UPDATE public.clients
     SET client_decision = 'continuar',
         decision_at     = now(),
         status          = 'anticipo_pendiente',
         payment_plan    = v_plan
   WHERE id = c.id;

  IF v_kind IS NOT NULL THEN
    PERFORM public.asegurar_cobro(c.id, v_kind);
  END IF;

  -- La reserva puede haber cubierto todo el pago inicial.
  PERFORM public.revisar_inicio(c.id);

  SELECT * INTO c FROM public.clients WHERE id = c.id;

  RETURN jsonb_build_object('ok', true, 'status', c.status,
                            'plan', v_plan, 'cobro', v_kind);
END$function$;

REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[], text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 9 — portal_subir_comprobante: el PRIMER cobro pendiente de ese tipo
--
--   Cuerpo de la migracion 05 (la ultima que la definio). Cambia solo la
--   busqueda del pago: con varias cuotas o extras, "kind = 'cuota'" ya no
--   identifica una fila sola. Se toma la mas vieja que siga sin pagar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_subir_comprobante(
  p_token   text,
  p_kind    text,
  p_imagen  text,
  p_nota    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c           public.clients%ROWTYPE;
  v_pago      public.payments%ROWTYPE;
  v_recientes int;
BEGIN
  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  -- Limite ANTES de validar la imagen: si no, cada intento rechazado igual
  -- obliga al servidor a recibir y analizar 2 MB.
  SELECT count(*) INTO v_recientes
  FROM public.payments
  WHERE client_id = c.id
    AND receipt_uploaded_at IS NOT NULL
    AND receipt_uploaded_at > now() - interval '1 hour';

  IF v_recientes >= 5 THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Subiste varios comprobantes seguidos. Esperá un rato o escribime por WhatsApp.');
  END IF;

  IF p_imagen IS NULL OR p_imagen !~ '^data:image/(png|jpe?g|webp);base64,' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El archivo tiene que ser una imagen (JPG, PNG o WEBP).');
  END IF;

  IF char_length(p_imagen) > 2000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La imagen es demasiado pesada.');
  END IF;

  SELECT * INTO v_pago FROM public.payments
  WHERE client_id = c.id AND kind = p_kind AND status <> 'pagado'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.payments
                WHERE client_id = c.id AND kind = p_kind AND status = 'pagado') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Ese pago ya figura como abonado.');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'Ese pago no existe.');
  END IF;

  UPDATE public.payments
     SET receipt_image       = p_imagen,
         receipt_note        = NULLIF(left(coalesce(btrim(p_nota), ''), 500), ''),
         receipt_uploaded_at = now(),
         method              = 'transferencia',
         -- 'en_revision', NO 'pagado'. Una foto no es un pago.
         status              = 'en_revision'
   WHERE id = v_pago.id;

  RETURN jsonb_build_object('ok', true, 'status', 'en_revision');
END$$;

REVOKE ALL ON FUNCTION public.portal_subir_comprobante(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_subir_comprobante(text, text, text, text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 10 — portal_obtener: dos claves mas, SIN reescribir la funcion
--
--   La leccion de las migraciones 09, 10 y 12: reescribir portal_obtener de
--   memoria rompe cosas en silencio. Aca no se reescribe: se toma la
--   definicion que esta corriendo con pg_get_functiondef() y se le insertan
--   dos claves en lugares exactos:
--
--     'plan_fijado' al lado de 'payment_plan'
--     'concepto'    al lado de 'kind' en cada pago
--
--   Si alguno de los dos puntos de insercion no aparece, la migracion FALLA
--   con un error claro en vez de seguir con una funcion a medias.
-- ---------------------------------------------------------------------------
DO $parche$
DECLARE
  v_def   text;
  v_nueva text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'portal_obtener';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'No existe portal_obtener. Corré primero las migraciones 11 y 12.';
  END IF;

  v_nueva := v_def;

  IF v_nueva NOT LIKE '%''plan_fijado''%' THEN
    v_nueva := regexp_replace(v_nueva,
      '''payment_plan'',(\s*)c\.payment_plan,',
      '''payment_plan'',\1c.payment_plan,
    ''plan_fijado'',        c.plan_fijado,');
    IF v_nueva NOT LIKE '%''plan_fijado''%' THEN
      RAISE EXCEPTION 'No encontré ''payment_plan'' en portal_obtener: la función cambió. No se tocó nada.';
    END IF;
  END IF;

  IF v_nueva NOT LIKE '%''concepto''%' THEN
    v_nueva := regexp_replace(v_nueva,
      '''kind'',(\s*)p\.kind,',
      '''kind'',\1p.kind, ''concepto'', p.concepto,');
    IF v_nueva NOT LIKE '%''concepto''%' THEN
      RAISE EXCEPTION 'No encontré ''kind'' en los pagos de portal_obtener: la función cambió. No se tocó nada.';
    END IF;
  END IF;

  IF v_nueva <> v_def THEN
    EXECUTE v_nueva;
    RAISE NOTICE 'portal_obtener actualizada (plan_fijado + concepto).';
  ELSE
    RAISE NOTICE 'portal_obtener ya tenía plan_fijado y concepto. Nada que hacer.';
  END IF;
END$parche$;


-- ---------------------------------------------------------------------------
-- PASO 11 — v_clientes_panel con plan_fijado
--
--   Definicion de la migracion 11 (la 12 y la 13 no la tocaron) + una
--   columna. DROP + CREATE porque CREATE OR REPLACE no deja insertar
--   columnas en el medio.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_clientes_panel;

CREATE VIEW public.v_clientes_panel
WITH (security_invoker = true) AS
SELECT
  c.id, c.access_token, c.client_name, c.project_name, c.project_brief,
  c.proposal_url, c.proposal_filename,
  c.brief_pdf_url, c.brief_pdf_filename,
  c.budget_pdf_url, c.budget_pdf_filename,
  c.status, c.demo_url, c.production_url,
  c.price_usd, c.payment_plan, c.plan_fijado,
  c.domain_choice, c.domain_name, c.domain_extra_usd,
  c.client_decision, c.whatsapp, c.is_active, c.created_at,
  c.last_seen_at, c.view_count,
  public.orden_etapa(c.status)   AS orden,
  public.calcular_progreso(c.id) AS progreso,
  (SELECT count(*) FROM public.client_tasks t WHERE t.client_id = c.id)            AS tareas_total,
  (SELECT count(*) FROM public.client_tasks t WHERE t.client_id = c.id AND t.done) AS tareas_hechas,
  COALESCE((SELECT sum(p.amount_usd) FROM public.payments p
             WHERE p.client_id = c.id AND p.status = 'pagado'), 0)                 AS cobrado_usd,
  COALESCE((SELECT sum(p.amount_usd) FROM public.payments p
             WHERE p.client_id = c.id AND p.status <> 'pagado'), 0)                AS pendiente_usd,
  (SELECT count(*) FROM public.payments p
     WHERE p.client_id = c.id AND p.status = 'en_revision')                        AS comprobantes_a_revisar
FROM public.clients c;

GRANT SELECT ON public.v_clientes_panel TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 12 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'Tipos de cobro reserva y cuota habilitados' AS q, (
    SELECT pg_get_constraintdef(oid) LIKE '%reserva%' AND pg_get_constraintdef(oid) LIKE '%cuota%'
      FROM pg_constraint WHERE conname='payments_kind_check') AS ok
  UNION ALL SELECT 'Planes unico y personalizado habilitados', (
    SELECT pg_get_constraintdef(oid) LIKE '%personalizado%' AND pg_get_constraintdef(oid) LIKE '%unico%'
      FROM pg_constraint WHERE conname='clients_payment_plan_valido')
  UNION ALL SELECT 'Columna concepto en payments', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='payments' AND column_name='concepto')
  UNION ALL SELECT 'Columna plan_fijado en clients', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='clients' AND column_name='plan_fijado')
  UNION ALL SELECT 'El panel ve plan_fijado', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='v_clientes_panel' AND column_name='plan_fijado')
  UNION ALL SELECT 'El portal recibe plan_fijado y el concepto de cada pago', (
    SELECT prosrc LIKE '%plan_fijado%' AND prosrc LIKE '%p.concepto%'
      FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'portal_obtener conserva el número de recibo (migración 12)', (
    SELECT prosrc LIKE '%nro_recibo%' FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'portal_obtener sigue registrando la visita', (
    SELECT provolatile='v' AND prosrc LIKE '%last_seen_at%' FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'El saldo descuenta lo ya cubierto', (
    SELECT prosrc LIKE '%cubierto_a_cuenta%' FROM pg_proc WHERE proname='asegurar_cobro')
  UNION ALL SELECT 'Sigue habiendo UNA sola portal_decidir', (
    SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='portal_decidir')
  UNION ALL SELECT 'anon NO puede configurar planes', NOT has_function_privilege('anon',
    'public.admin_configurar_plan(uuid, text, boolean)', 'EXECUTE')
  UNION ALL SELECT 'anon NO puede recalcular saldos', NOT has_function_privilege('anon',
    'public.admin_recalcular_saldo(uuid)', 'EXECUTE')
  UNION ALL SELECT 'anon NO puede crear cobros', NOT has_function_privilege('anon',
    'public.asegurar_cobro(uuid, text)', 'EXECUTE')
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;
