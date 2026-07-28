import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  COMPONENT_TYPES,
  defaultDesign,
  designTokensSchema,
  type ChannelDto,
  type ComponentDto,
  type ComponentType,
  type DesignTokens,
} from '@fabrica/shared';
import { Button, Chip, EmptyState, type ChipKind } from '../components/ui';
import {
  activateComponent,
  authorComponents,
  deleteComponent,
  fileUrl,
  generateAvatar,
  getComponentPrompt,
  getComponents,
  putDesign,
  putProfile,
  uploadAvatar,
  uploadComponent,
} from '../lib/api';
import { useChannel } from '../lib/channel';
import { useLive, type JobNote } from '../lib/events';
import { useHotkeys } from '../lib/hotkeys';
import { useToasts } from '../lib/toasts';

// Brand kit por zips (SPEC §10): lista por tipo con estado, preview y log,
// subida del zip y activación por canal. Los tiempos de validación llegan en
// vivo por SSE (job_progress con video_id = id del componente).

const TYPE_LABELS: Record<ComponentType, string> = {
  intro: 'Intro',
  outro: 'Outro',
  title_card: 'Tarjeta de título',
  lower_third: 'Rótulo',
  subtitle_theme: 'Tema de subtítulos',
  transition: 'Transición',
  thumbnail_template: 'Plantilla de miniatura',
};

const STATUS_CHIP: Record<ComponentDto['status'], { kind: ChipKind; label: string }> = {
  pending: { kind: 'warn', label: 'Pendiente de validar' },
  validated: { kind: 'ok', label: 'Validado' },
  failed: { kind: 'danger', label: 'Fallido' },
};

// Sugerencia de nombre de canal Personaje+Tópico (p. ej. MilkyGoblinNews).
function suggestChannelName(characterName: string): string {
  const cleaned = characterName.replace(/[^\p{L}\p{N}]/gu, '');
  return cleaned.length > 0 ? `${cleaned}News` : 'MilkyGoblinNews';
}

