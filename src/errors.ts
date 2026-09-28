/**
 * Error codes for Quickwit client errors
 */
export enum QuickwitErrorCode {
  UNKNOWN = "UNKNOWN",
  CONNECTION_ERROR = "CONNECTION_ERROR",
  TIMEOUT = "TIMEOUT",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  BAD_REQUEST = "BAD_REQUEST",
  CONFLICT = "CONFLICT",
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}

/**
 * Additional error details from the API
 */
export interface ErrorDetails {
  /** Error message from the server */
  message?: string;

  /** Specific field that caused the error */
  field?: string;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Base error class for all Quickwit client errors
 */
export class QuickwitError extends Error {
  /** Error code for programmatic handling */
  readonly code: QuickwitErrorCode;

  /** HTTP status code (if applicable) */
  readonly status?: number;

  /** Additional error details */
  readonly details?: ErrorDetails;

  constructor(
    message: string,
    code: QuickwitErrorCode = QuickwitErrorCode.UNKNOWN,
    options?: {
      status?: number;
      details?: ErrorDetails;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "QuickwitError";
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, QuickwitError);
    }
  }

  /**
   * Returns a JSON representation of the error
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
    };
  }
}

/**
 * Error thrown when a network connection fails
 */
export class ConnectionError extends QuickwitError {
  constructor(message: string, cause?: Error) {
    super(message, QuickwitErrorCode.CONNECTION_ERROR, { cause });
    this.name = "ConnectionError";
  }
}

/**
 * Error thrown when a request times out
 */
export class TimeoutError extends QuickwitError {
  /** Timeout duration in milliseconds */
  readonly timeout: number;

  constructor(
    message: string,
    timeout: number,
    cause?: Error,
    status?: number,
    details?: ErrorDetails
  ) {
    super(message, QuickwitErrorCode.TIMEOUT, { cause, status, details });
    this.name = "TimeoutError";
    this.timeout = timeout;
  }
}

/**
 * Error thrown when request validation fails
 */
export class ValidationError extends QuickwitError {
  /** Fields that failed validation */
  readonly fields?: string[];

  constructor(
    message: string,
    options?: {
      fields?: string[];
      details?: ErrorDetails;
    }
  ) {
    super(message, QuickwitErrorCode.VALIDATION_ERROR, {
      status: 400,
      details: options?.details,
    });
    this.name = "ValidationError";
    this.fields = options?.fields;
  }
}

/**
 * Error thrown when a resource is not found (404)
 */
export class NotFoundError extends QuickwitError {
  /** Type of resource that was not found */
  readonly resourceType?: string;

  /** ID of the resource that was not found */
  readonly resourceId?: string;

  constructor(
    message: string,
    options?: {
      resourceType?: string;
      resourceId?: string;
      details?: ErrorDetails;
    }
  ) {
    super(message, QuickwitErrorCode.NOT_FOUND, {
      status: 404,
      details: options?.details,
    });
    this.name = "NotFoundError";
    this.resourceType = options?.resourceType;
    this.resourceId = options?.resourceId;
  }
}

/**
 * Error thrown when authentication fails (401)
 */
export class UnauthorizedError extends QuickwitError {
  constructor(message: string = "Unauthorized", details?: ErrorDetails) {
    super(message, QuickwitErrorCode.UNAUTHORIZED, { status: 401, details });
    this.name = "UnauthorizedError";
  }
}

/**
 * Error thrown when access is forbidden (403)
 */
export class ForbiddenError extends QuickwitError {
  constructor(message: string = "Forbidden", details?: ErrorDetails) {
    super(message, QuickwitErrorCode.FORBIDDEN, { status: 403, details });
    this.name = "ForbiddenError";
  }
}

/**
 * Creates an appropriate error instance based on HTTP status code
 */
export function createErrorFromStatus(
  status: number,
  message: string,
  details?: ErrorDetails
): QuickwitError {
  switch (status) {
    case 400:
      return new ValidationError(message, { details });
    case 401:
      return new UnauthorizedError(message, details);
    case 403:
      return new ForbiddenError(message, details);
    case 404:
      return new NotFoundError(message, { details });
    case 408:
      return new TimeoutError(message, 0, undefined, status, details);
    case 409:
      return new QuickwitError(message, QuickwitErrorCode.CONFLICT, {
        status,
        details,
      });
    case 429:
      return new QuickwitError(message, QuickwitErrorCode.TOO_MANY_REQUESTS, {
        status,
        details,
      });
    case 500:
      return new QuickwitError(message, QuickwitErrorCode.INTERNAL_SERVER_ERROR, {
        status,
        details,
      });
    case 503:
      return new QuickwitError(message, QuickwitErrorCode.SERVICE_UNAVAILABLE, {
        status,
        details,
      });
    default:
      return new QuickwitError(message, QuickwitErrorCode.UNKNOWN, {
        status,
        details,
      });
  }
}
