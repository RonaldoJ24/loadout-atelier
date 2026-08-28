import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/loadout-atelier/' : '/',
  server: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:4317',
    },
  },
  preview: { port: 4173 },
});
