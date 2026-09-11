-- ============================================================================
-- MIGRACIÓN 07: PERMITIR VOLVER / REABRIR PASOS EN EL PORTAL DE CLIENTES
-- ============================================================================
-- Permite que el cliente o el lead pueda retomar pasos anteriores (como la Demo)
-- restableciendo la decisión y el estado del proyecto en la base de datos.
-- ============================================================================

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
  c public.clients%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('continuar', 'no_continuar', 'reabrir_demo', 'reset_demo', 'volver_demo', 'volver_anticipo', 'volver_cambios', 'volver_dominio') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisión inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  -- Acciones de reinicio / volver a un paso anterior
  IF p_decision IN ('reabrir_demo', 'reset_demo', 'volver_demo') THEN
    UPDATE public.clients
       SET client_decision = NULL,
           decision_at = NULL,
           status = 'demo_lista'
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'demo_lista');
  END IF;

  IF p_decision = 'volver_anticipo' THEN
    UPDATE public.clients
       SET status = 'anticipo_pendiente'
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'anticipo_pendiente');
  END IF;

  IF p_decision = 'volver_cambios' THEN
    UPDATE public.clients
       SET status = 'en_produccion'
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'en_produccion');
  END IF;

  IF p_decision = 'volver_dominio' THEN
    UPDATE public.clients
       SET status = 'dominio'
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'dominio');
  END IF;

  -- Flujo normal de decisión (continuar / no_continuar)
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

  UPDATE public.clients
     SET client_decision = 'continuar', decision_at = now(), status = 'anticipo_pendiente'
   WHERE id = c.id;

  PERFORM public.asegurar_cobro(c.id, 'anticipo');

  RETURN jsonb_build_object('ok', true, 'status', 'anticipo_pendiente');
END$$;

REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[]) TO anon, authenticated;
