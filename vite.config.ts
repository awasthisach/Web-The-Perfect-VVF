import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    worker: {
      format: 'es' as const,
    },
    server: {
      // HMR can be disabled via DISABLE_HMR env var (e.g. AI Studio agent edits).
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
    },
    build: {
      // Safer for serverless / Vercel memory limits with large deps (transformers).
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            dexie: ['dexie', 'dexie-react-hooks'],
          },
        },
      },
    },
  };
});
