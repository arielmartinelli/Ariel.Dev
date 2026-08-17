# Auditoría y cambios — Ariel.Dev

Fecha: 13 de agosto de 2026
Alcance: revisión completa del proyecto + sector cliente + integración de cobros.

---

## 1. El bug que reportaste — corregido y verificado

**Síntoma:** al guardar o eliminar un proyecto desde el panel, el cartel de
confirmación aparecía *detrás* del panel. Había que cerrar el panel para poder
aceptar.

**Causa exacta:** SweetAlert2 escribe `z-index: 1060` en el atributo `style` de
su contenedor. `.admin-modal` tenía `z-index: 1200`. El diálogo se abría
literalmente por debajo del panel: invisible pero activo, lo que además dejaba
la interfaz bloqueada porque el diálogo seguía capturando el foco.

**Qué se hizo:**

1. Se creó una **escala de capas única** en `:root` (`--z-header`, `--z-modal`,
   `--z-dialog`…). Antes cada componente elegía su número a ojo —había hasta un
   `z-index: 99999` en la barra de progreso de scroll—, y por eso el choque era
   cuestión de tiempo. Ahora no queda ningún `z-index` suelto: todos salen de
   esa lista.
2. `.swal2-container` se fija en `--z-dialog` (2400), por encima de todo.
   Va con `!important` porque la librería lo escribe inline y una regla normal
   pierde contra el atributo `style`.
3. Refuerzo en runtime (`js/ui-dialogs.js`): en cada apertura se vuelve a fijar
   el z-index, por si una versión futura de la librería cambia el valor.
4. Los diálogos ahora heredan el tema oscuro del sitio, en vez del blanco por
   defecto que cortaba la continuidad visual.

**Verificado en navegador real** (Chromium, `dist` de producción):

| Prueba | Resultado |
|---|---|
| z-index del panel / del diálogo | 1200 / 2400 |
| El diálogo queda por encima | ✅ |
| El botón «Sí, eliminar» recibe el click (`elementFromPoint`) | ✅ |

La última fila es la que importa: no se comprobó que "se vea", se comprobó que
el punto donde se dibuja el botón devuelve ese botón y no el panel. Eso es lo
que fallaba.

---

## 2. Otras fallas encontradas

Ordenadas por gravedad. Todas corregidas salvo donde se aclara.

### 🔴 Graves

**F-01 · Las ediciones de los proyectos base se perdían solas.**
`projects.js` comparaba cada fila de la base contra `DEFAULT_PROJECTS` por
título y, si coincidían, pisaba la imagen y la descripción con los valores por
defecto —y encima disparaba un `UPDATE` a Supabase para dejarlo escrito. En la
práctica: editabas «Aura Store», el panel decía «actualizado con éxito», y al
recargar volvía el texto viejo. Los defaults ahora se usan **solo** como
semilla cuando la tabla está vacía. Lo que está en la base manda siempre.

**F-02 · Los errores de guardado se mostraban como éxito.**
Si Supabase rechazaba un `INSERT` (sesión vencida, RLS, sin conexión), el
`catch` escribía en `localStorage` y seguía como si nada. El panel anunciaba
«Proyecto agregado con éxito» aunque en el servidor no existiera nada: el
proyecto se veía en tu navegador y en ningún otro. Ahora toda escritura
devuelve `{ ok, persistido, error }` y el mensaje dice la verdad —incluido
«Guardado solo en este equipo» cuando corresponde.

**F-03 · Un `UPDATE` que no tocaba ninguna fila contaba como éxito.**
PostgREST devuelve `[]` sin error cuando el `id` ya no existe o RLS filtró la
fila. Ahora se detecta y se avisa.

### 🟠 Medias

