import type { QuickwitConfig, HttpMethod } from "../types";
import {
  QuickwitError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  createErrorFromStatus,
  type ErrorDetails,
} from "../errors";

/**
 * Options for a single fetch request
 */
export interface FetchOptions {
  /** HTTP method */
  method?: HttpMethod;

  /** Request body (will be JSON stringified) */
  body?: unknown;

  /** Raw body (sent as-is, takes precedence over body) */
  rawBody?: string | Uint8Array | ArrayBuffer;

  /** Additional headers for this request */
  headers?: Record<string, string>;

  /** Override timeout for this request */
  timeout?: number;

  /** Query parameters */
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * HTTP client wrapper with authentication, timeout, and error handling
 */
export class Fetcher {
  private readonly endpoint: string;
  private readonly defaultHeaders: Record<string, string>;
  readonly defaultTimeout: number;

  constructor(config: QuickwitConfig) {
    // Normalize endpoint while preserving any reverse-proxy path prefix.
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.defaultTimeout = config.timeout ?? 30000;

    // Build default headers
    this.defaultHeaders = {
      Accept: "application/json",
      ...config.headers,
    };

    // Add authentication headers
    if (config.apiKey) {
      this.defaultHeaders["X-API-Key"] = config.apiKey;
    }
    if (config.bearerToken) {
      this.defaultHeaders["Authorization"] = `Bearer ${config.bearerToken}`;
    }
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(path: string, params?: FetchOptions["params"]): string {
    // encodeURIComponent keeps "." and "..", and URL resolution would collapse them into
    // another route: deleteSource("..") would become the delete-index endpoint.
    if (path.split("/").some((segment) => segment === "." || segment === "..")) {
      throw new ValidationError(`Path segment "." or ".." is not allowed: ${path}`);
    }

    const url = new URL(path.replace(/^\/+/, ""), `${this.endpoint}/`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Parse error response body
   */
  private async parseErrorBody(response: Response): Promise<ErrorDetails> {
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        return {
          message: json.message || json.error || text,
          context: json,
        };
      } catch {
        return { message: text };
      }
    } catch {
      return { message: response.statusText };
    }
  }

  /**
   * Perform a fetch request with error handling
   */
  async fetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const { method = "GET", body, rawBody, headers = {}, timeout, params } = options;
    const requestTimeout = timeout ?? this.defaultTimeout;
    let url = this.endpoint;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      url = this.buildUrl(path, params);
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), requestTimeout);

      const requestBody = rawBody instanceof Uint8Array
        ? Uint8Array.from(rawBody).buffer
        : rawBody !== undefined
        ? rawBody
        : (body !== undefined ? JSON.stringify(body) : undefined);
      const requestHeaders: Record<string, string> = {
        ...this.defaultHeaders,
        ...headers,
      };
      if (body !== undefined && rawBody === undefined && requestHeaders["Content-Type"] === undefined) {
        requestHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });

      // Handle non-OK responses
      if (!response.ok) {
        const details = await this.parseErrorBody(response);
        throw createErrorFromStatus(
          response.status,
          details.message || `HTTP ${response.status}: ${response.statusText}`,
          details
        );
      }

      const responseText = await response.text();
      if (responseText.length === 0) {
        return undefined as T;
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return JSON.parse(responseText) as T;
      }
      return responseText as T;
    } catch (error) {
      // Handle abort (timeout)
      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(
          `Request to ${url} timed out after ${requestTimeout}ms`,
          requestTimeout
        );
      }

      // Re-throw QuickwitError instances
      if (error instanceof QuickwitError) {
        throw error;
      }

      // Handle network errors
      if (error instanceof TypeError) {
        throw new ConnectionError(
          `Failed to connect to ${this.endpoint}: ${error.message}`,
          error
        );
      }

      // Unknown errors
      throw new QuickwitError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { cause: error instanceof Error ? error : undefined }
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Perform a GET request
   */
  async get<T>(
    path: string,
    options?: Omit<FetchOptions, "method" | "body">
  ): Promise<T> {
    return this.fetch<T>(path, { ...options, method: "GET" });
  }

  /**
   * Perform a POST request
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: Omit<FetchOptions, "method" | "body">
  ): Promise<T> {
    return this.fetch<T>(path, { ...options, method: "POST", body });
  }

  /**
   * Perform a PUT request
   */
  async put<T>(
    path: string,
    body?: unknown,
    options?: Omit<FetchOptions, "method" | "body">
  ): Promise<T> {
    return this.fetch<T>(path, { ...options, method: "PUT", body });
  }

  /**
   * Perform a DELETE request
   */
  async delete<T>(
    path: string,
    options?: Omit<FetchOptions, "method" | "body">
  ): Promise<T> {
    return this.fetch<T>(path, { ...options, method: "DELETE" });
  }

  /**
   * Perform a POST request with NDJSON body
   *
   * @param path - API path
   * @param ndjsonBody - Pre-serialized NDJSON string
   * @param options - Additional fetch options
   */
  async postNDJSON<T>(
    path: string,
    ndjsonBody: string,
    options?: Omit<FetchOptions, "method" | "body" | "rawBody">
  ): Promise<T> {
    return this.fetch<T>(path, {
      ...options,
      method: "POST",
      rawBody: ndjsonBody,
      headers: {
        ...options?.headers,
        "Content-Type": "application/x-ndjson",
      },
    });
  }

  /** Perform a POST request with an arbitrary raw body. */
  async postRaw<T>(
    path: string,
    rawBody: string | Uint8Array | ArrayBuffer,
    options?: Omit<FetchOptions, "method" | "body" | "rawBody">
  ): Promise<T> {
    return this.fetch<T>(path, {
      ...options,
      method: "POST",
      rawBody,
    });
  }

  /**
   * Get the base endpoint URL
   */
  getEndpoint(): string {
    return this.endpoint;
  }
}
