/**
 * Re-siembra las previews de los componentes integrados con la marca REAL del
 * canal (paleta, nombre, coletilla y avatar).
 *
 *   pnpm previews:kit                 # el canal por defecto
 *   pnpm previews:kit ch-otro-canal
 *
 * Existe porque el render de las previews vive en `packages/video`, que no lee
 * la base de datos —los workers son los únicos que la tocan—, así que alguien
 * tiene que sacar la marca de Postgres y pasársela. Eso hace este script: la
 * vuelca a un JSON temporal e invoca al sembrador.
 *
 * Hay que ejecutarlo cuando cambian los tokens, el avatar, el nombre… o cuando
 * se reescribe una pieza integrada: la pantalla de Brand kit enseña ficheros
 * mp4 ya renderizados, no los componentes en vivo, así que sin esto se queda
 * mostrando el diseño anterior sin avisar de nada.
 */
import { execa } from 'execa';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { channels, createDb } from '@fabrica/db';
import { channelSettingsSchema } from '@fabrica/shared';

const CANAL_POR_DEFECTO = 'ch-ia-tech';

async function main(): Promise<void> {
  const canalId = process.argv[2] ?? CANAL_POR_DEFECTO;
  const { db, client } = createDb();
  const [canal] = await db.select().from(channels).where(eq(channels.id, canalId));
  if (!canal) throw new Error(`El canal ${canalId} no existe`);

  // El avatar viaja EMPOTRADO como data: URI, reducido a 512 px.
  //
  // Las otras dos vías no valen y las dos fallan calladas: `file://` lo rechaza
  // Chrome («Not allowed to load local resource»), y una ruta relativa se
  // resuelve contra el origen del bundle, que no sirve la carpeta del canal. En
  // los dos casos la preview sale sin logotipo y nada avisa.
  //
  // 512 px porque la preview mide 1920 y el disco de marca ocupa ~230: de
  // sobra, y baja el JSON de props de 4 MB a unos 60 KB.
  const raiz = path.resolve(process.cwd(), '..', '..');
  // el mismo interruptor que el vídeo: si el avatar no sale en la intro, la
  // preview tampoco puede enseñarlo, o el humano elige con una imagen falsa
  const ajustes = channelSettingsSchema.parse(canal.settings ?? {});
  let logo: string | undefined;
  if (canal.avatarPath !== null && ajustes.avatar_en_video) {
    const dir = mkdtempSync(path.join(tmpdir(), 'avatar-'));
    const chico = path.join(dir, 'avatar.jpg');
    await execa('ffmpeg', [
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      canal.avatarPath,
      '-vf',
      'scale=512:-1',
      '-q:v',
      '4',
      chico,
    ]);
    logo = `data:image/jpeg;base64,${readFileSync(chico).toString('base64')}`;
  }

  const marca = {
    channel_id: canal.id,
    channel_name: canal.profile?.identity.name ?? canal.name,
    ...(canal.profile?.identity.tagline ? { tagline: canal.profile.identity.tagline } : {}),
    ...(canal.profile?.brand_design ? { design: canal.profile.brand_design } : {}),
    ...(logo ? { logo } : {}),
  };

  const dir = mkdtempSync(path.join(tmpdir(), 'marca-'));
  const fichero = path.join(dir, 'marca.json');
  writeFileSync(fichero, JSON.stringify(marca, null, 2));
  console.log(
    `Marca de ${marca.channel_name}${
      logo
        ? ` (avatar, ${Math.round(logo.length / 1024)} KB)`
        : ajustes.avatar_en_video
          ? ' (sin avatar subido)'
          : ' (avatar desactivado en vídeo)'
    }`,
  );

  await client.end();
  await execa(
    'pnpm',
    [
      '--filter',
      '@fabrica/video',
      'exec',
      'tsx',
      'scripts/seed-builtin-previews.ts',
      '--marca',
      fichero,
    ],
    { stdio: 'inherit', cwd: raiz },
  );
}

await main();
