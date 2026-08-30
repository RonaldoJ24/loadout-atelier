import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const configuredPort = Number(loadEnv(mode, process.cwd(), 'PORT').PORT ?? 4317);
  const apiPort =
    Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
      ? configuredPort
      : 4317;
  return {
    plugins: [react()],
    base: process.env.GITHUB_ACTIONS ? '/loadout-atelier/' : '/',
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
