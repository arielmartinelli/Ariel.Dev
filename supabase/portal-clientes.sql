-- ============================================================================
--  PORTAL DE CLIENTES — Esquema, seguridad y funciones
--  Ariel.Dev
--
--  Ejecutar completo en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  ------------------------------------------------------------------------
--  DECISION DE SEGURIDAD MAS IMPORTANTE DE ESTE ARCHIVO
--  ------------------------------------------------------------------------
--  El cliente entra por un link secreto, SIN cuenta ni contrasena. La forma
--  ingenua de resolverlo seria dar SELECT a 'anon' sobre la tabla clients con
--  una policy tipo `USING (true)` y filtrar por token desde el navegador.
--  Eso seria un desastre: la clave anon es publica (esta en el bundle), asi
--  que cualquiera podria hacer
--
--      curl '.../rest/v1/clients?select=*' -H "apikey: <anon>"
--
--  y bajarse la lista COMPLETA de clientes, con nombres, precios y links de
--  demo. El filtro por token del lado del navegador no protege nada.
--
--  Solucion aplicada: 'anon' NO tiene NINGUN permiso sobre estas tablas.
--  Todo el portal pasa por funciones SECURITY DEFINER que exigen el token y
--  solo devuelven la fila correspondiente. Es la unica puerta, y es angosta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — Extension para generar tokens aleatorios.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ---------------------------------------------------------------------------
-- PASO 1 — Tablas
-- ---------------------------------------------------------------------------

-- Estados del proyecto de un cliente.
--   demo_pendiente : lo estoy armando, todavia no hay nada que mostrar
--   demo_lista     : la demo esta publicada, el cliente puede verla y decidir
--   rechazado      : el cliente decidio no seguir
--   en_produccion  : el cliente acepto, se estan aplicando los cambios
--   finalizado     : 100%, pagado, link de produccion visible
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_proyecto') THEN
    CREATE TYPE estado_proyecto AS ENUM (
      'demo_pendiente', 'demo_lista', 'rechazado', 'en_produccion', 'finalizado'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Token del link privado. 32 bytes aleatorios en base64url = 43 caracteres.
  -- Adivinarlo por fuerza bruta es inviable (2^256 combinaciones).
  access_token      text NOT NULL UNIQUE
                       DEFAULT translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_'),

  client_name       text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 120),
  project_name      text NOT NULL CHECK (char_length(project_name) BETWEEN 1 AND 120),
  project_brief     text          CHECK (project_brief IS NULL OR char_length(project_brief) <= 2000),

  status            estado_proyecto NOT NULL DEFAULT 'demo_pendiente',

  demo_url          text CHECK (demo_url       IS NULL OR demo_url       ~ '^https?://'),
  production_url    text CHECK (production_url IS NULL OR production_url ~ '^https?://'),

  -- Precio de produccion en USD que ve el cliente.
  price_usd         numeric(10,2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),

  -- Dominio: 'vercel' (el que ya viene con la demo) o 'propio' (+10 USD).
  domain_choice     text CHECK (domain_choice IN ('vercel', 'propio')),
  domain_name       text CHECK (domain_name IS NULL OR char_length(domain_name) <= 253),
  domain_extra_usd  numeric(10,2) NOT NULL DEFAULT 10 CHECK (domain_extra_usd >= 0),

  -- Decision del cliente sobre seguir a produccion.
  client_decision   text CHECK (client_decision IN ('continuar', 'no_continuar')),
  decision_at       timestamptz,

  whatsapp          text CHECK (whatsapp IS NULL OR char_length(whatsapp) <= 30),
  admin_notes       text CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 4000),

  -- Se desactiva en vez de borrarse: revoca el link sin perder el historial.
  is_active         boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_token_idx  ON public.clients (access_token);
CREATE INDEX IF NOT EXISTS clients_status_idx ON public.clients (status);


-- Tareas / cambios pedidos. El progreso sale de aca.
CREATE TABLE IF NOT EXISTS public.client_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 400),
  -- 'cliente' = lo pidio el cliente desde el portal; 'ariel' = lo agregue yo.
  source      text NOT NULL DEFAULT 'ariel' CHECK (source IN ('cliente', 'ariel')),
  done        boolean NOT NULL DEFAULT false,
  position    int NOT NULL DEFAULT 0,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_tasks_client_idx ON public.client_tasks (client_id, position);


