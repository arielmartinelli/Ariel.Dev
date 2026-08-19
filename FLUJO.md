# Flujo del proyecto — diseño

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
