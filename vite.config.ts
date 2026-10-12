import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: true, // Listen on all interfaces so the LAN-bundled signaling server
                // can proxy the companion HTML to phones during dev.
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        companion: resolve(__dirname, 'companion.html'),
      },
    },
  },
});
