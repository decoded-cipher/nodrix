// Transport-agnostic service errors. Service functions throw these; the HTTP
// routes map them to status codes and the MCP tools map them to JSON-RPC tool
// errors, so the same business logic serves both without either knowing about
// the other's wire format.

export type ServiceErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict';

const STATUS: Record<ServiceErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message?: string,
    public reason?: string
  ) {
    super(message ?? code);
    this.name = 'ServiceError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}
