-- ============================================================================
--  MIGRACION 16 — La columna que le faltaba a «Destacar en el portfolio»
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  ------------------------------------------------------------------------
--  QUE PASABA
--  ------------------------------------------------------------------------
--  En el panel, Portfolio, cada proyecto tiene una estrella para marcarlo
--  como destacado (la «Vista Grande»). La tildabas, la estrella se prendia,
--  el panel te decia que si — y en /proyectos la tarjeta seguia igual que
--  todas las demas.
--
--  El motivo: la tabla public.projects NO TIENE la columna is_featured.
--  El panel la manda igual, Supabase rechaza el UPDATE con «column
--  is_featured does not exist», y updateProject() captura el error y guarda
--  el cambio en el localStorage de ESE navegador. Por eso la estrella queda
--  prendida al volver al panel: la estas leyendo de tu propia maquina, no
--  del servidor.
--
--  /proyectos, en cambio, pide los datos a Supabase. Ahi la columna no
--  existe, is_featured llega como undefined, y Boolean(undefined) es false:
--  ninguna tarjeta se dibuja a lo ancho. Nunca.
--
--  ------------------------------------------------------------------------
--  COMO SE VERIFICO
--  ------------------------------------------------------------------------
--  Se le pidio una fila a la API REST de tu propio proyecto, con la misma
--  clave publica que usa el sitio:
--
--      GET /rest/v1/projects?select=*&limit=1   ->   http 200
--      columnas: category, created_at, demo_url, description, id, image,
--                position, tags, title
--
--  No hay is_featured en esa lista. El resto del codigo esta bien: el panel
--  la escribe, mapProjectFromDB la lee y la grilla la usa. Faltaba la
--  columna y nada mas.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — La columna
-- ---------------------------------------------------------------------------
-- NOT NULL con DEFAULT false: un proyecto esta destacado o no lo esta, no
-- hay un tercer estado. Sin el NOT NULL, los 18 proyectos que ya existen
-- quedarian en NULL y cada lectura tendria que acordarse de tratarlo como
-- false. Con el default, los que ya estan arrancan en false solos.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;


-- ---------------------------------------------------------------------------
-- PASO 2 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'La columna is_featured existe' AS q, EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'projects'
       AND column_name = 'is_featured') AS ok
  UNION ALL SELECT 'Es booleana y no admite NULL', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'projects'
       AND column_name = 'is_featured'
       AND data_type = 'boolean' AND is_nullable = 'NO')
  UNION ALL SELECT 'Ningun proyecto quedo en NULL', NOT EXISTS (
    SELECT 1 FROM public.projects WHERE is_featured IS NULL)
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;


-- ---------------------------------------------------------------------------
-- PASO 3 — Como quedo tu portfolio
-- ---------------------------------------------------------------------------
-- Arranca todo en false, asi que esto va a decir 0 destacados. Es lo
-- esperado: las estrellas que habias tildado nunca llegaron al servidor,
-- quedaron en el localStorage de tu navegador. Hay que volver a marcarlas
-- una vez desde el panel — ahora si se guardan.
SELECT count(*) FILTER (WHERE is_featured)       AS destacados,
       count(*) FILTER (WHERE NOT is_featured)   AS normales,
       count(*)                                  AS total
  FROM public.projects;
