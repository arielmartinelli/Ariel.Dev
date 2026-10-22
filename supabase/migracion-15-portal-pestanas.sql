-- ============================================================================
--  MIGRACION 15 — Portal en pestañas que habilita Ariel + control total de pagos
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--  Requiere la migracion 14 ya aplicada.
--
--  ------------------------------------------------------------------------
--  QUE TRAE
--  ------------------------------------------------------------------------
--   1. PESTAÑAS DEL LINK DEL CLIENTE (clients.secciones)
--        Inicio · Tareas · Pagos · Dominio · Produccion
--      Inicio esta siempre abierta. Las otras cuatro las abre Ariel A MANO
--      desde el panel; mientras tanto el cliente las ve con candado.
--
--      Los proyectos que ya estan en marcha arrancan con las pestañas que
--      corresponden a su etapa (PASO 1), para que nadie pierda acceso a algo
--      que ya estaba viendo. De ahi en adelante, todo manual.
--
--   2. MEDIOS DE PAGO POR CLIENTE (clients.metodos_pago)
--      Mercado Pago, transferencia o ambos. El portal solo muestra esos, y el
--      servidor de Mercado Pago rechaza el pago si MP no esta habilitado.
--
--   3. CUOTAS DE MERCADO PAGO POR COBRO (payments.cuotas_mp)
--      NULL = lo que diga el plan (3 en "3 cuotas", 1 en el resto).
--
--   4. Las acciones del cliente siguen a las pestañas:
--        - cargar cambios: con la pestaña Tareas abierta
--        - elegir dominio: con la pestaña Dominio abierta
--        - ver el link final: con la pestaña Produccion abierta
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — Columnas
-- ---------------------------------------------------------------------------
-- La columna secciones se crea en un bloque aparte para saber si es NUEVA:
-- solo en ese caso se completan las pestañas de los proyectos en marcha
-- (PASO 1). Si la migracion se corre de nuevo, no pisa lo que abriste o
-- cerraste a mano.
DO $secciones$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'clients'
                    AND column_name = 'secciones') THEN
    ALTER TABLE public.clients ADD COLUMN secciones jsonb NOT NULL
      DEFAULT '{"tareas": false, "pagos": false, "dominio": false, "produccion": false}'::jsonb;

    -- PASO 1 — Los proyectos en marcha no pierden nada: arrancan con las
    -- pestañas de su etapa. De aca en adelante, todo manual.
    UPDATE public.clients c
       SET secciones = jsonb_build_object(
             'tareas',     public.orden_etapa(c.status) >= 3,
             'pagos',      public.orden_etapa(c.status) >= 2
                           OR EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = c.id),
             'dominio',    public.orden_etapa(c.status) >= 4,
             'produccion', c.status = 'finalizado')
     WHERE public.orden_etapa(c.status) >= 2;
  END IF;
END$secciones$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS metodos_pago text[] NOT NULL
    DEFAULT ARRAY['mercadopago', 'transferencia'];

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_metodos_pago_validos;
ALTER TABLE public.clients ADD CONSTRAINT clients_metodos_pago_validos
  CHECK (cardinality(metodos_pago) >= 1
         AND metodos_pago <@ ARRAY['mercadopago', 'transferencia']);

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_secciones_objeto;
ALTER TABLE public.clients ADD CONSTRAINT clients_secciones_objeto
  CHECK (jsonb_typeof(secciones) = 'object');

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cuotas_mp int;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_cuotas_mp_rango;
ALTER TABLE public.payments ADD CONSTRAINT payments_cuotas_mp_rango
  CHECK (cuotas_mp IS NULL OR cuotas_mp BETWEEN 1 AND 24);