-- Pagos. 50% de anticipo + 50% al finalizar (+ dominio propio si aplica).
CREATE TABLE IF NOT EXISTS public.payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  kind              text NOT NULL CHECK (kind IN ('anticipo', 'saldo', 'dominio')),
  amount_usd        numeric(10,2) NOT NULL CHECK (amount_usd >= 0),
  amount_ars        numeric(12,2),

  status            text NOT NULL DEFAULT 'pendiente'
                       CHECK (status IN ('pendiente', 'en_proceso', 'pagado', 'rechazado')),
  method            text CHECK (method IN ('mercadopago', 'transferencia', 'efectivo', 'otro')),

  -- Trazabilidad con Mercado Pago.
  mp_preference_id  text,
  mp_payment_id     text UNIQUE,

  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Un solo anticipo y un solo saldo por cliente: evita duplicados si el
  -- cliente aprieta "Pagar" dos veces o si el webhook llega repetido.
  UNIQUE (client_id, kind)
);

CREATE INDEX IF NOT EXISTS payments_client_idx ON public.payments (client_id);


-- ---------------------------------------------------------------------------
-- PASO 2 — updated_at automatico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tocar_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS clients_updated_at ON public.clients;
CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();


-- ---------------------------------------------------------------------------
-- PASO 3 — Calculo del progreso (una sola definicion, usada por todos)
--
--   Las tareas reparten de 0 a 99.
--   El ultimo 1% se libera SOLO cuando esta elegido el dominio.
--   Asi el 100% coincide con "esta todo hecho y el dominio definido", que es
--   el momento en que se muestra el link de produccion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_progreso(p_client_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total     int;
  v_hechas    int;
  v_dominio   text;
  v_estado    estado_proyecto;
  v_progreso  int;
BEGIN
  SELECT domain_choice, status INTO v_dominio, v_estado
  FROM public.clients WHERE id = p_client_id;

  IF v_estado IS NULL OR v_estado IN ('demo_pendiente', 'demo_lista', 'rechazado') THEN
    RETURN 0;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE done)
    INTO v_total, v_hechas
  FROM public.client_tasks WHERE client_id = p_client_id;

  IF v_total = 0 THEN
    v_progreso := 0;
  ELSE
    v_progreso := floor((v_hechas::numeric / v_total) * 99);
  END IF;

  -- El 100 solo se alcanza con todas las tareas hechas Y el dominio elegido.
  IF v_total > 0 AND v_hechas = v_total AND v_dominio IS NOT NULL THEN
    v_progreso := 100;
  END IF;

  RETURN v_progreso;
END$$;


-- ---------------------------------------------------------------------------
-- PASO 4 — RLS: cerrar todo por defecto
--
--   anon           -> NADA. Ni SELECT. Entra solo por las funciones del PASO 5.
--   Ariel (admin)  -> todo.
--   otros usuarios -> NADA.
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- PERMISOS A NIVEL DE TABLA (GRANT) — no confundir con RLS.
--
-- Son DOS candados distintos y hay que abrir los dos:
--
--   GRANT  = "este rol puede tocar esta TABLA"        (permiso de tabla)
--   RLS    = "y solo puede ver/tocar ESTAS FILAS"     (permiso de fila)
--
-- Las policies de abajo no sirven de nada si el rol no tiene el GRANT: la
-- consulta falla antes, con "permission denied for table clients".
--
-- Supabase suele venir con privilegios por defecto que otorgan acceso a anon
-- y authenticated sobre todo lo nuevo en `public`. NO se depende de eso:
--   - a anon se le revoca TODO, explicitamente;
--   - a authenticated se le otorga lo justo, explicitamente.
-- Si algun dia esos defaults cambian, este script sigue haciendo lo correcto
-- en vez de romperse (o, peor, de abrir algo sin querer).
-- ---------------------------------------------------------------------------

-- anon: nada. La unica via son las funciones del PASO 5.
REVOKE ALL ON public.clients      FROM anon;
REVOKE ALL ON public.client_tasks FROM anon;
REVOKE ALL ON public.payments     FROM anon;

-- authenticated: acceso a la tabla; QUE filas ve lo deciden las policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments     TO authenticated;

-- Limpieza idempotente.
DROP POLICY IF EXISTS "clients admin total"      ON public.clients;
DROP POLICY IF EXISTS "client_tasks admin total" ON public.client_tasks;
DROP POLICY IF EXISTS "payments admin total"     ON public.payments;

-- REEMPLAZAR por tu UID si cambia. Es el mismo que ya usa rls-policies.sql.
CREATE POLICY "clients admin total" ON public.clients
  FOR ALL TO authenticated
  USING      (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid)
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);

