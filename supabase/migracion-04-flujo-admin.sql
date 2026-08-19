-- ============================================================================
--  MIGRACION 04 — El dueño maneja el flujo del proyecto desde su panel
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez.
--
--  ------------------------------------------------------------------------
--  QUE ESTABA ROTO
--  ------------------------------------------------------------------------
--  El flujo del proyecto (demo -> decision -> produccion -> dominio -> 100%)
--  estaba escrito como si SIEMPRE lo manejara el cliente desde su portal.
--  En la realidad la mitad de los pasos se arreglan por WhatsApp y despues
--  Ariel los tiene que reflejar en el panel. Tres callejones sin salida:
--
--   1. EL ULTIMO 1% NO SE PODIA DESTRABAR.
--      `domain_choice` solo lo escribia portal_elegir_dominio, o sea el
--      cliente. Si el dominio se hablaba por WhatsApp, la columna quedaba en
--      NULL para siempre; calcular_progreso() topeaba en 99 y portal_obtener
--      NUNCA mostraba production_url. Poner el estado en "finalizado" desde
--      el panel no cambiaba nada: el cliente seguia viendo 99% y sin link.
--      Reproducido: todas las tareas hechas + estado finalizado -> 99%.
--
--   2. LA DECISION DEL CLIENTE ERA UNA TRABA DE UNA SOLA DIRECCION.
--      Una vez escrita, portal_decidir contesta "Ya registramos tu respuesta"
--      para siempre. Un cliente que dijo que no y se arrepintio quedaba
--      muerto, y devolver el estado a "demo_lista" desde el panel no
--      alcanzaba, porque la guarda mira client_decision, no el estado.
--
--   3. MOVER EL ESTADO A MANO SALTEABA LOS EFECTOS.
--      El anticipo del 50% lo creaba portal_decidir. Si el cliente confirmaba
--      por WhatsApp y Ariel movia el selector a "en produccion", no se creaba
--      ningun pago: el proyecto arrancaba sin cobro cargado y no aparecia en
--      el tablero. Reproducido: 0 filas en payments.
--
--  ------------------------------------------------------------------------
--  COMO SE ARREGLA
--  ------------------------------------------------------------------------
--  Una sola funcion, admin_mover_flujo(), que hace la transicion Y sus
--  efectos en la misma transaccion. Es SECURITY INVOKER a proposito: corre
--  con los permisos de quien llama, asi que las policies RLS siguen siendo
--  las que mandan. No hay un uid hardcodeado de mas que mantener, y si algun
--  dia la sesion no es la de Ariel, el UPDATE toca 0 filas y la funcion
--  devuelve un error en vez de hacer algo a escondidas.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — El 100% tambien se puede alcanzar cerrando el proyecto a mano.
--
--   Se mantiene la regla original: el 100 coincide con "esta todo hecho y el
--   dominio esta definido". Lo que cambia es que ahora "finalizado" es una
--   forma valida de decir "esta todo hecho", porque el dueño puede haber
--   cerrado tareas fuera del sistema. El dominio sigue siendo obligatorio:
--   es el ultimo paso del acuerdo y no se saltea.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_progreso(p_client_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total     int;
  v_hechas    int;
  v_dominio   text;
  v_estado    estado_proyecto;
  v_progreso  int;
BEGIN
  SELECT domain_choice, status INTO v_dominio, v_estado
  FROM public.clients WHERE id = p_client_id;

  IF v_estado IS NULL OR v_estado IN ('demo_pendiente', 'demo_lista', 'rechazado') THEN
    RETURN 0;
  END IF;

  -- NUEVO: proyecto cerrado por el dueño y con dominio definido = terminado.
  -- Sin esto, un proyecto sin tareas cargadas se quedaba en 0% aunque
  -- estuviera finalizado, y uno con todas las tareas hechas se quedaba en 99
  -- esperando una eleccion de dominio que quizas se hizo por telefono.
  IF v_estado = 'finalizado' AND v_dominio IS NOT NULL THEN
    RETURN 100;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE done)
    INTO v_total, v_hechas
  FROM public.client_tasks WHERE client_id = p_client_id;

  IF v_total = 0 THEN
    v_progreso := 0;
  ELSE
    v_progreso := floor((v_hechas::numeric / v_total) * 99);
  END IF;

  IF v_total > 0 AND v_hechas = v_total AND v_dominio IS NOT NULL THEN
    v_progreso := 100;
  END IF;

  RETURN v_progreso;
END$$;


-- ---------------------------------------------------------------------------
-- PASO 2 — La funcion de flujo del panel.
--
--   Todos los parametros son opcionales: se manda solo lo que se quiere
--   cambiar. NULL significa "no tocar", no "borrar".
--
--   p_dominio acepta 'vercel', 'propio' o 'ninguno' (para volver a dejarlo
--   sin definir). Se usa la palabra 'ninguno' en vez de NULL justamente para
--   poder distinguir "no me interesa este campo" de "borralo".
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_mover_flujo(uuid, text, text, text, boolean);

