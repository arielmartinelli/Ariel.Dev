-- ============================================================================
--  MIGRACION 10 — PDF de Descripción del Proyecto y apertura segura Blob URL
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================================

-- 1. Agregar columnas para PDF de la descripcion del proyecto en public.clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brief_pdf_url text,
  ADD COLUMN IF NOT EXISTS brief_pdf_filename text;


-- 2. Actualizar public.portal_obtener para retornar PDF de descripcion y propuesta
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
    'client_name',        c.client_name,
    'project_name',       c.project_name,
    'project_brief',      c.project_brief,
    'brief_pdf_url',      c.brief_pdf_url,
    'brief_pdf_filename', c.brief_pdf_filename,
    'proposal_url',       c.proposal_url,
    'proposal_filename',  c.proposal_filename,
    'status',             c.status,
    'demo_url',           c.demo_url,
    'price_usd',          c.price_usd,
    'domain_choice',      c.domain_choice,
    'domain_name',        c.domain_name,
    'domain_extra_usd',   c.domain_extra_usd,
    'total_usd',          v_total,
    'client_decision',    c.client_decision,
    'progreso',           v_progreso,
    'created_at',         c.created_at,

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


-- 3. Actualizar la vista v_clientes_panel
DROP VIEW IF EXISTS public.v_clientes_panel;
CREATE VIEW public.v_clientes_panel
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.access_token,
  c.client_name,
  c.project_name,
  c.project_brief,
  c.brief_pdf_url,
  c.brief_pdf_filename,
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
