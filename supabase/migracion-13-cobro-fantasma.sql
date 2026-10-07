-- ============================================================================
--  MIGRACION 13 — El cobro fantasma del plan que el cliente descarto
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  ------------------------------------------------------------------------
--  QUE PASABA
--  ------------------------------------------------------------------------
--  El cliente acepta la demo y elige "mitad y mitad" -> se le crea un cobro
--  de anticipo por el 50%.
--  Despues se arrepiente, toca "Retomar proyecto desde la Demo", vuelve a
--  aceptar y esta vez elige "3 cuotas" -> se le crea un cobro 'total' por el
--  100%.
--
--  Y EL ANTICIPO DEL 50% QUEDA AHI, sin pagar, para siempre.
--
--  El portal solo le muestra el cobro de su plan actual, asi que el cliente
--  no ve nada raro: paga el 100% y se queda tranquilo. El problema aparece
--  al final, cuando vos cerras el proyecto. admin_cerrar_o_cobrar() decide
--  si el proyecto termino preguntando:
--
--      ¿queda algun cobro sin pagar?
--
--  Con el fantasma ahi, la respuesta es SIEMPRE que si. Entonces:
--
--    * El proyecto NUNCA llega a 'finalizado'.
--    * El cliente pago todo y el portal le sigue diciendo "falta abonar".
--    * El progreso se clava en 95% y no llega nunca al 100%.
--    * En tu panel te figura plata adeudada que nadie te debe.
--
--  Nada de esto tira un error. Simplemente el proyecto no cierra y vos
--  pensas que el cliente no termino de pagar.
--
--  ------------------------------------------------------------------------
--  COMO SE VERIFICO
--  ------------------------------------------------------------------------
--  Reproducido en Postgres 16 con las 12 migraciones aplicadas:
--  cliente de USD 400 que elige mitades, vuelve, elige 3 cuotas y paga los
--  400 completos. Resultado antes del arreglo:
--
--      kind     | amount_usd | status
--      anticipo |     200.00 | pendiente   <- el fantasma
--      total    |     400.00 | pagado
--
--      estado que ve el cliente : saldo_pendiente
--      progreso                 : 95
--      adeudado en el panel     : USD 200
--
--  ------------------------------------------------------------------------
--  QUE HACE ESTA MIGRACION
--  ------------------------------------------------------------------------
--   1. Al elegir plan, borra los cobros SIN PAGAR del plan descartado.
--   2. Si ya hay plata cobrada, no deja cambiar de plan.
--   3. Limpia los fantasmas que ya existen en tu base.
--
--  Lo que esta PAGADO no se toca nunca, en ningun paso. Un cobro acreditado
--  es historia de plata que entro.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — portal_decidir deja de dejar basura atras
-- ---------------------------------------------------------------------------
-- El cuerpo NO esta reescrito de memoria: salio de pg_get_functiondef() de
-- la funcion que ya estaba corriendo, y se le cambio solo el bloque final.
-- Es la misma disciplina de la migracion 12, y por el mismo motivo: las
-- migraciones 09 y 10 rompieron cosas en silencio por reescribir funciones
-- enteras de memoria.
--
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='portal_decidir';

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

  -- Continuar: hace falta un plan valido.
  IF p_plan IS NULL OR p_plan NOT IN ('mitades', 'cuotas3') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Elegí cómo querés pagar antes de continuar.');
  END IF;

  -- Si YA HAY PLATA COBRADA, el plan no se cambia.
  -- Un cliente que pago el anticipo del 50% y despues vuelve a la demo y
  -- elige "3 cuotas" terminaria con un cobro nuevo por el 100% ADEMAS de
  -- los 200 que ya pago. Se respeta el plan con el que pago.
  IF EXISTS (SELECT 1 FROM public.payments
              WHERE client_id = c.id AND status = 'pagado') THEN
    v_plan := COALESCE(c.payment_plan, p_plan);
  ELSE
    v_plan := p_plan;
  END IF;

  v_kind := CASE WHEN v_plan = 'cuotas3' THEN 'total' ELSE 'anticipo' END;

  -- LIMPIEZA DEL PLAN ANTERIOR.
  -- Esta es la linea que faltaba y que rompia el cierre del proyecto.
  -- Antes se creaba el cobro del plan elegido y el del plan viejo quedaba
  -- ahi, sin pagar, para siempre. Como admin_cerrar_o_cobrar() pregunta
  -- "¿queda algo sin pagar?" para decidir si el proyecto termino, ese cobro
  -- fantasma hacia que la respuesta fuera SIEMPRE que si: el cliente pagaba
  -- todo y el portal le seguia diciendo "falta abonar", el progreso se
  -- clavaba en 95% y el panel mostraba plata adeudada que no existia.
  --
  -- Solo se borra lo que NO esta pagado: un cobro acreditado es historia de
  -- plata que entro y no se toca nunca, pase lo que pase.
  --
  -- El 'saldo' tambien entra: si el cliente volvio hasta la demo, cualquier
  -- saldo viejo quedo con un importe que ya no corresponde.
  -- admin_cerrar_o_cobrar() lo vuelve a crear con el numero correcto, cosa
  -- que no podria hacer si la fila vieja siguiera ahi (asegurar_cobro usa
  -- ON CONFLICT DO NOTHING).
  DELETE FROM public.payments
   WHERE client_id = c.id
     AND status <> 'pagado'
     AND kind IN ('anticipo', 'saldo', 'total')
     AND kind <> v_kind;

  UPDATE public.clients
     SET client_decision = 'continuar',
         decision_at     = now(),
         status          = 'anticipo_pendiente',
         payment_plan    = v_plan
   WHERE id = c.id;

  PERFORM public.asegurar_cobro(c.id, v_kind);

  RETURN jsonb_build_object('ok', true, 'status', 'anticipo_pendiente',
                            'plan', v_plan, 'cobro', v_kind);