**F-04 · Lenis (scroll suave) nunca funcionó en producción.**
Se cargaba desde `cdn.jsdelivr.net` por `<script>`, pero la CSP declara
`script-src 'self'`: el navegador bloqueaba el archivo. Y como el código
preguntaba `typeof Lenis !== 'undefined'`, el fallo era **silencioso**. Encima
`initSmoothScroll()` estaba comentado en `app.js`, así que se pagaba una
petición bloqueada por un efecto que nadie iba a ver. Ahora Lenis viene del
bundle vía npm: la CSP sigue estricta y el scroll suave sí funciona. Se
desactiva solo en móvil y con `prefers-reduced-motion`.

**F-05 · Doble envío del formulario de proyectos.**
Dos clicks rápidos en «Agregar» creaban el proyecto dos veces. El botón ahora
se deshabilita mientras guarda.

**F-06 · Categorías duplicadas por acentos.**
El slug se calculaba con `.toLowerCase()` *antes* de normalizar los acentos, así
que «Invitación» e «Invitacion» generaban ids distintos y se podían crear dos
categorías que después el filtro no encontraba. Corregido el orden.

**F-07 · Borrar una categoría dejaba proyectos huérfanos.**
Los proyectos con esa categoría desaparecían de todos los filtros sin
explicación. Ahora se comprueba antes y se avisa.

**F-08 · `cachedCategories` no se refrescaba al crear una categoría.**
La categoría nueva aparecía en el `<select>` pero su nombre no se resolvía en la
lista de proyectos hasta recargar la página.

### 🟡 Accesibilidad (WCAG)

**F-09 · El panel no se cerraba con Escape.** Incumple WCAG 2.1.2.
**F-10 · El foco se escapaba al fondo.** Al tabular dentro del panel abierto, el
recorrido seguía por los links de la página de atrás, visualmente tapados.
**F-11 · El fondo scrolleaba detrás del panel abierto.**
**F-12 · Faltaban `role="dialog"`, `aria-modal` y `aria-labelledby`.**

Todo esto vive ahora en `js/a11y.js`. Verificado en navegador:

| Prueba | Resultado |
|---|---|
| Foco inicial dentro del panel | ✅ |
| Foco atrapado tras 15 × Tab | ✅ |
| Escape cierra solo el diálogo cuando hay uno encima | ✅ |
| Escape cierra el panel | ✅ |
| El foco vuelve al botón que lo abrió | ✅ |
| Scroll de fondo bloqueado y restaurado | ✅ |

> Detalle que costó encontrar: `offsetParent` devuelve `null` para cualquier
> elemento dentro de un ancestro `position: fixed` —y el panel es fixed—, así
> que usarlo para detectar elementos visibles daba lista vacía. Y `.focus()` es
> un *no-op silencioso* mientras el elemento sigue en `visibility: hidden`
> durante la transición de entrada. Por eso el foco inicial se reintenta a lo
> largo de la animación.

### 🟡 SEO

**F-13 · `og:url` y `og:image` eran rutas relativas** (`/` y
`/images/og-banner.png`). WhatsApp, LinkedIn y Twitter no resuelven rutas
relativas: la vista previa al compartir el link salía sin imagen y sin destino.
Ahora son absolutas.

**F-14 · El Schema.org apuntaba al repo de GitHub**, no al sitio. Le decías a
Google que tu negocio vive en github.com.

**F-15 · Faltaba `<link rel="canonical">`.** Sin él, el mismo contenido servido
en `vercel.app` y en el dominio propio compite consigo mismo.

---

## 3. Sector cliente — lo nuevo

### Cómo funciona, de punta a punta

```
  VOS (panel)                          EL CLIENTE (link privado)
  ───────────                          ─────────────────────────
  1. Nuevo cliente
     nombre · página · qué se hace
     precio USD · link de la demo
            │
            └── genera un link secreto ──►  /cliente/<token>
                (43 caracteres al azar)

  2. Cargás el link de la demo   ──────►  «Tu demo está lista»
                                          [Ver mi demo]
                                          ¿Continuamos?  Sí / Por ahora no
                                                 │
  3. Te llegan los cambios pedidos ◄────────────┘  escribe sus cambios
     como tareas en su ficha                       ve el aviso del 50%

  4. Vas marcando tareas hechas  ──────►  la barra avanza sola
                                          (las tareas reparten de 0 a 99%)

  5. Al llegar al 99%            ──────►  «Último paso: el dominio»
                                          ○ el de la demo (incluido)
                                          ○ .com propio (+USD 10)

  6. Cargás el link de producción ─────►  100% · aparece el link final
     y marcás «finalizado»
```

