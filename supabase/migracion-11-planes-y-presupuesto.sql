-- ============================================================================
--  MIGRACION 11 — Plan de pago, presupuesto PDF y documentos livianos
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  ------------------------------------------------------------------------
--  QUE TRAE
--  ------------------------------------------------------------------------
--   1. DOS PLANES DE PAGO que el cliente elige al aceptar la demo:
--        'mitades' -> 50% para arrancar + 50% al entregar (lo de siempre)
--        'cuotas3' -> el 100% de una, con tarjeta en Mercado Pago en 3 cuotas
--                     sin interes. Para el cliente son 3 pagos; para la caja
--                     es UNO solo y al principio.
--
--   2. PRESUPUESTO EN PDF, aparte de la propuesta que ya existia.
--
--   3. LOS PDF DEJAN DE VIAJAR EN CADA CONSULTA (ver PASO 6).
--
--   4. SE RESTAURA lo que las migraciones 09 y 10 pisaron sin querer
--      (ver abajo). Eso hoy tiene dos funciones del panel rotas en silencio.
--
--  ------------------------------------------------------------------------
--  LO QUE SE HABIA ROTO Y ACA SE ARREGLA
--  ------------------------------------------------------------------------
--  Las migraciones 09 y 10 redefinieron portal_obtener() y v_clientes_panel
--  enteras, partiendo de una version anterior. Al hacerlo se llevaron puesto:
--
--    * v_clientes_panel perdio comprobantes_a_revisar, last_seen_at,
--      view_count, orden y domain_extra_usd.
--      -> El panel NUNCA avisa que hay un comprobante esperando aprobacion
--         (hayComprobante() siempre da false en admin-clients.js), y el
--         rastro del link siempre dice "Todavia no lo abrio nadie".
--
--    * portal_obtener volvio a ser STABLE y dejo de registrar la visita.
--      -> last_seen_at y view_count no se actualizan mas: no hay forma de
--         saber si un link se filtro.
--
--    * portal_obtener dejo de mandar method / tiene_comprobante /
--      comprobante_fecha en los pagos, y perdio la correccion de
--      "demo_lista sin link" -> el cliente podia ver un boton de demo que no
--      abria nada.
--
--  No es culpa de nadie: redefinir una funcion entera en una migracion nueva
--  siempre arrastra ese riesgo. Por eso esta migracion deja las dos
--  definiciones COMPLETAS, con todo lo de la 09 y la 10 adentro.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — Columnas nuevas
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS budget_pdf_url      text,
  ADD COLUMN IF NOT EXISTS budget_pdf_filename text,
  ADD COLUMN IF NOT EXISTS payment_plan        text;

-- NULL = todavia no eligio. Se completa cuando acepta la demo.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_payment_plan_valido;
ALTER TABLE public.clients ADD CONSTRAINT clients_payment_plan_valido
  CHECK (payment_plan IS NULL OR payment_plan IN ('mitades', 'cuotas3'));

-- Los proyectos que ya venian en marcha son todos del plan viejo.
UPDATE public.clients
   SET payment_plan = 'mitades'
 WHERE payment_plan IS NULL
   AND client_decision = 'continuar';


-- ---------------------------------------------------------------------------
-- PASO 1 — Un cobro nuevo: 'total'
--
--   Es el pago unico del plan de 3 cuotas. Se podria haber reusado
--   'anticipo' con el monto al 100%, pero entonces en la tabla de Cobros
--   figuraria "Anticipo (50%)" al lado de un importe que es el total. Un
--   nombre que miente en la pantalla donde se controla la plata no sirve.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind IN ('anticipo', 'saldo', 'dominio', 'total', 'otro'));

-- El indice parcial tiene que incluir 'total': es el que evita duplicarlo.
-- Repetir este WHERE en cada ON CONFLICT de abajo NO es opcional en Postgres.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_client_id_kind_key;
DROP INDEX IF EXISTS payments_kind_unico;
CREATE UNIQUE INDEX payments_kind_unico
  ON public.payments (client_id, kind)
  WHERE kind IN ('anticipo', 'saldo', 'dominio', 'total');


