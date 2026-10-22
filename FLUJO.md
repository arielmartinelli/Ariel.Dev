# Flujo del proyecto

> **Estado: implementado.** Correr `supabase/migracion-05-flujo-9-etapas.sql`
> en el SQL Editor de Supabase. Tiene que devolver **11 ✅**.
>
> No hace falta haber corrido las migraciones 02, 03 ni 04: si falta algo de
> ellas, el PASO 0 se lo trae solo. Lo único que sí tiene que estar es
> `portal-clientes.sql`, que es el que crea las tablas.

Cómo avanza un proyecto desde que le mando la demo al cliente hasta que su
página queda publicada. Un solo camino, sin atajos y sin pasos que dependan de
que alguien se acuerde de hacer algo por WhatsApp.

**La regla de oro:** en cada momento hay **una sola** persona con la pelota, y
la pantalla dice de quién es. Si es del cliente, ve un botón. Si es mía, ve
qué estoy haciendo y no tiene nada que tocar.

---

## Las 9 etapas

| # | Clave interna | Pelota | Qué ve el cliente | Avance |
|---|---|---|---|---|
| 1 | `demo_pendiente` | **Ariel** | «Estamos armando tu demo» | 5% |
| 2 | `demo_lista` | **Cliente** | La demo + Continuar / No continuar | 15% |
| — | `rechazado` | — | «Quedamos en contacto» (reabrible) | 0% |
| 3 | `anticipo_pendiente` | **Cliente** | Anticipo 50% · MP o transferencia | 30% |
| 4 | `en_produccion` | **Cliente + Ariel** | Carga sus cambios · ve el avance | 40–75% |
| 5 | `dominio` | **Cliente** | Elige Vercel o dominio propio | 80% |
| 6 | `publicando` | **Ariel** | «Estamos publicando tu página» | 88% |
| 7 | `saldo_pendiente` | **Cliente** | Saldo 50% (+USD 10 si eligió propio) | 95% |
| 8 | `finalizado` | — | «Tu página está en línea» + link | 100% |

El **avance** ya no depende solo de las tareas: cada etapa aporta lo suyo. Así
el número grande de arriba se mueve aunque todavía no haya ni una tarea
cargada — antes se quedaba en 0% durante media obra y parecía que nada pasaba.

---

## Quién dispara cada paso

| De | A | Quién | Con qué |
|---|---|---|---|
| `demo_pendiente` | `demo_lista` | **Ariel** | Carga el link de la demo y toca «Enviar demo» — **sin link el botón no funciona** |
| `demo_lista` | `anticipo_pendiente` | **Cliente** | «Sí, quiero continuar» |
| `demo_lista` | `rechazado` | **Cliente** | «Por ahora no» |
| `anticipo_pendiente` | `en_produccion` | **automático** | Cuando el anticipo queda **pagado** |
| `en_produccion` | `dominio` | **Ariel** | «Cambios terminados → siguiente» |
| `dominio` | `publicando` | **Cliente** | Elige dominio y confirma |
| `publicando` | `saldo_pendiente` | **Ariel** | «Ya está publicada» |
| `saldo_pendiente` | `finalizado` | **automático** | Cuando el saldo queda **pagado** |

Además, desde mi panel puedo forzar cualquier etapa y reabrir la decisión del
cliente. Eso es una salida de emergencia, no el camino normal.

### El cartel de espera

Mientras el proyecto está en `demo_pendiente`, el cliente ve un **cartel de
demo en espera** y nada más: un panel punteado que dice «Todavía no hay nada
para revisar · No tenés que hacer nada por ahora», y debajo la ruta de lo que
viene (ver la demo → anticipo → cargar cambios). No hay botones que no llevan
a ningún lado ni links vacíos.

Ese cartel se levanta con **dos** condiciones, no una:

1. que yo mueva la etapa a `demo_lista`, **y**
2. que el link de la demo esté cargado.

Las dos juntas. El panel directamente **no me deja** pasar a `demo_lista` con
el campo del link vacío — no es un aviso que se puede ignorar, el botón no
funciona. Y como red de seguridad, si alguna vez la etapa quedara en
`demo_lista` sin link (por ejemplo si lo borro después), el portal vuelve solo
al cartel de espera en vez de mostrarle al cliente una tarjeta rota con un
botón que no abre nada.

