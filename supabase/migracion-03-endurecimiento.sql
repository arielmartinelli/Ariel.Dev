-- ============================================================================
--  MIGRACION 03 — Endurecimiento del portal
--  Ariel.Dev
--
--  Ejecutar DESPUES de migracion-02, en: Supabase -> SQL Editor -> Run
--  Es idempotente.
--
--  QUE CORRIGE (hallazgos de la auditoria)
--  ---------------------------------------
--  S-02  portal_subir_comprobante no tenia limite de frecuencia: con un link
--        valido se podian subir imagenes de 2 MB en bucle.
--  S-06  El formato de receipt_image lo validaba SOLO la funcion. Si alguna
--        vez se inserta por otra via, entraba cualquier cosa. Ahora tambien
--        lo exige la base.
--  S-07  No habia forma de saber si un link se estaba usando de forma rara.
--        Se registra el ultimo acceso de cada cliente.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — El formato del comprobante, exigido por la BASE
--
-- Defensa en profundidad. Hoy la unica via de entrada es
-- portal_subir_comprobante, que ya valida el prefijo. Pero una validacion que
-- vive en un solo lugar se pierde el dia que alguien agrega una segunda via
-- (un panel, un script de migracion, una carga manual). El CHECK no se olvida.
--
-- Se excluye SVG a proposito: un SVG puede contener <script> y se ejecutaria
-- al abrirlo en el panel.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_formato;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_formato
  CHECK (
    receipt_image IS NULL
    OR receipt_image ~ '^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$'
  );


-- ---------------------------------------------------------------------------
-- PASO 2 — Rastro de uso del link
--
-- Sirve para dos cosas concretas:
--   1. Ver si un cliente entro alguna vez (o si el link nunca llego).
--   2. Detectar un link que se esta consultando cientos de veces por hora,
--      que es la senal de que se filtro o de que alguien esta automatizando.
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_count   bigint NOT NULL DEFAULT 0;


-- ---------------------------------------------------------------------------
-- PASO 3 — Limite de frecuencia para el comprobante
--
-- 5 subidas por hora y por cliente. Un cliente honesto sube una, quizas dos
-- si la primera salio movida. Cinco ya es raro; cincuenta es abuso.
--
-- NOTA SOBRE DONDE VA CADA LIMITE
-- --------------------------------
-- Este limite vive en la base porque es una ESCRITURA y esta atado a una
-- fila concreta: contar es barato al lado de guardar 2 MB.
--
-- portal_obtener es distinto: es una LECTURA anonima y de alta frecuencia
-- (el portal la llama en cada carga). Limitarla desde Postgres obligaria a
-- escribir una fila por cada lectura — mas caro que el ataque que evita — y
-- ademas Postgres no ve la IP del que llama, asi que no podria distinguir a
-- un cliente recargando de un atacante. Ese limite corresponde al borde
-- (Vercel / Cloudflare / los limites de plataforma de Supabase), no aca.
-- Ver AUDITORIA.md, seccion 11.
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
-- PASO 4 — Registrar el acceso al portal
--
-- portal_obtener era STABLE (solo lectura). Para dejar rastro tiene que poder
-- escribir, asi que pasa a VOLATILE. El costo es un UPDATE de dos columnas
-- por carga de pagina: despreciable al lado de lo que cuesta no saber si un
-- link se filtro.
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
  -- Corta de entrada cualquier sondeo con tokens cortos, sin tocar la tabla.
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
-- PASO 5 — La vista del panel muestra el rastro de acceso
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE no puede insertar columnas en el medio de una vista
-- existente: falla con "cannot change name of view column". Hay que
-- recrearla. Nada depende de esta vista, asi que borrarla es seguro.
DROP VIEW IF EXISTS public.v_clientes_panel;

CREATE VIEW public.v_clientes_panel
WITH (security_invoker = true) AS
SELECT
  c.id, c.access_token, c.client_name, c.project_name, c.status,
  c.demo_url, c.production_url, c.price_usd, c.domain_choice, c.domain_name,
  c.client_decision, c.whatsapp, c.is_active, c.created_at,
  c.last_seen_at, c.view_count,
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
-- PASO 6 — Verificacion
-- ---------------------------------------------------------------------------
SELECT '✅ OK' AS estado, 'Formato del comprobante exigido por la base' AS chequeo
WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_receipt_formato')

UNION ALL
SELECT '✅ OK', 'Rastro de acceso (last_seen_at, view_count)'
WHERE (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='clients'
          AND column_name IN ('last_seen_at','view_count')) = 2

UNION ALL
SELECT '✅ OK', 'Límite de 5 comprobantes por hora'
WHERE EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='portal_subir_comprobante'
    AND pg_get_functiondef(p.oid) LIKE '%v_recientes >= 5%');
