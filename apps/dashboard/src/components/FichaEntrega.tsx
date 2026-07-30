import type { InboxDto } from '@fabrica/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fileUrl, getVideo, revealVideoFolder } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { useToasts } from '../lib/toasts';
import { Button, useModalKeyboard } from './ui';

// La ficha completa de una entrega: el vídeo y, al lado, exactamente lo que hay
// que pegar en YouTube. Se abre desde la galería para no perder la bandeja de
// vista; la pantalla de entrega sigue existiendo para el trabajo largo
// (miniaturas, capítulos, subida).

type Entregada = InboxDto['done'][number];

function CampoCopiable({
  etiqueta,
  valor,
  multilinea = false,
}: {
  etiqueta: string;
  valor: string;
  multilinea?: boolean;
}) {
  const { push } = useToasts();
  return (
    <div className="ficha-campo">
      <div className="ficha-campo-cabecera">
        <span className="step-label">{etiqueta}</span>
        <Button
          variant="ghost"
          aria-label={`Copiar ${etiqueta.toLowerCase()}`}
          disabled={valor === ''}
          onClick={() => {
            void navigator.clipboard.writeText(valor).then(() => push(`${etiqueta} copiado`));
          }}
        >
          Copiar
        </Button>
      </div>
      <div className="ficha-campo-valor" data-multilinea={multilinea ? 'si' : 'no'}>
        {valor === '' ? <span className="muted">—</span> : valor}
      </div>
    </div>
  );
}

export function FichaEntrega({ entrega, onClose }: { entrega: Entregada; onClose: () => void }) {
  const { push } = useToasts();
  const boxRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  useModalKeyboard(true, boxRef, onClose, cerrarRef);

  // el título, la descripción y las etiquetas viven en el maestro, no en la
  // bandeja: se piden solo al abrir la ficha
  const videoQ = useQuery({
    queryKey: ['video', entrega.video_id],
    queryFn: () => getVideo(entrega.video_id),
  });

  const revealMut = useMutation({
    mutationFn: () => revealVideoFolder(entrega.video_id),
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo abrir la carpeta', 'danger'),
  });

  const seo = videoQ.data?.master.seo;
  const titulo = videoQ.data?.title_chosen ?? entrega.title;
  const etiquetas = seo?.tags.join(', ') ?? '';

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="ficha-entrega"
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha de «${entrega.title}»`}
      >
        <div className="ficha-entrega-media">
          {/* tabIndex explícito: la trampa de foco del modal no captura los
              controles nativos de <video> sin él. Y la URL se arma con el id,
              no con `output_dir`, que es una ruta absoluta de disco. */}
          <video
            className="ficha-entrega-video"
            src={fileUrl(`outputs/${entrega.video_id}/video.mp4`)}
            poster={entrega.thumbnail_url !== null ? fileUrl(entrega.thumbnail_url) : undefined}
            controls
            tabIndex={0}
          />
          <div className="ficha-entrega-datos mono">
            <span>
              {videoQ.data !== undefined
                ? `${fmtMoney(videoQ.data.costs_total)} de coste`
                : 'cargando el coste'}
            </span>
            <span>·</span>
            <span>{entrega.output_dir === '' ? 'sin carpeta' : entrega.output_dir}</span>
          </div>
        </div>

        <div className="ficha-entrega-lado">
          <div className="ficha-entrega-campos">
            {videoQ.isPending ? (
              <div className="muted fs-sm">Cargando el texto de publicación</div>
            ) : videoQ.isError ? (
              <div className="muted fs-sm">
                No se pudo cargar el texto de publicación. Ábrelo en la pantalla de entrega.
              </div>
            ) : (
              <>
                <CampoCopiable etiqueta="Título" valor={titulo} />
                <CampoCopiable etiqueta="Descripción" valor={seo?.description ?? ''} multilinea />
                <CampoCopiable etiqueta="Etiquetas" valor={etiquetas} />
              </>
            )}
          </div>

          <div className="ficha-entrega-pie">
            <Button
              variant="secondary"
              disabled={revealMut.isPending}
              onClick={() => revealMut.mutate()}
            >
              Abrir la carpeta
            </Button>
            <Link className="btn btn-secondary" to={`/videos/${entrega.video_id}/entrega`}>
              Ir a la entrega
            </Link>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" ref={cerrarRef} onClick={onClose} kbd="Esc">
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
