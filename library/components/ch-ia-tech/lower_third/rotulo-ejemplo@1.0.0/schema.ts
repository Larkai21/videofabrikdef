import { z } from 'zod';

// Contrato lower_third (docs/contratos.md §3): la composición garantiza
// pasar estas props; el schema puede añadir opcionales propias, nunca
// obligatorias nuevas.
export default z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  fromFrame: z.number(),
});