-- ---------------------------------------------------------------------------
-- PASO 2 — Helper: ¿esta abierta esa pestaña?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seccion_abierta(p_secciones jsonb, p_cual text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((p_secciones ->> p_cual)::boolean, false);
$$;


-- ---------------------------------------------------------------------------
-- PASO 3 — Cargar cambios: con la pestaña Tareas abierta
--
--   Cuerpo de la migracion 09 (la ultima que la definio). Cambia solo la
--   condicion: antes exigia la etapa en_produccion o dominio; ahora alcanza
--   con que Ariel haya abierto la pestaña Tareas.
-- ---------------------------------------------------------------------------
-- La version vieja de 2 parametros (migracion 05) sigue exigiendo la etapa
-- y hace ambigua cualquier llamada con dos argumentos. El portal usa la de 4.
DROP FUNCTION IF EXISTS public.portal_pedir_cambio(text, text);

CREATE OR REPLACE FUNCTION public.portal_pedir_cambio(
  p_token    text,
  p_texto    text,
  p_pdf_data text DEFAULT NULL,
  p_pdf_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.clients%ROWTYPE;
  v_pos    int;
  v_id     uuid;
  v_limite int;
BEGIN
  IF p_texto IS NULL OR char_length(trim(p_texto)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escribí un cambio un poco más detallado.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF NOT public.seccion_abierta(c.secciones, 'tareas') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La lista de cambios todavía no está habilitada.');
  END IF;

  -- Límite de frecuencia: máximo 20 tareas por cliente
  SELECT count(*) INTO v_limite FROM public.client_tasks WHERE client_id = c.id AND source = 'cliente';
  IF v_limite >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Alcanzaste el límite de cambios desde el portal. Hablame por WhatsApp.');
  END IF;

  SELECT COALESCE(max(position), 0) + 1 INTO v_pos
  FROM public.client_tasks WHERE client_id = c.id;

  INSERT INTO public.client_tasks (client_id, title, source, position, pdf_data, pdf_name)
  VALUES (c.id, trim(p_texto), 'cliente', v_pos, p_pdf_data, p_pdf_name)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END$$;

REVOKE ALL ON FUNCTION public.portal_pedir_cambio(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_pedir_cambio(text, text, text, text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 4 — Elegir dominio: con la pestaña Dominio abierta
--
--   Cuerpo de la migracion 05. Cambian dos cosas:
--     - la habilita SOLO la pestaña (antes exigia la etapa 'dominio');
--     - el flujo avanza a 'publicando' unicamente si estaba en la etapa
--       'dominio'. Si Ariel abrio la pestaña antes (por ejemplo durante la
--       produccion), elegir el dominio guarda la eleccion y nada mas: no
--       saltea los cambios ni hace retroceder un proyecto mas avanzado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_elegir_dominio(
  p_token   text,
  p_opcion  text,
  p_dominio text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.clients%ROWTYPE;
  v_nombre text;
  v_estado text;
BEGIN
  IF p_opcion NOT IN ('vercel', 'propio') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Opción de dominio inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF NOT public.seccion_abierta(c.secciones, 'dominio') THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Todavía no llegamos al paso del dominio.');
  END IF;

  v_nombre := NULLIF(left(btrim(coalesce(p_dominio, '')), 253), '');

  IF p_opcion = 'propio' AND v_nombre IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escribí qué dominio querés.');
  END IF;

  DELETE FROM public.payments
   WHERE client_id = c.id AND kind = 'dominio' AND status <> 'pagado';

  v_estado := CASE WHEN c.status = 'dominio' THEN 'publicando' ELSE c.status END;

  UPDATE public.clients
     SET domain_choice = p_opcion,
         domain_name   = CASE WHEN p_opcion = 'propio' THEN v_nombre ELSE NULL END,
         status        = v_estado
   WHERE id = c.id;

  RETURN jsonb_build_object('ok', true, 'status', v_estado,
                            'progreso', public.calcular_progreso(c.id));
END$$;

REVOKE ALL ON FUNCTION public.portal_elegir_dominio(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_elegir_dominio(text, text, text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 5 — portal_obtener: pestañas, medios, cuotas y link final
--
--   Mismo metodo que la migracion 14: se parchea la funcion que esta
--   corriendo, sin reescribirla. Tres inserciones y un cambio:
--     + 'secciones' y 'metodos_pago' al lado de 'plan_fijado'
--     + 'cuotas_mp' en cada pago
--     ~ el link de produccion se muestra si el proyecto esta finalizado O si
--       Ariel abrio la pestaña Produccion
--   Si algun punto no aparece, falla sin tocar nada.
-- ---------------------------------------------------------------------------
DO $parche$
DECLARE
  v_def   text;
  v_nueva text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'portal_obtener';

  IF v_def IS NULL OR v_def NOT LIKE '%''plan_fijado''%' THEN
    RAISE EXCEPTION 'portal_obtener no tiene plan_fijado: corré primero la migración 14.';
  END IF;

  v_nueva := v_def;

  IF v_nueva NOT LIKE '%''secciones''%' THEN
    v_nueva := regexp_replace(v_nueva,
      '''plan_fijado'',(\s*)c\.plan_fijado,',
      '''plan_fijado'',\1c.plan_fijado,
    ''secciones'',          c.secciones,
    ''metodos_pago'',       to_jsonb(c.metodos_pago),');
    IF v_nueva NOT LIKE '%''secciones''%' THEN
      RAISE EXCEPTION 'No encontré ''plan_fijado'' en portal_obtener. No se tocó nada.';
    END IF;
  END IF;

  IF v_nueva NOT LIKE '%''cuotas_mp''%' THEN
    v_nueva := regexp_replace(v_nueva,
      '''concepto'',(\s*)p\.concepto,',
      '''concepto'',\1p.concepto, ''cuotas_mp'', p.cuotas_mp,');
    IF v_nueva NOT LIKE '%''cuotas_mp''%' THEN
      RAISE EXCEPTION 'No encontré ''concepto'' en los pagos de portal_obtener. No se tocó nada.';
    END IF;
  END IF;

  IF v_nueva NOT LIKE '%seccion_abierta(c.secciones, ''produccion'')%' THEN
    v_nueva := regexp_replace(v_nueva,
      'WHEN\s+c\.status\s*=\s*''finalizado''(\s*)THEN\s+c\.production_url',
      'WHEN c.status = ''finalizado'' OR public.seccion_abierta(c.secciones, ''produccion'')\1THEN c.production_url');
    IF v_nueva NOT LIKE '%seccion_abierta(c.secciones, ''produccion'')%' THEN
      RAISE EXCEPTION 'No encontré el candado de production_url en portal_obtener. No se tocó nada.';
    END IF;
  END IF;

  IF v_nueva <> v_def THEN
    EXECUTE v_nueva;
    RAISE NOTICE 'portal_obtener actualizada (pestañas, medios, cuotas, link final).';
  ELSE
    RAISE NOTICE 'portal_obtener ya estaba actualizada. Nada que hacer.';
  END IF;
END$parche$;


-- ---------------------------------------------------------------------------
-- PASO 6 — v_clientes_panel con secciones y medios
--
--   Definicion de la migracion 14 + dos columnas.
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
  c.secciones, c.metodos_pago,
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
-- PASO 7 — Verificacion
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'Columna secciones (pestañas del cliente)' AS q, EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='clients' AND column_name='secciones') AS ok
  UNION ALL SELECT 'Columna metodos_pago', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='clients' AND column_name='metodos_pago')
  UNION ALL SELECT 'Columna cuotas_mp en payments', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='payments' AND column_name='cuotas_mp')
  UNION ALL SELECT 'El panel ve secciones y medios', (
    SELECT count(*) = 2 FROM information_schema.columns
     WHERE table_name='v_clientes_panel' AND column_name IN ('secciones','metodos_pago'))
  UNION ALL SELECT 'El portal recibe pestañas, medios y cuotas', (
    SELECT prosrc LIKE '%c.secciones%' AND prosrc LIKE '%metodos_pago%' AND prosrc LIKE '%cuotas_mp%'
      FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'El link final se muestra con la pestaña Producción', (
    SELECT prosrc LIKE '%seccion_abierta(c.secciones, ''produccion'')%'
      FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'portal_obtener conserva recibo y plan (12 y 14)', (
    SELECT prosrc LIKE '%nro_recibo%' AND prosrc LIKE '%plan_fijado%'
      FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'Cargar cambios depende de la pestaña Tareas', (
    SELECT prosrc LIKE '%seccion_abierta(c.secciones, ''tareas'')%'
      FROM pg_proc p WHERE proname='portal_pedir_cambio' AND pronargs = 4)
  UNION ALL SELECT 'Elegir dominio depende de la pestaña Dominio', (
    SELECT prosrc LIKE '%seccion_abierta(c.secciones, ''dominio'')%'
      FROM pg_proc WHERE proname='portal_elegir_dominio')
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;