Recién cuando se cumplen las dos, el cliente ve la demo de verdad y se le
abre el camino: mirarla → aceptar → anticipo → cargar sus cambios.

### Los dos pasos automáticos

Son los únicos que no aprieta nadie, y por eso son los importantes:

- **Mercado Pago** confirma solo por webhook → el cliente sigue al instante,
  aunque yo esté durmiendo.
- **Transferencia:** el cliente sube la foto del comprobante y el pago queda
  **en revisión**. No avanza hasta que yo lo apruebo desde el panel. Mientras
  tanto ve una pantalla que dice exactamente eso, no un error.

En los dos casos el que mueve la etapa es un *trigger* en la base, no la
pantalla. Da igual si el pago entró por Mercado Pago, si lo aprobé yo, o si
cargué un cobro manual en efectivo: siempre avanza igual. Un solo lugar donde
puede fallar en vez de tres.

---

## Los cobros

| Cobro | Cuándo se crea | Monto |
|---|---|---|
| `anticipo` | Al entrar en `anticipo_pendiente` | 50% del precio |
| `saldo` | Al entrar en `saldo_pendiente` | 50% del precio **+ USD 10** si eligió dominio propio |

El saldo se calcula recién cuando marco «ya está publicada», que es después de
que el cliente eligió el dominio. Por eso el monto siempre sale bien y el
cliente hace **una sola** transferencia final en vez de dos.

---

## Qué ve el cliente

Arriba de todo, siempre lo mismo: **«Hola, Juan»**, abajo el nombre del
proyecto, a la derecha el **número grande** de avance, y debajo el riel de 5
pasos: `Demo · Anticipo · Cambios · Dominio · Entrega`. Los pasos hechos en
verde, el actual en violeta, los que faltan apagados.

Abajo, **una sola tarjeta**: la etapa en la que está. Nada más. No hay
pestañas que abrir ni secciones que buscar — si tiene algo que hacer, es lo
único que hay en pantalla.

Las etapas 6 y 7 (`publicando` y `saldo_pendiente`) comparten el paso
«Entrega» del riel: para el cliente es un solo tramo final, y la tarjeta le
dice en cuál de los dos momentos está.

---

## Qué cambia respecto de hoy

1. **La lista de cambios se desbloquea con el pago, no con el «acepto».** Hoy
   el cliente carga los cambios en el mismo momento en que acepta, sin haber
   pagado nada. Pasa a ser: acepta → paga el 50% → recién ahí escribe.
2. **Etapas nuevas:** `anticipo_pendiente`, `dominio`, `publicando` y
   `saldo_pendiente`. Hoy no existen y por eso el flujo saltaba de
   «en producción» directo a «finalizado» sin pasos intermedios visibles.
3. **La elección del dominio la habilito yo.** Hoy el cliente puede elegirlo
   en cualquier momento de la producción; pasa a aparecer recién cuando los
   cambios están terminados y yo doy «siguiente».
4. **El avance ya no es solo tareas** — ver la tabla de arriba.
5. **Los USD 10 del dominio dejan de ser un cobro aparte** y se suman al saldo.

### En la base de datos

`status` deja de ser un `ENUM` y pasa a ser `text` con un `CHECK`. Motivo
práctico: en Postgres no se puede agregar un valor a un `ENUM` y usarlo en la
misma transacción, y el editor SQL de Supabase corre el script como una sola
transacción — o sea que la migración fallaría a mitad de camino. Con `text` +
`CHECK` la migración corre de una, y agregar otra etapa el día de mañana es
una línea.

Las filas que ya existen no se tocan: `demo_pendiente`, `demo_lista`,
`rechazado`, `en_produccion` y `finalizado` siguen significando lo mismo.

---

## Cómo quedó implementado

### En la base — `supabase/migracion-05-flujo-9-etapas.sql`

