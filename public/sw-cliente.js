/**
 * sw-cliente.js — Service worker del link del cliente instalado como app.
 *
 * NO GUARDA NADA EN CACHÉ, a propósito: el portal muestra pagos y avances
 * que cambian, y una copia vieja sería peor que nada. Existe solo porque
 * Chrome en Android lo pide para ofrecer «Instalar app» y abrir el ícono a
 * pantalla completa. Cada pedido va directo a la red, como si no estuviera.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* sin respondWith: va a la red */ });
