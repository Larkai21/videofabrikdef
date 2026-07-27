import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// las rutas /files/... que sirve la API llegan también en URLs relativas
// (maestro del player, miniaturas): en dev el proxy evita que se resuelvan
// contra el origen del dashboard
const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/files': { target: apiUrl, changeOrigin: true },
    },
  },
});
