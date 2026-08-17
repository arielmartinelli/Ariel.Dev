-- ============================================================================
--  MIGRACIÓN COMPLETA — Workflow 4 Pasos + Tabla de Reseñas de Clientes
--  Ariel.Dev
--  
--  INSTRUCCIONES:
--  1. Entrá a tu panel de Supabase: https://supabase.com/dashboard
--  2. Entrá a tu proyecto -> Menú lateral -> SQL Editor.
--  3. Pegá todo este código y presioná "Run".
-- ============================================================================

-- 1. Actualizar enum estado_proyecto para incluir los estados de los 4 pasos
ALTER TYPE public.estado_proyecto ADD VALUE IF NOT EXISTS 'desarrollo_listo';
ALTER TYPE public.estado_proyecto ADD VALUE IF NOT EXISTS 'dominio_listo';

-- 2. Agregar columnas de confirmación de pasos en la tabla clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS desarrollo_listo boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS dominio_listo boolean NOT NULL DEFAULT false;

-- 3. Crear tabla pública de reseñas
CREATE TABLE IF NOT EXISTS public.reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name  text NOT NULL,
  project_name text,
  company_url  text,
  rating       int NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  comment      text NOT NULL CHECK (char_length(comment) BETWEEN 2 AND 2000),
  is_published boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_published_idx ON public.reviews (is_published, created_at DESC);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Politicas RLS para la tabla de reseñas
DROP POLICY IF EXISTS "Reseñas publicas visibles" ON public.reviews;
CREATE POLICY "Reseñas publicas visibles" ON public.reviews
  FOR SELECT USING (is_published = true);

DROP POLICY IF EXISTS "Permitir enviar reseñas" ON public.reviews;
CREATE POLICY "Permitir enviar reseñas" ON public.reviews
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin gestiona reseñas" ON public.reviews;
CREATE POLICY "Admin gestiona reseñas" ON public.reviews
  FOR ALL USING (auth.role() = 'authenticated');
