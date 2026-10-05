# Avisos por mail — cómo sería

Esto es un plan, no está implementado. Léelo y decidime qué parte querés.

---

## Primero: ¿hace falta?

Hoy avisás por WhatsApp y funciona. El mail **no lo reemplaza**, y si lo
usás para todo vas a terminar con un cliente que recibe dos notificaciones
de lo mismo y te pide que pares.

Donde el mail gana de verdad es en tres cosas que WhatsApp no hace:

1. **Queda.** El cliente busca «Ariel» en el mail dentro de ocho meses y
   encuentra el recibo. En WhatsApp el PDF ya se le borró del teléfono.
2. **Es formal.** «Tu página está en línea» con el recibo adjunto se reenvía
   al socio o al contador. Un audio de WhatsApp no.
3. **A vos te llega con el teléfono apagado.** Un pago acreditado a las 2 AM
   lo ves cuando abrís la compu, aunque no mires el celular.

Donde **no** gana: «subí la demo», «hice el cambio que pediste». Eso es
conversación y va por WhatsApp. Si mandás mail también, es ruido.

**Mi recomendación:** 4 mails al cliente y 3 a vos. Nada más. Está abajo.

---

## Los momentos

### Al cliente (4)

| Cuándo | Asunto | Por qué este sí |
|---|---|---|
| Marcás la demo lista | Tu demo está lista para ver | Es el único momento en que necesitás que **entre al portal**, y es el que más se demora. |
| Se acredita un pago | Recibo R-2026-0012 — Pastelería Dulce Hogar | Con el PDF adjunto. Es el mail que va a guardar. |
| Publicás la página | Tu página ya está en línea | El cierre. Se reenvía. |
| Faltan 7 días del saldo sin pagar | Recordatorio: saldo pendiente | Un recordatorio automático y cortés cobra mejor que vos insistiendo. |

### A vos (3)

| Cuándo | Por qué |
|---|---|
| El cliente acepta o rechaza la demo | Destraba el proyecto. Querés saberlo ya. |
| Se acredita un pago | Es plata. |
| El cliente sube un comprobante de transferencia | Hay algo esperando tu aprobación y hoy solo te enterás si entrás al panel. |

Lo que **no** manda mail, a propósito: el cliente pidió un cambio (puede
pedir ocho seguidos), el cliente eligió dominio (lo ves en el panel), cada
tarea que marcás.

---

## Cómo funcionaría

### El disparador es la base, no el click

Esto es lo importante del diseño. El mail **no** se manda desde
`cliente.js` ni desde `admin.js` cuando alguien aprieta un botón, se manda
cuando **cambia el dato en Postgres**.

Es exactamente la misma razón por la que el número de recibo salió en un
trigger: hoy hay **tres** caminos para que un pago quede pagado — el webhook
de Mercado Pago, tu botón del panel, y la aprobación de un comprobante de
transferencia. Si el mail se mandara desde el navegador habría que acordarse
en los tres. Y el webhook de Mercado Pago **no tiene navegador**: ahí no hay
nadie apretando nada.

```
  cambia payments.status o clients.status
              ↓
  Database Webhook de Supabase
              ↓
  /api/avisar.js   (función en Vercel, ya tenés api/)
              ↓
  Resend  →  mail
```

### Las piezas

**1. Una columna que hoy no existe.** `clients.email`. Hoy solo guardás
`whatsapp`. Sin mail no hay a quién mandarle, así que es el primer paso y es
el único que cambia el formulario del panel.

**2. Una tabla para no mandar dos veces.**

```sql
CREATE TABLE avisos_enviados (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad_id  uuid NOT NULL,       -- el pago o el cliente
  evento      text NOT NULL,       -- 'recibo', 'demo_lista', 'publicada'…
  enviado_a   text NOT NULL,
  enviado_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entidad_id, evento)
);
```

El `UNIQUE` es el corazón de esto, no un detalle. **Supabase reintenta los
webhooks que fallan.** Si Resend tarda y la función devuelve error después
de haber mandado, Supabase lo vuelve a llamar y el cliente recibe el mismo
recibo tres veces. Con el `UNIQUE`, el segundo intento choca contra el
índice y la función corta antes de mandar nada.

**3. Una función en Vercel.** `api/avisar.js`, al lado de
`api/mp-crear-preferencia.js`. Recibe el cambio, decide si corresponde
avisar, arma el HTML y llama a Resend.