### El progreso, exactamente como lo pediste

Las tareas reparten de **0 a 99 %**. El 1 % final se libera **solo** cuando el
cliente eligió el dominio. Así el 100 % coincide con «está todo hecho y el
dominio definido», que es justo el momento en que se muestra el link.

El cálculo vive en la base de datos (`calcular_progreso`), no en el navegador:
un solo lugar, mismo número para vos y para el cliente, y nadie puede
adelantarlo desde la consola.

Cuando la barra queda en 99 % el portal explica por qué («Falta solo un paso:
elegir el dominio»). Sin ese texto parece que algo se rompió.

### Cobros

- Al aceptar producción se crea automáticamente el **anticipo del 50 %**.
- Vos generás el **saldo final (50 %)** con un botón cuando corresponde.
- El **dominio propio** se suma como un cobro aparte de USD 10.
- Tu panel muestra **cobrado / por cobrar / activos / finalizados** arriba de
  todo. Lo pendiente de proyectos rechazados no se suma: sería inflar el número
  con plata que no va a entrar.

### Seguridad del portal (esto es lo importante)

La forma ingenua de hacerlo sería dar acceso de lectura a la tabla `clients` y
filtrar por token desde el navegador. **Sería un desastre**: la clave anon es
pública (está en el bundle), así que cualquiera podría hacer

```
curl '.../rest/v1/clients?select=*' -H "apikey: <anon>"
```

y bajarse la lista completa de tus clientes, con nombres, precios y links.
El filtro del lado del navegador no protege nada.

Lo que se hizo en cambio:

- El rol `anon` **no tiene ningún permiso** sobre `clients`, `client_tasks` ni
  `payments`. Ni siquiera `SELECT`.
- Todo el portal pasa por **funciones `SECURITY DEFINER`** que exigen el token y
  devuelven **solo** la fila correspondiente. Es la única puerta, y es angosta.
- Esas funciones eligen **campo por campo** qué se manda al navegador. No se
  serializa la fila entera: eso filtraría el `access_token` y tus notas
  internas.
- El **link de producción no se envía** hasta que el proyecto está al 100 % y
  finalizado. Si viaja al navegador «por las dudas», el cliente lo encuentra.
- El token **no se guarda en `localStorage`** —en una máquina compartida, el
  siguiente que la use entraría— y se **borra de la barra de direcciones**
  apenas se lee, para que no quede en una captura de pantalla.
- La página declara `referrer: no-referrer`: al tocar el link de la demo, el
  token **no viaja** en la cabecera `Referer` al sitio de destino. Sin eso,
  quedaría en los logs de cualquier servidor visitado.
- El link es **revocable** sin perder el historial.
- Token inválido y link revocado devuelven **exactamente lo mismo**: no se le
  confirma a nadie que un token existe.

---

## 4. Mercado Pago — sí se puede, y sí conviene automático

**La respuesta corta a tu pregunta:** sí, se puede integrar de verdad, con
cuotas, y que el estado se actualice solo. No hace falta que generes un link a
mano cada vez.

**Por qué hace falta un backend mínimo:** para crear un cobro hay que llamar a
la API de Mercado Pago con tu `ACCESS_TOKEN`, que permite cobrar en tu nombre.
Si estuviera en el bundle, cualquiera lo lee con Ctrl+U. Por eso se agregaron
dos funciones serverless en Vercel (gratis en tu plan, sin servidor que
mantener):

