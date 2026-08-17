import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Rutas limpias en desarrollo.
 *
 * En produccion, Vercel reescribe /cliente/<token> -> /cliente.html y
 * /admin -> /admin.html (ver los "rewrites" de vercel.json). El servidor de
 * Vite no sabe nada de ese archivo, asi que en `npm run dev` y en
 * `npm run preview` esas URLs daban 404.
 *
 * Eso importa mas de lo que parece: el link que el panel genera para cada
 * cliente es justamente /cliente/<token>. Sin esto, copiabas el link, lo
 * abrias para probarlo y no funcionaba — pero SI funcionaba una vez
 * desplegado. Un bug que solo existe en tu maquina es el peor tipo de bug:
 * te hace desconfiar de codigo que esta bien.
 *
 * Este plugin replica las mismas reglas, para que local y produccion se
 * comporten igual.
 */
function rutasLimpias() {
  const reescribir = (req, _res, next) => {
    const url = (req.url || '').split('?')[0];

    // Nunca reescribir pedidos de ARCHIVOS. Sin este filtro, la regla de
    // abajo tambien capturaba /cliente/css/portal.css y devolvia el HTML del
    // portal con estado 200 — un CSS que "existe" pero es una pagina entera.
    // Eso convierte un 404 evidente en un fallo silencioso y confuso.
    const pareceArchivo = /\.[a-z0-9]{2,5}$/i.test(url);
    if (pareceArchivo) return next();

    // /cliente/<token>  y  /cliente
    if (/^\/cliente(\/|$)/.test(url)) {
      req.url = '/cliente.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
      // El token viaja en el path original, que el navegador conserva:
      // cliente.js lo lee de window.location, no de esta reescritura.
    }

    // /admin
    if (/^\/admin\/?$/.test(url)) {
      req.url = '/admin.html';
    }

    next();
  };

  return {
    name: 'rutas-limpias-en-dev',
    configureServer(server) {
      server.middlewares.use(reescribir);
    },
    configurePreviewServer(server) {
      server.middlewares.use(reescribir);
    },
  };
}

export default defineConfig({
  plugins: [rutasLimpias()],

  build: {
    // Los sourcemaps se generan pero NO se publican: se suben a Vercel para
    // poder leer un stack trace real, y el navegador solo los pide si alguien
    // abre DevTools. 'hidden' evita el comentario //# sourceMappingURL, que es
    // lo que hace que se descarguen solos y expongan el codigo completo.
    sourcemap: 'hidden',

    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),

        // Portal privado del cliente. Es una pagina aparte a proposito: no
        // comparte JS con el portfolio, asi que quien entra al portal no baja
        // el cotizador, el PDF ni los efectos de scroll. Ver cliente.html.
        cliente: resolve(__dirname, 'cliente.html'),

        // Panel propietario. Tambien aparte: el sitio publico no debe
        // descargar el ABM de proyectos, clientes ni cobros.
        admin: resolve(__dirname, 'admin.html'),

        landing: resolve(__dirname, 'ventajas-landing.html'),
        ecommerce: resolve(__dirname, 'ventajas-ecommerce.html'),
        portfolio: resolve(__dirname, 'ventajas-portfolio.html'),
        desarrolloMedida: resolve(__dirname, 'ventajas-desarrollo-medida.html'),
        invitaciones: resolve(__dirname, 'ventajas-invitaciones.html'),
      },

      output: {
        // Supabase se separa del resto: es la dependencia mas pesada y la
        // comparten el portfolio y el portal, asi que se cachea una sola vez
        // y no se vuelve a bajar cuando cambia el codigo propio.
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/lenis')) return 'lenis';
        },
      },
    },
  },
});
