import type { InboxDto } from '@fabrica/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, fileUrl, revealVideoFolder } from '../lib/api';
import { useToasts } from '../lib/toasts';
import { FichaEntrega } from './FichaEntrega';
import { Button, Chip, EmptyState, type ChipKind } from './ui';

// La galería de entregas: lo terminado, en 16:9 y con el vídeo real detrás de
// la miniatura. Antes eran filas de texto con un rectángulo gris de relleno,
// así que para saber qué habías hecho había que entrar en cada una.

type Entregada = InboxDto['done'][number];

function estadoDe(d: Entregada): { label: string; kind: ChipKind } {
  if (d.youtube?.status === 'subido') {
    // «En YouTube» a secas mentiría sobre quién lo hizo, que es justo lo que el
    // humano necesita saber de un vistazo al repasar la galería
    return d.youtube.origin === 'manual'
      ? { label: 'Publicado a mano', kind: 'ok' }
      : { label: 'En YouTube', kind: 'ok' };
  }
  if (d.youtube?.status === 'subiendo') return { label: 'Subiendo', kind: 'neutral' };
  if (d.youtube?.status === 'fallido') return { label: 'Subida fallida', kind: 'danger' };
  return { label: 'Sin publicar', kind: 'warn' };
}

/** «14 mar» — la fecha corta basta; el año solo si no es el actual. */
function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mismoAno = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    ...(mismoAno ? {} : { year: 'numeric' }),
  });
}

/** «14 de marzo de 2026, 18:20» — solo para el title del ratón. */
function fechaLarga(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'fecha desconocida';
  return d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
}

function Tarjeta({ d, onAbrir }: { d: Entregada; onAbrir: () => void }) {
  const { push } = useToasts();
  const videoRef = useRef<HTMLVideoElement>(null);
  const estado = estadoDe(d);

  const revealMut = useMutation({
    mutationFn: () => revealVideoFolder(d.video_id),
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo abrir la carpeta', 'danger'),
  });

  // el vídeo no se descarga hasta que el ratón entra: una galería de 20
  // entregas con preload sería decenas de MB por cada carga de la bandeja
  const reproducir = () => {
    const v = videoRef.current;
    if (v === null) return;
    void v.play().catch(() => {
      // sin autoplay disponible se queda la miniatura, que ya es suficiente
    });
  };
  const parar = () => {
    const v = videoRef.current;
    if (v === null) return;
    v.pause();
    v.currentTime = 0;
  };

  return (
    <li className="entrega" onMouseEnter={reproducir} onMouseLeave={parar}>
      <div className="entrega-lienzo">
        {d.thumbnail_url !== null ? (
          <img src={fileUrl(d.thumbnail_url)} alt="" />
        ) : (
          <span className="entrega-sinimagen">sin miniatura</span>
        )}
        {/* `output_dir` es una ruta ABSOLUTA de disco: no sirve para una URL.
            El servidor publica siempre /files/outputs/<id>/… */}
        <video
          ref={videoRef}
          src={fileUrl(`outputs/${d.video_id}/video.mp4`)}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
        />
        <span className="entrega-estado">
          <Chip kind={estado.kind}>{estado.label}</Chip>
        </span>
      </div>

      <div className="entrega-cuerpo">
        <button type="button" className="entrega-titulo" onClick={onAbrir}>
          {d.title}
        </button>
        <div className="entrega-pie">
          {/* la de CREACIÓN, que es la que ordena: `finished_at` es updatedAt y
              lo mueve cada escritura de publicación */}
          <span
            title={`Creado el ${fechaLarga(d.created_at)} · última escritura ${fechaLarga(d.finished_at)}`}
          >
            {fecha(d.created_at)}
          </span>
          <Button variant="ghost" disabled={revealMut.isPending} onClick={() => revealMut.mutate()}>
            Abrir la carpeta
          </Button>
        </div>
      </div>
    </li>
  );
}

export function Galeria({ entregas }: { entregas: Entregada[] }) {
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const abierta = entregas.find((d) => d.video_id === abiertaId);

  if (entregas.length === 0) {
    return (
      <EmptyState title="Nada pendiente de publicar">
        Cuando un vídeo termine de renderizar aparecerá aquí para su último visto bueno. No hay nada
        que hacer ahora mismo.
      </EmptyState>
    );
  }

  return (
    <>
      <ul className="galeria">
        {entregas.map((d) => (
          <Tarjeta key={d.video_id} d={d} onAbrir={() => setAbiertaId(d.video_id)} />
        ))}
      </ul>
      {abierta !== undefined ? (
        <FichaEntrega entrega={abierta} onClose={() => setAbiertaId(null)} />
      ) : null}
    </>
  );
}
