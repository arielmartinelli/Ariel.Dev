-- ============================================================================
--  MIGRACION 12 — Comprobante de pago para el cliente
--  Ariel.Dev
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> Run
--  Es idempotente: se puede correr mas de una vez sin romper nada.
--
--  ------------------------------------------------------------------------
--  QUE TRAE
--  ------------------------------------------------------------------------
--  Cuando un pago queda en 'pagado', el cliente puede bajarse un comprobante
--  en PDF desde su portal. Para eso hace falta UNA sola cosa del lado de la
--  base: un NUMERO.
--
--  ------------------------------------------------------------------------
--  POR QUE EL NUMERO LO DA LA BASE Y NO EL NAVEGADOR
--  ------------------------------------------------------------------------
--  Lo facil seria armar el numero en el navegador con la fecha, o con el id
--  del pago. Las dos cosas estan mal:
--
--    * Con la fecha, el mismo pago genera un numero distinto cada vez que el
--      cliente aprieta "descargar". Si despues reclama algo citando su
--      comprobante, el numero que el tiene no existe en ningun lado.
--
--    * Con el uuid del pago, el numero es estable pero ilegible, y encima
--      filtra una clave interna de la base en un papel que el cliente puede
--      reenviar por mail.
--
--  Lo que sirve es un numero corto, legible, que se asigna UNA vez y queda
--  guardado: el mismo pago siempre devuelve el mismo numero, y vos lo podes
--  buscar en la tabla cuando el cliente te lo menciona.
--
--  ------------------------------------------------------------------------
--  ESTO NO ES UNA FACTURA
--  ------------------------------------------------------------------------
--  Es un recibo propio: constancia de que cobraste. No reemplaza ninguna
--  factura de AFIP y no se numera como una (nada de 0001-00000001, que es
--  justamente el formato de un comprobante fiscal y confundiria al cliente).
--  Por eso el formato es R-<anio>-<numero>: R de recibo, y a simple vista no
--  se parece a una factura. El PDF lo aclara por escrito, en el pie.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — El numero
-- ---------------------------------------------------------------------------
-- Secuencia propia, no `max(receipt_number) + 1`. Con max() dos pagos
-- aprobados en el mismo instante leen el mismo maximo y se asignan el mismo
-- numero; una secuencia no tiene esa carrera, porque nextval() nunca devuelve
-- dos veces lo mismo ni siquiera en transacciones paralelas.
CREATE SEQUENCE IF NOT EXISTS public.comprobantes_seq AS integer START 1;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_number int,
  ADD COLUMN IF NOT EXISTS receipt_issued_at timestamptz;

-- Dos pagos no pueden compartir numero. Va como indice unico y NO como
-- UNIQUE en la columna porque los pagos todavia sin cobrar tienen NULL, y
-- un indice parcial deja afuera esos NULL de forma explicita.
CREATE UNIQUE INDEX IF NOT EXISTS payments_receipt_number_unico
  ON public.payments (receipt_number)
  WHERE receipt_number IS NOT NULL;


-- ---------------------------------------------------------------------------
-- PASO 2 — Se asigna solo, cuando el pago pasa a 'pagado'
-- ---------------------------------------------------------------------------
-- En un trigger y no en cada lugar que marca un pago, porque hoy hay TRES
-- caminos distintos para que un pago quede pagado: el webhook de Mercado
-- Pago, el boton del panel, y la aprobacion de un comprobante de
-- transferencia. Si el numero se asignara en el codigo, habria que acordarse
-- en los tres — y en el cuarto que venga.
--
-- La condicion `receipt_number IS NULL` es lo que hace que el numero no
-- cambie nunca: si un pago se marca pagado, se vuelve atras y se vuelve a
-- marcar, se queda con el primer numero que le toco.
CREATE OR REPLACE FUNCTION public.asignar_numero_comprobante()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pagado' AND NEW.receipt_number IS NULL THEN
    NEW.receipt_number    := nextval('public.comprobantes_seq');
    NEW.receipt_issued_at := COALESCE(NEW.paid_at, now());
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS payments_numeran_comprobante ON public.payments;
CREATE TRIGGER payments_numeran_comprobante
  BEFORE INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.asignar_numero_comprobante();