| Pieza | Qué hace |
|---|---|
| `clients.status` | Pasa de `ENUM` a `text` + `CHECK` con las 9 etapas |
| `orden_etapa(text)` | El orden del flujo en un solo lugar; `rechazado` = -1 |
| `calcular_progreso()` | Cada etapa aporta su porcentaje; en producción las tareas mueven el tramo 40–75 |
| `asegurar_cobro()` | Crea el anticipo o el saldo con el monto correcto, sin duplicar |
| **trigger `payments_avanzan_flujo`** | Anticipo pagado → producción · Saldo pagado → finalizado |
| `portal_decidir()` | Aceptar ya no manda a producción: manda al anticipo y lo genera |
| `portal_pedir_cambio()` | Solo en producción, o sea solo con el anticipo acreditado |
| `portal_elegir_dominio()` | Solo en la etapa «dominio»; al confirmar pasa a «publicando» |
| `admin_mover_flujo()` | Mueve la etapa desde el panel; **rechaza** pasar a demo lista sin link |
| `portal_obtener()` | Si la etapa es demo lista pero falta el link, le informa `demo_pendiente` al portal |

Dos decisiones que conviene no deshacer sin leer el motivo:

- **El trigger, y no el JavaScript.** Si las transiciones por pago vivieran en
  el panel, el webhook de Mercado Pago no las ejecutaría nunca y un cliente que
  paga un domingo a la noche quedaría trabado hasta que alguien entre a mirar.
  Además cubre gratis el cobro manual en efectivo.
- **`asegurar_cobro` es `SECURITY INVOKER`.** Con `DEFINER` habría que darle
  `EXECUTE` a `authenticated`, y entonces cualquier cuenta logueada podría
  crear filas de cobro para clientes ajenos. Con `INVOKER` las policies RLS
  siguen decidiendo, y `portal_decidir` (que sí es `DEFINER`) igual la puede
  llamar porque para ese momento el usuario efectivo ya es el dueño.

### En el portal del cliente — `cliente.html`, `js/cliente.js`, `css/portal.css`

Reescritos. Antes todos los bloques vivían en el HTML y se mostraban u
ocultaban con `hidden`; con 9 etapas eso no se sostiene, porque cada bloque
nuevo hay que acordarse de esconderlo en las otras 8 situaciones y basta
olvidarse una vez para que el cliente vea dos cosas contradictorias. Ahora hay
un objeto `ETAPAS` donde **cada etapa devuelve su propia tarjeta**, y lo que no
devuelve, no existe en pantalla.

### En tu panel — `js/admin-clients.js`, `css/admin.css`

El bloque «Flujo del proyecto» contesta tres cosas de un vistazo:

1. **De quién es el turno** — un chip arriba a la derecha: ámbar «te toca a
   vos», azul «le toca al cliente», verde «sin acciones pendientes». Es
   dinámico: en «esperando el anticipo» la pelota es del cliente, salvo que ya
   haya subido el comprobante, y ahí pasa a ser tuya.
2. **La única acción que te toca** — un botón ancho que dice exactamente qué va
   a pasar («Cambios terminados → elegir dominio»). En las etapas donde la
   pelota es del cliente no hay botón, porque no hay nada que apretar. Y si
   falta un dato, el botón viene deshabilitado explicando cuál.
3. **Qué está frenando el proyecto** — el cartel de color, con el mismo código
   ámbar/azul/verde.

El selector de etapa sigue estando, pero plegado dentro de «Mover el flujo a
mano»: es la salida de emergencia para volver atrás o reflejar algo que
arreglaste por WhatsApp, no el camino normal.

### Qué se verificó

Contra un PostgreSQL real, no sobre el papel: las 9 etapas de punta a punta,
que el saldo salga 210 (200 + 10 del dominio) y no 200, que el link final siga
oculto hasta que el saldo esté pagado, que un comprobante en revisión **no**
haga avanzar el flujo y que aprobarlo sí, que `anon` no pueda ejecutar ninguna
función del panel y que otro usuario autenticado no vea ni una fila.

En navegador real, escritorio y celular: las 9 etapas del portal y los 13 casos
del bloque de flujo del panel, sin errores de consola, sin desborde horizontal
y sin controles por debajo del mínimo táctil.

Dos bugs los encontró el propio test y no habrían aparecido leyendo el código:
`ALTER COLUMN ... TYPE` falla si una vista depende de la columna, y
`admin_mover_flujo` no podía ejecutar `asegurar_cobro` por permisos.

---

## Planes de pago, presupuesto y documentos (migración 11)

### Los dos planes

El cliente elige en el **paso 1**, junto al precio, antes de aceptar.

| Plan | Qué paga | Cuándo | Cómo entra la plata |
|---|---|---|---|
| **Mitades** | 50% + 50% | al arrancar y al entregar | dos cobros |
| **3 cuotas sin interés** | 100% | al arrancar | **un solo cobro** |