Tiene que validar que el pedido viene de Supabase y no de cualquiera: el
Database Webhook manda un header secreto que la función compara con una
variable de entorno. Sin eso, cualquiera que descubra la URL te hace mandar
mails con tu dominio.

**4. Resend.** Gratis hasta 3.000 mails por mes y 100 por día. Vas a usar
quince. La alternativa sería el SMTP de Gmail, pero eso te limita a ~500 por
día, no te da estadísticas de entrega y Google te corta la cuenta si
detecta patrón de envío automático.

---

## El problema real: que no caiga en spam

Esto es lo que va a costar, no el código.

Si mandás desde `ariel.martinelli.dev@gmail.com` a través de Resend, Gmail
ve un mail que **dice** venir de gmail.com pero sale de un servidor que no
es de Google, y lo manda a spam o directamente lo rebota. No hay forma de
esquivarlo.

Hay que mandar desde tu propio dominio: `hola@arieldev.com.ar`. Eso implica
cargar tres registros DNS donde tenés el dominio:

| Registro | Para qué |
|---|---|
| **SPF** (TXT) | Dice qué servidores pueden mandar en nombre de tu dominio. |
| **DKIM** (TXT) | Firma cada mail; el que recibe verifica que no se tocó en el camino. |
| **DMARC** (TXT) | Le dice a Gmail qué hacer si falla alguna de las dos. |

Resend te da los tres valores ya armados: es copiar y pegar en el panel del
dominio. Tarda entre 15 minutos y unas horas en propagarse.

Si no hacés esto, el mail sale, no da error, y **el cliente nunca lo ve**.
Es el modo de falla más molesto que hay porque desde tu lado parece que
funcionó.

El `reply-to` va a tu Gmail, así que cuando el cliente conteste te llega
donde ya mirás.

---

## Qué tocar

| Dónde | Qué |
|---|---|
| Migración 13 | `clients.email`, tabla `avisos_enviados`, los Database Webhooks. |
| `js/admin-clients.js` | Campo de mail en el formulario del cliente. |
| `api/avisar.js` | Nuevo. La función que arma y manda. |
| `api/_plantillas/` | El HTML de los mails. |
| Vercel → Variables | `RESEND_API_KEY`, `WEBHOOK_SECRET`. |
| DNS del dominio | SPF, DKIM, DMARC. |

Un detalle de armado: el HTML de un mail **no es HTML de página**. Outlook
no entiende flexbox ni grid, así que se maqueta con `<table>` y estilos
inline, como en 2005. No es que esté mal hecho: es lo único que se ve igual
en Gmail, Outlook y el Mail del iPhone. Se prueba con un servicio de
preview, no abriéndolo en Chrome.

---

## Dos cosas a decidir vos

**1. El link privado viaja por mail.** Hoy el link del portal lo mandás por
WhatsApp. Por mail queda en la bandeja del cliente para siempre y se reenvía
con un click. No es peor que WhatsApp, pero es una superficie más. Si te
molesta, el mail puede no llevar el link y decir «entrá desde el link que te
pasé» — pierde comodidad y gana control. Yo pondría el link: el portal ya
registra cada visita (`view_count`) y tenés el botón de revocar.

**2. ¿El recibo va adjunto o se baja del portal?** Adjunto es mejor para el
cliente (lo tiene sin entrar a ningún lado) pero obliga a generar el PDF en
el servidor, y hoy se genera en el navegador con html2pdf. Son dos
implementaciones del mismo documento que pueden desincronizarse. La
alternativa es que el mail diga «bajá tu comprobante acá» y linkee al
portal: menos cómodo, una sola implementación. **Empezaría por el link** y
vería si algún cliente pide el adjunto.

---

## Si querés arrancar de a poco

El orden que menos riesgo tiene:

1. **Solo los 3 mails a vos.** No hace falta `clients.email` (van a tu
   casilla), no hace falta configurar DNS (mandás a vos mismo y el spam no
   te preocupa), y probás toda la cañería con un destinatario que no es un
   cliente. Si algo sale mal, lo ves vos.
2. **DNS del dominio.** Con la cañería ya probada.
3. **Los 4 mails al cliente**, de a uno. El del recibo primero: es el que
   más valor agrega y el más fácil de revisar.

El paso 1 es media tarde. El 2 depende de tu proveedor de DNS. El 3 es un
rato por mail, casi todo maquetación.
