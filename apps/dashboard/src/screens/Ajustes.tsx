import type { ChannelProfile } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Chip } from '../components/ui';
import { getChannels, putProfile } from '../lib/api';
import { useToasts } from '../lib/toasts';

export function Ajustes() {
  const { push } = useToasts();
  const queryClient = useQueryClient();

  const channelsQ = useQuery({ queryKey: ['channels'], queryFn: getChannels });
  const channel = channelsQ.data?.[0];

  const [profile, setProfile] = useState<ChannelProfile | null>(null);
  useEffect(() => {
    if (profile === null && channel?.profile != null) setProfile(channel.profile);
  }, [channel, profile]);

  const saveMut = useMutation({
    mutationFn: () =>
      putProfile(channel?.id as string, profile as ChannelProfile, channel?.profile_approved ?? true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      push('Ajustes guardados');
    },
    onError: () => push('No se pudieron guardar los ajustes', 'danger'),
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
          {/* Los settings de canal (presupuesto, duración) aún no tienen endpoint en la API:
              controles deshabilitados a propósito. */}
          <label style={{ display: 'block' }}>
            <span className="field-label">Presupuesto mensual · $</span>
            <input className="control" value="15" disabled aria-describedby="nota-settings" />
          </label>
          <label style={{ display: 'block' }}>
            <span className="field-label">Duración objetivo · minutos de locución</span>
            <input className="control" value="7" disabled aria-describedby="nota-settings" />
          </label>
          <p id="nota-settings" className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
            Estos dos controles se activarán cuando la API exponga los ajustes del canal
            (endpoint de settings pendiente).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? 'Guardando' : 'Guardar los ajustes'}
          </Button>
          <Link to="/wizard" className="fs-sm">
            Editar el perfil completo en el wizard →
          </Link>
        </div>
      </div>
    </div>
  );
}
