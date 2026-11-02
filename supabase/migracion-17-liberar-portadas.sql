-- ============================================================================
--  MIGRACION 17 — Vaciar las portadas en base64  (OPCIONAL, Y NO ES URGENTE)
--  Ariel.Dev
--
--  NO LA CORRAS TODAVIA.
--  Primero mirá /proyectos con las vistas vivas andando. Si te gusta cómo
--  quedó y no querés volver atrás, recién ahí corré esto.
--
--  ------------------------------------------------------------------------
--  QUE HACE Y POR QUE ESPERAR
--  ------------------------------------------------------------------------
--  La columna public.projects.image guarda la captura de cada proyecto
--  ENTERA, como texto base64. Entre los 19 proyectos son 21,5 MB.
--
--  Desde el commit de las vistas vivas, la página ya no pide esa columna:
--  la tarjeta muestra el sitio de verdad adentro del marco. O sea que el
--  peso ya dejó de bajarse — ESTE ARCHIVO NO ARREGLA NADA QUE SIGA ROTO.
--  Lo único que hace es liberar el espacio en tu base.
--
--  Y es para siempre: el base64 no se puede recuperar. Las capturas no
--  están en ningún otro lado, ni en el repositorio ni en Storage.
--
--  ------------------------------------------------------------------------
--  ANTES DE CORRERLA: LLEVATE UNA COPIA
--  ------------------------------------------------------------------------
--  El PASO 1 deja una copia de las portadas en otra tabla. Es idempotente y
--  ocupa lo mismo que ocupaba antes, así que no te ahorra espacio todavía:
--  te da la posibilidad de arrepentirte. Cuando ya estés seguro de verdad,
--  corré el PASO 4 y ahí sí se libera todo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — La copia de seguridad
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects_portadas_backup (
  id         UUID PRIMARY KEY,
  title      TEXT,
  image      TEXT,
  guardado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin RLS para anon: esto es un archivo tuyo, no algo que el sitio lea.
ALTER TABLE public.projects_portadas_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO public.projects_portadas_backup (id, title, image)
SELECT id, title, image
  FROM public.projects
 WHERE image IS NOT NULL AND image <> ''
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- PASO 2 — Verificacion de la copia. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'Todas las portadas tienen copia' AS q, NOT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.image IS NOT NULL AND p.image <> ''
       AND NOT EXISTS (SELECT 1 FROM public.projects_portadas_backup b
                        WHERE b.id = p.id AND b.image = p.image)) AS ok
  UNION ALL SELECT 'La copia no quedo vacia', EXISTS (
    SELECT 1 FROM public.projects_portadas_backup)
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;


-- ---------------------------------------------------------------------------
-- PASO 3 — Cuanto pesa esto hoy
-- ---------------------------------------------------------------------------
SELECT count(*)                                  AS proyectos_con_portada,
       pg_size_pretty(sum(length(image))::bigint) AS pesan
  FROM public.projects
 WHERE image IS NOT NULL AND image <> '';


-- ---------------------------------------------------------------------------
-- PASO 4 — El borrado. DESCOMENTAR SOLO CUANDO ESTES DECIDIDO.
-- ---------------------------------------------------------------------------
-- Vacía la columna en projects. La copia del PASO 1 queda, así que todavía
-- se puede volver atrás con el PASO 5.
--
--   UPDATE public.projects SET image = '' WHERE image <> '';
--   VACUUM FULL public.projects;        -- devuelve el espacio al disco


-- ---------------------------------------------------------------------------
-- PASO 5 — Volver atras, si te arrepentis
-- ---------------------------------------------------------------------------
--   UPDATE public.projects p
--      SET image = b.image
--     FROM public.projects_portadas_backup b
--    WHERE b.id = p.id;
--
-- Y para liberar del todo, una vez que no quieras volver nunca mas:
--   DROP TABLE public.projects_portadas_backup;