CREATE FUNCTION public.admin_mover_flujo(
  p_client_id        uuid,
  p_status           text    DEFAULT NULL,
  p_dominio          text    DEFAULT NULL,
  p_dominio_nombre   text    DEFAULT NULL,
  p_reabrir_decision boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER            -- <- las policies RLS siguen decidiendo
SET search_path = public
AS $$
DECLARE
  c          public.clients%ROWTYPE;
  v_estado   estado_proyecto;
  v_avisos   text[] := '{}';
  v_anticipo numeric;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN
     ('demo_pendiente','demo_lista','rechazado','en_produccion','finalizado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estado inválido: ' || p_status);
  END IF;

  IF p_dominio IS NOT NULL AND p_dominio NOT IN ('vercel','propio','ninguno') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Opción de dominio inválida: ' || p_dominio);
  END IF;

  -- FOR UPDATE bajo RLS: si la sesion no es la del dueño, no encuentra la
  -- fila y sale por acá. La autorizacion la hace la policy, no un IF.
  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'No se encontró el cliente (o la sesión no tiene permiso).');
  END IF;

  v_estado := COALESCE(p_status::estado_proyecto, c.status);

  -- --- Reabrir la decision -------------------------------------------------
  -- Se limpia explicitamente si lo piden, y tambien de forma automatica al
  -- volver a cualquier etapa previa a la decision: es lo que uno espera al
  -- mandar un proyecto de vuelta a "demo lista".
  IF p_reabrir_decision OR v_estado IN ('demo_pendiente','demo_lista') THEN
    UPDATE public.clients
       SET client_decision = NULL, decision_at = NULL
     WHERE id = p_client_id;
    c.client_decision := NULL;
  END IF;

  -- --- Estado --------------------------------------------------------------
  IF p_status IS NOT NULL AND v_estado <> c.status THEN
    UPDATE public.clients SET status = v_estado WHERE id = p_client_id;

    -- Coherencia con lo que ve el cliente: si el dueño lo pasa a produccion,
    -- es porque el cliente acepto (aunque haya sido por WhatsApp).
    IF v_estado = 'en_produccion' AND c.client_decision IS NULL THEN
      UPDATE public.clients
         SET client_decision = 'continuar', decision_at = now()
       WHERE id = p_client_id;
    END IF;

    IF v_estado = 'rechazado' THEN
      UPDATE public.clients
         SET client_decision = 'no_continuar', decision_at = COALESCE(decision_at, now())
       WHERE id = p_client_id;
    END IF;
  END IF;

  -- --- Anticipo del 50% ----------------------------------------------------
  -- Este era el efecto que se perdia al mover el estado a mano. Se crea igual
  -- que lo hace portal_decidir, con el mismo ON CONFLICT contra el indice
  -- parcial (repetir el WHERE del indice no es opcional en Postgres).
  IF v_estado IN ('en_produccion','finalizado') AND c.price_usd > 0 THEN
    v_anticipo := round(c.price_usd * 0.5, 2);
    INSERT INTO public.payments (client_id, kind, amount_usd, status)
    VALUES (p_client_id, 'anticipo', v_anticipo, 'pendiente')
    ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo','saldo','dominio')
    DO NOTHING;
  END IF;

  -- --- Dominio -------------------------------------------------------------
  IF p_dominio = 'ninguno' THEN
    UPDATE public.clients SET domain_choice = NULL, domain_name = NULL
     WHERE id = p_client_id;
    DELETE FROM public.payments
     WHERE client_id = p_client_id AND kind = 'dominio' AND status <> 'pagado';

  ELSIF p_dominio = 'vercel' THEN
    UPDATE public.clients SET domain_choice = 'vercel', domain_name = NULL
     WHERE id = p_client_id;
    DELETE FROM public.payments
     WHERE client_id = p_client_id AND kind = 'dominio' AND status <> 'pagado';

  ELSIF p_dominio = 'propio' THEN
    UPDATE public.clients
       SET domain_choice = 'propio',
           domain_name   = NULLIF(left(btrim(COALESCE(p_dominio_nombre, '')), 253), '')
     WHERE id = p_client_id;
    INSERT INTO public.payments (client_id, kind, amount_usd, status)
    VALUES (p_client_id, 'dominio', c.domain_extra_usd, 'pendiente')
    ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo','saldo','dominio')
    DO NOTHING;
  END IF;

  -- --- Avisos --------------------------------------------------------------
  -- No bloquean nada: informan por que el cliente todavia no ve lo que
  -- deberia ver. Antes esto no se decia en ningun lado y parecia un bug.
  SELECT * INTO c FROM public.clients WHERE id = p_client_id;

  IF c.status = 'finalizado' AND c.domain_choice IS NULL THEN
    v_avisos := array_append(v_avisos, 'Falta definir el dominio: sin eso el progreso no llega a 100% y el cliente no ve el link final.');
  END IF;
  IF c.status = 'finalizado' AND COALESCE(c.production_url, '') = '' THEN
    v_avisos := array_append(v_avisos, 'Falta cargar el link de producción: el cliente no tiene qué abrir.');
  END IF;
  IF c.status = 'demo_lista' AND COALESCE(c.demo_url, '') = '' THEN
    v_avisos := array_append(v_avisos, 'Falta cargar el link de la demo: el cliente entra y no ve nada que revisar.');
  END IF;
  IF c.status = 'en_produccion' AND c.domain_choice IS NULL THEN
    v_avisos := array_append(v_avisos, 'El dominio todavía no está definido. Lo puede elegir el cliente desde su panel, o podés cargarlo vos acá.');
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'status',          c.status,
    'client_decision', c.client_decision,
    'domain_choice',   c.domain_choice,
    'domain_name',     c.domain_name,
    'progreso',        public.calcular_progreso(p_client_id),
    'avisos',          to_jsonb(v_avisos)
  );