La clave del segundo: *3 cuotas* es un asunto entre el cliente y su tarjeta.
Mercado Pago cobra el total de una y el banco se lo divide en tres. Para la
caja es un pago, al principio, y el proyecto arranca ahí.

> **Hace falta activarlo en Mercado Pago.** `installments: 3` solo define
> cuántas cuotas se le *ofrecen*. Que sean **sin interés** se configura en la
> cuenta (Tu negocio → Costos → Cuotas sin interés) y el costo lo absorbe el
> vendedor. Sin esa promoción activa, Mercado Pago igual muestra 3 cuotas
> pero **con interés para el cliente**.

Si eligió 3 cuotas y después pide dominio propio, al final queda un cobro de
**solo USD 10**. Y si eligió el dominio de la demo, no queda nada: el proyecto
pasa directo a finalizado en vez de mostrarle una pantalla de pago por cero.

### Presupuesto

Documento aparte de la propuesta: la propuesta dice **qué** se hace, el
presupuesto **cuánto** sale y con qué detalle. Se carga como link o como PDF,
en la ficha del cliente y en el alta, igual que la propuesta. El cliente lo ve
en el paso 1 junto a la demo y al precio.

### Los PDF ya no viajan en cada consulta

El portal se actualiza solo cada 30 segundos. Con la propuesta, el
presupuesto, la descripción y los adjuntos de cada tarea metidos dentro de
`portal_obtener`, un cliente con el portal abierto en el celular se bajaba
**todo eso dos veces por minuto**. Medido con una propuesta de 600 KB, un
presupuesto de 400 KB y un adjunto de 300 KB:

| | Antes | Ahora |
|---|---|---|
| Peso de cada consulta | **1,3 MB** | **805 bytes** |

Ahora viaja el nombre y un sí/no. El contenido se pide con
`portal_documento()` cuando el cliente toca el botón, una sola vez. Los links
http(s) comunes siguen viniendo enteros porque no pesan nada.

### Lo que estaba roto y se arregló de paso

Las migraciones 09 y 10 redefinieron `portal_obtener()` y `v_clientes_panel`
enteras, partiendo de una versión anterior. Sin querer se llevaron puesto:

- **El panel no avisaba de comprobantes nuevos.** La vista perdió
  `comprobantes_a_revisar`, así que el chip de turno decía «le toca al
  cliente» aunque hubiera una transferencia esperando tu aprobación.
- **El rastro del link no se registraba.** `portal_obtener` volvió a ser
  `STABLE` y dejó de escribir `last_seen_at` / `view_count`: el panel siempre
  decía «todavía no lo abrió nadie», y no había forma de detectar un link
  filtrado.
- **Se perdió la red de seguridad de la demo sin link**, y el aviso de
  comprobante en el portal del cliente.

No es un error de nadie en particular: redefinir una función entera en una
migración nueva siempre arrastra ese riesgo. La migración 11 deja las dos
definiciones completas, con todo lo de la 09 y la 10 adentro.

---

## Íconos: se fueron los emojis

Había tres sistemas de íconos conviviendo en la misma pantalla: SVG dibujados
(solo en el portal), emojis sueltos (📄 💵 ⚠️ ⚙️ 👤 📭 💸 ⭐ 🚀 📍 ✉️ 📞 📸 🧾 📋
💬 🎉 ❤️) y glifos tipográficos (✓ ✕ ● ○ ★ ☆).

El emoji es el problema serio de los tres, y no por gusto:

- **Lo dibuja la fuente del sistema.** El mismo 📄 se ve distinto en Windows,
  en Android y en iPhone. No controlás cómo se ve tu propia pantalla.
- **No hereda el color del texto.** Queda a todo color al lado de un ícono
  gris de trazo fino. Es lo que más delata que la pantalla se armó apurada.
- **No escala con la tipografía.**
- **El lector de pantalla lo lee en voz alta** con un nombre que nadie
  eligió: 📄 se anuncia como «página de cara arriba».

Ahora hay **uno solo**: `js/iconos.js`. Mismo `viewBox`, mismo grosor de
trazo, `currentColor` (toman el color del texto que los rodea) y
`aria-hidden` porque el texto al lado ya dice lo que el ícono repite.

