-- ============================================================================
--  MIGRACION 05 — El flujo de 9 etapas
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  UNICO REQUISITO: tener corrido portal-clientes.sql (el que crea las tablas).
--  Las migraciones 02, 03 y 04 son opcionales: si no se corrieron, el PASO 0
--  se trae solo lo que falte. Correrla igual con todas aplicadas no cambia
--  nada. Probado en las tres situaciones y corriendola dos veces seguidas.
--
--  Ver FLUJO.md para el diseño completo.
--
--  ------------------------------------------------------------------------
--  QUE CAMBIA
--  ------------------------------------------------------------------------
--  El flujo pasa de 5 etapas a 9, con una regla arriba de todo: en cada
--  momento hay UNA sola persona con la pelota.
--
--    1 demo_pendiente      Ariel arma la demo      -> cartel de espera
--    2 demo_lista          el cliente decide
--    - rechazado           (reabrible)
--    3 anticipo_pendiente  el cliente paga el 50%
--    4 en_produccion       carga cambios / los aplico
--    5 dominio             el cliente elige dominio
--    6 publicando          Ariel sube todo
--    7 saldo_pendiente     el cliente paga el saldo
--    8 finalizado          en linea
--
--  Cambios de fondo respecto de lo que habia:
--
--   A. LA LISTA DE CAMBIOS SE DESBLOQUEA CON EL PAGO, NO CON EL "ACEPTO".
--      portal_decidir ya no recibe los cambios ni manda a produccion: manda a
--      anticipo_pendiente y crea el cobro. Los cambios se cargan despues, con
--      portal_pedir_cambio, y solo cuando el anticipo esta pagado.
--
--   B. LAS DOS TRANSICIONES POR PAGO LAS HACE UN TRIGGER, NO LA PANTALLA.
--      anticipo pagado -> en_produccion; saldo pagado -> finalizado. Da igual
--      si el pago entro por Mercado Pago, si Ariel aprobo una transferencia o
--      si cargo un cobro manual en efectivo: hay un solo lugar donde puede
--      fallar en vez de tres.
--
--   C. LA DEMO NO SE PUEDE "ENVIAR" SIN LINK.
--      Pasar a demo_lista con demo_url vacio devuelve error, no un aviso. Y
--      calcular_progreso trata ese caso como si siguiera en demo_pendiente,
--      asi el portal vuelve solo al cartel de espera en vez de mostrar una
--      tarjeta rota.
--
--   D. EL DOMINIO PROPIO YA NO ES UN COBRO APARTE: se suma al saldo, que se
--      calcula recien al entrar en saldo_pendiente — o sea despues de que el
--      cliente eligio. Por eso el monto siempre sale bien y hace UNA sola
--      transferencia final.
--
--  ------------------------------------------------------------------------
--  POR QUE status DEJA DE SER ENUM
--  ------------------------------------------------------------------------
--  Postgres no deja usar un valor de ENUM recien agregado dentro de la misma
--  transaccion en que se agrego, y el editor SQL de Supabase corre el script
--  como una sola transaccion. O sea: con ENUM esta migracion fallaria a mitad
--  de camino, y el que la corre se queda con media base migrada.
--
--  Con text + CHECK corre de una, y agregar otra etapa el dia de mañana es
--  editar una linea. Se pierde el orden implicito del ENUM, que no se usaba
--  para nada: el orden del flujo vive en orden_etapa() (PASO 2), donde se
--  puede leer.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — Prerrequisitos: traerse solo lo que falte de las migraciones 02 y 03
--
--   Esta migracion usa cosas que agregaron las migraciones anteriores: las
--   columnas del comprobante, el estado 'en_revision', el indice unico parcial
--   de payments y el rastro de acceso (last_seen_at / view_count).
--
--   Si alguna de esas no se corrio, el script fallaba a mitad de camino con un
--   error que no decia que hacer — por ejemplo
--   "la columna c.last_seen_at no existe" en la vista del PASO 11.
--
--   En vez de exigir un orden que hay que recordar, este paso crea lo que
--   falte. Todo es IF NOT EXISTS / DROP + ADD, asi que correrlo con las
--   migraciones anteriores YA aplicadas no cambia nada: deja exactamente lo
--   mismo que ya estaba.
-- ---------------------------------------------------------------------------