END$$;

-- anon NO: esto es del panel, y el panel exige sesion.
REVOKE ALL ON FUNCTION public.admin_mover_flujo(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mover_flujo(uuid, text, text, text, boolean) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 3 — portal_decidir: dejar que una decision reabierta se vuelva a tomar.
--
--   Cambia una sola cosa: el mensaje de "ya respondiste" ahora solo aplica si
--   la decision sigue puesta. Como el panel ahora puede ponerla en NULL, el
--   cliente que se arrepintio puede volver a entrar por el mismo link y
--   decidir de nuevo. La proteccion contra el doble click sigue intacta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_decidir(
  p_token    text,
  p_decision text,
  p_cambios  text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c         public.clients%ROWTYPE;
  v_texto   text;
  v_pos     int := 0;
  v_creadas int := 0;
BEGIN
  IF p_decision NOT IN ('continuar', 'no_continuar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisión inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF c.status <> 'demo_lista' THEN
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

  UPDATE public.clients
     SET client_decision = 'continuar', decision_at = now(), status = 'en_produccion'
   WHERE id = c.id;

  -- La posicion arranca despues de las tareas que ya existan: si el proyecto
  -- se reabrio, las tareas viejas siguen ahi y no hay que pisarles el orden.
  SELECT COALESCE(max(position), 0) INTO v_pos
  FROM public.client_tasks WHERE client_id = c.id;

  FOREACH v_texto IN ARRAY COALESCE(p_cambios, '{}')
  LOOP
    v_texto := btrim(v_texto);
    CONTINUE WHEN v_texto = '';
    EXIT WHEN v_creadas >= 40;

    v_pos := v_pos + 1;
    INSERT INTO public.client_tasks (client_id, title, source, position)
    VALUES (c.id, left(v_texto, 400), 'cliente', v_pos);
    v_creadas := v_creadas + 1;
  END LOOP;

  INSERT INTO public.payments (client_id, kind, amount_usd, status)
  VALUES (c.id, 'anticipo', round(c.price_usd * 0.5, 2), 'pendiente')
  ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo','saldo','dominio')
  DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'status', 'en_produccion', 'tareas', v_creadas);
END$$;


-- ---------------------------------------------------------------------------
-- PASO 4 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
SELECT '✅ OK' AS estado, 'El panel puede mover el flujo (admin_mover_flujo)' AS chequeo
WHERE EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_mover_flujo'
)
UNION ALL
SELECT '❌ FALTA', 'El panel puede mover el flujo (admin_mover_flujo)'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_mover_flujo'
)

UNION ALL
SELECT '✅ OK', 'anon NO puede ejecutarla'
WHERE NOT has_function_privilege('anon',
  'public.admin_mover_flujo(uuid, text, text, text, boolean)', 'EXECUTE')
UNION ALL
SELECT '❌ REVISAR', 'anon NO puede ejecutarla'
WHERE has_function_privilege('anon',
  'public.admin_mover_flujo(uuid, text, text, text, boolean)', 'EXECUTE')

UNION ALL
SELECT '✅ OK', 'Un proyecto finalizado con dominio llega a 100%'
WHERE (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='calcular_progreso')
      LIKE '%v_estado = ''finalizado'' AND v_dominio IS NOT NULL%'
UNION ALL
SELECT '❌ FALTA', 'Un proyecto finalizado con dominio llega a 100%'
WHERE (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='calcular_progreso')
      NOT LIKE '%v_estado = ''finalizado'' AND v_dominio IS NOT NULL%';