```js
import { ico, estrellas } from "./iconos.js";

ico("documento")                       // tamaño normal
ico("check", "pico pico-sm")           // chico
ico("estrella", "pico", { relleno: true })
estrellas(4)                           // las 5 de una reseña
```

La clase base `.pico` vive en **`css/styles.css`**, no en `portal.css`, porque
las tres pantallas (home, panel y portal) cargan esa hoja y el módulo de
íconos es uno solo para las tres.

### Detalle que muerde

Un `<svg>` es `display:block`. Metido en un `<h2>` o en un `<span>` de texto
plano, **se va a su propio renglón** y parte el título en dos. Donde un ícono
acompaña texto, el contenedor va `inline-flex` con `gap`. Pasó en cuatro
lugares (`.tech-badge-btn`, `.admin-h2-ico`, `.resena-titulo`,
`.footer-corazon`) y lo detectó `pruebas/verificar-iconos.mjs` midiendo la
posición vertical real del ícono contra la del texto — no mirando capturas.

### Lo que quedó afuera a propósito

- **Los mensajes de WhatsApp** (`js/app.js`): ahí el emoji está bien. Es un
  chat, no una interfaz, y los dibuja WhatsApp.
- **El PDF del presupuesto**: lo rasteriza html2canvas, que con SVG inline es
  inconsistente. Cambiarlo es arriesgar un documento que hoy sale bien.
- **Las cinco páginas `ventajas-*.html`**: son autónomas, no cargan
  `styles.css`, así que `.pico` no les llega. Son ~50 ocurrencias de dos
  patrones (`.point-icon` ✓/✕ y el emoji del `<h2>`); se hacen en una pasada
  aparte copiando el bloque `.pico` al `<style>` de cada una.

---

## El comprobante del cliente (migración 12)

Cuando un pago queda acreditado, el cliente puede bajarse un **recibo en
PDF** desde el resumen de su portal.

### No es una factura, y lo dice

Es un recibo propio: constancia de que cobraste. **No reemplaza una factura
de AFIP.** El PDF lo aclara en un recuadro, con texto normal y no letra
chica, y el portal lo repite abajo de los botones.

Por eso el número **no** se formatea como `0001-00000001`: ese es justo el
formato de un comprobante fiscal argentino y confundiría al cliente. El
formato es `R-2026-0012` — la R de recibo y el año legible dejan claro de un
vistazo que es otra cosa.

### Por qué el número lo da la base y no el navegador

| Si el número saliera de… | Qué pasa |
|---|---|
| La fecha | Cambia en cada descarga. El número que tiene el cliente no existe en ningún lado. |
| El `uuid` del pago | Estable pero ilegible, y filtra una clave interna en un papel que el cliente puede reenviar. |
| `max(receipt_number) + 1` | Dos pagos aprobados en el mismo instante leen el mismo máximo y se pisan. |

Lo que se hizo: una **secuencia** de Postgres (`comprobantes_seq`), un
`int` guardado en `payments.receipt_number` y un índice único parcial.
`nextval()` nunca devuelve dos veces lo mismo, ni en transacciones paralelas.

### Se asigna solo

Un trigger `BEFORE UPDATE OF status`, no código en el navegador. Hoy hay
**tres** caminos para que un pago quede pagado — el webhook de Mercado Pago,
el botón del panel y la aprobación de un comprobante de transferencia — y
mañana puede haber un cuarto. En un trigger te alcanza con acordarte una vez.

La condición `receipt_number IS NULL` es lo que hace que el número **no
cambie nunca**: si marcás un pago, volvés atrás y lo volvés a marcar, se
queda con el primero. Verificado en la base local: tres re-marcas, mismo
número.

### Cómo se tocó `portal_obtener`

**Este es el punto importante del archivo.** El cuerpo de la función no se
reescribió: se sacó con `pg_get_functiondef()` de la función que ya estaba
corriendo y se le agregaron tres claves al bloque `pagos`.

El primer intento de esta migración **sí** la reescribió de memoria. La
comparación contra la versión real mostró que se perdían `total_usd`,
`created_at`, el orden de las tareas por `t.position` y el candado que oculta
`production_url` hasta que el proyecto está finalizado. Ninguna de las cuatro
habría dado error: habrían fallado en silencio, igual que las migraciones 09
y 10.

