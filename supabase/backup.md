# Backups de la base de datos

Tu contenido del portfolio vive en dos tablas de Supabase. Hoy no tenés ninguna copia fuera de Supabase.

El riesgo ya no es que alguien te borre los datos —las policies RLS lo cubren— sino **un error propio**: un `DELETE` sin `WHERE` en el SQL Editor, un borrado desde el panel, o perder el acceso a la cuenta.

---

## Lo que hay que entender primero

**El plan gratuito de Supabase no tiene backups que puedas restaurar vos.** Hay backups internos de la plataforma, pero no una restauración a un punto en el tiempo que puedas ejecutar desde el dashboard. Si borrás una tabla, no hay botón de deshacer.

Por eso el respaldo tiene que salir de Supabase y quedar en un lugar tuyo.

La buena noticia: tus datos son chicos (dos tablas, unas decenas de filas). Un backup completo pesa poco y tarda segundos.

---

## Opción A — Manual desde el dashboard (2 minutos, sin instalar nada)

Sirve perfecto para tu escala. Hacelo cada 3 meses o después de cargar proyectos nuevos.

1. Supabase → **Table Editor** → tabla `projects`
2. Arriba a la derecha: **Export** → **Download as CSV**
3. Repetir con `categories`
4. Guardar ambos archivos en una carpeta con fecha: `backup-2026-08/`

Guardalos **fuera de la carpeta del proyecto** (no los subas a Git: si tenés imágenes en Base64, los CSV pesan y no aportan nada al repo).

> Ojo: el CSV puede cortar valores muy largos, como las imágenes en Base64. Para un respaldo fiel usá la opción B.

---

## Opción B — Dump completo con Supabase CLI (recomendada)

Instalación única:

```bash
npm install -g supabase
supabase login
```

Backup completo (estructura + datos + policies RLS):

```bash
supabase db dump --db-url "TU_CONNECTION_STRING" -f backup-$(date +%Y-%m-%d).sql
```

El connection string está en **Supabase → Settings → Database → Connection string → URI**.

> **La connection string contiene la contraseña de tu base.** No la pegues en el repo, ni en un chat, ni en el historial de comandos compartido. Tratala como una clave.

Solo los datos, sin la estructura:

```bash
supabase db dump --db-url "TU_CONNECTION_STRING" --data-only -f datos-$(date +%Y-%m-%d).sql
```

---

## Restaurar

Probalo **antes** de necesitarlo. Un backup que nunca restauraste no es un backup: es un archivo.

```bash
psql "TU_CONNECTION_STRING" -f backup-2026-08-02.sql
```

Para probar sin riesgo, creá un proyecto nuevo y gratuito en Supabase, restaurá ahí y verificá que las tablas tengan el contenido esperado. Nunca pruebes una restauración sobre la base de producción.

---

## Qué respaldar además de la base

La base no es lo único que perderías:

| Qué | Dónde está | Cómo respaldarlo |
|---|---|---|
| Código | GitHub | Ya versionado |
| Variables de entorno | Vercel | Anotadas en un gestor de contraseñas |
| Tablas `projects` y `categories` | Supabase | Este documento |
| Usuario admin | Supabase Auth | Se recrea a mano; anotá el email |
| Dominio | Tu registrador | Verificá que la renovación automática esté activa |

Las variables de entorno son la que más se olvida. Si perdés acceso a Vercel y no las tenés anotadas, tenés que sacarlas de Supabase de nuevo.

---

## Frecuencia sugerida

| Cuándo | Qué |
|---|---|
| Después de cargar proyectos nuevos | Export CSV (opción A) |
| Cada 3 meses | Dump completo (opción B) |
| Una vez al año | Probar una restauración real |

Para tu volumen de datos, exportar los CSV después de cada carga de proyectos alcanza. Lo importante es que exista una copia fuera de Supabase.
