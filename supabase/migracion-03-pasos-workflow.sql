-- ============================================================================
--  MIGRACIÓN 03 — Pasos Secuenciales del Workflow
--  Ariel.Dev
--  ------------------------------------------------------------------------
--  Agrega flags y estados para la secuencia estricta de 4 pasos:
--  1. Demo & Desarrollo (50% Adelanto)
--  2. Elección de Dominio (tras Desarrollo Listo)
--  3. Pago Final (50% Restante tras Dominio Listo)
--  4. Publicación Lista (Sitio Online con link definitivo)
-- ============================================================================

-- 1. Agregar estados si la columna status los admite
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_proyecto') THEN
    ALTER TYPE estado_proyecto ADD VALUE IF NOT EXISTS 'desarrollo_listo';
    ALTER TYPE estado_proyecto ADD VALUE IF NOT EXISTS 'dominio_listo';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Silencioso si el tipo no soporta alteración dinámica
END$$;

-- 2. Agregar columnas de control a la tabla clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS desarrollo_listo boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS dominio_listo boolean NOT NULL DEFAULT false;

-- 3. Actualizar función portal_obtener para retornar desarrollo_listo y dominio_listo
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
    'client_name',      c.client_name,
    'project_name',     c.project_name,
    'project_brief',    c.project_brief,
    'status',           c.status,
    'demo_url',         c.demo_url,
    'price_usd',        c.price_usd,
    'domain_choice',    c.domain_choice,
    'domain_name',      c.domain_name,
    'domain_extra_usd', c.domain_extra_usd,
    'total_usd',        v_total,
    'client_decision',  c.client_decision,
    'progreso',         v_progreso,
    'created_at',       c.created_at,
    'desarrollo_listo', COALESCE(c.desarrollo_listo, false),
    'dominio_listo',    COALESCE(c.dominio_listo, false),

    'production_url', CASE WHEN c.status = 'finalizado'
                           THEN c.production_url ELSE NULL END,

    'tareas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'done', t.done, 'source', t.source
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
END;
$$;

REVOKE ALL ON FUNCTION public.portal_obtener(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_obtener(text) TO anon, authenticated;
