import { useQuery } from '@tanstack/react-query';
import { getCatalogoEditor } from '../lib/editor-catalogo';
import { Button } from './ui';

// El guion de dirección de un reel, como FORMULARIO POR ACTOS (principio 2:
// el humano nunca ve JSON crudo). El JSON del contrato del editor
// (apps/editor/guiones/CONTRATO.md) se serializa por debajo: lo que se pueda
// decir aquí se dice con campos; micro-FX y media local quedan para el modo
// avanzado, que sigue existiendo como pliegue porque quitar capacidad para
// ganar limpieza sería cambiar un defecto por otro.

export interface ActoGuion {
  act_name: string;
  voice_speech: string;
  screen_mode: 'MODE_A_ROLL' | 'MODE_FULL_MOTION';
  framing: 'FRAME_CLOSE_UP' | 'FRAME_WIDE' | 'FRAME_LEFT' | 'NONE';
  /** plantilla del catálogo; '' = sin tarjeta en este acto */
  plantilla: string;
  card_copy: string;
  /** CSV de palabras a resaltar en azul */
  resaltar: string;
  /** sonido de banco; '' = sin sfx */
  sfx: string;
}

export const ACTO_VACIO: ActoGuion = {
  act_name: '',
  voice_speech: '',
  screen_mode: 'MODE_A_ROLL',
  framing: 'FRAME_CLOSE_UP',
  plantilla: '',
  card_copy: '',
  resaltar: '',
  sfx: '',
};

/** Actos → el JSON del contrato del editor, como string listo para el alta. */
export function serializarGuion(titulo: string, actos: readonly ActoGuion[]): string {
  return JSON.stringify(
    {
      metadata: { title: titulo, aspect_ratio: '9:16' },
      timeline: actos.map((a, i) => ({
        act: i + 1,
        ...(a.act_name.trim() !== '' ? { act_name: a.act_name.trim() } : {}),
        screen_mode: a.screen_mode,
        ...(a.framing !== 'NONE' ? { framing: a.framing } : {}),
        voice_speech: a.voice_speech.trim(),
        blue_highlight_words: a.resaltar
          .split(',')
          .map((w) => w.trim())
          .filter((w) => w !== ''),
        ...(a.plantilla !== ''
          ? {
              visual_trigger: {
                name: a.plantilla,
                ...(a.card_copy.trim() !== '' ? { card_copy: a.card_copy.trim() } : {}),
              },
            }
          : {}),
        ...(a.sfx !== '' ? { sfx: [a.sfx] } : {}),
      })),
    },
    null,
    2,
  );
}

export function GuionActosEditor({
  actos,
  onChange,
}: {
  actos: readonly ActoGuion[];
  onChange: (actos: ActoGuion[]) => void;
}) {
  const catalogoQ = useQuery({
    queryKey: ['editor-catalogo'],
    queryFn: getCatalogoEditor,
    staleTime: Infinity,
  });
  const piezas = catalogoQ.data?.piezas ?? [];
  const sonidos = catalogoQ.data?.sonidos ?? [];

  const cambiar = (i: number, patch: Partial<ActoGuion>) =>
    onChange(actos.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {actos.map((acto, i) => {
        const pieza = piezas.find((p) => p.plantilla === acto.plantilla);
        return (
          <div
            key={i}
            className="card"
            style={{ padding: 'var(--pad)', display: 'grid', gap: 8, background: 'var(--bg3)' }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono fs-sm muted">Acto {i + 1}</span>
              <input
                className="control"
                type="text"
                placeholder="Nombre (HOOK, giro, cierre…)"
                aria-label={`Nombre del acto ${i + 1}`}
                value={acto.act_name}
                onChange={(e) => cambiar(i, { act_name: e.target.value })}
                style={{ width: 200 }}
              />
              <select
                className="control"
                aria-label={`Modo de pantalla del acto ${i + 1}`}
                value={acto.screen_mode}
                onChange={(e) =>
                  cambiar(i, { screen_mode: e.target.value as ActoGuion['screen_mode'] })
                }
                style={{ width: 150 }}
              >
                <option value="MODE_A_ROLL">Tú a cámara</option>
                <option value="MODE_FULL_MOTION">Solo gráficos</option>
              </select>
              <select
                className="control"
                aria-label={`Encuadre del acto ${i + 1}`}
                value={acto.framing}
                onChange={(e) => cambiar(i, { framing: e.target.value as ActoGuion['framing'] })}
                style={{ width: 140 }}
              >
                <option value="FRAME_CLOSE_UP">Primer plano</option>
                <option value="FRAME_WIDE">Plano amplio</option>
                <option value="FRAME_LEFT">A la izquierda</option>
                <option value="NONE">Sin encuadre</option>
              </select>
              <div style={{ flex: 1 }} />
              {actos.length > 1 ? (
                <Button
                  variant="danger-ghost"
                  onClick={() => onChange(actos.filter((_, j) => j !== i))}
                >
                  Quitar acto
                </Button>
              ) : null}
            </div>
            <textarea
              className="control"
              rows={2}
              placeholder="Lo que dices en este acto (se cruza palabra a palabra con la grabación)"
              aria-label={`Texto del acto ${i + 1}`}
              value={acto.voice_speech}
              onChange={(e) => cambiar(i, { voice_speech: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="control"
                aria-label={`Plantilla del acto ${i + 1}`}
                value={acto.plantilla}
                onChange={(e) => cambiar(i, { plantilla: e.target.value, card_copy: '' })}
                style={{ flex: '1 1 220px' }}
              >
                <option value="">— sin tarjeta en este acto —</option>
                {piezas.map((p) => (
                  <option key={p.plantilla} value={p.plantilla}>
                    {p.plantilla.replace(/\.html$/, '')}
                    {p.admite_copy ? ' · admite copy' : ''}
                  </option>
                ))}
              </select>
              {pieza?.admite_copy === true ? (
                <input
                  className="control"
                  type="text"
                  placeholder="Copy de la tarjeta"
                  aria-label={`Copy de la tarjeta del acto ${i + 1}`}
                  value={acto.card_copy}
                  onChange={(e) => cambiar(i, { card_copy: e.target.value })}
                  style={{ flex: '1 1 200px' }}
                />
              ) : null}
              <input
                className="control"
                type="text"
                placeholder="Palabras en azul, separadas por comas"
                aria-label={`Palabras a resaltar del acto ${i + 1}`}
                value={acto.resaltar}
                onChange={(e) => cambiar(i, { resaltar: e.target.value })}
                style={{ flex: '1 1 220px' }}
              />
              <select
                className="control"
                aria-label={`Sonido del acto ${i + 1}`}
                value={acto.sfx}
                onChange={(e) => cambiar(i, { sfx: e.target.value })}
                style={{ width: 180 }}
              >
                <option value="">— sin sonido —</option>
                {sonidos.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/\.wav$/, '')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      <div>
        <Button variant="secondary" onClick={() => onChange([...actos, { ...ACTO_VACIO }])}>
          + Añadir acto
        </Button>
      </div>
    </div>
  );
}
