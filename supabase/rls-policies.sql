-- ============================================================================
--  POLITICAS RLS — Portfolio Ariel.Dev
--  Version FINAL (endurecida). Reemplaza a la version anterior.
--
--  Ejecutar completo en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  QUE CAMBIA RESPECTO AL ESTADO ANTERIOR
--  --------------------------------------
--  El estado anterior ya bloqueaba a los visitantes anonimos (bien), pero las
--  policies de escritura decian:
--
--      auth.uid() IS NOT NULL     -- "cualquiera con una sesion valida"
--
--  Eso no significa "soy Ariel". Con la clave anon publica del bundle,
--  cualquiera podia registrarse por su cuenta (POST /auth/v1/signup),
--  convertirse en 'authenticated' y heredar permisos de administrador.
--
--  Ahora dice:
--
--      auth.uid() = '<UID de Ariel>'   -- "soy exactamente esta cuenta"
--
--  Aunque alguien logre crear una cuenta, no puede tocar nada.
--  Complemento obligatorio: apagar el registro publico en
--  Authentication -> Providers -> Email -> "Allow new users to sign up".
--
--  Habia ademas policies duplicadas con cmd = ALL que otorgaban escritura a
--  cualquier 'authenticated'. Las policies permisivas se combinan con OR:
--  alcanzaba con que una dejara pasar para anular a las demas. Se eliminan.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — Confirmar que el UID es el correcto antes de seguir.
-- Debe devolver UNA sola fila, con tu email.
-- ---------------------------------------------------------------------------
SELECT id, email, created_at
FROM auth.users
WHERE id = '83feffc4-1e28-4428-9c2c-a97ecaf82f91';


-- ---------------------------------------------------------------------------
-- PASO 1 — RLS activo y forzado.
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- PASO 2 — Limpieza total de policies previas.
-- Se borran TODAS (incluidas las duplicadas y las de cmd = ALL) para partir
-- de un estado conocido. Entre este bloque y el PASO 3 las tablas quedan
-- cerradas: ejecutar el script entero de una sola vez.
-- ---------------------------------------------------------------------------

-- projects
DROP POLICY IF EXISTS "Permitir escritura solo a autenticados en proyectos" ON public.projects;
DROP POLICY IF EXISTS "Permitir lectura publica de proyectos"               ON public.projects;
DROP POLICY IF EXISTS "lectura publica projects"                            ON public.projects;
DROP POLICY IF EXISTS "escritura solo autenticados"                         ON public.projects;
DROP POLICY IF EXISTS "update solo autenticados"                            ON public.projects;
DROP POLICY IF EXISTS "delete solo autenticados"                            ON public.projects;
DROP POLICY IF EXISTS "lectura publica"                                     ON public.projects;
DROP POLICY IF EXISTS "escritura solo admin"                                ON public.projects;
DROP POLICY IF EXISTS "update solo admin"                                   ON public.projects;
DROP POLICY IF EXISTS "delete solo admin"                                   ON public.projects;

-- categories
DROP POLICY IF EXISTS "Permitir escritura solo a autenticados en categorias" ON public.categories;
DROP POLICY IF EXISTS "Permitir lectura publica de categorias"               ON public.categories;
DROP POLICY IF EXISTS "lectura publica categories"                           ON public.categories;
DROP POLICY IF EXISTS "escritura cat solo autenticados"                      ON public.categories;
DROP POLICY IF EXISTS "update cat solo autenticados"                         ON public.categories;
DROP POLICY IF EXISTS "delete cat solo autenticados"                         ON public.categories;
DROP POLICY IF EXISTS "lectura publica cat"                                  ON public.categories;
DROP POLICY IF EXISTS "escritura cat solo admin"                             ON public.categories;
DROP POLICY IF EXISTS "update cat solo admin"                                ON public.categories;
DROP POLICY IF EXISTS "delete cat solo admin"                                ON public.categories;


-- ---------------------------------------------------------------------------
-- PASO 3 — Policies definitivas.
--
--   Visitante anonimo  -> SOLO lectura (el portfolio es publico).
--   Cuenta de Ariel    -> lectura y escritura.
--   Cualquier otra cuenta autenticada -> NADA.
-- ---------------------------------------------------------------------------

-- ---- projects -------------------------------------------------------------

CREATE POLICY "lectura publica projects"
  ON public.projects FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "insert solo admin"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);

CREATE POLICY "update solo admin"
  ON public.projects FOR UPDATE
  TO authenticated
  USING      (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid)
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);

CREATE POLICY "delete solo admin"
  ON public.projects FOR DELETE
  TO authenticated
  USING (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);


-- ---- categories -----------------------------------------------------------

CREATE POLICY "lectura publica categories"
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "insert cat solo admin"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);

CREATE POLICY "update cat solo admin"
  ON public.categories FOR UPDATE
  TO authenticated
  USING      (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid)
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);

CREATE POLICY "delete cat solo admin"
  ON public.categories FOR DELETE
  TO authenticated
  USING (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);


-- ---------------------------------------------------------------------------
-- PASO 4 — Limites de tamano en la base.
-- Defensa en profundidad: el navegador ya valida, pero el navegador lo
-- controla el atacante. Sin esto, un curl puede insertar un titulo de 50 MB.
-- Si alguna sentencia falla por datos existentes que ya superan el limite,
-- corregir esos registros y volver a ejecutarla.
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_title_len,
  DROP CONSTRAINT IF EXISTS projects_desc_len,
  DROP CONSTRAINT IF EXISTS projects_image_len;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_title_len CHECK (char_length(title)       <= 120),
  ADD CONSTRAINT projects_desc_len  CHECK (char_length(description) <= 600),
  ADD CONSTRAINT projects_image_len CHECK (image IS NULL OR char_length(image) <= 3000000);


-- ---------------------------------------------------------------------------
-- PASO 5 — Verificacion.
-- Esperado: 8 filas. Las 2 de SELECT con roles {anon,authenticated};
-- las otras 6 con roles {authenticated} y el UID en la expresion.
-- NO debe aparecer ninguna fila con cmd = 'ALL'.
-- ---------------------------------------------------------------------------
SELECT tablename, policyname, cmd, roles, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('projects', 'categories')
ORDER BY tablename, cmd;


-- ============================================================================
--  PASO 6 — PRUEBAS REALES (hacerlas, no asumir)
--
--  A) Lectura publica: DEBE devolver los proyectos.
--     curl 'https://<proyecto>.supabase.co/rest/v1/projects?select=title' \
--          -H "apikey: <clave_anon>"
--
--  B) Escritura anonima: DEBE fallar con 401/403.
--     curl -X POST 'https://<proyecto>.supabase.co/rest/v1/projects' \
--          -H "apikey: <clave_anon>" -H "Content-Type: application/json" \
--          -d '{"title":"test","description":"x","category":"landing"}'
--
--  C) El sitio sigue mostrando el portfolio a un visitante deslogueado.
--
--  D) Entrando al panel con tu cuenta, podes crear y borrar un proyecto.
--     Si esto falla, revisa que el UID del PASO 0 sea el correcto.
-- ============================================================================
