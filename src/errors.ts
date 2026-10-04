export type ErrorCode =
  | 'E_DIMENSIONS'
  | 'E_PATTERN'
  | 'E_SAMPLE_COUNT'
  | 'E_NON_FINITE'
  | 'E_RANGE'
  | 'E_PARSE'
  | 'E_NO_NEIGHBORS'
  | 'E_NOT_FOUND'
  | 'E_CONFLICT'
  | 'E_PAGINATION'
  | 'E_VALIDATION'
  | 'E_INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}
