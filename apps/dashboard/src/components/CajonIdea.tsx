import type { IdeaDto } from '@fabrica/shared';
import { useRef, type ReactNode } from 'react';
import { fmtMoney } from '../lib/format';
import { Button, useModalKeyboard } from './ui';

// El cajón de lanzamiento: todo lo que la máquina sabe de una idea, antes de
// gastar dinero en ella. El radar solo enseña titular y motivo; aquí se ve el
// resumen entero, el enfoque, las fuentes de las que sale y lo que va a costar.

/** «cnn.com» a partir de una URL, sin romperse si no es una URL válida. */
export function dominio(url: string, caida?: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return caida ?? url;
  }
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <dl className="cajon-bloque" style={{ margin: 0 }}>
      <dt>{titulo}</dt>
      <dd>{children}</dd>
    </dl>
  );
}

export function CajonIdea({
  idea,
  puesto,
  minutos,
  costeMedio,
  generando,
  onGenerar,
  onDescartar,
  onClose,
}: {
  idea: IdeaDto;
  /** posición en el orden actual, 1-indexada */
  puesto: number;
  /** duración objetivo del canal, o null si no hay perfil aprobado */
  minutos: number | null;
  /** coste medio por vídeo del mes, o null si aún no hay ninguno */
  costeMedio: number | null;
  generando: boolean;
  onGenerar: () => void;
  onDescartar: () => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  useModalKeyboard(true, boxRef, onClose, ctaRef);

  const angle = idea.angle !== null && idea.angle.trim() !== '' ? idea.angle : null;
  const porque = idea.why_now !== null && idea.why_now.trim() !== '' ? idea.why_now : null;

  return (
    <div
      className="cajon-fondo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="cajon"
        role="dialog"
        aria-modal="true"
        aria-label={`Lanzar «${idea.title}»`}
      >
        <div className="cajon-cuerpo">
          <div>
            <div className="mono fs-sm muted" style={{ marginBottom: 6 }}>
              oportunidad n.º {puesto} · puntuación {idea.score.toFixed(1).replace('.', ',')}
            </div>
            <h2
              className="head"
              style={{ fontSize: 'var(--t-pantalla)', lineHeight: 1.2, margin: 0 }}
            >
              {idea.title}
            </h2>
          </div>

          {porque !== null ? <Bloque titulo="Por qué ahora">{porque}</Bloque> : null}
          {angle !== null ? <Bloque titulo="El enfoque">{angle}</Bloque> : null}
          <Bloque titulo="De qué va">{idea.summary}</Bloque>

          {idea.source_refs.length > 0 ? (
            <Bloque titulo={idea.source_refs.length === 1 ? 'Fuente' : 'Fuentes'}>
              <ul className="cajon-fuentes">
                {idea.source_refs.map((ref) => (
                  <li key={ref.url}>
                    <a href={ref.url} target="_blank" rel="noreferrer noopener">
                      {ref.title ?? dominio(ref.url, ref.domain)}
                    </a>
                    {ref.title !== undefined ? (
                      <span className="mono">{dominio(ref.url, ref.domain)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Bloque>
          ) : null}

          <Bloque titulo="Lo que va a costar">
            {/* estimación honesta: la duración es la del perfil del canal y el
                dinero la media real de este mes, no un número inventado */}
            {minutos !== null
              ? `unos ${minutos} min de vídeo`
              : 'duración según el perfil del canal'}
            {costeMedio !== null
              ? ` · ${fmtMoney(costeMedio)} de media en tus vídeos de este mes`
              : ' · aún no hay vídeos este mes con los que estimar el coste'}
          </Bloque>
        </div>

        <div className="cajon-pie">
          <Button variant="primary" ref={ctaRef} disabled={generando} onClick={onGenerar}>
            {generando ? 'Arrancando' : 'Generar vídeo'}
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="danger-ghost" onClick={onDescartar}>
            Descartar
          </Button>
          <Button variant="ghost" onClick={onClose} kbd="Esc">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
