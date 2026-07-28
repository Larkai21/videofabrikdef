// Orígenes de navegador permitidos (dashboard local). Compartido entre el
// registro de @fastify/cors, la guarda de escrituras y la respuesta hijacked
// de /events, para que no puedan divergir.
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
