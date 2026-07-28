import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels } from '@fabrica/db';
import { defaultDesign, type ChannelAvatarGenerateJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { generateAvatarImage } from '../../providers/flux.js';

// Generación del avatar/personaje del canal con Flux (Fase 5). Deriva el prompt
// del personaje del perfil (por defecto "Milky Goblin") y de la estética visual
// del canal; escribe library/assets/<canal>/avatar.png y setea avatar_path. El
// render lo congela en master.brand.avatar_path (ideas.approve) y las intro/outro
// lo muestran como logo.

const DEFAULT_CHARACTER = {
  name: 'Milky Goblin',
  description: 'un duende simpático de piel clara, personaje mascota del canal',
};

function buildAvatarPrompt(
  character: { name: string; description: string },
  design: { accent: string; background: string },
  visualSuffix: string | undefined,
): string {
  const parts = [
    `character mascot avatar portrait of "${character.name}"`,
    character.description,
    'centered, head and shoulders, friendly, expressive, clean solid background',
    `accent color ${design.accent}`,
    visualSuffix && visualSuffix.trim() !== '' ? visualSuffix.trim() : 'modern flat illustration, high detail',
  ];
  return parts.filter(Boolean).join(', ');
}

// Borra los avatar-*.png anteriores del canal (evita acumular en disco).
async function removePreviousAvatars(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((e) => /^avatar[-.].*\.(png|jpg|jpeg|webp)$/i.test(e))
      .map((e) => fsp.rm(path.join(dir, e), { force: true }).catch(() => {})),
  );
}

export async function handleAvatarGenerate(
  ctx: WorkerContext,
  job: ChannelAvatarGenerateJob,
): Promise<void> {
  const { channelId } = job;
  const log = ctx.logger.child({ channelId, op: 'avatar' });

  const [channel] = await ctx.db
    .select({ profile: channels.profile })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel) {
    log.warn('Canal no encontrado; generación de avatar ignorada');
    return;
  }
  const profile = channel.profile;
  const character = profile?.character ?? DEFAULT_CHARACTER;
  const design = profile?.brand_design ?? defaultDesign();
  const prompt = buildAvatarPrompt(character, design, profile?.style.visual_prompt_suffix);

  const image = await generateAvatarImage(ctx.db, ctx.logger, {
    channelId,
    prompt,
    ...(job.seedSalt ? { seedSalt: job.seedSalt } : {}),
  });

  // library/assets/<canal>/avatar-<id>.png (nombre único: cada avatar nuevo
  // estrena URL, sin caché rancia en el dashboard). Se limpian los anteriores.
  const destDir = path.join(ctx.libraryDir, 'assets', channelId);
  await fsp.mkdir(destDir, { recursive: true });
  await removePreviousAvatars(destDir);
  const destPath = path.join(destDir, `avatar-${nanoid()}.png`);
  await fsp.copyFile(image.path, destPath);
  await fsp.rm(image.path, { force: true }).catch(() => {});

  await ctx.db.update(channels).set({ avatarPath: destPath }).where(eq(channels.id, channelId));
  await ctx.publishEvent({ type: 'inbox_changed' });
  log.info({ destPath }, 'Avatar de canal generado y asignado');
}
