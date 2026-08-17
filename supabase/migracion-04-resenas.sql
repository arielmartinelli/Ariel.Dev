-- ============================================================================
--  MIGRACIÓN 04 — Tabla de Reseñas de Clientes
--  Ariel.Dev
-- ============================================================================

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

-- Reseñas publicadas visibles para todo el mundo
CREATE POLICY "Reseñas publicas visibles" ON public.reviews
  FOR SELECT USING (is_published = true);

-- Clientes y usuarios pueden insertar reseñas
CREATE POLICY "Permitir enviar reseñas" ON public.reviews
  FOR INSERT WITH CHECK (true);

-- Admin autenticado puede modificar y borrar reseñas
CREATE POLICY "Admin gestiona reseñas" ON public.reviews
  FOR ALL USING (auth.role() = 'authenticated');
