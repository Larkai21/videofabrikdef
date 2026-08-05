export { Pieza as LongForm } from './Pieza';

// El id `LongForm` se selecciona por literal en el worker de render, en
// render-master, en preview-marca y en el humo, y el símbolo lo importan
// packages/video/src/index.ts y el player del dashboard. La composición vive
// ahora en Pieza.tsx, que pinta los dos formatos; este alias existe para que
// nada de eso tenga que cambiar.
