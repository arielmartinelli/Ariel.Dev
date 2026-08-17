-- ============================================================================
--  VERIFICACION DEL PORTAL DE CLIENTES
--  Pegar en Supabase -> SQL Editor -> Run.  Todo debe decir OK.
--  Si algo dice FALLA, ese renglon explica que revisar.
-- ============================================================================
WITH
uid_admin AS (SELECT '83feffc4-1e28-4428-9c2c-a97ecaf82f91'::uuid AS id),

chequeos AS (

  SELECT 1 AS n, 'Tu cuenta de admin existe' AS chequeo,
         (SELECT count(*) FROM auth.users u, uid_admin a WHERE u.id = a.id) = 1 AS pasa,
         coalesce((SELECT email FROM auth.users u, uid_admin a WHERE u.id = a.id),
                  'el UID del script no existe en auth.users') AS detalle

  UNION ALL SELECT 2, 'Existen las 3 tablas',
         (SELECT count(*) FROM pg_tables WHERE schemaname='public'
            AND tablename IN ('clients','client_tasks','payments')) = 3,
         (SELECT count(*)::text || ' de 3' FROM pg_tables WHERE schemaname='public'
            AND tablename IN ('clients','client_tasks','payments'))

  UNION ALL SELECT 3, 'RLS activo en las 3',
         (SELECT count(*) FROM pg_tables WHERE schemaname='public'
            AND tablename IN ('clients','client_tasks','payments') AND rowsecurity) = 3,
         (SELECT count(*)::text || ' de 3' FROM pg_tables WHERE schemaname='public'
            AND tablename IN ('clients','client_tasks','payments') AND rowsecurity)

  -- El mas importante: si anon tiene UN solo privilegio, la lista de clientes
  -- se puede bajar con un curl usando la clave publica del bundle.
  UNION ALL SELECT 4, 'anon SIN acceso a las tablas',
         (SELECT count(*) FROM information_schema.role_table_grants
            WHERE table_schema='public' AND grantee='anon'
              AND table_name IN ('clients','client_tasks','payments')) = 0,
         (SELECT CASE WHEN count(*)=0 THEN 'ningun privilegio (correcto)'
                      ELSE 'FUGA: ' || string_agg(DISTINCT privilege_type, ', ') END
            FROM information_schema.role_table_grants
            WHERE table_schema='public' AND grantee='anon'
              AND table_name IN ('clients','client_tasks','payments'))

  -- Sin esto el panel no puede escribir: da "permission denied for table".
  UNION ALL SELECT 5, 'Tu panel puede escribir',
         (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
            WHERE table_schema='public' AND grantee='authenticated'
              AND privilege_type='INSERT'
              AND table_name IN ('clients','client_tasks','payments')) = 3,
         (SELECT count(DISTINCT table_name)::text || ' de 3 tablas con INSERT'
            FROM information_schema.role_table_grants
            WHERE table_schema='public' AND grantee='authenticated'
              AND privilege_type='INSERT'
              AND table_name IN ('clients','client_tasks','payments'))

  UNION ALL SELECT 6, 'Policies de admin creadas',
         (SELECT count(*) FROM pg_policies WHERE schemaname='public'
            AND tablename IN ('clients','client_tasks','payments')) >= 3,
         (SELECT count(*)::text || ' policies' FROM pg_policies WHERE schemaname='public'
            AND tablename IN ('clients','client_tasks','payments'))

  UNION ALL SELECT 7, 'Las 4 funciones del portal',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN
            ('portal_obtener','portal_decidir','portal_elegir_dominio','portal_pedir_cambio')) = 4,
         (SELECT count(*)::text || ' de 4' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN
            ('portal_obtener','portal_decidir','portal_elegir_dominio','portal_pedir_cambio'))

  UNION ALL SELECT 8, 'El cliente puede usar el portal',
         has_function_privilege('anon', 'public.portal_obtener(text)', 'EXECUTE'),
         CASE WHEN has_function_privilege('anon','public.portal_obtener(text)','EXECUTE')
              THEN 'anon puede ejecutar portal_obtener' ELSE 'falta el GRANT EXECUTE' END

  UNION ALL SELECT 9, 'Vista del panel',
         (SELECT count(*) FROM pg_views WHERE schemaname='public'
            AND viewname='v_clientes_panel') = 1,
         (SELECT CASE WHEN count(*)=1 THEN 'v_clientes_panel lista'
                      ELSE 'no existe' END FROM pg_views
            WHERE schemaname='public' AND viewname='v_clientes_panel')
)

SELECT CASE WHEN pasa THEN '✅ OK' ELSE '❌ FALLA' END AS estado,
       chequeo, detalle
FROM chequeos ORDER BY n;
