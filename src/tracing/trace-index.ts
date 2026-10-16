import { ValidationError } from "../errors";
import type { Fetcher } from "../utils/fetcher";
import type { RequestOptions } from "../types";
import type {
  JaegerResponse,
  JaegerTrace,
  TraceSearchParams,
} from "./types";

/** Jaeger-compatible trace queries for one index or index pattern. */
export class TraceIndex {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly indexIdPattern: string
  ) {}

  get id(): string {
    return this.indexIdPattern;
  }

  async listServices(options?: RequestOptions): Promise<string[]> {
    const response = await this.fetcher.get<JaegerResponse<string[]>>(
      `${this.basePath}/services`,
      options
    );
    return response.data;
  }

  async listOperations(service: string, options?: RequestOptions): Promise<string[]> {
    const response = await this.fetcher.get<JaegerResponse<string[]>>(
      `${this.basePath}/services/${encodeURIComponent(service)}/operations`,
      options
    );
    return response.data;
  }

  async search(params: TraceSearchParams = {}, options?: RequestOptions): Promise<JaegerTrace[]> {
    if (
      params.limit !== undefined
      && (!Number.isSafeInteger(params.limit) || params.limit < 0 || params.limit > 2_147_483_647)
    ) {
      throw new ValidationError("Trace limit must be a non-negative 32-bit integer", {
        fields: ["limit"],
      });
    }
    for (const field of ["start", "end"] as const) {
      const value = params[field];
      if (value !== undefined && !Number.isSafeInteger(value)) {
        throw new ValidationError(`${field} must be Unix epoch microseconds`, {
          fields: [field],
        });
      }
    }

    const response = await this.fetcher.get<JaegerResponse<JaegerTrace[]>>(
      `${this.basePath}/traces`,
      {
        ...options,
        params: {
          service: params.service,
          operation: params.operation,
          start: params.start,
          end: params.end,
          tags: params.tags === undefined ? undefined : JSON.stringify(params.tags),
          minDuration: params.minDuration,
          maxDuration: params.maxDuration,
          lookback: params.lookback,
          limit: params.limit,
        },
      }
    );
    return response.data;
  }

  async getTrace(traceId: string, options?: RequestOptions): Promise<JaegerTrace | undefined> {
    if (!/^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{32})$/.test(traceId)) {
      throw new ValidationError("Trace ID must be a 16- or 32-character hexadecimal string", {
        fields: ["traceId"],
      });
    }
    const response = await this.fetcher.get<JaegerResponse<JaegerTrace[]>>(
      `${this.basePath}/traces/${traceId}`,
      options
    );
    return response.data[0];
  }

  private get basePath(): string {
    return `/api/v1/${encodeURIComponent(this.indexIdPattern)}/jaeger/api`;
  }
}
