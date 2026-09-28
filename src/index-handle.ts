import type { Fetcher } from "./utils/fetcher";
import type {
  SearchRequestParams,
  SearchResponse,
  BuiltQuery,
} from "./search/types";
import type {
  IngestOptions,
  IngestResponse,
  SourceConfig,
  SourceConfigRequest,
  UpdateSourceOptions,
  DeleteQueryRequest,
  DeleteTask,
} from "./types";
import { QueryBuilder } from "./search/query-builder";
import { toNDJSON } from "./utils/ndjson";
import { ValidationError } from "./errors";

// Quickwit's default commit_timeout_secs is 60s, and wait_for can block that long.
const WAIT_FOR_MIN_TIMEOUT_MS = 90_000;

/**
 * Handle for operations on a specific Quickwit index
 */
export class Index {
  private readonly fetcher: Fetcher;
  private readonly indexId: string;

  constructor(fetcher: Fetcher, indexId: string) {
    this.fetcher = fetcher;
    this.indexId = indexId;
  }

  /**
   * Get the index ID
   */
  get id(): string {
    return this.indexId;
  }

  /**
   * Create a new QueryBuilder for this index
   *
   * @param queryString - Optional initial query string
   * @returns A new QueryBuilder instance
   *
   * @example
   * ```typescript
   * const results = await index.search(
   *   index.query("error")
   *     .timeRange(startTs, endTs)
   *     .limit(20)
   * );
   * ```
   */
  query(queryString?: string): QueryBuilder {
    return new QueryBuilder(queryString);
  }

  /**
   * Execute a search query on this index
   *
   * @param query - Query parameters, QueryBuilder, or BuiltQuery
   * @returns Search response with hits and aggregations
   *
   * @example
   * ```typescript
   * // Simple string query
   * const results = await index.search("level:error");
   *
   * // Query parameters object
   * const results = await index.search({
   *   query: "level:error",
   *   max_hits: 10,
    *   sort_by: ["timestamp"],
   * });
   *
   * // Using QueryBuilder
   * const results = await index.search(
    *   index.query("error").limit(10).sortBy("timestamp", "desc")
   * );
   * ```
   */
  async search<T = Record<string, unknown>>(
    query?: string | SearchRequestParams | QueryBuilder | BuiltQuery
  ): Promise<SearchResponse<T>> {
    const params = this.normalizeQuery(query);
    const body: Record<string, unknown> = { ...params };
    delete body.search_fields;
    delete body.snippet_fields;
    if (params.search_fields !== undefined && params.search_fields.length > 0) {
      body.search_field = params.search_fields.join(",");
    }
    if (params.snippet_fields !== undefined && params.snippet_fields.length > 0) {
      body.snippet_fields = params.snippet_fields.join(",");
    }
    if (params.sort_by !== undefined) {
      body.sort_by = params.sort_by.join(",");
    }
    return this.fetcher.post<SearchResponse<T>>(
      `/api/v1/${encodeURIComponent(this.indexId)}/search`,
      body
    );
  }

  /**
   * Execute a search query and return only the hits
   *
   * @param query - Query parameters, QueryBuilder, or BuiltQuery
   * @returns Array of documents
   */
  async searchHits<T = Record<string, unknown>>(
    query?: string | SearchRequestParams | QueryBuilder | BuiltQuery
  ): Promise<T[]> {
    const response = await this.search<T>(query);
    return response.hits;
  }

  /**
   * Execute a search query and return the first hit
   *
   * @param query - Query parameters, QueryBuilder, or BuiltQuery
   * @returns First document or undefined if no hits
   */
  async searchFirst<T = Record<string, unknown>>(
    query?: string | SearchRequestParams | QueryBuilder | BuiltQuery
  ): Promise<T | undefined> {
    const response = await this.search<T>({ ...this.normalizeQuery(query), max_hits: 1 });
    return response.hits[0];
  }

  /**
   * Count documents matching a query
   *
   * @param query - Query string or parameters (defaults to "*" for all documents)
   * @returns Number of matching documents
   */
  async count(query?: string | SearchRequestParams | QueryBuilder | BuiltQuery): Promise<number> {
    const params = this.normalizeQuery(query);
    const response = await this.search({
      ...params,
      query: params.query || "*",
      max_hits: 0,
      count_all: true,
    });
    return response.num_hits;
  }