| Archivo | Qué hace |
|---|---|
| `api/mp-crear-preferencia.js` | El cliente aprieta «Pagar» → crea la preferencia y lo manda al checkout de Mercado Pago (con cuotas) |
| `api/mp-webhook.js` | Mercado Pago avisa que pagó → se acredita solo en el portal y en tu panel |

**Tres decisiones que evitan que te roben:**

1. **El monto nunca viene del navegador.** Se calcula en el servidor a partir
   del precio guardado. Si el importe viajara en la petición, alguien podría
   mandar `{ amount: 1 }` y pagar un dólar por un proyecto de 800.

2. **El webhook no le cree al mensaje que recibe.** Es una URL pública que
   decide quién figura como que pagó; si le creyera al POST, cualquiera manda
   «pago aprobado» y listo. Entonces: valida la firma HMAC, y **aunque la firma
   sea válida vuelve a preguntarle a Mercado Pago** por ese pago. Lo único que
   se cree es lo que responde Mercado Pago directamente.

3. **Se compara el monto acreditado** contra el esperado (con 1 % de tolerancia
   por el redondeo de la cotización). Un pago de $100 no acredita un saldo de
   $400.000: queda marcado para que lo revises a mano.

También es **idempotente**: Mercado Pago reintenta las notificaciones, y
procesar el mismo aviso dos veces no duplica nada.

**Cotización:** Mercado Pago cobra en pesos. El precio se guarda en USD y se
convierte al momento de pagar usando `dolarapi.com`, con cache de 30 minutos y
un valor de respaldo configurable. Sin ese respaldo, una caída de la API haría
cobrar un monto equivocado.

**Alternativa manual (por si querés arrancar hoy):** podés generar un link de
pago desde la app de Mercado Pago y pasárselo al cliente. Funciona sin
configurar nada, pero marcás el cobro a mano y no hay confirmación automática.
Las funciones ya están escritas: cuando cargues las credenciales, empieza a
andar solo.

---

## 5. Qué falta hacer (de tu lado)

Cinco pasos, en este orden:

1. **Correr el SQL.** Supabase → SQL Editor → pegar `supabase/portal-clientes.sql`
   completo y ejecutar. Es idempotente: se puede correr más de una vez.
   Al final trae consultas de verificación — leé el resultado, no asumas.

2. **Confirmar tu UID.** El SQL usa `83feffc4-1e28-4428-9c2c-a97ecaf82f91`
   (el mismo de `rls-policies.sql`). El PASO 0 del script lo verifica.

3. **Cargar las variables en Vercel** (Settings → Environment Variables), todas
   **sin** prefijo `VITE_`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `MP_ACCESS_TOKEN`,
   `MP_WEBHOOK_SECRET`, `SITE_URL`.
   Están explicadas una por una en `.env.example`.

4. **Configurar el webhook** en Mercado Pago → Tus integraciones → Webhooks:
   URL `https://arieldev.com/api/mp-webhook`, evento **Pagos**. Guardá la clave
   secreta que te da en `MP_WEBHOOK_SECRET`.

5. **Probar con credenciales de PRUEBA** antes de tocar plata real. Creá un
   cliente de mentira, entrá con su link, aceptá producción y pagá el anticipo
   con una tarjeta de prueba. Si el portal pasa a «Pagado» solo, el webhook
   funciona.

---

## 6. Rendimiento

**Build actual** (gzip):

| Archivo | Tamaño | Nota |
|---|---|---|
| `index.html` | 12,0 kB | |
| CSS | 9,6 kB | portfolio + panel |
| `main.js` | 20,3 kB | código propio |
| `lenis.js` | 5,7 kB | ahora en el bundle, antes bloqueado por CSP |
| `supabase.js` | **57,4 kB** | ver abajo |
| `cliente.js` + CSS | 6,3 kB | solo lo baja quien entra al portal |

**Lo que mejoró:**

- El portal del cliente es una entrada aparte: quien entra **no descarga** el
  cotizador, el generador de PDF ni los efectos de scroll del portfolio.
- Supabase se separó en su propio chunk: se cachea una vez y no se vuelve a
  bajar cuando cambia tu código.
