-- ============================================================================
--  MIGRACION 09 — Soporte para Propuesta PDF, Links y Adjuntos PDF en Tareas
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================================

-- 1. Agregar columnas a public.clients para la propuesta PDF
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS proposal_url text,
  ADD COLUMN IF NOT EXISTS proposal_filename text;

-- 2. Agregar columnas a public.client_tasks para adjuntos PDF en tareas
ALTER TABLE public.client_tasks
  ADD COLUMN IF NOT EXISTS pdf_data text,
  ADD COLUMN IF NOT EXISTS pdf_name text;


-- 3. Actualizar la funcion public.portal_obtener para retornar la propuesta y adjuntos
CREATE OR REPLACE FUNCTION public.portal_obtener(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_progreso := public.calcular_progreso(c.id);
  v_total    := c.price_usd + CASE WHEN c.domain_choice = 'propio'
                                   THEN c.domain_extra_usd ELSE 0 END;

  SELECT jsonb_build_object(
    'client_name',       c.client_name,
    'project_name',      c.project_name,
    'project_brief',     c.project_brief,
    'proposal_url',      c.proposal_url,
    'proposal_filename', c.proposal_filename,
    'status',            c.status,
    'demo_url',          c.demo_url,
    'price_usd',         c.price_usd,
    'domain_choice',     c.domain_choice,
    'domain_name',       c.domain_name,
    'domain_extra_usd',  c.domain_extra_usd,
    'total_usd',         v_total,
    'client_decision',   c.client_decision,
    'progreso',          v_progreso,
    'created_at',        c.created_at,

    'production_url', CASE WHEN v_progreso = 100 AND c.status = 'finalizado'
                           THEN c.production_url ELSE NULL END,

    'tareas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'done', t.done,
               'source', t.source,
               'pdf_data', t.pdf_data,
               'pdf_name', t.pdf_name
             ) ORDER BY t.position, t.created_at)
      FROM public.client_tasks t WHERE t.client_id = c.id
    ), '[]'::jsonb),

    'pagos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', p.kind, 'amount_usd', p.amount_usd,
               'status', p.status, 'paid_at', p.paid_at
             ) ORDER BY p.created_at)
      FROM public.payments p WHERE p.client_id = c.id
    ), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END$$;

GRANT EXECUTE ON FUNCTION public.portal_obtener(text) TO anon, authenticated;


-- 4. Actualizar public.portal_pedir_cambio para soportar adjuntar PDF
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

  IF c.status NOT IN ('en_produccion', 'dominio') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Los cambios se cargan durante la fase de producción.');
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

GRANT EXECUTE ON FUNCTION public.portal_pedir_cambio(text, text, text, text) TO anon, authenticated;


-- 5. Actualizar la vista v_clientes_panel
DROP VIEW IF EXISTS public.v_clientes_panel;
CREATE VIEW public.v_clientes_panel
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.access_token,
  c.client_name,
  c.project_name,
  c.project_brief,
  c.proposal_url,
  c.proposal_filename,
  c.status,
  c.demo_url,
  c.production_url,
  c.price_usd,
  c.domain_choice,
  c.domain_name,
  c.client_decision,
  c.whatsapp,
  c.is_active,
  c.created_at,
  public.calcular_progreso(c.id) AS progreso,
  (SELECT count(*) FROM public.client_tasks t WHERE t.client_id = c.id)              AS tareas_total,
  (SELECT count(*) FROM public.client_tasks t WHERE t.client_id = c.id AND t.done)   AS tareas_hechas,
  COALESCE((SELECT sum(p.amount_usd) FROM public.payments p
             WHERE p.client_id = c.id AND p.status = 'pagado'), 0)                   AS cobrado_usd,
  COALESCE((SELECT sum(p.amount_usd) FROM public.payments p
             WHERE p.client_id = c.id AND p.status <> 'pagado'), 0)                  AS pendiente_usd
FROM public.clients c;

GRANT SELECT ON public.v_clientes_panel TO authenticated;
