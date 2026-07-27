import type { ChannelProfile } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Chip } from '../components/ui';
import { getChannel, getChannels, postWizard, putProfile } from '../lib/api';
import { useToasts } from '../lib/toasts';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 'var(--pad)' }}>
      <div className="head" style={{ fontSize: 16, marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </div>
  );
}

const splitLines = (v: string): string[] =>
  v
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');

const splitCommas = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

export function Wizard() {
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();

  // Formulario inicial
  const [niche, setNiche] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [competitors, setCompetitors] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);

  // Si ya hay un canal con perfil sin aprobar, se retoma su edición.
  const { data: channels } = useQuery({ queryKey: ['channels'], queryFn: getChannels });
  useEffect(() => {
    if (channelId === null && channels !== undefined) {
      const pendiente = channels.find((c) => c.profile !== null && !c.profile_approved);
      if (pendiente !== undefined) setChannelId(pendiente.id);
    }
  }, [channels, channelId]);

  const channelQ = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => getChannel(channelId as string),
    enabled: channelId !== null,
    refetchInterval: (query) => (query.state.data?.profile ? false : 2500),
  });

  const wizardMut = useMutation({
    mutationFn: postWizard,
    onSuccess: (res) => {
      setChannelId(res.id);
      push('Perfil en preparación · estamos leyendo a la competencia');
    },
    onError: () => push('No se pudo iniciar el wizard', 'danger'),
  });

  // Perfil editable (copia local del borrador)
  const [profile, setProfile] = useState<ChannelProfile | null>(null);
  useEffect(() => {
    if (profile === null && channelQ.data?.profile != null) {
      setProfile(channelQ.data.profile);
    }
  }, [channelQ.data, profile]);

  const approveMut = useMutation({
    mutationFn: () => putProfile(channelId as string, profile as ChannelProfile, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      push('Perfil aprobado · la ideación está en marcha');
      void navigate('/');
    },
    onError: () => push('No se pudo guardar el perfil', 'danger'),
  });

  // Pantalla 1: formulario del wizard
  if (channelId === null) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px', maxWidth: 760 }}>
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
          Nuevo canal
        </h1>
        <p className="muted fs-sm" style={{ margin: '0 0 var(--sec-gap)', lineHeight: 1.55 }}>
          El wizard lee los canales competidores, sintetiza un perfil editorial y te lo trae para
          editarlo y aprobarlo. Tarda uno o dos minutos.
        </p>
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          <Section title="Datos del canal">
            <Field label="Nicho">
              <input
                className="control"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="IA y tecnología aplicada"
              />
            </Field>
            <Field label="Nombre del canal">
              <input
                className="control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre visible en YouTube"
              />
            </Field>
            <Field label="Idioma">
              <select
                className="control"
                value={language}
                onChange={(e) => setLanguage(e.target.value === 'en' ? 'en' : 'es')}
              >
                <option value="es">Español</option>
                <option value="en">Inglés</option>
              </select>
            </Field>
            <Field label="Canales competidores · una URL por línea">
              <textarea
                className="control"
                rows={5}
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder={'https://www.youtube.com/@canal1\nhttps://www.youtube.com/@canal2'}
              />
            </Field>
          </Section>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              disabled={niche.trim().length < 2 || name.trim() === '' || wizardMut.isPending}
              onClick={() =>
                wizardMut.mutate({
                  niche: niche.trim(),
                  name: name.trim(),
                  language,
                  competitors: splitLines(competitors),
                })
              }
            >
              {wizardMut.isPending ? 'Preparando' : 'Preparar el perfil'}
            </Button>
            <Button variant="ghost" onClick={() => void navigate('/')}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla 2: perfil en preparación (poll)
  if (profile === null) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 3) 26px', maxWidth: 640 }}>
        <div className="card" style={{ padding: 'calc(var(--pad) * 1.6)', textAlign: 'center' }}>
          <div className="head" style={{ fontSize: 17, marginBottom: 6 }}>
            Perfil en preparación
          </div>
          <p className="muted fs-sm" style={{ margin: '0 auto 16px', maxWidth: 400, lineHeight: 1.5 }}>
            Estamos leyendo los canales competidores y sintetizando el avatar del canal. Esta
            página se actualiza sola.
          </p>
          <div className="progress progress-indeterminate" style={{ maxWidth: 320, margin: '0 auto' }}>
            <div />
          </div>
        </div>
      </div>
    );
  }

  // Pantalla 3: editor del perfil como formulario amable (nunca JSON crudo)
  const p = profile;
  const set = (patch: Partial<ChannelProfile>) => setProfile({ ...p, ...patch });

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px', maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--pad)' }}>
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>
          Perfil del canal
        </h1>
        <Chip kind="warn">Borrador · pendiente de aprobar</Chip>
      </div>
      <p className="muted fs-sm" style={{ margin: '0 0 var(--sec-gap)', lineHeight: 1.55, maxWidth: 660 }}>
        Este perfil se inyecta como contexto en todo lo que se genere después. Revísalo con calma:
        el vídeo 30 debe sonar al vídeo 1.
      </p>

      <div style={{ display: 'grid', gap: 'var(--gap)' }}>
        <Section title="Identidad">
          <Field label="Nombre">
            <input
              className="control"
              value={p.identity.name}
              onChange={(e) => set({ identity: { ...p.identity, name: e.target.value } })}
            />
          </Field>
          <Field label="Posicionamiento">
            <textarea
              className="control"
              rows={2}
              value={p.identity.positioning}
              onChange={(e) => set({ identity: { ...p.identity, positioning: e.target.value } })}
            />
          </Field>
          <Field label="Espectador objetivo">
            <textarea
              className="control"
              rows={2}
              value={p.identity.audience}
              onChange={(e) => set({ identity: { ...p.identity, audience: e.target.value } })}
            />
          </Field>
          <Field label="Tono · separado por comas">
            <input
              className="control"
              value={p.identity.tone.join(', ')}
              onChange={(e) => set({ identity: { ...p.identity, tone: splitCommas(e.target.value) } })}
            />
          </Field>
        </Section>

        <Section title="Pilares de contenido">
          {p.pillars.map((pillar, i) => (
            <div
              key={i}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                padding: 12,
                display: 'grid',
                gap: 10,
              }}
            >
              <Field label={`Pilar ${i + 1} · nombre`}>
                <input
                  className="control"
                  value={pillar.name}
                  onChange={(e) => {
                    const pillars = p.pillars.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    );
                    set({ pillars });
                  }}
                />
              </Field>
              <Field label="Descripción">
                <textarea
                  className="control"
                  rows={2}
                  value={pillar.description}
                  onChange={(e) => {
                    const pillars = p.pillars.map((x, j) =>
                      j === i ? { ...x, description: e.target.value } : x,
                    );
                    set({ pillars });
                  }}
                />
              </Field>
              <Field label="Consultas de ejemplo · separadas por comas">
                <input
                  className="control"
                  value={pillar.example_queries.join(', ')}
                  onChange={(e) => {
                    const pillars = p.pillars.map((x, j) =>
                      j === i ? { ...x, example_queries: splitCommas(e.target.value) } : x,
                    );
                    set({ pillars });
                  }}
                />
              </Field>
              <div>
                <Button
                  variant="danger-ghost"
                  onClick={() => set({ pillars: p.pillars.filter((_, j) => j !== i) })}
                >
                  Quitar este pilar
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={() =>
                set({
                  pillars: [...p.pillars, { name: '', description: '', example_queries: [] }],
                })
              }
            >
              Añadir un pilar
            </Button>
          </div>
        </Section>

        <Section title="Estilo visual">
          <Field label="Sufijo para prompts visuales y búsquedas de stock">
            <input
              className="control"
              value={p.style.visual_prompt_suffix}
              onChange={(e) => set({ style: { ...p.style, visual_prompt_suffix: e.target.value } })}
            />
          </Field>
          <Field label="Idioma de las búsquedas de stock">
            <select
              className="control"
              value={p.style.stock_query_lang}
              onChange={(e) =>
                set({ style: { ...p.style, stock_query_lang: e.target.value === 'en' ? 'en' : 'es' } })
              }
            >
              <option value="en">Inglés</option>
              <option value="es">Español</option>
            </select>
          </Field>
          <Field label="Temas y palabras prohibidos · separados por comas">
            <input
              className="control"
              value={p.style.banned.join(', ')}
              onChange={(e) => set({ style: { ...p.style, banned: splitCommas(e.target.value) } })}
            />
          </Field>
        </Section>

        <Section title="Voz">
          <Field label="Proveedor de TTS">
            <select
              className="control"
              value={p.voice.provider}
              onChange={(e) =>
                set({
                  voice: { ...p.voice, provider: e.target.value === 'elevenlabs' ? 'elevenlabs' : 'edge' },
                })
              }
            >
              <option value="edge">edge-tts · gratuito</option>
              <option value="elevenlabs">ElevenLabs · de pago</option>
            </select>
          </Field>
          <Field label="Identificador de la voz">
            <input
              className="control"
              value={p.voice.voice_id}
              onChange={(e) => set({ voice: { ...p.voice, voice_id: e.target.value } })}
            />
          </Field>
          <Field label="Velocidad · ajuste estilo edge-tts, p. ej. -8%">
            <input
              className="control"
              value={p.voice.rate}
              onChange={(e) => set({ voice: { ...p.voice, rate: e.target.value } })}
            />
          </Field>
        </Section>

        <Section title="Patrones de título">
          {p.title_patterns.map((pattern, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
              <Field label={`Plantilla ${i + 1}`}>
                <input
                  className="control"
                  value={pattern.template}
                  onChange={(e) => {
                    const title_patterns = p.title_patterns.map((x, j) =>
                      j === i ? { ...x, template: e.target.value } : x,
                    );
                    set({ title_patterns });
                  }}
                />
              </Field>
              <Field label="Ejemplo">
                <input
                  className="control"
                  value={pattern.example}
                  onChange={(e) => {
                    const title_patterns = p.title_patterns.map((x, j) =>
                      j === i ? { ...x, example: e.target.value } : x,
                    );
                    set({ title_patterns });
                  }}
                />
              </Field>
              <Chip kind="neutral">{pattern.source === 'mined' ? 'minado' : 'manual'}</Chip>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={() =>
                set({
                  title_patterns: [...p.title_patterns, { template: '', example: '', source: 'manual' }],
                })
              }
            >
              Añadir un patrón
            </Button>
          </div>
        </Section>

        <Section title="Señales comerciales y flags">
          <Field label="Temas de CPM alto · separados por comas">
            <input
              className="control"
              value={p.high_cpm_topics.join(', ')}
              onChange={(e) => set({ high_cpm_topics: splitCommas(e.target.value) })}
            />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}>
            <input
              type="checkbox"
              checked={p.flags.packaging_first}
              onChange={(e) => set({ flags: { ...p.flags, packaging_first: e.target.checked } })}
            />
            Packaging primero: elegir título y miniatura al aprobar la idea, antes del guion
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}>
            <input
              type="checkbox"
              checked={p.flags.ai_disclosure}
              onChange={(e) => set({ flags: { ...p.flags, ai_disclosure: e.target.checked } })}
            />
            Declarar contenido sintético al subir (containsSyntheticMedia)
          </label>
        </Section>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" disabled={approveMut.isPending} onClick={() => approveMut.mutate()}>
            {approveMut.isPending ? 'Guardando' : 'Aprobar el perfil'}
          </Button>
          <Button variant="ghost" onClick={() => void navigate('/')}>
            Seguir más tarde
          </Button>
        </div>
      </div>
    </div>
  );
}
