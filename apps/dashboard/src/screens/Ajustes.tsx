import type { ChannelProfile } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Chip } from '../components/ui';
import { getChannels, getSettings, putProfile, putSettings } from '../lib/api';
import { useToasts } from '../lib/toasts';

// borrador editable de los settings de producción (los campos numéricos se
// guardan como texto para no pelear con el teclado; se validan al guardar)
interface ProdDraft {
  monthly_budget_usd: string;
  target_minutes: string;
  anti_repeat_n: string;
  background_music: boolean;
}

function parseProd(draft: ProdDraft): {
  monthly_budget_usd: number;
  target_minutes: number;
  anti_repeat_n: number;
  background_music: boolean;
} | null {
  const budget = Number(draft.monthly_budget_usd.replace(',', '.'));
  const minutes = Number(draft.target_minutes.replace(',', '.'));
  const antiRepeat = Number(draft.anti_repeat_n);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 20) return null;
  if (!Number.isInteger(antiRepeat) || antiRepeat < 0) return null;
  return {
    monthly_budget_usd: budget,
    target_minutes: minutes,
    anti_repeat_n: antiRepeat,
    background_music: draft.background_music,
  };
}

export function Ajustes() {
  const { push } = useToasts();
  const queryClient = useQueryClient();

  const channelsQ = useQuery({ queryKey: ['channels'], queryFn: getChannels });
  const channel = channelsQ.data?.[0];

  const [profile, setProfile] = useState<ChannelProfile | null>(null);
  useEffect(() => {
    if (profile === null && channel?.profile != null) setProfile(channel.profile);
  }, [channel, profile]);

  const settingsQ = useQuery({
    queryKey: ['settings', channel?.id],
    queryFn: () => getSettings(channel?.id as string),
    enabled: channel !== undefined,
  });
  const [prod, setProd] = useState<ProdDraft | null>(null);
  useEffect(() => {
    if (prod === null && settingsQ.data !== undefined) {
      setProd({
        monthly_budget_usd: String(settingsQ.data.monthly_budget_usd),
        target_minutes: String(settingsQ.data.target_minutes),
        anti_repeat_n: String(settingsQ.data.anti_repeat_n),
        background_music: settingsQ.data.background_music,
      });
    }
  }, [settingsQ.data, prod]);

  const saveMut = useMutation({
    mutationFn: () =>
      putProfile(channel?.id as string, profile as ChannelProfile, channel?.profile_approved ?? true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      push('Ajustes guardados');
    },
    onError: () => push('No se pudieron guardar los ajustes', 'danger'),
  });

  const prodParsed = prod !== null ? parseProd(prod) : null;
  const settingsMut = useMutation({
    mutationFn: () => {
      if (prodParsed === null) throw new Error('Ajustes de producción inválidos');
      return putSettings(channel?.id as string, prodParsed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', channel?.id] });
      push('Ajustes de producción guardados');
    },
    onError: () => push('No se pudieron guardar los ajustes de producción', 'danger'),
  });

  if (channelsQ.isPending) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="muted fs-sm">Cargando los ajustes</div>
      </div>
    );
  }

  if (channel === undefined) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px', maxWidth: 640 }}>
        <div className="card" style={{ padding: 'calc(var(--pad) * 1.6)', textAlign: 'center' }}>
          <div className="head" style={{ fontSize: 16, marginBottom: 6 }}>
            Todavía no hay canal
          </div>
          <p className="muted fs-sm" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
            Crea el canal con el wizard: perfil, competidores y voz.
          </p>
          <Link to="/wizard" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Abrir el wizard
          </Link>
        </div>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px', maxWidth: 640 }}>
        <div className="card" style={{ padding: 'calc(var(--pad) * 1.6)', textAlign: 'center' }}>
          <div className="head" style={{ fontSize: 16, marginBottom: 6 }}>
            El perfil aún se está preparando
          </div>
          <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
            Cuando el wizard termine podrás editar aquí los ajustes del canal.
          </p>
        </div>
      </div>
    );
  }

  const p = profile;

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px', maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sec-gap)' }}>
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>
          Ajustes
        </h1>
        <Chip kind={channel.profile_approved ? 'ok' : 'warn'}>
          {channel.profile_approved ? 'Perfil aprobado' : 'Perfil sin aprobar'}
        </Chip>
      </div>

      <div style={{ display: 'grid', gap: 'var(--gap)' }}>
        <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 12 }}>
          <div className="head" style={{ fontSize: 16 }}>
            Canal
          </div>
          <label style={{ display: 'block' }}>
            <span className="field-label">Nombre del canal</span>
            <input
              className="control"
              value={p.identity.name}
              onChange={(e) =>
                setProfile({ ...p, identity: { ...p.identity, name: e.target.value } })
              }
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}>
            <input
              type="checkbox"
              checked={p.flags.packaging_first}
              onChange={(e) =>
                setProfile({ ...p, flags: { ...p.flags, packaging_first: e.target.checked } })
              }
            />
            Packaging primero: título y miniatura se eligen al aprobar la idea
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}>
            <input
              type="checkbox"
              checked={p.flags.ai_disclosure}
              onChange={(e) =>
                setProfile({ ...p, flags: { ...p.flags, ai_disclosure: e.target.checked } })
              }
            />
            Declarar contenido sintético al subir (containsSyntheticMedia)
          </label>
        </div>

        <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 12 }}>
          <div className="head" style={{ fontSize: 16 }}>
            Voz
          </div>
          <label style={{ display: 'block' }}>
            <span className="field-label">Proveedor de TTS</span>
            <select
              className="control"
              value={p.voice.provider}
              onChange={(e) =>
                setProfile({
                  ...p,
                  voice: { ...p.voice, provider: e.target.value === 'elevenlabs' ? 'elevenlabs' : 'edge' },
                })
              }
            >
              <option value="edge">edge-tts · gratuito</option>
              <option value="elevenlabs">ElevenLabs · de pago</option>
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span className="field-label">Identificador de la voz</span>
            <input
              className="control"
              value={p.voice.voice_id}
              onChange={(e) => setProfile({ ...p, voice: { ...p.voice, voice_id: e.target.value } })}
            />
          </label>
        </div>

        <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 12 }}>
          <div className="head" style={{ fontSize: 16 }}>
            Producción
          </div>
          {prod === null ? (
            <p className="muted fs-sm" style={{ margin: 0 }}>
              Cargando los ajustes de producción
            </p>
          ) : (
            <>
              <label style={{ display: 'block' }}>
                <span className="field-label">Presupuesto mensual · $</span>
                <input
                  className="control"
                  type="number"
                  min={1}
                  step={1}
                  value={prod.monthly_budget_usd}
                  onChange={(e) => setProd({ ...prod, monthly_budget_usd: e.target.value })}
                />
              </label>
              <label style={{ display: 'block' }}>
                <span className="field-label">Duración objetivo · minutos de locución</span>
                <input
                  className="control"
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={prod.target_minutes}
                  onChange={(e) => setProd({ ...prod, target_minutes: e.target.value })}
                />
              </label>
              <label style={{ display: 'block' }}>
                <span className="field-label">Anti repetición · vídeos recientes a evitar</span>
                <input
                  className="control"
                  type="number"
                  min={0}
                  step={1}
                  value={prod.anti_repeat_n}
                  onChange={(e) => setProd({ ...prod, anti_repeat_n: e.target.value })}
                />
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}
              >
                <input
                  type="checkbox"
                  checked={prod.background_music}
                  onChange={(e) => setProd({ ...prod, background_music: e.target.checked })}
                />
                Música de fondo a −22 dB bajo la voz
              </label>
              <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                La música necesita pistas de tipo música (kind music) en la biblioteca del canal o
                compartidas; sin pistas, el vídeo sale solo con la voz.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  disabled={settingsMut.isPending || prodParsed === null}
                  onClick={() => settingsMut.mutate()}
                >
                  {settingsMut.isPending ? 'Guardando' : 'Guardar la producción'}
                </Button>
                {prodParsed === null ? (
                  <span className="muted fs-sm">
                    Revisa los valores: presupuesto positivo, duración entre 0,5 y 20 minutos.
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* guardar desde aquí marca el perfil como aprobado en la API:
              con el perfil sin aprobar se bloquea para no aprobarlo sin querer */}
          <Button
            variant="primary"
            disabled={saveMut.isPending || !channel.profile_approved}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? 'Guardando' : 'Guardar los ajustes'}
          </Button>
          <Link to="/wizard" className="fs-sm">
            Editar el perfil completo en el wizard →
          </Link>
          {!channel.profile_approved ? (
            <span className="muted fs-sm">
              El perfil está sin aprobar: revísalo y apruébalo primero en el wizard.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
