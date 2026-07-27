export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly label: string,
    readonly detail?: string,
  ) {
    super(detail ?? label);
  }
}

export const notFound = (detail: string) => new HttpError(404, 'no encontrado', detail);
export const conflict = (detail: string) => new HttpError(409, 'conflicto de estado', detail);
export const badRequest = (detail: string) => new HttpError(400, 'petición inválida', detail);