Si hay que tocarla otra vez, el camino es el mismo:

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'portal_obtener';
```

### Qué se verificó

- Las 8 comprobaciones del PASO 6 de la migración, en Postgres 16 local con
  las 12 migraciones aplicadas en orden.
- El número es estable: tres re-marcas del mismo pago → mismo número.
- `portal_obtener` sigue devolviendo `total_usd`, `created_at`,
  `production_url` y `tareas`.
- Cuatro escenarios en Chromium (`pruebas/verificar-recibo.mjs`): dos pagos
  acreditados → 2 botones; saldo pendiente → 1; pago viejo sin numerar → el
  botón no aparece; nada cobrado → ninguno.
- El PDF se descarga de verdad: 259 kB, abierto y leído, no «no tiró error».

---

## Pagos flexibles (migración 14)

Correr `supabase/migracion-14-pagos-flexibles.sql` en el SQL Editor. Tiene que
devolver **13 ✅**. Se puede correr dos veces sin romper nada.

### Por qué

El caso que lo disparó: un cliente pagó una **reserva** antes de arrancar y el
sistema igual le pedía el anticipo completo del 50%. No había dónde cargar esa
plata ni forma de cambiar un monto.

### Los cuatro planes

| Plan | Quién lo elige | Cobros que se generan |
|---|---|---|
| `mitades` | cliente o Ariel | anticipo 50% − reservas · saldo = lo que falta |
| `unico` | cliente o Ariel | pago total − reservas (MP en **1** pago o transferencia) |
| `cuotas3` | cliente o Ariel | pago total − reservas (MP en **3** cuotas) |
| `personalizado` | **solo Ariel** | ninguno automático: las cuotas se cargan a mano |

Con **«Fijarlo»** tildado (`clients.plan_fijado`), el cliente ve el plan en su
link y no puede elegir otro: `portal_decidir` ignora lo que mande el navegador.

### Tipos de cobro

| Tipo | Qué es | ¿Parte del precio? |
|---|---|---|
| `reserva` | plata cobrada antes de arrancar | sí — se descuenta del cobro inicial |
| `anticipo` / `total` | el cobro inicial del plan | sí |
| `cuota` | una parte del precio (plan personalizado) | sí |
| `saldo` | **lo que falta**: precio + dominio − todo lo anterior | sí |
| `otro` | un extra fuera del presupuesto | no, se suma aparte |

Cada cobro tiene un `concepto` que ve el cliente. Reserva, cuota y extra
admiten varios por cliente; el comprobante y Mercado Pago toman siempre el
**primero pendiente** de ese tipo.

### En el panel — bloque «Cobros» de cada cliente

- Resumen: total del proyecto, cobrado, pendiente y **sin programar** (lo que
  todavía no tiene cobro y se pedirá con el saldo). Avisa si programaste más
  que el precio.
- Plan de pago + «Aplicar plan»: rehace el cobro inicial descontando reservas.
- Cada cobro: **Marcar pagado**, **Editar** (monto, estado, medio, fecha,
  concepto) y **Eliminar**.
- **+ Agregar cobro**: reserva, cuota o extra.
- **Recalcular el saldo final**.

Al cargar, editar o borrar una reserva, el anticipo se recalcula solo. Si la
reserva cubre todo el pago inicial, el proyecto pasa directo a producción.

### Reglas que conviene no romper

- **Lo pagado no se borra ni se recalcula** en ninguna función de la base. El
  panel sí deja eliminarlo a mano, con una advertencia.
- **No se toca un cobro con pago en curso** (`en_proceso` o `en_revision`):
  borrarlo dejaría la plata sin fila donde acreditarse.
- **Editar el monto suelta la preferencia de MP**, y el webhook compara los
  USD del link con los del cobro actual: un pago hecho con un link viejo queda
  para revisar en vez de acreditarse solo.
- **`portal_obtener` no se reescribió**: la migración toma la versión que está
  corriendo con `pg_get_functiondef()` y le inserta dos claves. Si no encuentra
  dónde, falla sin tocar nada.

### De paso se arregló

`admin_mover_flujo` pedía siempre un `anticipo`: con el plan de 3 cuotas,
mover la etapa a mano creaba un anticipo del 50% **además** del pago total.
Ahora `asegurar_cobro` traduce «anticipo» al cobro inicial que corresponde al
plan.

### Qué se verificó

- En Postgres 16 con las 14 migraciones en orden: reserva de 100 sobre 400
  (anticipo 100, saldo 200), reserva que cubre el anticipo (pasa sola a
  producción), plan fijado que el cliente no puede pisar, el anticipo fantasma,
  plan personalizado de 3 cuotas hasta finalizar, recálculo del saldo, y que
  otro usuario logueado no vea ni toque nada.
- En Chromium (`pruebas/verificar-pagos.mjs`), a 390 y 1280 px: los números
  del resumen del panel, que «Agregar» y «Editar» manden a la base exactamente
  lo cargado, y los cinco casos nuevos del portal.
- `pruebas/verificar-mp.mjs`: 3 cuotas para `cuotas3`, 1 pago para `unico`.

---

## Link del cliente en pestañas (migración 15)

Correr `supabase/migracion-15-portal-pestanas.sql` **después** de la 14. Tiene
que devolver **9 ✅**. Se puede correr dos veces: la segunda no pisa las
pestañas que abriste o cerraste a mano.

### Qué ve el cliente

Un dashboard: arriba el saludo y el avance, abajo una barra con cinco
pestañas (al costado en la computadora, arriba y deslizable en el celular).

| Pestaña | Qué tiene | ¿Quién la abre? |
|---|---|---|
| **Inicio** | en qué está el proyecto, la demo, propuesta, presupuesto y descripción | siempre abierta |
| **Tareas** | la lista de cambios y el campo para sumar (con PDF) | vos, a mano |
| **Pagos** | lo que hay que pagar ahora, la cuenta completa, «Tus pagos» y comprobantes | vos, a mano |
| **Dominio** | elegir o corregir la dirección | vos, a mano |
| **Producción** | el link final de la página | vos, a mano |

Una pestaña cerrada se ve con **candado** y «Próximamente»; si la toca, le
explica qué va a encontrar ahí y que le avisás cuando la abras. Un puntito
naranja marca la pestaña donde tiene algo para hacer, y el portal abre
directo esa. `#pagos`, `#tareas`, etc. al final del link abren esa pestaña.

