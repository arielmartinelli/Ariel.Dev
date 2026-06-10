import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'ventajas-landing.html'),
        ecommerce: resolve(__dirname, 'ventajas-ecommerce.html'),
        portfolio: resolve(__dirname, 'ventajas-portfolio.html'),
        desarrolloMedida: resolve(__dirname, 'ventajas-desarrollo-medida.html'),
        invitaciones: resolve(__dirname, 'ventajas-invitaciones.html'),
      },
    },
  },
});
