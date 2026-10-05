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
node pruebas/verificar-recibo.mjs
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

**verificar-recibo.mjs** — que el botón de comprobante aparezca solo cuando
hay un pago acreditado **con número**, que el PDF se descargue de verdad (no
que "no tire error") y que el archivo no salga vacío.

## Una trampa que ya costó una vez

En Playwright **gana la última ruta registrada**. El catch-all va primero:

```js
await p.route("**/rest/v1/**", ...);              // primero
await p.route("**/rest/v1/rpc/portal_obtener*", ...); // después
```

Al revés, el catch-all se come la RPC, el portal recibe `[]` y **las diez
etapas dibujan la misma tarjeta genérica**. Los scripts pasan igual: parecen
verdes y no probaron nada.
