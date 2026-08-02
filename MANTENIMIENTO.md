# Mantenimiento — Portfolio Ariel.Dev

Rutina mínima para que el sitio no se degrade. Está pensada para que sea sostenible, no exhaustiva: **una rutina corta que cumplís vale más que una larga que abandonás.**

---

## Cada mes — 10 minutos

**1. Actualizar dependencias**

```bash
npm audit
npm outdated
npm update
npm run build    # verificar que sigue compilando
```

Si `npm audit` reporta algo, leé si afecta a `dependencies` o solo a `devDependencies`. Una vulnerabilidad en Vite (herramienta de build) no expone tu sitio en producción; una en `@supabase/supabase-js` sí.

**2. Verificar que RLS sigue activo**

Supabase → SQL Editor:

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename IN ('projects','categories');
```

Ambas deben decir `true`. Si creaste una tabla nueva, **RLS viene apagado por defecto** — es el error más fácil de cometer.

**3. Revisar accesos**

Supabase → Authentication → Users. Debería haber solo tu usuario. Si aparece otro, alguien entró.

---

## Cada 3 meses — 20 minutos

**4. Backup real de la base**

Supabase → Database → Backups. En el plan gratuito los backups automáticos son limitados: exportá manualmente y guardá el archivo fuera de Supabase.

```bash
# Requiere Supabase CLI
supabase db dump -f backup-$(date +%Y-%m).sql
```

**Un backup que nunca restauraste no es un backup.** Una vez al año, probá restaurarlo en un proyecto de prueba.

**5. Re-verificar cabeceras**

https://securityheaders.com — deberías mantener A o A+. Si bajó, el hosting cambió algo o el `.htaccess` no se subió en el último deploy.

**6. Medir rendimiento**

https://pagespeed.web.dev en modo Mobile. Compará con el número anterior. Si empeoró, algo pesado entró sin querer (una imagen sin comprimir suele ser la causa).

---

## Cada 6 meses

**7. Rotar la contraseña de admin.** Mínimo 16 caracteres, desde un gestor de contraseñas.

**8. Revisar la validez del certificado SSL.** Suele renovarse solo, pero confirmalo. Con HSTS activo, un certificado vencido deja el sitio inaccesible, no solo con advertencia.

**9. Revisar la CSP.** Abrí el sitio con la consola y buscá errores `Refused to load`. Indican que algo se está bloqueando — o es un ataque, o agregaste una librería y olvidaste declararla.

---

## Reglas permanentes

**Nunca pongas la `service_role` key en el frontend.** Ignora RLS y da control total de la base. Solo va en un entorno servidor (Edge Function), jamás en algo con prefijo `VITE_`.

**Toda tabla nueva necesita RLS.** Antes de usarla desde el navegador:

```sql
ALTER TABLE public.nueva_tabla ENABLE ROW LEVEL SECURITY;
-- y las políticas correspondientes (ver supabase/rls-policies.sql)
```

**Todo dato que venga de la base se escapa antes de mostrarlo.** Al agregar código que use `innerHTML`, pasá los valores por `escapeHtml()` de `js/security.js`. La alternativa segura por defecto es `textContent`, que nunca interpreta HTML.

**Toda librería nueva se declara en la CSP.** Si agregás algo de un CDN, agregá su dominio en `.htaccess`. Si no aparece, no carga — y ese es el comportamiento deseado.

**Nunca ejecutes `vite --host` en WiFi pública.** Expone tu proyecto de desarrollo a toda la red.

---

## Si algo sale mal

**El sitio no carga después de un deploy**
Consola del navegador (F12). Si hay errores `Refused to load ... Content Security Policy`, falta declarar un origen en el `.htaccess`.

**No puedo entrar al panel de admin**
Se eliminó la contraseña de respaldo `admin123`. Verificá que exista tu usuario en Supabase → Authentication → Users. Si no existe, crealo desde ahí.

**Desaparecieron proyectos de la base**
Revisá si RLS está activo (paso 2). Si estaba apagado, cualquiera pudo borrarlos. Restaurá desde backup y aplicá `supabase/rls-policies.sql` antes de volver a cargar contenido.

**El sitio quedó inaccesible por HTTPS**
Si activaste HSTS y el certificado falló, los navegadores se niegan a abrirlo y no se puede saltear. Arreglá el certificado en el hosting; no hay atajo. Por eso HSTS se activa **después** de confirmar que el SSL funciona.

---

## Calendario resumido

| Cuándo | Qué |
|---|---|
| Mensual | `npm audit` · RLS activo · usuarios de Supabase |
| Trimestral | Backup de base · securityheaders.com · PageSpeed |
| Semestral | Rotar contraseña · certificado SSL · revisar CSP |
| Anual | Probar restaurar un backup |