END$function$;

REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[], text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 2 — Limpiar los fantasmas que ya estan en la base
-- ---------------------------------------------------------------------------
-- Para cada cliente que YA eligio plan, se borra el cobro sin pagar que no
-- corresponde a ese plan:
--
--    plan 'cuotas3' -> sobra el 'anticipo'
--    plan 'mitades' -> sobra el 'total'
--
-- Los clientes con payment_plan NULL (todavia no decidieron) no se tocan.
-- Lo pagado tampoco, nunca.
--
-- Antes de borrar, se deja la lista en los mensajes del SQL Editor, para que
-- puedas ver exactamente que se fue y no tengas que confiar en el conteo.
DO $limpieza$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.id, p.kind, p.amount_usd, p.status, c.client_name, c.project_name, c.payment_plan
      FROM public.payments p
      JOIN public.clients c ON c.id = p.client_id
     WHERE c.payment_plan IS NOT NULL
       AND p.status <> 'pagado'
       AND ((c.payment_plan = 'cuotas3' AND p.kind = 'anticipo')
         OR (c.payment_plan = 'mitades' AND p.kind = 'total'))
  LOOP
    RAISE NOTICE 'Se borra: % % (USD %, %) — cliente % / plan %',
      r.kind, r.id, r.amount_usd, r.status, r.client_name, r.payment_plan;
    DELETE FROM public.payments WHERE id = r.id;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'No habia ningun cobro fantasma. Nada que limpiar.';
  ELSE
    RAISE NOTICE '% cobro(s) fantasma eliminado(s).', n;
  END IF;
END$limpieza$;


-- ---------------------------------------------------------------------------
-- PASO 3 — Reabrir los proyectos que quedaron trabados
-- ---------------------------------------------------------------------------
-- Un proyecto que ya estaba en 'saldo_pendiente' solo por culpa del fantasma
-- ahora puede cerrar. Se cierran unicamente los que NO tienen NADA sin pagar
-- y que ya tenian el dominio y la publicacion listos.
UPDATE public.clients c
   SET status = 'finalizado'
 WHERE c.status = 'saldo_pendiente'
   AND NOT EXISTS (SELECT 1 FROM public.payments p
                    WHERE p.client_id = c.id AND p.status <> 'pagado')
   AND EXISTS     (SELECT 1 FROM public.payments p
                    WHERE p.client_id = c.id AND p.status = 'pagado');


-- ---------------------------------------------------------------------------
-- PASO 4 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'portal_decidir limpia el plan descartado' AS q, (
    SELECT prosrc LIKE '%DELETE FROM public.payments%'
      FROM pg_proc WHERE proname='portal_decidir') AS ok
  UNION ALL SELECT 'No deja cambiar de plan si ya cobraste', (
    SELECT prosrc LIKE '%status = ''pagado''%' AND prosrc LIKE '%v_plan%'
      FROM pg_proc WHERE proname='portal_decidir')
  UNION ALL SELECT 'Nunca borra un cobro pagado', (
    SELECT prosrc LIKE '%status <> ''pagado''%'
      FROM pg_proc WHERE proname='portal_decidir')
  UNION ALL SELECT 'No queda ningun cobro fantasma', NOT EXISTS (
    SELECT 1 FROM public.payments p JOIN public.clients c ON c.id = p.client_id
     WHERE c.payment_plan IS NOT NULL AND p.status <> 'pagado'
       AND ((c.payment_plan='cuotas3' AND p.kind='anticipo')
         OR (c.payment_plan='mitades' AND p.kind='total')))
  UNION ALL SELECT 'Sigue habiendo UNA sola portal_decidir', (
    SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='portal_decidir')
  UNION ALL SELECT 'Ningun proyecto cerrado con plata sin cobrar', NOT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.status='finalizado'
       AND EXISTS (SELECT 1 FROM public.payments p
                    WHERE p.client_id=c.id AND p.status <> 'pagado'))
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;