-- ---------------------------------------------------------------------------
-- PASO 3 — Numerar lo que ya estaba cobrado
-- ---------------------------------------------------------------------------
-- Los pagos que ya figuran como pagados son anteriores al trigger, asi que
-- no tienen numero. Se los asigna por orden de cobro, para que la
-- numeracion siga la linea del tiempo y no el orden en que Postgres
-- devuelva las filas.
WITH a_numerar AS (
  SELECT id, row_number() OVER (ORDER BY COALESCE(paid_at, created_at), created_at, id) AS n
  FROM public.payments
  WHERE status = 'pagado' AND receipt_number IS NULL
)
UPDATE public.payments p
   SET receipt_number    = a_numerar.n,
       receipt_issued_at = COALESCE(p.paid_at, p.created_at)
  FROM a_numerar
 WHERE p.id = a_numerar.id;

-- Dejar la secuencia arriba de lo ya asignado, para que el proximo pago no
-- choque con el indice unico.
SELECT setval('public.comprobantes_seq',
              GREATEST(COALESCE((SELECT max(receipt_number) FROM public.payments), 0), 1));


-- ---------------------------------------------------------------------------
-- PASO 4 — El portal pasa a devolver el numero
-- ---------------------------------------------------------------------------
-- ATENCION AL METODO, no solo al resultado.
--
-- Este cuerpo NO se escribio de nuevo: se saco con pg_get_functiondef() de
-- la funcion que ya esta corriendo y se le agregaron TRES claves al bloque
-- 'pagos'. Todo lo demas esta caracter por caracter como estaba.
--
-- Se hace asi porque reescribir la funcion de memoria es exactamente lo que
-- rompio las migraciones 09 y 10 (ver el encabezado de la 11). Al probar
-- este archivo, el primer intento fue justamente eso, y la comparacion
-- contra la version real mostro que se perdian: total_usd, created_at, el
-- orden de las tareas por t.position, y el candado que oculta
-- production_url hasta que el proyecto esta finalizado. Ninguna de esas
-- cuatro cosas habria dado error: habrian fallado en silencio.
--
-- Si en el futuro hay que tocar esta funcion otra vez, el camino es el
-- mismo: traer la definicion viva de la base y parchear lo minimo.
--
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='portal_obtener';
CREATE OR REPLACE FUNCTION public.portal_obtener(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
    'client_name',        c.client_name,
    'project_name',       c.project_name,
    'project_brief',      c.project_brief,

    -- Documentos: si es un link, va entero; si es un PDF guardado, va solo
    -- el nombre y la bandera. El contenido se pide aparte.
    'proposal_url',       CASE WHEN c.proposal_url LIKE 'data:%' THEN NULL ELSE c.proposal_url END,
    'proposal_filename',  c.proposal_filename,
    'proposal_es_pdf',    (c.proposal_url LIKE 'data:application/pdf%'),

    'brief_pdf_url',      CASE WHEN c.brief_pdf_url LIKE 'data:%' THEN NULL ELSE c.brief_pdf_url END,
    'brief_pdf_filename', c.brief_pdf_filename,
    'brief_es_pdf',       (c.brief_pdf_url LIKE 'data:application/pdf%'),

    'budget_pdf_url',      CASE WHEN c.budget_pdf_url LIKE 'data:%' THEN NULL ELSE c.budget_pdf_url END,
    'budget_pdf_filename', c.budget_pdf_filename,
    'budget_es_pdf',       (c.budget_pdf_url LIKE 'data:application/pdf%'),

    -- "Demo lista" sin link NO es demo lista: se le informa la etapa anterior
    -- para que vea el cartel de espera y no un boton que no abre nada.
    'status',             CASE WHEN c.status = 'demo_lista' AND COALESCE(c.demo_url,'') = ''
                               THEN 'demo_pendiente' ELSE c.status END,

    'demo_url',           c.demo_url,
    'price_usd',          c.price_usd,
    'payment_plan',       c.payment_plan,
    'domain_choice',      c.domain_choice,
    'domain_name',        c.domain_name,
    'domain_extra_usd',   c.domain_extra_usd,
    'total_usd',          v_total,
    'client_decision',    c.client_decision,
    'progreso',           v_progreso,
    'created_at',         c.created_at,

    'production_url', CASE WHEN c.status = 'finalizado'
                           THEN c.production_url ELSE NULL END,

    'tareas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'done', t.done,
               'source', t.source,
               'pdf_name', t.pdf_name,
               'tiene_pdf', (t.pdf_data IS NOT NULL)
             ) ORDER BY t.position, t.created_at)
      FROM public.client_tasks t WHERE t.client_id = c.id
    ), '[]'::jsonb),

    'pagos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', p.kind, 'amount_usd', p.amount_usd,
               'status', p.status, 'paid_at', p.paid_at, 'method', p.method,
               'tiene_comprobante', (p.receipt_image IS NOT NULL),
               'comprobante_fecha', p.receipt_uploaded_at,
               -- Nuevo en la migracion 12. Con esto el portal arma el
               -- comprobante en PDF sin pedirle nada mas a la base.
               'amount_ars',        p.amount_ars,
               'nro_recibo',        p.receipt_number,
               'recibo_fecha',      p.receipt_issued_at
             ) ORDER BY p.created_at)
      FROM public.payments p WHERE p.client_id = c.id
    ), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END$function$;