- Los sourcemaps pasaron a `hidden`: se generan para poder depurar, pero el
  navegador ya no los descarga solo (antes exponían el código completo).
- Se eliminó una petición bloqueada por CSP (Lenis desde CDN).

**La optimización pendiente más grande — recomendada, no aplicada:**

`@supabase/supabase-js` pesa **57 kB gzip** y se descarga en la portada solo
para leer la lista de proyectos. Del SDK completo (auth, realtime, storage,
functions) la portada usa una fracción mínima.

Se puede bajar a casi cero así: leer los proyectos con un `fetch` directo a
PostgREST (`/rest/v1/projects?select=*`, que es una llamada REST común) y cargar
el SDK completo **solo** cuando se abre el panel de administración, donde sí
hace falta para manejar la sesión. Serían unos **57 kB menos en la portada**,
que es la página que te sirve de carta de presentación.

No lo apliqué en esta pasada a propósito: reimplementar el constructor de
consultas de Supabase al final de una sesión larga, sin poder probarlo contra tu
base real, es la clase de cambio que rompe algo silenciosamente. Es un trabajo
acotado y bien delimitado para hacer con la base delante.

**Otros pendientes menores:**

- `public/images/` tiene los `.jpg` originales (≈2,3 MB en total) además de los
  `.webp`. Los `.jpg` no se referencian en ningún lado: se pueden borrar.
- Las imágenes del portfolio no usan `loading="lazy"` ni `srcset`.
- `profile.webp` no se referencia desde ninguna página.
- Los links del footer apuntan a `github.com`, `linkedin.com` e `instagram.com`
  genéricos, sin tu usuario.

---

## 7. Mantenimiento

**Cada tanto**

- Revisar `USD_ARS_FALLBACK` (hoy 1250). Es el precio que se cobra si
  `dolarapi.com` no responde.
- Mirar los pagos en estado `en_proceso` que no avanzan: o el cliente abandonó
  el checkout, o el webhook falló. El panel de Mercado Pago muestra los intentos.

**Al cerrar un proyecto**

- Revocar el link del cliente (botón «Revocar link»). Los datos quedan; el
  acceso no. Es más seguro que dejar links vivos para siempre.

**Nunca**

- Poner prefijo `VITE_` a `SUPABASE_SERVICE_ROLE` o `MP_ACCESS_TOKEN`. Vite
  publica en el bundle todo lo que empiece con `VITE_`.
- Marcar a mano como «pagado» un cobro de Mercado Pago sin haber visto el dinero
  en tu cuenta. Ese botón existe para transferencias; usarlo por confianza rompe
  la única cadena de verificación real que hay.

**Si algo se filtra**

- `SUPABASE_SERVICE_ROLE`: rotarla ya en Supabase → Settings → API.
- `MP_ACCESS_TOKEN`: regenerarlo en Mercado Pago → Credenciales.
- Un link de cliente: revocarlo desde el panel.

---

## 8. Archivos

**Nuevos**

```
cliente.html                    portal privado del cliente
css/portal.css                  estilos del portal
js/cliente.js                   lógica del portal
js/clients.js                   acceso a datos (portal + panel)
js/admin-clients.js             gestión de clientes en el panel
js/ui-dialogs.js                capa única sobre SweetAlert2  ← el fix
js/a11y.js                      foco, Escape, anuncios
api/_lib.js                     utilidades del servidor
api/mp-crear-preferencia.js     inicio del cobro
api/mp-webhook.js               acreditación verificada
supabase/portal-clientes.sql    esquema + seguridad + funciones
AUDITORIA.md                    este documento
```

**Modificados**

```
css/styles.css      escala de capas, fix SweetAlert2, estilos del panel
index.html          pestañas del panel, semántica del modal, SEO
js/app.js           diálogos, foco, Lenis, manejo real de errores
js/projects.js      reescrito: F-01, F-02, F-03, F-06, F-07
vite.config.js      entrada del portal, chunks, sourcemaps ocultos
vercel.json         rewrite /cliente/:token, CSP con Mercado Pago, noindex
public/robots.txt   Disallow /cliente y /api
.env.example        separación explícita entre variables públicas y secretas
package.json        + lenis
```