-- ---------------------------------------------------------------------------
-- PASO 2 — asegurar_cobro() entiende el plan
--
--   Sigue siendo SECURITY INVOKER: las policies RLS son las que deciden.
--   Con DEFINER habria que darle EXECUTE a authenticated y cualquier cuenta
--   logueada podria crear cobros para clientes ajenos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asegurar_cobro(p_client_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c       public.clients%ROWTYPE;
  v_monto numeric;
  v_extra numeric;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND OR c.price_usd <= 0 THEN RETURN; END IF;

  v_extra := CASE WHEN c.domain_choice = 'propio' THEN c.domain_extra_usd ELSE 0 END;

  IF p_kind = 'total' THEN
    -- Plan 3 cuotas: el 100% de una. Las cuotas las arma la tarjeta, no esto.
    v_monto := c.price_usd;

  ELSIF p_kind = 'anticipo' THEN
    v_monto := round(c.price_usd * 0.5, 2);

  ELSIF p_kind = 'saldo' THEN
    -- Si ya pago el total, al final solo puede quedar el dominio propio.
    IF c.payment_plan = 'cuotas3' THEN
      v_monto := v_extra;
    ELSE
      v_monto := round(c.price_usd * 0.5, 2) + v_extra;
    END IF;

    -- Un cobro de cero no se crea: le apareceria al cliente una pantalla de
    -- pago por USD 0, que no significa nada.
    IF v_monto <= 0 THEN RETURN; END IF;

  ELSE
    RETURN;
  END IF;

  INSERT INTO public.payments (client_id, kind, amount_usd, status)
  VALUES (p_client_id, p_kind, v_monto, 'pendiente')
  ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo','saldo','dominio','total')
  DO NOTHING;
END$$;

REVOKE ALL ON FUNCTION public.asegurar_cobro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asegurar_cobro(uuid, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 3 — El trigger de pagos tambien reconoce 'total'
--
--   Sigue siendo el UNICO lugar donde un pago mueve el flujo. Da igual si
--   entro por Mercado Pago, si Ariel aprobo una transferencia o si cargo un
--   cobro manual: un solo lugar donde puede fallar en vez de tres.
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

  IF NEW.kind IN ('anticipo', 'total') AND v_estado = 'anticipo_pendiente' THEN
    UPDATE public.clients SET status = 'en_produccion' WHERE id = NEW.client_id;

  ELSIF NEW.kind = 'saldo' AND v_estado = 'saldo_pendiente' THEN
    UPDATE public.clients SET status = 'finalizado' WHERE id = NEW.client_id;
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS payments_avanzan_flujo ON public.payments;
CREATE TRIGGER payments_avanzan_flujo
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.avanzar_por_pago();


-- ---------------------------------------------------------------------------
-- PASO 4 — El cliente elige plan al aceptar
--
--   Se conservan las decisiones de "volver atras" que agrego la migracion 07.
--
--   OJO CON EL DROP: agregar p_plan cambia la FIRMA de la funcion, asi que
--   CREATE OR REPLACE no reemplaza nada — crea una segunda version y quedan
--   las dos. Postgres entonces falla con "function portal_decidir(...) is
--   not unique", o peor: elige la vieja, que no sabe nada de planes, deja
--   payment_plan en NULL y crea un anticipo del 50% aunque el cliente haya
--   elegido 3 cuotas. Se borra la vieja explicitamente.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_decidir(text, text, text[]);
DROP FUNCTION IF EXISTS public.portal_decidir(text, text);

CREATE OR REPLACE FUNCTION public.portal_decidir(
  p_token    text,
  p_decision text,
  p_cambios  text[] DEFAULT NULL,
  p_plan     text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c     public.clients%ROWTYPE;
  v_kind text;
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

  UPDATE public.clients
     SET client_decision = 'continuar',
         decision_at     = now(),
         status          = 'anticipo_pendiente',
         payment_plan    = p_plan
   WHERE id = c.id;

  v_kind := CASE WHEN p_plan = 'cuotas3' THEN 'total' ELSE 'anticipo' END;
  PERFORM public.asegurar_cobro(c.id, v_kind);

  RETURN jsonb_build_object('ok', true, 'status', 'anticipo_pendiente',
                            'plan', p_plan, 'cobro', v_kind);
END$$;

REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[], text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 5 — admin_mover_flujo: no pedir un saldo que no existe
--
--   Con el plan de 3 cuotas el cliente ya pago todo al principio. Si ademas
--   eligio el dominio de la demo (sin costo), al marcar "ya esta publicada"
--   no queda NADA por cobrar: mandarlo a "esperando el saldo" lo dejaria
--   mirando una pantalla de pago vacia. En ese caso se cierra directo.
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
-- PASO 6 — portal_obtener: completa otra vez, y sin arrastrar los PDF
--
--   EL CAMBIO IMPORTANTE: los PDF guardados en base64 YA NO VIAJAN ACA.
--
--   El portal del cliente consulta esta funcion cada 30 segundos para
--   actualizarse solo. Con la propuesta, la descripcion y los adjuntos de
--   cada tarea metidos adentro, un cliente con una propuesta de 2 MB abierta
--   en el celular se bajaba 2 MB cada medio minuto — unos 240 MB por hora de
--   pestaña abierta. Y encima esos base64 terminaban escritos como atributos
--   HTML gigantes en el DOM.
--
--   Ahora viaja solo el NOMBRE y un si/no. El contenido se pide con
--   portal_documento() cuando el cliente toca el boton, una sola vez.
--
--   Los links http(s) comunes siguen viniendo enteros: pesan nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_obtener(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE                      -- VOLATILE para poder registrar la visita
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c           public.clients%ROWTYPE;
  v_progreso  int;
  v_total     numeric;
  v_resultado jsonb;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  -- Mismo resultado para token inexistente y para link revocado: no se le
  -- confirma a nadie que un token "existe pero esta desactivado".
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.clients
     SET last_seen_at = now(), view_count = view_count + 1
   WHERE id = c.id;

  v_progreso := public.calcular_progreso(c.id);
  v_total    := c.price_usd + CASE WHEN c.domain_choice = 'propio'
                                   THEN c.domain_extra_usd ELSE 0 END;

  SELECT jsonb_build_object(
    -- Campos elegidos A MANO. Nunca to_jsonb(c): eso filtraria el
    -- access_token y las admin_notes al navegador del cliente.
    'client_name',        c.client_name,
    'project_name',       c.project_name,
    'project_brief',      c.project_brief,

    -- Documentos: si es un link, va entero; si es un PDF guardado, va solo
    -- el nombre y la bandera. El contenido se pide aparte.
    'proposal_url',       CASE WHEN c.proposal_url LIKE 'data:%' THEN NULL ELSE c.proposal_url END,
    'proposal_filename',  c.proposal_filename,
    'proposal_es_pdf',    (c.proposal_url LIKE 'data:application/pdf%'),

    'brief_pdf_url',      CASE WHEN c.brief_pdf_url LIKE 'data:%' THEN NULL ELSE c.brief_pdf_url END,
    'brief_pdf_filename', c.brief_pdf_filename,
    'brief_es_pdf',       (c.brief_pdf_url LIKE 'data:application/pdf%'),

    'budget_pdf_url',      CASE WHEN c.budget_pdf_url LIKE 'data:%' THEN NULL ELSE c.budget_pdf_url END,
    'budget_pdf_filename', c.budget_pdf_filename,
    'budget_es_pdf',       (c.budget_pdf_url LIKE 'data:application/pdf%'),

    -- "Demo lista" sin link NO es demo lista: se le informa la etapa anterior
    -- para que vea el cartel de espera y no un boton que no abre nada.
    'status',             CASE WHEN c.status = 'demo_lista' AND COALESCE(c.demo_url,'') = ''
                               THEN 'demo_pendiente' ELSE c.status END,

    'demo_url',           c.demo_url,
    'price_usd',          c.price_usd,
    'payment_plan',       c.payment_plan,
    'domain_choice',      c.domain_choice,
    'domain_name',        c.domain_name,
    'domain_extra_usd',   c.domain_extra_usd,
    'total_usd',          v_total,
    'client_decision',    c.client_decision,
    'progreso',           v_progreso,
    'created_at',         c.created_at,

    'production_url', CASE WHEN c.status = 'finalizado'
                           THEN c.production_url ELSE NULL END,

    'tareas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'done', t.done,
               'source', t.source,
               'pdf_name', t.pdf_name,
               'tiene_pdf', (t.pdf_data IS NOT NULL)
             ) ORDER BY t.position, t.created_at)
      FROM public.client_tasks t WHERE t.client_id = c.id
    ), '[]'::jsonb),

    'pagos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', p.kind, 'amount_usd', p.amount_usd,
               'status', p.status, 'paid_at', p.paid_at, 'method', p.method,
               'tiene_comprobante', (p.receipt_image IS NOT NULL),
               'comprobante_fecha', p.receipt_uploaded_at
             ) ORDER BY p.created_at)
      FROM public.payments p WHERE p.client_id = c.id
    ), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END$$;