REVOKE ALL ON FUNCTION public.portal_obtener(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_obtener(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 5 — Que quede escrito que esto no es una factura
-- ---------------------------------------------------------------------------
-- El comentario vive en la base, no en un README: dentro de seis meses, el
-- que mire la tabla payments en Supabase lo lee ahi mismo.
--
-- v_clientes_panel se deja intacta a proposito. Cuando necesites buscar un
-- recibo por numero, la consulta directa alcanza y no hay que arriesgar la
-- vista entera:
--
--   SELECT c.client_name, p.* FROM payments p
--     JOIN clients c ON c.id = p.client_id
--    WHERE p.receipt_number = 7;
COMMENT ON COLUMN public.payments.receipt_number IS
  'Numero de recibo propio, correlativo. NO es un comprobante fiscal de AFIP.';
COMMENT ON COLUMN public.payments.receipt_issued_at IS
  'Cuando se emitio el recibo (igual a paid_at salvo en los pagos viejos).';


-- ---------------------------------------------------------------------------
-- PASO 6 — Verificacion. Correr y leer, no asumir.
-- ---------------------------------------------------------------------------
WITH chequeos AS (
  SELECT 'La columna del numero existe' AS q, EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='payments' AND column_name='receipt_number') AS ok
  UNION ALL SELECT 'Dos recibos no pueden compartir numero', EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='payments' AND indexname='payments_receipt_number_unico')
  UNION ALL SELECT 'El numero se asigna solo al cobrar (trigger)', EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='payments_numeran_comprobante' AND NOT tgisinternal)
  UNION ALL SELECT 'Ningun pago cobrado quedo sin numero', NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE status='pagado' AND receipt_number IS NULL)
  UNION ALL SELECT 'El portal manda el numero al cliente', (
    SELECT prosrc LIKE '%nro_recibo%' FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'El portal sigue registrando cada visita', (
    SELECT provolatile='v' AND prosrc LIKE '%last_seen_at%'
    FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'Los PDF siguen sin viajar en cada consulta', (
    SELECT prosrc NOT LIKE '%''pdf_data'', t.pdf_data%'
    FROM pg_proc WHERE proname='portal_obtener')
  UNION ALL SELECT 'Sigue habiendo UNA sola portal_obtener', (
    SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='portal_obtener')
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS estado, q AS chequeo
FROM chequeos ORDER BY ok, q;