---

## 9. Segunda pasada — el panel pasó a ser un dashboard

Después de probar la primera entrega aparecieron dos cosas: el scroll no
funcionaba dentro del panel, y el panel se había quedado chico.

### F-16 · El scroll interno del panel no andaba — causa: Lenis

Al activar el scroll suave (F-04), Lenis pasó a interceptar la rueda del mouse
en **toda** la página. Con el panel abierto yo llamaba a `lenis.stop()`, pero
`stop()` no "pausa y deja pasar": bloquea el scroll en todos lados, incluido el
contenedor de adentro del panel. Por eso los Escape funcionaban y la rueda no.

Se corrigió de dos formas, y las dos quedan:

1. **Estructural.** El panel dejó de ser un modal. Ahora es `/admin`, una
   página entera: scrollea el documento, no una caja dentro de otra caja.
2. **Defensiva.** Todo contenedor con scroll propio se marca con
   `data-lenis-prevent` — el cajón del menú móvil, la fila horizontal de
   proyectos y los diálogos de SweetAlert2 (que aparecen después, así que se
   detectan con un `MutationObserver`).

### F-17 · `init()` esperaba a la red antes de arrancar la interfaz

Descubierto mientras diagnosticaba lo anterior: `init()` empezaba con
`await getCategories()` y `await fetchDollarRate()`, y **recién después**
arrancaba Lenis, el tilt 3D y los efectos de scroll. Si Supabase estaba lento o
caído, esos `await` colgaban la función y los efectos no se inicializaban
nunca — una animación que se rompe por un problema de red que no tiene nada que
ver con ella.

Ahora todo lo que no depende de la red arranca primero. Los datos se piden
después, en paralelo, y cada uno atrapa su propio error.

### F-18 · El portfolio quedaba en blanco mientras cargaba

El contenedor se ponía en `opacity: 0` y solo volvía a 1 al terminar de pintar.
Con Supabase lento eso era un hueco invisible: parecía que la sección no
existía. Ahora hay un placeholder en el HTML (visible desde el primer pintado)
y la sección se vuelve visible pase lo que pase.

### F-19 · Un servidor caído se pagaba dos veces

`getProjects()` y `getCategories()` cacheaban el resultado bueno pero **no** el
del respaldo local. Con Supabase sin responder, cada llamada volvía a intentar
y pagaba el timeout completo de nuevo. Como el arranque las llama dos veces, el
visitante esperaba el doble para ver una página que ya se podía pintar. Ahora
el respaldo también se cachea.

### El dashboard

`/admin` — página completa, con barra lateral y cuatro secciones:

| Sección | Qué hace |
|---|---|
| **Resumen** | KPIs (cobrado, por cobrar, activos, tareas) + la cola de trabajo: cada proyecto con sus tareas pendientes y hechas. Marcar una acá mueve la barra que ve el cliente. |
| **Clientes** | Alta, link privado, ficha con tareas, cobros y estado. |
| **Cobros** | Todos los pagos de todos los clientes en una tabla, filtrable. |
| **Portfolio** | Lo de siempre: proyectos y categorías de la web pública. |

Los proyectos se ordenan por cantidad de pendientes: lo que más falta, arriba.
Y un proyecto en producción **sin** tareas cargadas igual aparece, porque «sin
tareas» también es información: significa que hay que cargarlas.

### Lo que ganó el sitio público

Sacar el panel de `index.html` no fue solo orden:

| | Antes | Ahora |
|---|---|---|
| `index.html` | 57,9 kB | 45,7 kB |
| JS de la portada (gzip) | 20,3 kB | **10,4 kB** |

El código de gestión de clientes, cobros y tareas ya no lo descarga cualquiera
que entre a ver tus trabajos.