REVOKE ALL ON FUNCTION public.portal_obtener(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_obtener(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 7 — Un documento, a pedido
--
--   Devuelve UN solo PDF, cuando el cliente lo toca. Exige el token igual que
--   todo el resto del portal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_documento(
  p_token  text,
  p_cual   text,                 -- 'propuesta' | 'descripcion' | 'presupuesto' | 'tarea'
  p_tarea  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c      public.clients%ROWTYPE;
  v_data text;
  v_name text;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF p_cual = 'propuesta' THEN
    v_data := c.proposal_url;      v_name := c.proposal_filename;
  ELSIF p_cual = 'descripcion' THEN
    v_data := c.brief_pdf_url;     v_name := c.brief_pdf_filename;
  ELSIF p_cual = 'presupuesto' THEN
    v_data := c.budget_pdf_url;    v_name := c.budget_pdf_filename;
  ELSIF p_cual = 'tarea' THEN
    -- El client_id en el WHERE es lo que impide pedir el adjunto de otro
    -- proyecto pasando un id de tarea ajeno.
    SELECT t.pdf_data, t.pdf_name INTO v_data, v_name
    FROM public.client_tasks t
    WHERE t.id = p_tarea AND t.client_id = c.id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Documento desconocido.');
  END IF;

  IF v_data IS NULL OR v_data = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese documento no está cargado.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'data', v_data,
                            'filename', COALESCE(v_name, 'documento.pdf'));
END$$;

REVOKE ALL ON FUNCTION public.portal_documento(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_documento(text, text, uuid) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 8 — v_clientes_panel completa
--
--   Con TODO: lo de la 09 y la 10 (propuesta, descripcion) mas lo que esas
--   migraciones se habian llevado puesto, mas el presupuesto y el plan.
--
--   DROP + CREATE porque CREATE OR REPLACE no puede insertar columnas en el
--   medio de una vista existente.
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
  c.price_usd, c.payment_plan,
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
-- PASO 9 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'Presupuesto PDF (budget_pdf_url)' AS q, EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='clients' AND column_name='budget_pdf_url') AS ok
  UNION ALL SELECT 'Plan de pago (payment_plan)', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='clients' AND column_name='payment_plan')
  UNION ALL SELECT 'Cobro «total» habilitado (plan 3 cuotas)', (
    SELECT pg_get_constraintdef(oid) LIKE '%total%' FROM pg_constraint
    WHERE conname='payments_kind_check')
  UNION ALL SELECT 'El cliente puede pedir un PDF aparte (portal_documento)', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='portal_documento')
  UNION ALL SELECT 'Los PDF ya NO viajan en cada consulta', (
    SELECT prosrc NOT LIKE '%''pdf_data'', t.pdf_data%' FROM pg_proc WHERE proname='portal_obtener')
  -- Lo que se restaura
  UNION ALL SELECT 'RESTAURADO · el panel avisa de comprobantes nuevos', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='v_clientes_panel' AND column_name='comprobantes_a_revisar')
  UNION ALL SELECT 'RESTAURADO · rastro del link (last_seen_at / view_count)', (
    SELECT count(*) = 2 FROM information_schema.columns
    WHERE table_name='v_clientes_panel' AND column_name IN ('last_seen_at','view_count'))
  UNION ALL SELECT 'RESTAURADO · se registra cada visita al portal', (
    SELECT provolatile='v' AND prosrc LIKE '%last_seen_at%' FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'RESTAURADO · «demo lista» sin link muestra el cartel de espera', (
    SELECT prosrc LIKE '%demo_pendiente'' ELSE c.status%' FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'anon NO puede crear cobros', NOT has_function_privilege('anon',
    'public.asegurar_cobro(uuid, text)', 'EXECUTE')
  UNION ALL SELECT 'Hay UNA sola portal_decidir (sin versiones duplicadas)', (
    SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='portal_decidir')
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;