  /**
   * Ingest documents into this index
   *
   * @param documents - Array of documents to ingest
   * @param options - Ingest options (commit mode)
   * @returns Ingest response with number of documents queued
   *
   * @example
   * ```typescript
   * // Ingest with auto commit (default)
   * const result = await index.ingest([
   *   { timestamp: Date.now(), level: "info", message: "Hello" },
   *   { timestamp: Date.now(), level: "error", message: "Something failed" }
   * ]);
   *
   * // Ingest with forced commit (documents immediately searchable)
   * const result = await index.ingest(documents, { commit: "force" });
   * ```
   */
  async ingest<T extends object>(
    documents: readonly T[],
    options?: IngestOptions
  ): Promise<IngestResponse> {
    if (documents.length === 0) {
      throw new ValidationError("Cannot ingest empty document array", {
        fields: ["documents"],
      });
    }

    let ndjsonBody: string;
    try {
      ndjsonBody = toNDJSON(documents);
    } catch (error) {
      throw new ValidationError(
        `Failed to serialize documents: ${error instanceof Error ? error.message : String(error)}`,
        { fields: ["documents"] }
      );
    }
    const path = `/api/v1/${encodeURIComponent(this.indexId)}/ingest`;

    const params: Record<string, string | boolean> = {};
    if (options?.commit) {
      params.commit = options.commit;
    }
    if (options?.detailed_response !== undefined) {
      params.detailed_response = options.detailed_response;
    }

    const waitForTimeout = options?.commit === "wait_for"
      ? Math.max(this.fetcher.defaultTimeout, WAIT_FOR_MIN_TIMEOUT_MS)
      : undefined;
    return this.fetcher.postNDJSON<IngestResponse>(path, ndjsonBody, {
      params,
      timeout: options?.timeout ?? waitForTimeout,
    });
  }

  /**
   * Create a new source for this index
   *
   * @param config - Source configuration
   * @returns Created source configuration
   */
  async createSource(config: SourceConfigRequest): Promise<SourceConfig> {
    return this.fetcher.post<SourceConfig>(
      `/api/v1/indexes/${encodeURIComponent(this.indexId)}/sources`,
      config
    );
  }

  /**
   * Update an existing source configuration
   *
   * @param sourceId - The source ID to update
   * @param config - New source configuration
   * @param options - Update options
   * @returns Updated source configuration
   */
  async updateSource(
    sourceId: string,
    config: SourceConfigRequest,
    options?: UpdateSourceOptions
  ): Promise<SourceConfig> {
    const params: Record<string, string | boolean | undefined> = {};
    if (options?.create !== undefined) {
      params.create = options.create;
    }
    return this.fetcher.put<SourceConfig>(
      `/api/v1/indexes/${encodeURIComponent(this.indexId)}/sources/${encodeURIComponent(sourceId)}`,
      config,
      { params }
    );
  }

  /**
   * Delete a source from this index
   *
   * @param sourceId - The source ID to delete
   */
  async deleteSource(sourceId: string): Promise<void> {
    await this.fetcher.delete(
      `/api/v1/indexes/${encodeURIComponent(this.indexId)}/sources/${encodeURIComponent(sourceId)}`
    );
  }

  /**
   * Reset the checkpoint for a source, causing it to re-process from the beginning
   *
   * @param sourceId - The source ID to reset
   */
  async resetSourceCheckpoint(sourceId: string): Promise<void> {
    await this.fetcher.put(
      `/api/v1/indexes/${encodeURIComponent(this.indexId)}/sources/${encodeURIComponent(sourceId)}/reset-checkpoint`
    );
  }

  /**
   * Enable or disable a source
   *
   * @param sourceId - The source ID to toggle
   * @param enable - Whether to enable (true) or disable (false) the source
   */
  async toggleSource(sourceId: string, enable: boolean): Promise<void> {
    await this.fetcher.put(
      `/api/v1/indexes/${encodeURIComponent(this.indexId)}/sources/${encodeURIComponent(sourceId)}/toggle`,
      { enable }
    );
  }

  /** Queue deletion of documents matching a query. */
  async createDeleteTask(request: DeleteQueryRequest): Promise<DeleteTask> {
    const body: Record<string, unknown> = { ...request };
    delete body.search_fields;
    if (request.search_fields !== undefined) {
      body.search_field = [...request.search_fields];
    }
    return this.fetcher.post<DeleteTask>(
      `/api/v1/${encodeURIComponent(this.indexId)}/delete-tasks`,
      body
    );
  }

  /** List queued and completed delete tasks for this index. */
  async listDeleteTasks(): Promise<DeleteTask[]> {
    return this.fetcher.get<DeleteTask[]>(
      `/api/v1/${encodeURIComponent(this.indexId)}/delete-tasks`
    );
  }

  private normalizeQuery(
    query?: string | SearchRequestParams | QueryBuilder | BuiltQuery
  ): SearchRequestParams {
    if (query === undefined) {
      return { query: "*" };
    }
    if (typeof query === "string") {
      return { query };
    }
    const params = query instanceof QueryBuilder
      ? query.build().params
      : "params" in query
      ? query.params
      : query;
    return { ...params, query: params.query ?? "*" };
  }
}