### Verificado en navegador

| Prueba | Resultado |
|---|---|
| Login se muestra, dashboard oculto sin sesión | ✅ |
| Navegación entre las 4 secciones | ✅ |
| La página scrollea (el problema original) | ✅ |
| Barra lateral y superior fijas al scrollear | ✅ |
| Menú lateral como cajón en móvil, con Escape | ✅ |
| El botón «Admin» es un enlace real a `/admin` | ✅ |
| El modal ya no existe en `index.html` | ✅ |
| Contenedores marcados con `data-lenis-prevent` | ✅ |
| Lenis arranca de verdad (antes lo bloqueaba un `await`) | ✅ |
| Errores de JavaScript | ninguno |

### Rutas nuevas

`/admin` queda fuera de buscadores por tres lados: `<meta robots>`,
`Disallow` en `robots.txt` y cabecera `X-Robots-Tag` en `vercel.json`. Igual,
eso no es lo que lo protege: sin sesión válida las consultas vuelven vacías
porque las policies RLS exigen que `auth.uid()` sea tu cuenta. Esconder una
página nunca es un control de acceso.

---

## 10. El SQL, probado contra un Postgres real

Antes de que lo corras en tu base, el script se ejecutó contra un PostgreSQL 16
con un entorno que imita a Supabase (roles `anon` y `authenticated`, `auth.uid()`,
`auth.users`). Ahí apareció un error que en producción hubiera sido molesto de
diagnosticar.

### F-20 · El panel no habría podido escribir nada (GRANT vs RLS)

Son **dos candados distintos** y hay que abrir los dos:

| | Qué controla |
|---|---|
| `GRANT` | si un rol puede tocar **la tabla** |
| RLS (policies) | **qué filas** de esa tabla puede tocar |

El script revocaba todo para `anon` (correcto) pero nunca otorgaba nada
explícitamente a `authenticated`: quedaba dependiendo de los privilegios por
defecto del proyecto. En muchos Supabase eso funciona de casualidad; en uno
recién creado o endurecido, no — y el síntoma es
`permission denied for table clients` **antes** de que las policies siquiera se
evalúen.

Ahora los permisos de tabla son explícitos en las dos direcciones: se revoca
todo para `anon` y se otorga lo justo para `authenticated`. Si los defaults de
Supabase cambian algún día, el script sigue haciendo lo correcto en vez de
romperse o, peor, de abrir algo sin querer.

### Lo que se verificó, ejecutándolo

| Prueba | Resultado |
|---|---|
| El script corre sin errores | ✅ |
| Correrlo **dos veces** no rompe nada (idempotente) | ✅ |
| RLS activo en las 3 tablas | ✅ |
| `anon` sin **ningún** privilegio sobre las tablas | ✅ |
| El admin puede crear un cliente | ✅ |
| Token generado de 43 caracteres | ✅ |
| **Otra** cuenta autenticada ve 0 filas | ✅ |
| `anon` leyendo la tabla directo → `permission denied` | ✅ |
| `portal_obtener` con token válido devuelve el proyecto | ✅ |
| Con token inválido devuelve `NULL` (sin revelar nada) | ✅ |
| Aceptar producción crea las tareas + el anticipo del 50% | ✅ |
| Doble clic en «continuar» no duplica | ✅ |
| Progreso: 32% → 66% → **99%** (se frena sin dominio) | ✅ |
| Elegir dominio → **100%** | ✅ |
| Total pasa de USD 480 a 490 con dominio propio | ✅ |
| `production_url` oculto al 100% si no está finalizado | ✅ |
| Visible recién al marcar finalizado | ✅ |
| El `access_token` **no viaja** en la respuesta al cliente | ✅ |
| `admin_notes` **no viaja** en la respuesta al cliente | ✅ |

Las dos últimas son las que más importan: la función elige campo por campo qué
mandar en vez de serializar la fila entera. Si algún día alguien la cambia por
un `to_jsonb(c)`, esas dos pruebas son las que lo detectan.