// Personaje y avatar del canal: subir o generar con IA el avatar, y editar el
// nombre + descripción del personaje. El avatar aparece en el header, en las
// intro/outro y de fondo en la miniatura de los vídeos nuevos.
function CharacterCard({ channel }: { channel: ChannelDto }) {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const character = channel.profile?.character ?? { name: 'Milky Goblin', description: '' };
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description);

  useEffect(() => {
    const c = channel.profile?.character ?? { name: 'Milky Goblin', description: '' };
    setName(c.name);
    setDescription(c.description);
  }, [channel.id, channel.profile?.character]);

  const invalidateChannels = () =>
    queryClient.invalidateQueries({ queryKey: ['channels'] });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadAvatar(channel.id, file),
    onSuccess: () => {
      void invalidateChannels();
      push('Avatar actualizado');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo subir el avatar', 'danger'),
  });

  const generateMut = useMutation({
    mutationFn: () => generateAvatar(channel.id),
    onSuccess: () => push('Generando el avatar con IA'),
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo generar el avatar', 'danger'),
  });

  const saveCharacterMut = useMutation({
    mutationFn: () => {
      const profile = channel.profile;
      if (!profile) throw new Error('El canal todavía no tiene perfil aprobado');
      return putProfile(channel.id, { ...profile, character: { name, description } });
    },
    onSuccess: () => {
      void invalidateChannels();
      push('Personaje guardado');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo guardar el personaje', 'danger'),
  });

  const dirty = name !== character.name || description !== character.description;
  const busy = uploadMut.isPending || generateMut.isPending;

  return (
    <div
      className="card"
      style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)', display: 'grid', gap: 14 }}
    >
      <div className="head" style={{ fontSize: 14 }}>
        Personaje del canal
      </div>
      <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.55 }}>
        El avatar del personaje aparece en la barra superior, en la intro/outro y de fondo en la
        miniatura de los vídeos nuevos. Súbelo o deja que la IA lo genere.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {channel.avatar_url ? (
          <img
            src={fileUrl(channel.avatar_url)}
            alt={`Avatar de ${channel.name}`}
            style={{
              width: 88,
              height: 88,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid var(--line)',
              background: 'var(--bg2)',
            }}
          />
        ) : (
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: '50%',
              border: '1px dashed var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 12,
              textAlign: 'center',
              padding: 8,
            }}
          >
            sin avatar
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMut.mutate(file);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {uploadMut.isPending ? 'Subiendo' : 'Subir avatar'}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => generateMut.mutate()}>
            {generateMut.isPending ? 'Generando' : 'Generar con IA'}
          </Button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted fs-sm">Nombre del personaje</span>
          <input
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Milky Goblin"
            style={{ fontSize: 'var(--fs-sm)' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted fs-sm">Descripción</span>
          <input
            className="control"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Un duende simpático, mascota del canal"
            style={{ fontSize: 'var(--fs-sm)' }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="secondary"
          disabled={!dirty || channel.profile === null || saveCharacterMut.isPending}
          onClick={() => saveCharacterMut.mutate()}
        >
          {saveCharacterMut.isPending ? 'Guardando' : 'Guardar personaje'}
        </Button>
        <span className="muted fs-sm">
          Sugerencia de nombre de canal: <strong>{suggestChannelName(name)}</strong>
        </span>
      </div>
    </div>
  );
}

// Etiquetas de cada token de color del design system (orden de edición).
const DESIGN_TOKEN_LABELS: Array<{ key: keyof Omit<DesignTokens, 'font_family'>; label: string }> = [
  { key: 'background', label: 'Fondo' },
  { key: 'surface', label: 'Superficie' },
  { key: 'foreground', label: 'Texto' },
  { key: 'muted', label: 'Texto atenuado' },
  { key: 'accent', label: 'Acento' },
  { key: 'accent_fg', label: 'Texto sobre acento' },
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Design system del canal: campos de color + tipografía editables a mano. Los
// cambios se guardan en el perfil y los vídeos NUEVOS los congelan en
// master.brand.design; las animaciones (integradas y las creadas por IA) los
// leen, así que editar un color se ve sin regenerar nada.
function DesignSystemCard({ channel }: { channel: ChannelDto }) {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const saved = channel.profile?.brand_design ?? defaultDesign();
  const [draft, setDraft] = useState<DesignTokens>(saved);

  // si cambia el canal activo, recarga el borrador con sus tokens guardados
  useEffect(() => {
    setDraft(channel.profile?.brand_design ?? defaultDesign());
  }, [channel.id, channel.profile?.brand_design]);

  const saveMut = useMutation({
    mutationFn: () => putDesign(channel.id, designTokensSchema.parse(draft)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      push('Design system guardado');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo guardar el design system', 'danger'),
  });

  const dirty = DESIGN_TOKEN_LABELS.some(({ key }) => draft[key] !== saved[key]) ||
    draft.font_family !== saved.font_family;
  const allValid = DESIGN_TOKEN_LABELS.every(({ key }) => HEX_RE.test(draft[key]));

  const setToken = (key: keyof DesignTokens, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div
      className="card"
      style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)', display: 'grid', gap: 14 }}
    >
      <div className="head" style={{ fontSize: 14 }}>
        Design system
      </div>
      <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.55 }}>
        Colores y tipografía del canal. Se aplican al instante a las animaciones (subtítulos,
        intro, outro, tarjetas y miniatura) de los vídeos nuevos, sin regenerar nada.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
        }}
      >
        {DESIGN_TOKEN_LABELS.map(({ key, label }) => {
          const value = draft[key];
          const valid = HEX_RE.test(value);
          return (
            <label key={key} style={{ display: 'grid', gap: 6 }}>
              <span className="muted fs-sm">{label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  aria-label={`${label} (selector)`}
                  value={valid ? (value.length === 4 ? expandHex(value) : value) : '#000000'}
                  onChange={(e) => setToken(key, e.target.value)}
                  style={{
                    width: 40,
                    height: 34,
                    padding: 0,
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r)',
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
                <input
                  className="control mono"
                  aria-label={`${label} (hex)`}
                  value={value}
                  spellCheck={false}
                  onChange={(e) => setToken(key, e.target.value.trim())}
                  style={{
                    fontSize: 'var(--fs-sm)',
                    borderColor: valid ? undefined : 'var(--danger, #e5484d)',
                  }}
                />
              </div>
            </label>
          );
        })}

        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted fs-sm">Tipografía</span>
          <select
            className="control"
            aria-label="Tipografía"
            value={draft.font_family}
            onChange={(e) => setToken('font_family', e.target.value)}
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            <option value="Inter">Inter</option>
          </select>
        </label>
      </div>

      {/* vista previa en vivo de la paleta */}
      <div
        style={{
          borderRadius: 'var(--r)',
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: draft.background,
            padding: 20,
            display: 'grid',
            gap: 12,
            fontFamily: draft.font_family,
          }}
        >
          <div style={{ color: draft.foreground, fontSize: 22, fontWeight: 700 }}>
            {channel.name}
          </div>
          <div style={{ color: draft.muted, fontSize: 14 }}>Texto secundario de ejemplo</div>
          <div style={{ width: 160, height: 6, borderRadius: 3, background: draft.accent }} />
          <div
            style={{
              background: draft.surface,
              borderRadius: 'var(--r)',
              padding: '12px 14px',
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <span style={{ color: draft.foreground, fontSize: 14 }}>Tarjeta sobre superficie</span>
            <span
              style={{
                marginLeft: 'auto',
                background: draft.accent,
                color: draft.accent_fg,
                fontSize: 13,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 999,
              }}
            >
              Acento
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="primary"
          disabled={!dirty || !allValid || saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? 'Guardando' : 'Guardar design system'}
        </Button>
        {dirty ? (
          <Button variant="secondary" disabled={saveMut.isPending} onClick={() => setDraft(saved)}>
            Descartar cambios
          </Button>
        ) : null}
        {!allValid ? (
          <span className="muted fs-sm">Revisa los colores: usa formato #rgb o #rrggbb.</span>
        ) : null}
      </div>
    </div>
  );
}

// Expande #rgb → #rrggbb para el <input type="color"> (que solo acepta 6 díg.).
function expandHex(hex: string): string {
  const h = hex.replace('#', '');
  return `#${h.split('').map((c) => c + c).join('')}`;
}

// Animaciones con IA: la IA (Claude) escribe TODAS las animaciones del brand
// kit leyendo el design system del canal y mostrando el avatar. El flujo manual
// (copiar el prompt-contrato para Claude Design y subir el zip) queda como
// alternativa avanzada.
function DesignPromptCard({ channelId }: { channelId: string }) {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ComponentType>('intro');

  const authorMut = useMutation({
    mutationFn: (t?: string) => authorComponents(channelId, t),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['componentes'] });
      const n = res.enqueued.length;
      push(n > 1 ? `Generando ${n} animaciones con IA` : 'Generando la animación con IA');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudieron generar las animaciones', 'danger'),
  });

  const copyMut = useMutation({
    mutationFn: async () => {
      const prompt = await getComponentPrompt(channelId, type);
      await navigator.clipboard.writeText(prompt);
    },
    onSuccess: () => push(`Prompt de ${TYPE_LABELS[type].toLowerCase()} copiado`),
    onError: () => push('No se pudo generar el prompt', 'danger'),
  });

  const busy = authorMut.isPending;

  return (
    <div
      className="card"
      style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)', display: 'grid', gap: 12 }}
    >
      <div className="head" style={{ fontSize: 14 }}>
        Animaciones con IA
      </div>
      <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.55 }}>
        La IA escribe las animaciones del brand kit (intro, outro, tarjetas, rótulos, subtítulos y
        miniatura) leyendo tu design system y mostrando el avatar del canal. Cada una se valida
        (typecheck, determinismo, contrato y render de humo) y se activa sola al pasar.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" disabled={busy} onClick={() => authorMut.mutate(undefined)}>
          {busy ? 'Generando' : 'Generar todas con IA'}
        </Button>
        <span className="muted fs-sm">o un tipo concreto:</span>
        <select
          className="control"
          aria-label="Tipo de componente"
          value={type}
          style={{ width: 'auto', fontSize: 'var(--fs-sm)' }}
          onChange={(e) => setType(e.target.value as ComponentType)}
        >
          {COMPONENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <Button variant="secondary" disabled={busy} onClick={() => authorMut.mutate(type)}>
          Generar {TYPE_LABELS[type].toLowerCase()}
        </Button>
      </div>

      <details>
        <summary className="muted fs-sm" style={{ cursor: 'pointer' }}>
          Diseñarlo a mano con Claude Design (avanzado)
        </summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.55 }}>
            Copia el prompt-contrato (tokens del canal + props exactas + reglas de render), pégalo
            en Claude Design y sube el zip resultante.
          </p>
          <div>
            <Button
              variant="secondary"
              disabled={copyMut.isPending}
              onClick={() => copyMut.mutate()}
            >
              Copiar prompt de {TYPE_LABELS[type].toLowerCase()}
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

