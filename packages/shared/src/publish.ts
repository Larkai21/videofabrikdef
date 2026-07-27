// Programación de publicación (S3): siguiente hueco del canal. Pura y
// compartida: la API la usa al aprobar la subida y el worker la reutiliza
// para revalidar un publish_at que quedó en el pasado esperando en cola.

export interface PublishSchedule {
  weekday: number;
  hour: number;
}

export function nextPublishSlot(schedule: PublishSchedule, from: Date): Date {
  const slot = new Date(from);
  slot.setHours(schedule.hour, 0, 0, 0);
  const dayDiff = (schedule.weekday - slot.getDay() + 7) % 7;
  slot.setDate(slot.getDate() + dayDiff);
  if (slot.getTime() <= from.getTime()) slot.setDate(slot.getDate() + 7);
  return slot;
}
