-- ============================================================================
--  MIGRACION 02 — Transferencias, comprobantes y cobros manuales
--  Ariel.Dev
--
--  Ejecutar DESPUES de portal-clientes.sql, en: Supabase -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  QUE AGREGA
--  ----------
--  1. El cliente puede pagar por TRANSFERENCIA y subir la foto del
--     comprobante desde su portal.
--  2. Ese pago NO se acredita solo: queda "en revision" hasta que vos lo
--     aprobas desde el panel. Es la unica forma sensata de hacerlo — un
--     comprobante es una foto, y una foto se falsifica en dos minutos.
--  3. Podes cargar cobros manuales (kind = 'otro') sin tocar la base.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — Estados y tipos nuevos
-- ---------------------------------------------------------------------------

-- 'en_revision' = el cliente dice que pago y subio el comprobante, falta que
-- Ariel lo mire. Es un estado distinto de 'en_proceso' (que significa "el
-- cliente esta en el checkout de Mercado Pago"): mezclarlos haria imposible
-- saber cual necesita tu atencion.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pendiente', 'en_proceso', 'en_revision', 'pagado', 'rechazado'));

-- 'otro' habilita cobros manuales (una ampliacion, un extra pactado aparte).
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind IN ('anticipo', 'saldo', 'dominio', 'otro'));


-- ---------------------------------------------------------------------------
-- PASO 2 — Un solo anticipo/saldo/dominio, pero varios 'otro'
--
-- La restriccion UNIQUE (client_id, kind) evitaba duplicados del anticipo,
-- que es lo correcto. Pero tambien impediria cargar dos cobros manuales al
-- mismo cliente. Se cambia por un indice unico PARCIAL: aplica solo a los
-- tres tipos fijos y deja 'otro' libre.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_client_id_kind_key;
DROP INDEX IF EXISTS payments_kind_unico;

CREATE UNIQUE INDEX payments_kind_unico
  ON public.payments (client_id, kind)
  WHERE kind IN ('anticipo', 'saldo', 'dominio');


-- ---------------------------------------------------------------------------
-- PASO 3 — Columnas del comprobante
--
-- La imagen se guarda como data URL (base64) en la propia tabla, no en
-- Supabase Storage. Razon: para escribir en Storage, el rol anon necesitaria
-- una policy de INSERT sobre el bucket — y anon es publico, asi que
-- cualquiera podria subir archivos aunque no sea cliente. Guardarlo por una
-- funcion que exige el token mantiene la misma puerta angosta que el resto
-- del portal.
--
-- El navegador comprime la foto antes de mandarla; el tope de 1.5 MB de aca
-- es el limite duro, porque el navegador lo controla el que sube.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_image      text,
  ADD COLUMN IF NOT EXISTS receipt_note       text,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamptz;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_len;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_len
  CHECK (receipt_image IS NULL OR char_length(receipt_image) <= 2000000);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_nota_len;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_nota_len
  CHECK (receipt_note IS NULL OR char_length(receipt_note) <= 500);


-- ---------------------------------------------------------------------------
-- PASO 4 — El cliente sube el comprobante
--
-- Igual que el resto del portal: SECURITY DEFINER, exige el token, y solo
-- puede tocar la fila de ese token.
-- ---------------------------------------------------------------------------
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
  c        public.clients%ROWTYPE;
  v_pago   public.payments%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.clients
  WHERE access_token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link inválido o vencido.');
  END IF;

  -- Validacion del formato: solo imagenes, y NO se acepta SVG porque un SVG
  -- puede contener JavaScript y se ejecutaria al abrirlo en el panel.
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

  -- Un pago ya acreditado no se toca: sin esta guarda, alguien con el link
  -- podria pisar el comprobante de un pago cerrado.
  IF v_pago.status = 'pagado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese pago ya figura como abonado.');
  END IF;

  UPDATE public.payments
     SET receipt_image       = p_imagen,
         receipt_note        = left(coalesce(btrim(p_nota), ''), 500),
         receipt_uploaded_at = now(),
         method              = 'transferencia',
         -- OJO: pasa a 'en_revision', NO a 'pagado'. Una foto no es un pago.
         status              = 'en_revision'
   WHERE id = v_pago.id;

  RETURN jsonb_build_object('ok', true, 'status', 'en_revision');
END$$;

