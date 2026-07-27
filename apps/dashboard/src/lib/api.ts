import {
  channelDtoSchema,
  inboxDtoSchema,
  ideaDtoSchema,
  stockSearchResultSchema,
  timelineDtoSchema,
  videoDetailDtoSchema,
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

export function fileUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `${API_URL}${path}`;
  return `${API_URL}/files/${path}`;
}
