-- ============================================================================
-- MIGRACIÓN 08: ORDEN PERSONALIZADO DE PROYECTOS EN EL PORTFOLIO
-- ============================================================================
-- Agrega la columna `position` para permitir reordenar los proyectos del
-- portfolio desde el panel de administración.
-- ============================================================================

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS position INT DEFAULT 0;