-- De la 02: estados y tipos de cobro.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pendiente', 'en_proceso', 'en_revision', 'pagado', 'rechazado'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind IN ('anticipo', 'saldo', 'dominio', 'otro'));

-- De la 02: un solo anticipo/saldo/dominio por cliente, pero varios 'otro'.
-- Es un indice PARCIAL, y por eso todos los ON CONFLICT de este archivo
-- repiten su WHERE. En Postgres eso no es opcional: sin el WHERE, el
-- ON CONFLICT no encuentra el indice y falla.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_client_id_kind_key;
DROP INDEX IF EXISTS payments_kind_unico;
CREATE UNIQUE INDEX payments_kind_unico
  ON public.payments (client_id, kind)
  WHERE kind IN ('anticipo', 'saldo', 'dominio');

-- De la 02: columnas del comprobante de transferencia.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_image       text,
  ADD COLUMN IF NOT EXISTS receipt_note        text,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamptz;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_len;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_len
  CHECK (receipt_image IS NULL OR char_length(receipt_image) <= 2000000);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_nota_len;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_nota_len
  CHECK (receipt_note IS NULL OR char_length(receipt_note) <= 500);

-- De la 03: el formato del comprobante lo exige la base, no solo el navegador.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_formato;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_formato
  CHECK (
    receipt_image IS NULL
    OR receipt_image ~ '^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$'
  );

-- De la 03: rastro de acceso al link privado. ESTO es lo que faltaba.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_count   bigint NOT NULL DEFAULT 0;

-- De la 02/03: el cliente sube la foto del comprobante.
-- Se incluye entera y no solo por si falta: es la unica via por la que entra
-- una transferencia, y sin ella el portal muestra un boton que no hace nada.
CREATE OR REPLACE FUNCTION public.portal_subir_comprobante(
  p_token   text,
  p_kind    text,
  p_imagen  text,
  p_nota    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c           public.clients%ROWTYPE;
  v_pago      public.payments%ROWTYPE;
  v_recientes int;
BEGIN
  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  -- Limite ANTES de validar la imagen: si no, cada intento rechazado igual
  -- obliga al servidor a recibir y analizar 2 MB.
  SELECT count(*) INTO v_recientes
  FROM public.payments
  WHERE client_id = c.id
    AND receipt_uploaded_at IS NOT NULL
    AND receipt_uploaded_at > now() - interval '1 hour';

  IF v_recientes >= 5 THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Subiste varios comprobantes seguidos. Esperá un rato o escribime por WhatsApp.');
  END IF;

  IF p_imagen IS NULL OR p_imagen !~ '^data:image/(png|jpe?g|webp);base64,' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El archivo tiene que ser una imagen (JPG, PNG o WEBP).');
  END IF;

  IF char_length(p_imagen) > 2000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La imagen es demasiado pesada.');
  END IF;

  SELECT * INTO v_pago FROM public.payments
  WHERE client_id = c.id AND kind = p_kind
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese pago no existe.');
  END IF;

  IF v_pago.status = 'pagado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese pago ya figura como abonado.');
  END IF;

  UPDATE public.payments
     SET receipt_image       = p_imagen,
         receipt_note        = NULLIF(left(coalesce(btrim(p_nota), ''), 500), ''),
         receipt_uploaded_at = now(),
         method              = 'transferencia',
         -- 'en_revision', NO 'pagado'. Una foto no es un pago.
         status              = 'en_revision'
   WHERE id = v_pago.id;

  RETURN jsonb_build_object('ok', true, 'status', 'en_revision');
END$$;

