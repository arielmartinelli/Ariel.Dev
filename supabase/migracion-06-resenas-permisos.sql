-- ============================================================================
--  MIGRACION 06 — Que el sitio publico pueda LEER las reseñas
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez.
--
--  ------------------------------------------------------------------------
--  QUE ESTABA ROTO
--  ------------------------------------------------------------------------
--  Las reseñas de los clientes SI estaban guardadas en la tabla `reviews`,
--  pero la home no mostraba ninguna: mostraba tres de ejemplo que estaban
--  escritas en el codigo.
--
--  El motivo es el mismo error que ya habia pasado con la tabla `clients`
--  (ver AUDITORIA.md): confundir GRANT con RLS. Son DOS candados distintos y
--  hay que abrir los dos.
--
--    GRANT = "este rol puede tocar esta TABLA"      (permiso de tabla)
--    RLS   = "y solo puede ver ESTAS FILAS"         (permiso de fila)
--
--  migracion-04-resenas.sql creo la policy
--
--      CREATE POLICY "Reseñas publicas visibles" ON public.reviews
--        FOR SELECT USING (is_published = true);
--
--  que dice correctamente "las publicadas las ve cualquiera"... pero nunca
--  otorgo el GRANT. Sin el, la consulta muere ANTES de que Postgres llegue a
--  evaluar la policy, con "permission denied for table reviews".
--
--  Reproducido en Postgres: tabla creada igual que en migracion-04, una
--  reseña publicada adentro, y `SET ROLE anon; SELECT count(*) FROM reviews`
--  -> permission denied.
--
--  Peor todavia: el JavaScript trataba ese error como "no hay reseñas" y
--  caia al respaldo de localStorage, que son las tres inventadas. O sea que
--  el sitio mostraba testimonios falsos y ocultaba los reales, sin avisar.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — La tabla, por si esta migracion se corre antes que la 04.
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS reviews_published_idx
  ON public.reviews (is_published, created_at DESC);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- PASO 2 — LOS GRANT QUE FALTABAN. Este es el arreglo.
--
--   A anon se le da lo justo: SELECT (para mostrarlas) e INSERT (para que se
--   puedan dejar desde /resena). NADA de UPDATE ni DELETE: sin eso, cualquiera
--   con la clave publica —que esta en el bundle, a la vista— podria editar o
--   borrar los testimonios de la home.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT                   ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE   ON public.reviews TO authenticated;

REVOKE UPDATE, DELETE, TRUNCATE ON public.reviews FROM anon;


-- ---------------------------------------------------------------------------
-- PASO 3 — Las policies, redefinidas de forma determinista.
--
--   Se reescriben en vez de dejarlas como estaban por dos motivos:
--
--   1. La policy de admin usaba auth.role(), que Supabase dejo de recomendar.
--      Se reemplaza por auth.uid() IS NOT NULL, que es lo mismo pero sin
--      depender de una funcion que puede desaparecer.
--
--   2. La de INSERT era WITH CHECK (true) sin ninguna restriccion. Se le
--      agrega un minimo de higiene: que el nombre y el comentario no vengan
--      vacios. No reemplaza a una revision tuya, pero corta el ruido mas obvio.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Reseñas publicas visibles" ON public.reviews;
DROP POLICY IF EXISTS "Permitir enviar reseñas"   ON public.reviews;
DROP POLICY IF EXISTS "Admin gestiona reseñas"    ON public.reviews;

-- Cualquiera ve SOLO las publicadas. Las despublicadas quedan invisibles.
CREATE POLICY "resenas publicadas visibles" ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (is_published = true);

-- Ariel ve todas, incluso las despublicadas, para poder gestionarlas.
CREATE POLICY "admin ve todas las resenas" ON public.reviews
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cualquiera puede dejar una resena" ON public.reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    btrim(client_name) <> ''
    AND char_length(btrim(comment)) >= 2
  );

CREATE POLICY "admin edita resenas" ON public.reviews
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "admin borra resenas" ON public.reviews
  FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- PASO 4 — Verificacion. Correr y leer, no asumir.
--
--   La ultima fila es la que importa: dice cuantas reseñas hay guardadas y
--   cuantas de esas van a aparecer en la home.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'El sitio publico puede LEER reseñas (GRANT)' AS q,
         has_table_privilege('anon', 'public.reviews', 'SELECT') AS ok
  UNION ALL SELECT 'Se pueden dejar reseñas desde /resena (GRANT)',
         has_table_privilege('anon', 'public.reviews', 'INSERT')
  UNION ALL SELECT 'anon NO puede editar reseñas',
         NOT has_table_privilege('anon', 'public.reviews', 'UPDATE')
  UNION ALL SELECT 'anon NO puede borrar reseñas',
         NOT has_table_privilege('anon', 'public.reviews', 'DELETE')
  UNION ALL SELECT 'RLS activo en reviews',
         (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reviews'::regclass)
  UNION ALL SELECT 'Las despublicadas quedan ocultas al publico',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename='reviews' AND policyname='resenas publicadas visibles')
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;

-- Cuantas reseñas hay realmente, y cuantas se ven.
SELECT count(*)                                    AS resenas_guardadas,
       count(*) FILTER (WHERE is_published)        AS se_ven_en_la_home,
       count(*) FILTER (WHERE NOT is_published)    AS ocultas
FROM public.reviews;