REVOKE ALL ON FUNCTION public.portal_subir_comprobante(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_subir_comprobante(text, text, text, text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 5 — portal_obtener actualizado
--
-- Suma al JSON el estado del comprobante. NO devuelve la imagen: el cliente
-- ya la tiene, mandarsela de vuelta serian cientos de KB por cada carga de
-- pagina para nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_obtener(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_progreso := public.calcular_progreso(c.id);
  v_total    := c.price_usd + CASE WHEN c.domain_choice = 'propio'
                                   THEN c.domain_extra_usd ELSE 0 END;

  SELECT jsonb_build_object(
    -- Se eligen los campos A MANO. No se usa to_jsonb(c) porque eso filtraria
    -- el access_token y las admin_notes al navegador del cliente.
    'client_name',      c.client_name,
    'project_name',     c.project_name,
    'project_brief',    c.project_brief,
    'status',           c.status,
    'demo_url',         c.demo_url,
    'price_usd',        c.price_usd,
    'domain_choice',    c.domain_choice,
    'domain_name',      c.domain_name,
    'domain_extra_usd', c.domain_extra_usd,
    'total_usd',        v_total,
    'client_decision',  c.client_decision,
    'progreso',         v_progreso,
    'created_at',       c.created_at,

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
               'status', p.status, 'paid_at', p.paid_at, 'method', p.method,
               -- Solo si HAY comprobante, no la imagen en si.
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
-- PASO 6 — Vista del panel: cuantos comprobantes esperan revision
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
-- PASO 6.5 — CORRECCION: ON CONFLICT contra un indice PARCIAL
--
-- El PASO 2 cambio la restriccion UNIQUE (client_id, kind) por un indice
-- unico PARCIAL (solo para anticipo/saldo/dominio). Eso rompio dos funciones
-- de portal-clientes.sql que hacian:
--
--     ON CONFLICT (client_id, kind) DO NOTHING
--
-- Postgres necesita que la especificacion del ON CONFLICT coincida con un
-- indice EXACTO. Contra un indice parcial hay que repetir tambien su WHERE,
-- si no falla con:
--
--     there is no unique or exclusion constraint matching
--     the ON CONFLICT specification
--
-- Sintoma para el cliente: al apretar "Quiero continuar con la produccion"
-- saltaba "No se pudo registrar tu respuesta". Se vuelven a crear las dos
-- funciones con el ON CONFLICT correcto.
-- ---------------------------------------------------------------------------

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
  c         public.clients%ROWTYPE;
  v_texto   text;
  v_pos     int := 0;
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

  IF c.status <> 'demo_lista' THEN
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
     SET client_decision = 'continuar', decision_at = now(), status = 'en_produccion'
   WHERE id = c.id;

  FOREACH v_texto IN ARRAY COALESCE(p_cambios, '{}')
  LOOP
    v_texto := btrim(v_texto);
    CONTINUE WHEN v_texto = '';
    EXIT WHEN v_creadas >= 40;

    v_pos := v_pos + 1;
    INSERT INTO public.client_tasks (client_id, title, source, position)
    VALUES (c.id, left(v_texto, 400), 'cliente', v_pos);
    v_creadas := v_creadas + 1;
  END LOOP;

  -- El WHERE es obligatorio: sin el, no coincide con el indice parcial.
  INSERT INTO public.payments (client_id, kind, amount_usd, status)
  VALUES (c.id, 'anticipo', round(c.price_usd * 0.5, 2), 'pendiente')
  ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo', 'saldo', 'dominio')
  DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'status', 'en_produccion', 'tareas', v_creadas);
END$$;


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

  IF p_opcion = 'propio' THEN
    INSERT INTO public.payments (client_id, kind, amount_usd, status)
    VALUES (c.id, 'dominio', c.domain_extra_usd, 'pendiente')
    ON CONFLICT (client_id, kind) WHERE kind IN ('anticipo', 'saldo', 'dominio')
    DO NOTHING;
  ELSE
    DELETE FROM public.payments
     WHERE client_id = c.id AND kind = 'dominio' AND status = 'pendiente';
  END IF;

  RETURN jsonb_build_object('ok', true, 'progreso', public.calcular_progreso(c.id));
END$$;

REVOKE ALL ON FUNCTION public.portal_decidir(text, text, text[])      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_elegir_dominio(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_decidir(text, text, text[])      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_elegir_dominio(text, text, text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 7 — Verificacion
-- ---------------------------------------------------------------------------
SELECT
  CASE WHEN count(*) FILTER (WHERE column_name = 'receipt_image') = 1
       THEN '✅ OK' ELSE '❌ FALLA' END AS estado,
  'Columnas del comprobante' AS chequeo
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payments'

UNION ALL
SELECT CASE WHEN has_function_privilege('anon',
              'public.portal_subir_comprobante(text,text,text,text)', 'EXECUTE')
            THEN '✅ OK' ELSE '❌ FALLA' END,
       'El cliente puede subir comprobantes'

UNION ALL
SELECT CASE WHEN pg_get_constraintdef(oid) LIKE '%en_revision%'
            THEN '✅ OK' ELSE '❌ FALLA' END,
       'Estado en_revision habilitado'
FROM pg_constraint WHERE conname = 'payments_status_check'

UNION ALL
SELECT CASE WHEN count(*) = 1 THEN '✅ OK' ELSE '❌ FALLA' END,
       'Cobros manuales habilitados (varios ''otro'')'
FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'payments_kind_unico'

UNION ALL
SELECT CASE WHEN pg_get_functiondef(p.oid) LIKE '%ON CONFLICT (client_id, kind) WHERE%'
            THEN '✅ OK' ELSE '❌ FALLA' END,
       'portal_decidir corregido (ON CONFLICT parcial)'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'portal_decidir';