REVOKE ALL ON FUNCTION public.portal_subir_comprobante(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_subir_comprobante(text, text, text, text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 1 — status: enum -> text + CHECK
--
--   Las filas que ya existen no se tocan. Los 5 valores viejos siguen
--   significando exactamente lo mismo.
--
--   La vista se suelta ACA, no en el PASO 11: Postgres no deja cambiarle el
--   tipo a una columna de la que depende una vista
--   ("cannot alter type of a column used by a view or rule"). Se vuelve a
--   crear al final, ya con status como text.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_clientes_panel;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients'
      AND column_name = 'status' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE public.clients ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.clients ALTER COLUMN status TYPE text USING status::text;
    ALTER TABLE public.clients ALTER COLUMN status SET DEFAULT 'demo_pendiente';
  END IF;
END$$;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_status_valido;
ALTER TABLE public.clients ADD CONSTRAINT clients_status_valido CHECK (status IN (
  'demo_pendiente',
  'demo_lista',
  'rechazado',
  'anticipo_pendiente',
  'en_produccion',
  'dominio',
  'publicando',
  'saldo_pendiente',
  'finalizado'
));


-- ---------------------------------------------------------------------------
-- PASO 2 — El orden del flujo, en un solo lugar
--
--   Todo lo que necesite saber "¿esta etapa viene antes o despues?" pregunta
--   acá. rechazado devuelve -1: esta fuera de la linea, no antes ni despues.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orden_etapa(p_status text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'demo_pendiente'     THEN 0
    WHEN 'demo_lista'         THEN 1
    WHEN 'anticipo_pendiente' THEN 2
    WHEN 'en_produccion'      THEN 3
    WHEN 'dominio'            THEN 4
    WHEN 'publicando'         THEN 5
    WHEN 'saldo_pendiente'    THEN 6
    WHEN 'finalizado'         THEN 7
    ELSE -1
  END
$$;


-- ---------------------------------------------------------------------------
-- PASO 3 — El progreso ahora lo aporta la etapa, no solo las tareas
--
--   Antes dependia unicamente de las tareas hechas, asi que el numero grande
--   se quedaba en 0% durante media obra y parecia que nada pasaba. Ahora cada
--   etapa suma lo suyo, y dentro de produccion las tareas mueven el tramo
--   40-75.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_progreso(p_client_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
  v_demo   text;
  v_total  int;
  v_hechas int;
BEGIN
  SELECT status, demo_url INTO v_estado, v_demo
  FROM public.clients WHERE id = p_client_id;

  IF v_estado IS NULL THEN RETURN 0; END IF;
  IF v_estado = 'rechazado' THEN RETURN 0; END IF;

  -- "Demo lista" sin link no es demo lista. Se trata como la etapa anterior
  -- para que el portal muestre el cartel de espera y no una tarjeta rota.
  IF v_estado = 'demo_lista' AND COALESCE(v_demo, '') = '' THEN
    RETURN 5;
  END IF;

  IF v_estado = 'demo_pendiente'     THEN RETURN 5;  END IF;
  IF v_estado = 'demo_lista'         THEN RETURN 15; END IF;
  IF v_estado = 'anticipo_pendiente' THEN RETURN 30; END IF;
  IF v_estado = 'dominio'            THEN RETURN 80; END IF;
  IF v_estado = 'publicando'         THEN RETURN 88; END IF;
  IF v_estado = 'saldo_pendiente'    THEN RETURN 95; END IF;
  IF v_estado = 'finalizado'         THEN RETURN 100; END IF;

  -- en_produccion: 40 + hasta 35 puntos segun las tareas completadas.
  SELECT count(*), count(*) FILTER (WHERE done) INTO v_total, v_hechas
  FROM public.client_tasks WHERE client_id = p_client_id;

  IF v_total = 0 THEN RETURN 40; END IF;
  RETURN 40 + floor((v_hechas::numeric / v_total) * 35)::int;
END$$;


-- ---------------------------------------------------------------------------
-- PASO 4 — Cobros: crear el que corresponda a la etapa
--
--   Funcion interna, la usan el trigger y admin_mover_flujo. Es idempotente:
--   si el cobro ya existe no lo duplica ni le pisa el monto.
--
--   El ON CONFLICT repite el WHERE del indice parcial creado en la migracion
--   02. En Postgres eso NO es opcional: sin el WHERE, el ON CONFLICT no
--   encuentra el indice y tira "no unique or exclusion constraint matching".
-- ---------------------------------------------------------------------------
--   SECURITY INVOKER, no DEFINER, y el motivo importa:
--
--     - portal_decidir es SECURITY DEFINER, asi que cuando llama a esta el
--       usuario efectivo ya es el dueño de la funcion: entra sin problema.
--     - admin_mover_flujo es SECURITY INVOKER y corre como Ariel: las
--       policies RLS lo dejan pasar porque es el dueño.
--     - cualquier otro usuario autenticado que la llame de prestado no ve la
--       fila del cliente por RLS y la funcion no hace nada.
--
--   Con SECURITY DEFINER habria que darle EXECUTE a authenticated y entonces
--   cualquier cuenta logueada podria crear filas de cobro para clientes
--   ajenos. Asi no.
CREATE OR REPLACE FUNCTION public.asegurar_cobro(p_client_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c      public.clients%ROWTYPE;
  v_monto numeric;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND OR c.price_usd <= 0 THEN RETURN; END IF;

  IF p_kind = 'anticipo' THEN
    v_monto := round(c.price_usd * 0.5, 2);
  ELSIF p_kind = 'saldo' THEN
    -- El dominio propio se suma acá. Como el saldo se crea recien al entrar
    -- en saldo_pendiente, para este momento el cliente ya eligio y el monto
    -- sale bien sin tener que corregirlo despues.
    v_monto := round(c.price_usd * 0.5, 2)
             + CASE WHEN c.domain_choice = 'propio' THEN c.domain_extra_usd ELSE 0 END;
  ELSE
    RETURN;
  END IF;

  INSERT INTO public.payments (client_id, kind, amount_usd, status)
  VALUES (p_client_id, p_kind, v_monto, 'pendiente')
  ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo','saldo','dominio')
  DO NOTHING;
END$$;

REVOKE ALL ON FUNCTION public.asegurar_cobro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asegurar_cobro(uuid, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 5 — Las dos transiciones automaticas
--
--   Un trigger sobre payments. Es el unico lugar del sistema donde un pago
--   mueve el flujo, y por eso funciona igual venga de donde venga:
--   webhook de Mercado Pago, aprobacion de una transferencia desde el panel,
--   o un cobro manual en efectivo marcado como pagado.
--
--   Si esto viviera en el JavaScript del panel, el webhook no lo ejecutaria
--   nunca y un cliente que paga un domingo a la noche se quedaria trabado
--   hasta que alguien entre al panel.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avanzar_por_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
BEGIN
  IF NEW.status <> 'pagado' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pagado' THEN RETURN NEW; END IF;

  SELECT status INTO v_estado FROM public.clients WHERE id = NEW.client_id;

  IF NEW.kind = 'anticipo' AND v_estado = 'anticipo_pendiente' THEN
    UPDATE public.clients SET status = 'en_produccion' WHERE id = NEW.client_id;

  ELSIF NEW.kind = 'saldo' AND v_estado = 'saldo_pendiente' THEN
    UPDATE public.clients SET status = 'finalizado' WHERE id = NEW.client_id;
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS payments_avanzan_flujo ON public.payments;
CREATE TRIGGER payments_avanzan_flujo
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.avanzar_por_pago();


-- ---------------------------------------------------------------------------
-- PASO 6 — El cliente decide (etapa 2 -> 3)
--
--   Ya NO recibe la lista de cambios ni manda a produccion. Manda a
--   anticipo_pendiente y crea el cobro del 50%. Los cambios llegan despues,
--   con el anticipo pagado.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_decidir(text, text, text[]);

CREATE FUNCTION public.portal_decidir(
  p_token    text,
  p_decision text,
  p_cambios  text[] DEFAULT NULL   -- se ignora; queda por compatibilidad
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.clients%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('continuar', 'no_continuar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisión inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF c.status <> 'demo_lista' OR COALESCE(c.demo_url, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Todavía no hay una demo lista para revisar.');
  END IF;

  -- Idempotente: evita el doble click y el reenvio del formulario. Si Ariel
  -- reabre la decision desde el panel, esto vuelve a estar en NULL y el
  -- cliente puede responder de nuevo por el mismo link.
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


-- ---------------------------------------------------------------------------
-- PASO 7 — El cliente carga cambios (etapa 4)
--
--   Cambia la guarda: antes bastaba con estar "en produccion". Ahora la
--   etapa en_produccion solo se alcanza con el anticipo pagado, asi que la
--   guarda ya expresa "pago y puede pedir". Se agrega el mensaje util para
--   cuando todavia no pago.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_pedir_cambio(p_token text, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c           public.clients%ROWTYPE;
  v_recientes int;
BEGIN
  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF c.status = 'anticipo_pendiente' THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'La lista de cambios se habilita cuando se acredita el anticipo.');
  END IF;

  IF c.status <> 'en_produccion' THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Esta etapa del proyecto ya está cerrada. Escribime por WhatsApp y lo vemos.');
  END IF;

  IF btrim(coalesce(p_texto, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escribí el cambio que querés.');
  END IF;

  -- Freno anti-spam del lado del servidor: el limite del navegador no cuenta,
  -- cualquiera puede llamar la funcion con curl.
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
-- PASO 8 — El cliente elige dominio (etapa 5 -> 6)
--
--   Ahora solo se puede en la etapa 'dominio', que habilita Ariel cuando
--   termino los cambios. Y al confirmar pasa a 'publicando': el cliente
--   queda esperando y la pelota vuelve a ser mia.
--
--   Ya NO crea un cobro de dominio aparte: los USD 10 se suman al saldo.
-- ---------------------------------------------------------------------------
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
  c        public.clients%ROWTYPE;
  v_nombre text;
BEGIN
  IF p_opcion NOT IN ('vercel', 'propio') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Opción de dominio inválida.');
  END IF;

  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  IF c.status <> 'dominio' THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Todavía no llegamos al paso del dominio.');
  END IF;

  v_nombre := NULLIF(left(btrim(coalesce(p_dominio, '')), 253), '');

  IF p_opcion = 'propio' AND v_nombre IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escribí qué dominio querés.');
  END IF;

  -- Se limpia cualquier cobro de dominio suelto de antes de esta migracion:
  -- ahora los USD 10 viajan dentro del saldo y cobrarlos dos veces seria feo.
  DELETE FROM public.payments
   WHERE client_id = c.id AND kind = 'dominio' AND status <> 'pagado';

  UPDATE public.clients
     SET domain_choice = p_opcion,
         domain_name   = CASE WHEN p_opcion = 'propio' THEN v_nombre ELSE NULL END,
         status        = 'publicando'
   WHERE id = c.id;

  RETURN jsonb_build_object('ok', true, 'status', 'publicando',
                            'progreso', public.calcular_progreso(c.id));
END$$;


-- ---------------------------------------------------------------------------
-- PASO 9 — El panel de Ariel mueve el flujo
--
--   SECURITY INVOKER a proposito: las policies RLS siguen decidiendo quien
--   puede. No hay un uid hardcodeado que mantener, y si la sesion no es la
--   del dueño el SELECT ... FOR UPDATE no encuentra la fila y sale por ahi.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_mover_flujo(uuid, text, text, text, boolean);

CREATE FUNCTION public.admin_mover_flujo(
  p_client_id        uuid,
  p_status           text    DEFAULT NULL,
  p_dominio          text    DEFAULT NULL,   -- 'vercel' | 'propio' | 'ninguno'
  p_dominio_nombre   text    DEFAULT NULL,
  p_reabrir_decision boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c        public.clients%ROWTYPE;
  v_estado text;
  v_avisos text[] := '{}';
BEGIN
  IF p_status IS NOT NULL AND public.orden_etapa(p_status) < 0
     AND p_status <> 'rechazado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Etapa inválida: ' || p_status);
  END IF;

  IF p_dominio IS NOT NULL AND p_dominio NOT IN ('vercel','propio','ninguno') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Opción de dominio inválida: ' || p_dominio);
  END IF;

  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'No se encontró el cliente (o la sesión no tiene permiso).');
  END IF;

  v_estado := COALESCE(p_status, c.status);

  -- --- Guarda dura: la demo no se envia sin link -------------------------
  -- Es un error, no un aviso. Antes esto pasaba con una advertencia que se
  -- podia ignorar y el cliente terminaba viendo un boton "Ver la demo" que
  -- no abria nada.
  IF v_estado = 'demo_lista' AND COALESCE(c.demo_url, '') = '' THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Cargá el link de la demo antes de enviársela. Sin link el cliente sigue viendo el cartel de espera.');
  END IF;

  -- --- Reabrir la decision -----------------------------------------------
  IF p_reabrir_decision OR v_estado IN ('demo_pendiente','demo_lista') THEN
    UPDATE public.clients SET client_decision = NULL, decision_at = NULL
     WHERE id = p_client_id;
    c.client_decision := NULL;
  END IF;

  -- --- Dominio ------------------------------------------------------------
  -- Se aplica ANTES del cambio de etapa: si la etapa nueva es saldo_pendiente,
  -- el monto del saldo tiene que calcularse con el dominio ya definido.
  IF p_dominio = 'ninguno' THEN
    UPDATE public.clients SET domain_choice = NULL, domain_name = NULL WHERE id = p_client_id;
  ELSIF p_dominio = 'vercel' THEN
    UPDATE public.clients SET domain_choice = 'vercel', domain_name = NULL WHERE id = p_client_id;
  ELSIF p_dominio = 'propio' THEN
    UPDATE public.clients
       SET domain_choice = 'propio',
           domain_name = NULLIF(left(btrim(coalesce(p_dominio_nombre,'')), 253), '')
     WHERE id = p_client_id;
  END IF;

  IF p_dominio IS NOT NULL THEN
    DELETE FROM public.payments
     WHERE client_id = p_client_id AND kind = 'dominio' AND status <> 'pagado';
  END IF;

  -- --- Etapa --------------------------------------------------------------
  IF p_status IS NOT NULL AND v_estado <> c.status THEN
    UPDATE public.clients SET status = v_estado WHERE id = p_client_id;

    -- Coherencia con lo que ve el cliente: si lo mando a cualquier etapa
    -- posterior a la decision, es porque acepto (aunque haya sido por
    -- WhatsApp y nunca haya tocado el boton).
    IF public.orden_etapa(v_estado) >= 2 AND c.client_decision IS NULL THEN
      UPDATE public.clients SET client_decision = 'continuar', decision_at = now()
       WHERE id = p_client_id;
    END IF;

    IF v_estado = 'rechazado' THEN
      UPDATE public.clients
         SET client_decision = 'no_continuar', decision_at = COALESCE(decision_at, now())
       WHERE id = p_client_id;
    END IF;
  END IF;

  -- --- Cobros que correspondan a la etapa ---------------------------------
  IF public.orden_etapa(v_estado) >= 2 THEN
    PERFORM public.asegurar_cobro(p_client_id, 'anticipo');
  END IF;
  IF public.orden_etapa(v_estado) >= 6 THEN
    PERFORM public.asegurar_cobro(p_client_id, 'saldo');
  END IF;

  -- --- Avisos -------------------------------------------------------------
  -- No bloquean: informan por que el cliente todavia no ve lo que deberia.
  SELECT * INTO c FROM public.clients WHERE id = p_client_id;

  IF c.status = 'dominio' AND c.domain_choice IS NOT NULL THEN
    v_avisos := array_append(v_avisos, 'El dominio ya estaba elegido: el cliente solo tiene que confirmar.');
  END IF;
  IF c.status IN ('publicando','saldo_pendiente','finalizado') AND c.domain_choice IS NULL THEN
    v_avisos := array_append(v_avisos, 'Falta definir el dominio. Elegilo acá o mandá el proyecto a la etapa «Dominio» para que lo elija el cliente.');
  END IF;
  IF c.status IN ('saldo_pendiente','finalizado') AND COALESCE(c.production_url,'') = '' THEN
    v_avisos := array_append(v_avisos, 'Falta el link de producción: cuando pague el saldo no va a tener qué abrir.');
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'status',          c.status,
    'client_decision', c.client_decision,
    'domain_choice',   c.domain_choice,
    'domain_name',     c.domain_name,
    'progreso',        public.calcular_progreso(p_client_id),
    'avisos',          to_jsonb(v_avisos)
  );
END$$;

REVOKE ALL ON FUNCTION public.admin_mover_flujo(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mover_flujo(uuid, text, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[]) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.orden_etapa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orden_etapa(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 10 — portal_obtener: el link final se libera con el saldo pagado
--
--   Antes la condicion era "progreso = 100 Y status = finalizado". Ahora
--   'finalizado' YA significa saldo pagado (lo pone el trigger), asi que la
--   condicion es una sola. Se mantiene el rastro de acceso de la migracion 03.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_obtener(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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

  -- Mismo resultado para token inexistente y para link revocado: no se le
  -- confirma a nadie que un token "existe pero esta desactivado".
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.clients
     SET last_seen_at = now(), view_count = view_count + 1
   WHERE id = c.id;

  v_progreso := public.calcular_progreso(c.id);
  v_total    := c.price_usd + CASE WHEN c.domain_choice = 'propio'
                                   THEN c.domain_extra_usd ELSE 0 END;

  SELECT jsonb_build_object(
    -- Campos elegidos A MANO. Nunca to_jsonb(c): eso filtraria el
    -- access_token y las admin_notes al navegador del cliente.
    'client_name',      c.client_name,
    'project_name',     c.project_name,
    'project_brief',    c.project_brief,

    -- La etapa que ve el cliente NO es siempre la de la base: "demo lista"
    -- sin link se le muestra como "demo pendiente", asi ve el cartel de
    -- espera. La correccion se hace acá, del lado del servidor, para que no
    -- dependa de que el navegador se acuerde de chequearlo.
    'status',           CASE WHEN c.status = 'demo_lista' AND COALESCE(c.demo_url,'') = ''
                             THEN 'demo_pendiente' ELSE c.status END,

    'demo_url',         c.demo_url,
    'price_usd',        c.price_usd,
    'domain_choice',    c.domain_choice,
    'domain_name',      c.domain_name,
    'domain_extra_usd', c.domain_extra_usd,
    'total_usd',        v_total,
    'client_decision',  c.client_decision,
    'progreso',         v_progreso,
    'created_at',       c.created_at,

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
END$$;

REVOKE ALL ON FUNCTION public.portal_obtener(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_obtener(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 11 — La vista del panel
--
--   DROP + CREATE porque CREATE OR REPLACE no puede cambiar el tipo de una
--   columna existente (status pasa de estado_proyecto a text) ni insertar
--   columnas en el medio.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_clientes_panel;

CREATE VIEW public.v_clientes_panel
WITH (security_invoker = true) AS
SELECT
  c.id, c.access_token, c.client_name, c.project_name, c.status,
  c.demo_url, c.production_url, c.price_usd, c.domain_choice, c.domain_name,
  c.domain_extra_usd, c.client_decision, c.whatsapp, c.is_active, c.created_at,
  c.last_seen_at, c.view_count,
  public.orden_etapa(c.status)   AS orden,
  public.calcular_progreso(c.id) AS progreso,
  (SELECT count(*) FROM public.client_tasks t WHERE t.client_id = c.id)            AS tareas_total,
  (SELECT count(*) FROM public.client_tasks t WHERE t.client_id = c.id AND t.done) AS tareas_hechas,
  COALESCE((SELECT sum(p.amount_usd) FROM public.payments p
             WHERE p.client_id = c.id AND p.status = 'pagado'), 0)                 AS cobrado_usd,
  COALESCE((SELECT sum(p.amount_usd) FROM public.payments p
             WHERE p.client_id = c.id AND p.status <> 'pagado'), 0)                AS pendiente_usd,
  (SELECT count(*) FROM public.payments p
     WHERE p.client_id = c.id AND p.status = 'en_revision')                        AS comprobantes_a_revisar
FROM public.clients c;

GRANT SELECT ON public.v_clientes_panel TO authenticated;


-- ---------------------------------------------------------------------------
-- PASO 12 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'status acepta las 9 etapas' AS q, EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_status_valido'
      AND pg_get_constraintdef(oid) LIKE '%saldo_pendiente%'
  ) AS ok
  UNION ALL SELECT 'status ya no es ENUM', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
      AND column_name='status' AND data_type='text')
  UNION ALL SELECT 'El trigger de pagos mueve el flujo', EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname='payments_avanzan_flujo' AND NOT tgisinternal)
  UNION ALL SELECT 'orden_etapa() instalada', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='orden_etapa')
  UNION ALL SELECT 'El saldo incluye el dominio propio', (
    SELECT prosrc LIKE '%domain_extra_usd%' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='asegurar_cobro')
  UNION ALL SELECT 'La demo no se envía sin link', (
    SELECT prosrc LIKE '%Cargá el link de la demo%' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_mover_flujo')
  UNION ALL SELECT 'anon NO puede mover el flujo', NOT has_function_privilege('anon',
    'public.admin_mover_flujo(uuid, text, text, text, boolean)', 'EXECUTE')

  -- Prerrequisitos del PASO 0: si alguno sale ❌ es que quedó a medias.
  UNION ALL SELECT 'Rastro de acceso (last_seen_at, view_count)', (
    SELECT count(*) = 2 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
      AND column_name IN ('last_seen_at','view_count'))
  UNION ALL SELECT 'Columnas del comprobante', (
    SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payments'
      AND column_name IN ('receipt_image','receipt_note','receipt_uploaded_at'))
  UNION ALL SELECT 'El cliente puede subir comprobantes', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='portal_subir_comprobante')
  UNION ALL SELECT 'Índice parcial de cobros (permite varios «otro»)', EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='payments_kind_unico')
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;
