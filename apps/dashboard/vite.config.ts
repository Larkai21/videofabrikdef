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
    // Sin esto, si el 5173 está ocupado Vite arranca en el 5174 y el dashboard
    // carga pero NO trae datos: la API solo permite el 5173 por CORS
    // (`apps/api/src/lib/origins.ts`), así que el navegador recibe la respuesta
    // y la descarta sin cabecera. Falla en silencio y parece la API caída.
    // Mejor no arrancar y decirlo.
    strictPort: true,
    proxy: {
      '/files': { target: apiUrl, changeOrigin: true },
    },
  },
});
