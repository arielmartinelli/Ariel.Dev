# Pruebas de navegador

Tres scripts de Playwright que abren el sitio compilado en un Chromium de
verdad y **miden** en vez de suponer. No reemplazan tests unitarios: cubren
justo lo que más se rompe sin avisar — que algo se vea mal, no que tire error.

## Correrlos

```bash
npm run build
npx serve dist -l 4178        # o: cd dist && python3 -m http.server 4178
node pruebas/verificar-iconos.mjs
node pruebas/verificar-portal.mjs
node pruebas/verificar-panel.mjs
node pruebas/verificar-recibo.mjs
node pruebas/verificar-pagos.mjs
node pruebas/verificar-mp.mjs      # este no necesita el servidor
```

La primera vez: `npx playwright install chromium`.

El build necesita un `.env` (aunque sea con valores falsos). Sin
`VITE_SUPABASE_URL`, el portal corta antes de pedir los datos y los tres
scripts fallan con "0 botones" o pantalla de error — y el motivo no es
obvio mirando la salida.

Variables opcionales: `BASE` (otra URL), `CHROMIUM` (otro binario).

Los PDFs de prueba quedan en una carpeta temporal del sistema (la imprime al
terminar), no dentro del repo.

Para `verificar-recibo.mjs` hace falta que `dist/html2pdf.bundle.min.js`
exista — o sea, que el archivo esté en `public/`.

## Qué mira cada uno

**verificar-iconos.mjs** — recorre home, reseña, panel y portal a 390px y
1280px. Falla si: queda un emoji en texto visible, un ícono SVG cae en su
propio renglón arriba del texto que acompaña, o hay scroll horizontal.

**verificar-portal.mjs** — las 10 etapas del portal del cliente, una por una,
con la respuesta de `portal_obtener` simulada. Cada etapa dibuja una tarjeta
distinta, así que una sola pasada no prueba nada.

**verificar-panel.mjs** — enciende tu panel con una sesión y datos falsos y
recorre las cuatro vistas. Que dibujen, básicamente.

**verificar-recibo.mjs** — que el botón de comprobante aparezca solo cuando
hay un pago acreditado **con número**, que el PDF se descargue de verdad (no
que "no tire error") y que el archivo no salga vacío.

**verificar-pagos.mjs** — el bloque de Cobros del panel (que los números
cierren y que agregar/editar manden lo cargado) y los casos nuevos del
portal: plan fijado, reserva descontada, saldo con la cuenta y cuota
pendiente. Deja capturas en una carpeta temporal.

**verificar-mp.mjs** — arma la preferencia de Mercado Pago con `fetch` y
Supabase interceptados y mira **el cuerpo que se habría mandado**, sin tocar
la API real ni tu access token.

### El chequeo de contraste (`_contraste.mjs`)

Lo usan `verificar-portal` y `verificar-panel`. Mide el contraste real de
cada botón y link contra su fondo efectivo y falla por debajo del mínimo de
WCAG AA (4.5:1, o 3:1 si el texto es grande).

Está porque encontró un bug que mirando capturas no se ve: los botones de
"Ver la propuesta / el presupuesto / la descripción" daban **1.1:1** —
blanco sobre gris claro. En la pantalla parecían dos cajas borrosas y uno
asume que es el tema oscuro.

## Lo que todavía no pasa (y es decisión tuya)

`--text-muted` (#6b7280) sobre el fondo oscuro da **4.34:1**, apenas por
debajo del 4.5 que pide WCAG AA. Afecta a las pestañas inactivas del panel
y a la «×» de borrar tarea (4.11:1).

No lo toqué porque `--text-muted` se usa en TODOS los textos secundarios del
sitio: subirlo aclara cada hint y cada aclaración de golpe, y eso es una
decisión de diseño tuya, no un bug que arreglar de prepo. Si querés que
pase, el valor mínimo es **#767f8e**.

## Una trampa que ya costó una vez

En Playwright **gana la última ruta registrada**. El catch-all va primero:

```js
await p.route("**/rest/v1/**", ...);              // primero
await p.route("**/rest/v1/rpc/portal_obtener*", ...); // después
```

Al revés, el catch-all se come la RPC, el portal recibe `[]` y **las diez
etapas dibujan la misma tarjeta genérica**. Los scripts pasan igual: parecen
verdes y no probaron nada.