### Qué manejás desde el panel

- **Pestañas del link del cliente**: cuatro interruptores, guardan al tocar.
- **Condiciones** (en Cobros): precio, costo del dominio propio y **medios de
  pago** que ve el cliente (Mercado Pago, transferencia o los dos).
- **Cada cobro**: tipo (reserva, anticipo, pago total, cuota, saldo o extra),
  concepto, monto, estado, medio, fecha y **cuotas de Mercado Pago** (1 a 12;
  vacío = las del plan).

### Solo a mano, a propósito

Nada abre una pestaña solo: si el cliente paga el anticipo un domingo a la
noche, el proyecto pasa a producción pero **Tareas sigue cerrada** hasta que
la abras. Para que no se te pase, el bloque «Flujo del proyecto» te avisa en
ámbar («te toca a vos») cuando el cliente necesita una pestaña que sigue
cerrada.

Los proyectos que ya estaban en marcha al correr la migración arrancan con
las pestañas de su etapa abiertas, para que nadie pierda lo que ya veía.

### Lo hace cumplir la base, no la pantalla

- Cargar un cambio exige **Tareas** abierta (`portal_pedir_cambio`).
- Elegir el dominio exige **Dominio** abierta (`portal_elegir_dominio`). Si la
  abriste antes de tiempo, elegir guarda la dirección pero **no** saltea la
  producción: el flujo pasa a «publicando» solo desde la etapa «dominio».
- El link final viaja solo con **Producción** abierta o el proyecto
  finalizado (`portal_obtener`).
- Con Mercado Pago apagado para ese cliente, `api/mp-crear-preferencia`
  responde 403 aunque alguien fuerce el botón desde la consola.

### Qué se verificó

- Postgres 16 con las 15 migraciones: los candados de cada acción, que elegir
  dominio durante la producción no salte etapas, que el link final aparezca
  recién con Producción abierta y que no se pueda dejar a un cliente sin
  ningún medio de pago.
- Chromium a 390 y 1280 px (`pruebas/verificar-pagos.mjs`): diez casos del
  portal (incluidos candado, tocar una pestaña, solo transferencia, dominio
  elegido y link final) y, en el panel, que los interruptores y los medios de
  pago manden a la base exactamente lo elegido.
- `pruebas/verificar-mp.mjs`: cuotas fijadas en el cobro y 403 con MP apagado.