interface ComponentCardProps {
  component: ComponentDto;
  note?: JobNote;
  busy: boolean;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
}

function ComponentCard({ component: c, note, busy, onActivate, onDelete }: ComponentCardProps) {
  const status = STATUS_CHIP[c.status];
  const showNote = c.status === 'pending' && note !== undefined && note.queue === 'components';
  return (
    <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
          {c.name}@{c.version}
        </span>
        <Chip kind={status.kind}>{status.label}</Chip>
        {c.active ? <Chip kind="ok">Activo</Chip> : null}
      </div>

      {showNote ? (
        <div className="muted fs-sm">{note.detail ?? `Validando (${note.progress} %)`}</div>
      ) : null}

      {c.preview_video_url !== null ? (
        // preview animada en bucle (mp4 del render de humo); si falla, el
        // póster es el still de un frame medio
        <video
          src={fileUrl(c.preview_video_url)}
          poster={c.preview_url !== null ? fileUrl(c.preview_url) : undefined}
          muted
          autoPlay
          loop
          playsInline
          style={{
            width: '100%',
            maxWidth: 420,
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 'var(--r)',
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
          }}
        />
      ) : c.preview_url !== null ? (
        <img
          src={fileUrl(c.preview_url)}
          alt={`Preview de ${c.name}@${c.version}`}
          style={{
            width: '100%',
            maxWidth: 420,
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 'var(--r)',
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
          }}
        />
      ) : null}

      {c.log !== null ? (
        <details open={c.status === 'failed'}>
          <summary className="muted fs-sm" style={{ cursor: 'pointer' }}>
            {c.status === 'failed' ? 'Log del fallo' : 'Log de la validación'}
          </summary>
          <pre
            className="mono"
            style={{
              margin: '8px 0 0',
              padding: 10,
              fontSize: 11.5,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 260,
              overflow: 'auto',
              background: 'var(--bg2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
            }}
          >
            {c.log}
          </pre>
        </details>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {c.status === 'validated' && !c.active ? (
          <Button variant="primary" disabled={busy} onClick={() => onActivate(c.id)}>
            Activar
          </Button>
        ) : null}
        {!c.active ? (
          <Button variant="danger-ghost" disabled={busy} onClick={() => onDelete(c.id)}>
            Quitar
          </Button>
        ) : (
          <span className="muted fs-sm" style={{ alignSelf: 'center' }}>
            En uso en los vídeos nuevos del canal
          </span>
        )}
      </div>
    </div>
  );
}

export function Componentes() {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // el canal activo viene del contexto multicanal (antes se asumía channels[0])
  const {
    activeChannel: channel,
    activeChannelId: channelId,
    isPending: channelsPending,
    isError: channelsError,
    refetch: refetchChannels,
  } = useChannel();

  // EventsProvider invalida el prefijo ['componentes'] con el SSE inbox_changed
  // (que el worker publica al terminar la validación) y con job_progress de la
  // cola components al llegar al 100 %: la lista se refresca en vivo
  const componentsQ = useQuery({
    queryKey: ['componentes', channelId],
    queryFn: () => getComponents(channelId as string),
    enabled: channelId !== null,
  });

  const { jobNotes } = useLive();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['componentes'] });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadComponent({ file, channelId: channelId as string }),
    onMutate: () => setUploading(true),
    onSettled: () => setUploading(false),
    onSuccess: () => {
      void invalidate();
      push('Zip subido; validación en marcha');
    },
    onError: (err) => push(err instanceof Error ? err.message : 'No se pudo subir el zip', 'danger'),
  });

  const activateMut = useMutation({
    mutationFn: activateComponent,
    onSuccess: () => {
      void invalidate();
      push('Componente activado para el canal');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo activar el componente', 'danger'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteComponent,
    onSuccess: () => {
      void invalidate();
      push('Componente eliminado');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo eliminar el componente', 'danger'),
  });

  useHotkeys((e) => {
    if (e.key === 's' && channelId !== null && !uploading) {
      e.preventDefault();
      fileRef.current?.click();
    }
  });

  const onFileChosen = (files: FileList | null) => {
    const file = files?.[0];
    if (file !== undefined && channelId !== null) uploadMut.mutate(file);
    if (fileRef.current !== null) fileRef.current.value = '';
  };

  const busy = activateMut.isPending || deleteMut.isPending;
  const componentsByType = new Map<ComponentType, ComponentDto[]>();
  for (const c of componentsQ.data ?? []) {
    const type = c.type as ComponentType;
    const list = componentsByType.get(type) ?? [];
    list.push(c);
    componentsByType.set(type, list);
  }

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 'var(--sec-gap)',
        }}
      >
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>
          Brand kit
        </h1>
        <div style={{ flex: 1 }} />
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => onFileChosen(e.target.files)}
        />
        <Button
          variant="primary"
          kbd="s"
          disabled={channelId === null || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Subiendo el zip' : 'Subir zip'}
        </Button>
      </div>

      {/* nota fija: restricciones del contrato del zip */}
      <div
        className="card"
        style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)', display: 'grid', gap: 6 }}
      >
        <div className="head" style={{ fontSize: 14 }}>
          Contrato del zip
        </div>
        <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.55 }}>
          manifest.json (v1) + Component.tsx con export default + schema.ts con export default
          z.object + assets/. Restricciones de render: animar solo con useCurrentFrame, sin fetch
          durante el render, sin aleatoriedad sin semilla y fuentes empaquetadas en el zip o pila
          del sistema. La validación compila el componente, comprueba el contrato de props de su
          tipo y hace un render de humo de 60 frames antes de dejarlo activable. Nota: el render
          usa el componente nuevo de inmediato; la previsualización del dashboard compilado lo
          incorpora en el siguiente build (en desarrollo se recarga sola).
        </p>
      </div>

      {channel !== undefined ? <CharacterCard channel={channel} /> : null}

      {channel !== undefined ? <DesignSystemCard channel={channel} /> : null}

      {channelId !== null ? <DesignPromptCard channelId={channelId} /> : null}

      {channelsPending || (channelId !== null && componentsQ.isPending) ? (
        <div className="muted fs-sm">Cargando el brand kit</div>
      ) : null}

      {channelsError ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="banner banner-danger">No se pudieron cargar los canales.</div>
          <div>
            <Button variant="secondary" onClick={refetchChannels}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {!channelsPending && !channelsError && channel === undefined ? (
        <EmptyState title="Todavía no hay canal">
          Crea el canal con el wizard para poder subir componentes del brand kit.
        </EmptyState>
      ) : null}

      {componentsQ.data !== undefined && componentsQ.data.length === 0 ? (
        <EmptyState title="Sin componentes todavía">
          Genera un zip de plantilla con scripts/make-example-component.ts de packages/video y
          súbelo aquí para probar el ciclo completo.
        </EmptyState>
      ) : null}

      <div style={{ display: 'grid', gap: 'var(--sec-gap)' }}>
        {COMPONENT_TYPES.map((type) => {
          const list = componentsByType.get(type);
          if (list === undefined || list.length === 0) return null;
          return (
            <section key={type}>
              <h2 className="head" style={{ fontSize: 16, margin: '0 0 10px' }}>
                {TYPE_LABELS[type]}
              </h2>
              <div style={{ display: 'grid', gap: 'var(--gap)' }}>
                {list.map((c) => (
                  <ComponentCard
                    key={c.id}
                    component={c}
                    note={jobNotes[c.id]}
                    busy={busy}
                    onActivate={(id) => activateMut.mutate(id)}
                    onDelete={(id) => deleteMut.mutate(id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
