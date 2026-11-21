import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const backend = process.env.LEAVEMATE_DEV_API || 'http://127.0.0.1:4100';

export default defineConfig({
  root: 'web',
  envDir: '..',
  plugins: [react(), tailwind()],
  resolve: { preserveSymlinks: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
});
