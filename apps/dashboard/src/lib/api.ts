import {
  channelDtoSchema,
  inboxDtoSchema,
  ideaDtoSchema,
  stockSearchResultSchema,
  thumbnailBriefSchema,
  timelineDtoSchema,
  videoDetailDtoSchema,
  type ThumbnailBrief,
  type BeatActionRequest,
  type ChannelDto,
  type ChannelProfile,
  type IdeaDto,
  type InboxDto,
  type ScriptEditRequest,
  type StockSearchResult,
  type TimelineDto,
  type VideoDetailDto,
  type WizardRequest,
} from '@fabrica/shared';
// import aparte para no tocar el bloque anterior (hay agentes en paralelo)
import {
  channelSettingsSchema,
  type ChannelSettings,
  type ChannelSettingsUpdate,
  type DesignTokens,
} from '@fabrica/shared';

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let message = `Error ${res.status} de la API`;
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      if (typeof body.error === 'string') message = body.error;
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // cuerpo no JSON: nos quedamos con el mensaje genérico
    }
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return null;
  return (await res.json()) as unknown;
}

function post(path: string, body?: unknown): Promise<unknown> {
  return request(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function put(path: string, body: unknown): Promise<unknown> {
  return request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patch(path: string, body: unknown): Promise<unknown> {
  return request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// La API puede devolver la lista directamente o envuelta en { <key>: [...] }.
function unwrapList(data: unknown, key: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const inner = (data as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

// ---- bandeja ----

export async function getInbox(): Promise<InboxDto> {
  return inboxDtoSchema.parse(await request('/inbox'));
}

// ---- costes ----
import { costsDtoSchema, type CostsDto } from '@fabrica/shared';

export async function getCosts(
  filters: {
    channel?: string | null;
    video?: string;
    month?: string;
  } = {},
): Promise<CostsDto> {
  const params = new URLSearchParams();
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.video) params.set('video', filters.video);
  if (filters.month) params.set('month', filters.month);
  const qs = params.toString();
  return costsDtoSchema.parse(await request(qs === '' ? '/costs' : `/costs?${qs}`));
}

// ---- canales ----

export async function getChannels(): Promise<ChannelDto[]> {
  const data = await request('/channels');
  return channelDtoSchema.array().parse(unwrapList(data, 'channels'));
}

export async function getChannel(id: string): Promise<ChannelDto> {
  return channelDtoSchema.parse(await request(`/channels/${id}`));
}

export async function postWizard(body: WizardRequest): Promise<{ id: string }> {
  const data = await post('/channels/wizard', body);
  const parsed = channelDtoSchema.safeParse(data);
  if (parsed.success) return { id: parsed.data.id };
  const loose = data as { id?: string; channel_id?: string } | null;
  const id = loose?.id ?? loose?.channel_id;
  if (typeof id !== 'string') {
    throw new ApiError(500, 'La respuesta del wizard no incluye el id del canal');
  }
  return { id };
}

export async function putProfile(
  id: string,
  profile: ChannelProfile,
  _approved = true,
): Promise<void> {
  // la API recibe el perfil como cuerpo y marca profile_approved al guardarlo
  await put(`/channels/${id}/profile`, profile);
}

// design system: guarda solo los tokens (colores/tipografía) del canal y
// devuelve el canal actualizado
export async function putDesign(id: string, design: DesignTokens): Promise<ChannelDto> {
  return channelDtoSchema.parse(await patch(`/channels/${id}/design`, design));
}

// avatar/personaje: subida directa; devuelve el canal con avatar_url nuevo
export async function uploadAvatar(id: string, file: File): Promise<ChannelDto> {
  const form = new FormData();
  form.append('file', file);
  return channelDtoSchema.parse(
    await request(`/channels/${id}/avatar`, { method: 'POST', body: form }),
  );
}

// settings del canal (presupuesto, duración objetivo, música de fondo…)
export async function getSettings(id: string): Promise<ChannelSettings> {
  return channelSettingsSchema.parse(await request(`/channels/${id}/settings`));
}

export async function putSettings(
  id: string,
  patch: ChannelSettingsUpdate,
): Promise<ChannelSettings> {
  return channelSettingsSchema.parse(await put(`/channels/${id}/settings`, patch));
}

// packaging primero: con el título confirmado, encarga la escritura del guion
export async function writeScript(videoId: string): Promise<void> {
  await post(`/videos/${videoId}/write-script`);
}

// ---- ideas ----

export async function getIdeas(status = 'new'): Promise<IdeaDto[]> {
  const data = await request(`/ideas?status=${encodeURIComponent(status)}`);
  return ideaDtoSchema.array().parse(unwrapList(data, 'ideas'));
}

export async function approveIdea(id: string): Promise<{ video_id: string | null }> {
  const data = await post(`/ideas/${id}/approve`);
  const loose = data as { video_id?: string; id?: string } | null;
  return { video_id: loose?.video_id ?? null };
}

export async function discardIdea(id: string, reason: string): Promise<void> {
  await post(`/ideas/${id}/discard`, { reason });
}

// ---- vídeos ----

export async function getVideo(id: string): Promise<VideoDetailDto> {
  return videoDetailDtoSchema.parse(await request(`/videos/${id}`));
}

export async function putScript(id: string, body: ScriptEditRequest): Promise<void> {
  await put(`/videos/${id}/script`, body);
}

export async function chooseTitle(id: string, chosenIdx: number): Promise<void> {
  await post(`/videos/${id}/title`, { chosen_idx: chosenIdx });
}

export async function approveScript(id: string): Promise<void> {
  await post(`/videos/${id}/approve-script`);
}

export async function requestRewrite(id: string, reason: string): Promise<void> {
  await post(`/videos/${id}/rewrite`, { reason });
}

// ---- timeline ----

export async function getTimeline(id: string): Promise<TimelineDto> {
  return timelineDtoSchema.parse(await request(`/videos/${id}/timeline`));
}

export async function beatAction(
  videoId: string,
  idx: number,
  body: BeatActionRequest,
): Promise<void> {
  await post(`/videos/${videoId}/beats/${idx}`, body);
}

export async function approveTimeline(id: string): Promise<void> {
  await post(`/videos/${id}/approve-timeline`);
}

// Quita efectos de edición (por índice) durante la curación; devuelve los que quedan.
export async function removeEdits(id: string, remove: number[]): Promise<void> {
  await patch(`/videos/${encodeURIComponent(id)}/edits`, { remove });
}

export async function searchStock(
  q: string,
  videoId?: string,
  beatIdx?: number,
): Promise<StockSearchResult> {
  const params = new URLSearchParams({ q });
  if (videoId !== undefined) params.set('video', videoId);
  if (beatIdx !== undefined) params.set('beat', String(beatIdx));
  return stockSearchResultSchema.parse(await request(`/stock/search?${params.toString()}`));
}

export async function uploadToLibrary(input: {
  file: File;
  channelId: string;
  videoId?: string;
  beatIdx?: number;
}): Promise<void> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('channel_id', input.channelId);
  if (input.videoId !== undefined) form.append('video_id', input.videoId);
  if (input.beatIdx !== undefined) form.append('beat_idx', String(input.beatIdx));
  await request('/library/upload', { method: 'POST', body: form });
}

// ---- ficheros servidos por la API (/files) ----

// ---- biblioteca etiquetada (S2) ----
// import local a la sección para no tocar la cabecera del módulo
import { libraryListDtoSchema, type LibraryListDto } from '@fabrica/shared';

export interface LibraryFilters {
  kind?: string;
  q?: string;
  channel?: string;
  purge?: boolean;
  favorite?: boolean;
  limit?: number;
  offset?: number;
}

export async function getLibrary(filters: LibraryFilters = {}): Promise<LibraryListDto> {
  const params = new URLSearchParams();
  if (filters.kind !== undefined && filters.kind !== '') params.set('kind', filters.kind);
  if (filters.q !== undefined && filters.q !== '') params.set('q', filters.q);
  if (filters.channel !== undefined && filters.channel !== '')
    params.set('channel', filters.channel);
  if (filters.purge === true) params.set('purge', 'true');
  if (filters.favorite === true) params.set('favorite', 'true');
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return libraryListDtoSchema.parse(await request(qs === '' ? '/library' : `/library?${qs}`));
}

export async function deleteAsset(id: string): Promise<void> {
  await request(`/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Marca/desmarca un asset como favorito; devuelve el nuevo estado. */
export async function toggleFavorite(id: string): Promise<boolean> {
  const data = await request(`/library/${encodeURIComponent(id)}/favorite`, { method: 'PATCH' });
  return (data as { favorite?: unknown }).favorite === true;
}

export async function requestBackfill(): Promise<void> {
  await post('/library/backfill');
}

export function fileUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `${API_URL}${path}`;
  return `${API_URL}/files/${path}`;
}

// ---- componentes del brand kit (S2) ----
// import local a la sección para no tocar la cabecera del módulo
import { componentDtoSchema, type ComponentDto } from '@fabrica/shared';

export async function getComponents(channelId: string): Promise<ComponentDto[]> {
  const data = await request(`/components?channel=${encodeURIComponent(channelId)}`);
  return componentDtoSchema.array().parse(unwrapList(data, 'components'));
}

// Prompt de diseño (SPEC §10): el "prompt-contrato" por tipo para diseñar el
// componente con Claude Design, con los tokens de marca del canal.
export async function getComponentPrompt(channelId: string, type: string): Promise<string> {
  const data = await request(
    `/components/prompt?channel=${encodeURIComponent(channelId)}&type=${encodeURIComponent(type)}`,
  );
  const prompt = (data as { prompt?: unknown }).prompt;
  if (typeof prompt !== 'string') throw new Error('Respuesta de prompt inválida');
  return prompt;
}

export async function uploadComponent(input: { file: File; channelId: string }): Promise<void> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('channel_id', input.channelId);
  await request('/components', { method: 'POST', body: form });
}

export async function activateComponent(id: string): Promise<void> {
  await post(`/components/${encodeURIComponent(id)}/activate`);
}

// activa un componente INTEGRADO (built-in) por ref para el canal
export async function activateBuiltin(channel: string, type: string, ref: string): Promise<void> {
  await post('/components/activate-ref', { channel, type, ref });
}

export async function deleteComponent(id: string): Promise<void> {
  await request(`/components/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Regenera la preview (mp4 animado + still de frame medio) de un componente ya
// validado, re-encolando su validación.
export async function revalidateComponent(id: string): Promise<void> {
  await post(`/components/${encodeURIComponent(id)}/revalidate`);
}

// Autoría por IA (Fase 4): encola la generación de uno o todos los tipos.
// Sin type (o 'all') genera todas las animaciones que la composición monta.
export async function authorComponents(
  channelId: string,
  type?: string,
): Promise<{ enqueued: string[] }> {
  const data = await post('/components/author', {
    channel: channelId,
    ...(type !== undefined ? { type } : {}),
  });
  const enqueued = (data as { enqueued?: unknown }).enqueued;
  return { enqueued: Array.isArray(enqueued) ? (enqueued as string[]) : [] };
}

// ---- publicación en YouTube (S3) ----
// El estado de la publicación de un vídeo llega dentro de videoDetailDtoSchema
// (campo youtube, esquema de shared). Los endpoints de conexión OAuth aún no
// tienen esquema en @fabrica/shared y el dashboard no depende de zod: se
// valida a mano hasta que el dueño de shared publique youtubeStatusDtoSchema.

export interface PublishScheduleDto {
  weekday: number; // 0=domingo … 6=sábado
  hour: number; // 0–23, hora local del servidor
}

export interface YoutubeStatusDto {
  connected: boolean;
  channel_title?: string;
  connected_at?: string;
  oauth_configured: boolean;
  provider: string;
  publish_schedule: PublishScheduleDto | null;
}

function parsePublishSchedule(value: unknown): PublishScheduleDto | null {
  if (value === null || value === undefined) return null;
  const raw = value as { weekday?: unknown; hour?: unknown };
  if (typeof raw.weekday !== 'number' || typeof raw.hour !== 'number') return null;
  return { weekday: raw.weekday, hour: raw.hour };
}

export async function getYoutubeStatus(channelId: string): Promise<YoutubeStatusDto> {
  const data = await request(`/youtube/status?channel=${encodeURIComponent(channelId)}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  if (typeof raw.connected !== 'boolean' || typeof raw.oauth_configured !== 'boolean') {
    throw new ApiError(500, 'Respuesta inesperada de /youtube/status');
  }
  return {
    connected: raw.connected,
    ...(typeof raw.channel_title === 'string' ? { channel_title: raw.channel_title } : {}),
    ...(typeof raw.connected_at === 'string' ? { connected_at: raw.connected_at } : {}),
    oauth_configured: raw.oauth_configured,
    provider: typeof raw.provider === 'string' ? raw.provider : 'mock',
    publish_schedule: parsePublishSchedule(raw.publish_schedule),
  };
}

export async function getYoutubeAuthUrl(channelId: string): Promise<string> {
  const data = await request(`/youtube/auth-url?channel=${encodeURIComponent(channelId)}`);
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') {
    throw new ApiError(500, 'La respuesta de /youtube/auth-url no incluye la URL');
  }
  return url;
}

export async function disconnectYoutube(channelId: string): Promise<void> {
  await request(`/youtube/connection?channel=${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
  });
}

export async function putPublishSchedule(
  channelId: string,
  schedule: PublishScheduleDto | null,
): Promise<void> {
  await put('/youtube/schedule', { channel: channelId, schedule });
}

export async function publishToYoutube(videoId: string): Promise<{ publish_at: string | null }> {
  const data = await post(`/videos/${videoId}/publish`);
  const publishAt = (data as { publish_at?: unknown } | null)?.publish_at;
  return { publish_at: typeof publishAt === 'string' ? publishAt : null };
}

// ---- radar de ideas (búsqueda manual + orden del ranking) ----
import { sourceDtoSchema, type SourceDto } from '@fabrica/shared';

export async function getSources(channel: string): Promise<SourceDto[]> {
  const data = await request(`/sources?channel=${encodeURIComponent(channel)}`);
  return sourceDtoSchema.array().parse(data);
}

export async function pollSources(channel: string): Promise<{ enqueued: number }> {
  return (await post('/sources/poll', { channel })) as { enqueued: number };
}

export async function orderIdeas(channel: string, ids: string[]): Promise<void> {
  await put('/ideas/order', { channel, ids });
}

// ---- entregables en disco ----

/** URL de descarga del MP4 final (attachment: el navegador abre el diálogo de guardado). */
export function videoDownloadUrl(videoId: string): string {
  return `${API_URL}/videos/${encodeURIComponent(videoId)}/download`;
}

/** Abre outputs/<id> en el gestor de archivos de la máquina donde corre la API. */
export async function revealVideoFolder(videoId: string): Promise<void> {
  await post(`/videos/${encodeURIComponent(videoId)}/reveal`);
}

// ---- miniatura: brief de alta conversión + subida ----

// Lee el brief ya generado (outputs/<id>/thumbnail-brief.json). null si aún no
// existe (nunca se generó o el vídeo es previo a la función).
export async function getThumbnailBrief(videoId: string): Promise<ThumbnailBrief | null> {
  const res = await fetch(fileUrl(`/files/outputs/${videoId}/thumbnail-brief.json`));
  if (!res.ok) return null;
  try {
    return thumbnailBriefSchema.parse(await res.json());
  } catch {
    return null;
  }
}

// Encola la (re)generación del brief de miniatura.
export async function requestThumbnailBrief(videoId: string): Promise<void> {
  await post(`/videos/${encodeURIComponent(videoId)}/thumbnail-brief`);
}

// Sube la miniatura definitiva; pasa a ser la oficial. Devuelve su URL /files.
export async function uploadThumbnail(videoId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const data = await request(`/videos/${encodeURIComponent(videoId)}/thumbnail`, {
    method: 'POST',
    body: form,
  });
  const url = (data as { thumbnail_url?: unknown }).thumbnail_url;
  return typeof url === 'string' ? url : '';
}

// ---- multicanal ----
// Variantes con canal de getInbox/getIdeas: las firmas originales quedan
// intactas (Entrega.tsx pasa getInbox como queryFn directa). Aceptan null
// (canal activo aún sin resolver) y con él devuelven el agregado completo.
// El resto de endpoints ya aceptaban canal: getLibrary vía
// LibraryFilters.channel, getComponents/getSettings por id explícito.

export async function getInboxFor(channel?: string | null): Promise<InboxDto> {
  const qs =
    channel !== undefined && channel !== null && channel !== ''
      ? `?channel=${encodeURIComponent(channel)}`
      : '';
  return inboxDtoSchema.parse(await request(`/inbox${qs}`));
}

export async function getIdeasFor(status = 'new', channel?: string | null): Promise<IdeaDto[]> {
  const params = new URLSearchParams({ status });
  if (channel !== undefined && channel !== null && channel !== '') {
    params.set('channel', channel);
  }
  const data = await request(`/ideas?${params.toString()}`);
  return ideaDtoSchema.array().parse(unwrapList(data, 'ideas'));
}
