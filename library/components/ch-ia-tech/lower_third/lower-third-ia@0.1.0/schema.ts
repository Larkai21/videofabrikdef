import { z } from 'zod';

const designSchema = z
  .object({
    background: z.string(),
    surface: z.string(),
    foreground: z.string(),
    muted: z.string(),
    accent: z.string(),
    accent_fg: z.string(),
    font_family: z.string(),
  })
  .partial()
  .optional();

export default z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  fromFrame: z.number(),
  design: designSchema,
});