CREATE POLICY "client_tasks admin total" ON public.client_tasks
  FOR ALL TO authenticated
  USING      (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid)
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);

CREATE POLICY "payments admin total" ON public.payments
  FOR ALL TO authenticated
  USING      (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid)
  WITH CHECK (auth.uid() = '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid);


-- ---------------------------------------------------------------------------
-- PASO 5 — La unica puerta del cliente: funciones que exigen el token.
--
--  SECURITY DEFINER = corren con los permisos del dueno de la funcion, no del
--  que llama. Por eso pueden leer la tabla aunque anon no tenga permiso.
--  Todas fijan `SET search_path = public` para que nadie pueda secuestrarlas
--  creando un esquema falso mas prioritario.
-- ---------------------------------------------------------------------------

-- 5.1 — Leer el estado completo del proyecto propio.
CREATE OR REPLACE FUNCTION public.portal_obtener(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          public.clients%ROWTYPE;
  v_progreso int;
  v_total    numeric;
  v_resultado jsonb;
BEGIN
  -- Longitud minima: corta de entrada cualquier sondeo con tokens cortos.
  IF p_token IS NULL OR char_length(p_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN NULL;   -- mismo resultado para token invalido y para link revocado
  END IF;

  v_progreso := public.calcular_progreso(c.id);
  v_total    := c.price_usd + CASE WHEN c.domain_choice = 'propio'
                                   THEN c.domain_extra_usd ELSE 0 END;

  SELECT jsonb_build_object(
    -- OJO: aca se elige a mano QUE campos ve el cliente. No se hace
    -- to_jsonb(c) porque eso filtraria access_token y admin_notes.
    'client_name',    c.client_name,
    'project_name',   c.project_name,
    'project_brief',  c.project_brief,
    'status',         c.status,
    'demo_url',       c.demo_url,
    'price_usd',      c.price_usd,
    'domain_choice',  c.domain_choice,
    'domain_name',    c.domain_name,
    'domain_extra_usd', c.domain_extra_usd,
    'total_usd',      v_total,
    'client_decision', c.client_decision,
    'progreso',       v_progreso,
    'created_at',     c.created_at,

    -- El link final solo existe cuando el proyecto esta terminado. No se
    -- manda "por si acaso": si viaja al navegador, el cliente lo encuentra.
    'production_url', CASE WHEN v_progreso = 100 AND c.status = 'finalizado'
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
               'status', p.status, 'paid_at', p.paid_at
             ) ORDER BY p.created_at)
      FROM public.payments p WHERE p.client_id = c.id
    ), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END$$;


-- 5.2 — El cliente decide si sigue a produccion y deja sus cambios.
CREATE OR REPLACE FUNCTION public.portal_decidir(
  p_token    text,
  p_decision text,
  p_cambios  text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.clients%ROWTYPE;
  v_texto  text;
  v_pos    int := 0;
  v_creadas int := 0;
BEGIN
  IF p_decision NOT IN ('continuar', 'no_continuar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisión inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  -- Solo se decide con la demo lista. Sin esta guarda, alguien con el link
  -- podria "aceptar" un proyecto que todavia no existe.
  IF c.status <> 'demo_lista' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Todavía no hay una demo lista para revisar.');
  END IF;

  -- Idempotente: si ya decidio, no se pisa (evita doble click y reenvios).
  IF c.client_decision IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya registramos tu respuesta.');
  END IF;

  IF p_decision = 'no_continuar' THEN
    UPDATE public.clients
       SET client_decision = 'no_continuar', decision_at = now(), status = 'rechazado'
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'status', 'rechazado');
  END IF;

  -- Continuar: se registran los cambios pedidos como tareas.
  UPDATE public.clients
     SET client_decision = 'continuar', decision_at = now(), status = 'en_produccion'
   WHERE id = c.id;

  FOREACH v_texto IN ARRAY COALESCE(p_cambios, '{}')
  LOOP
    v_texto := btrim(v_texto);
    CONTINUE WHEN v_texto = '';
    EXIT WHEN v_creadas >= 40;   -- tope: evita que alguien cargue 10.000 filas

    v_pos := v_pos + 1;
    INSERT INTO public.client_tasks (client_id, title, source, position)
    VALUES (c.id, left(v_texto, 400), 'cliente', v_pos);
    v_creadas := v_creadas + 1;
  END LOOP;

  -- Se crea el anticipo del 50% para que el cliente ya lo vea pendiente.
  INSERT INTO public.payments (client_id, kind, amount_usd, status)
  VALUES (c.id, 'anticipo', round(c.price_usd * 0.5, 2), 'pendiente')
  ON CONFLICT (client_id, kind) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'status', 'en_produccion', 'tareas', v_creadas);
END$$;


-- 5.3 — El cliente elige el dominio (paso previo al 100%).
CREATE OR REPLACE FUNCTION public.portal_elegir_dominio(
  p_token   text,
  p_opcion  text,
  p_dominio text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.clients%ROWTYPE;
BEGIN
  IF p_opcion NOT IN ('vercel', 'propio') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Opción de dominio inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF c.status <> 'en_produccion' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El dominio se elige durante la producción.');
  END IF;

  UPDATE public.clients
     SET domain_choice = p_opcion,
         domain_name   = CASE WHEN p_opcion = 'propio'
                              THEN left(btrim(coalesce(p_dominio, '')), 253)
                              ELSE NULL END
   WHERE id = c.id;

  -- El dominio propio cuesta aparte: se agrega como pago separado.
  IF p_opcion = 'propio' THEN
    INSERT INTO public.payments (client_id, kind, amount_usd, status)
    VALUES (c.id, 'dominio', c.domain_extra_usd, 'pendiente')
    ON CONFLICT (client_id, kind) DO NOTHING;
  ELSE
    DELETE FROM public.payments
     WHERE client_id = c.id AND kind = 'dominio' AND status = 'pendiente';
  END IF;

  RETURN jsonb_build_object('ok', true, 'progreso', public.calcular_progreso(c.id));
END$$;


-- 5.4 — Cambios adicionales durante la produccion.
CREATE OR REPLACE FUNCTION public.portal_pedir_cambio(p_token text, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.clients%ROWTYPE;
  v_recientes int;
BEGIN
  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF c.status <> 'en_produccion' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El proyecto no está en producción.');
  END IF;

  IF btrim(coalesce(p_texto, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escribí el cambio que querés.');
  END IF;

  -- Freno anti-spam del lado del servidor: 10 pedidos por hora. El limite del
  -- navegador no cuenta, cualquiera puede llamar la funcion con curl.
  SELECT count(*) INTO v_recientes
  FROM public.client_tasks
  WHERE client_id = c.id AND source = 'cliente' AND created_at > now() - interval '1 hour';

  IF v_recientes >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Demasiados pedidos seguidos. Probá en un rato.');
  END IF;

  INSERT INTO public.client_tasks (client_id, title, source, position)
  VALUES (c.id, left(btrim(p_texto), 400), 'cliente',
          COALESCE((SELECT max(position) + 1 FROM public.client_tasks WHERE client_id = c.id), 1));

  RETURN jsonb_build_object('ok', true);
END$$;


-- ---------------------------------------------------------------------------
-- PASO 6 — Permisos de ejecucion
--
--  anon puede EJECUTAR las funciones, pero sigue sin poder tocar las tablas.
--  Ese es todo el modelo: la funcion es la unica interfaz y valida el token.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.portal_obtener(text)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[])        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_elegir_dominio(text, text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_pedir_cambio(text, text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calcular_progreso(uuid)                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.portal_obtener(text)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[])      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_elegir_dominio(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_pedir_cambio(text, text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcular_progreso(uuid)                 TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 7 — Vista de control para el panel propietario (ingresos y avance).
-- Solo la ve Ariel: hereda las policies de las tablas de abajo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_clientes_panel
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.access_token,
  c.client_name,
  c.project_name,
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


-- ---------------------------------------------------------------------------
-- PASO 8 — Verificacion (correr y leer el resultado, no asumir)
-- ---------------------------------------------------------------------------

-- 8.1 Debe devolver 3 filas, todas con rowsecurity = true.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('clients', 'client_tasks', 'payments');

-- 8.2 anon NO debe aparecer con privilegios sobre estas tablas.
--     Si aparece alguna fila, hay una fuga: revocar antes de publicar.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('clients', 'client_tasks', 'payments')
  AND grantee = 'anon';

-- 8.3 Prueba real desde afuera. DEBE devolver 401/permission denied:
--     curl 'https://<proyecto>.supabase.co/rest/v1/clients?select=*' \
--          -H "apikey: <clave_anon>"
--
--     Y esto DEBE devolver null (token inexistente), no un error revelador:
--     curl -X POST 'https://<proyecto>.supabase.co/rest/v1/rpc/portal_obtener' \
--          -H "apikey: <clave_anon>" -H "Content-Type: application/json" \
--          -d '{"p_token":"noexiste-noexiste-noexiste"}'
