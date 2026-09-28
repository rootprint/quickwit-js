import { test, expect, describe, afterEach } from "bun:test";
import {
  QuickwitClient,
  QueryBuilder,
  AggregationBuilder,
  QuickwitError,
  QuickwitErrorCode,
  ConnectionError,
  TimeoutError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  createErrorFromStatus,
  isFastFieldEnabled,
} from "../src";
import type { FieldMapping } from "../src";
import { toNDJSON } from "../src/utils/ndjson";

// ============================================================================
// QueryBuilder Tests
// ============================================================================

describe("QueryBuilder", () => {
  test("creates empty query with no params", () => {
    const builder = new QueryBuilder();
    const result = builder.build();

    expect(result.params).toEqual({});
    expect(result.requiresPost).toBe(false);
  });

  test("accepts initial query string in constructor", () => {
    const builder = new QueryBuilder("level:error");
    const result = builder.build();

    expect(result.params.query).toBe("level:error");
  });

  test("sets query string via method", () => {
    const builder = new QueryBuilder().query("level:error");
    const result = builder.build();

    expect(result.params.query).toBe("level:error");
  });

  test("sets limit", () => {
    const builder = new QueryBuilder().limit(50);
    const result = builder.build();

    expect(result.params.max_hits).toBe(50);
  });

  test("sets offset", () => {
    const builder = new QueryBuilder().offset(100);
    const result = builder.build();

    expect(result.params.start_offset).toBe(100);
  });

  test("throws ValidationError for negative limit", () => {
    expect(() => new QueryBuilder().limit(-1)).toThrow(ValidationError);
  });

  test("throws ValidationError for negative offset", () => {
    expect(() => new QueryBuilder().offset(-1)).toThrow(ValidationError);
  });

  test("sets search fields", () => {
    const builder = new QueryBuilder().searchFields("title", "body", "tags");
    const result = builder.build();

    expect(result.params.search_fields).toEqual(["title", "body", "tags"]);
  });

  test("sets snippet fields", () => {
    const builder = new QueryBuilder().snippetFields("title", "body");
    const result = builder.build();

    expect(result.params.snippet_fields).toEqual(["title", "body"]);
  });

  test("sets time range with timestamps", () => {
    const builder = new QueryBuilder().timeRange(1000, 2000);
    const result = builder.build();

    expect(result.params.start_timestamp).toBe(1000);
    expect(result.params.end_timestamp).toBe(2000);
  });

  test("sets time range with Date objects", () => {
    const start = new Date("2024-01-01T00:00:00Z");
    const end = new Date("2024-01-02T00:00:00Z");
    const builder = new QueryBuilder().dateRange(start, end);
    const result = builder.build();

    expect(result.params.start_timestamp).toBe(Math.floor(start.getTime() / 1000));
    expect(result.params.end_timestamp).toBe(Math.floor(end.getTime() / 1000));
  });

  test("sets sort with field and order", () => {
    const builder = new QueryBuilder().sortBy("timestamp", "desc");
    const result = builder.build();

    expect(result.params.sort_by).toEqual(["timestamp"]);
  });

  test("sets ascending sort with shorthand (prefix -)", () => {
    const builder = new QueryBuilder().sortBy("-timestamp");
    const result = builder.build();

    expect(result.params.sort_by).toEqual(["-timestamp"]);
  });

  test("sets sort ascending", () => {
    const builder = new QueryBuilder().sortBy("timestamp", "asc");
    const result = builder.build();

    expect(result.params.sort_by).toEqual(["-timestamp"]);
  });

  test("sets countAll", () => {
    const builder = new QueryBuilder().countAll();
    const result = builder.build();

    expect(result.params.count_all).toBe(true);
  });

  test("sets allowFailedSplits", () => {
    const builder = new QueryBuilder().allowFailedSplits();
    const result = builder.build();

    expect(result.params.allow_failed_splits).toBe(true);
  });

  test("sets allowFailedSplits to false", () => {
    const builder = new QueryBuilder().allowFailedSplits(false);
    const result = builder.build();

    expect(result.params.allow_failed_splits).toBe(false);
  });

  test("adds single aggregation", () => {
    const builder = new QueryBuilder().agg(
      "by_level",
      AggregationBuilder.terms("level")
    );
    const result = builder.build();

    expect(result.params.aggs).toHaveProperty("by_level");
    expect(result.requiresPost).toBe(true);
  });

  test("adds multiple aggregations", () => {
    const builder = new QueryBuilder().aggs({
      by_level: AggregationBuilder.terms("level"),
      avg_time: AggregationBuilder.avg("response_time"),
    });
    const result = builder.build();

    expect(Object.keys(result.params.aggs!)).toHaveLength(2);
    expect(result.requiresPost).toBe(true);
  });

  test("chains all methods fluently", () => {
    const builder = new QueryBuilder()
      .query("error")
      .limit(20)
      .offset(10)
      .searchFields("message")
      .snippetFields("message")
      .timeRange(1000, 2000)
      .sortBy("-timestamp")
      .countAll()
      .agg("by_level", AggregationBuilder.terms("level"));

    const result = builder.build();

    expect(result.params.query).toBe("error");
    expect(result.params.max_hits).toBe(20);
    expect(result.params.start_offset).toBe(10);
    expect(result.params.search_fields).toEqual(["message"]);
    expect(result.params.snippet_fields).toEqual(["message"]);
    expect(result.params.start_timestamp).toBe(1000);
    expect(result.params.end_timestamp).toBe(2000);
    expect(result.params.sort_by).toEqual(["-timestamp"]);
    expect(result.params.count_all).toBe(true);
    expect(result.params.aggs).toHaveProperty("by_level");
    expect(result.requiresPost).toBe(true);
  });

  test("clones builder correctly", () => {
    const original = new QueryBuilder()
      .query("error")
      .limit(20)
      .agg("by_level", AggregationBuilder.terms("level"));

    const cloned = original.clone().query("warning").limit(50);

    const originalResult = original.build();
    const clonedResult = cloned.build();

    expect(originalResult.params.query).toBe("error");
    expect(originalResult.params.max_hits).toBe(20);
    expect(clonedResult.params.query).toBe("warning");
    expect(clonedResult.params.max_hits).toBe(50);
  });

  test("toParams returns params directly", () => {
    const builder = new QueryBuilder().query("error").limit(10);
    const params = builder.toParams();

    expect(params.query).toBe("error");
    expect(params.max_hits).toBe(10);
  });
});

// ============================================================================
// AggregationBuilder Tests
// ============================================================================

describe("AggregationBuilder", () => {
  describe("terms", () => {
    test("creates basic terms aggregation", () => {
      const agg = AggregationBuilder.terms("level");

      expect(agg).toEqual({
        terms: { field: "level" },
      });
    });

    test("creates terms aggregation with options", () => {
      const agg = AggregationBuilder.terms("level", {
        size: 20,
        minDocCount: 5,
        order: { _count: "desc" },
        missing: "unknown",
      });

      expect(agg.terms.field).toBe("level");
      expect(agg.terms.size).toBe(20);
      expect(agg.terms.min_doc_count).toBe(5);
      expect(agg.terms.order).toEqual({ _count: "desc" });
      expect(agg.terms.missing).toBe("unknown");
    });

    test("creates terms aggregation with nested aggs", () => {
      const agg = AggregationBuilder.terms("level", {
        aggs: {
          avg_time: AggregationBuilder.avg("response_time"),
        },
      });

      expect(agg.aggs).toHaveProperty("avg_time");
    });
  });

  describe("histogram", () => {
    test("creates basic histogram aggregation", () => {
      const agg = AggregationBuilder.histogram("size", 1000);

      expect(agg).toEqual({
        histogram: { field: "size", interval: 1000 },
      });
    });

    test("creates histogram with options", () => {
      const agg = AggregationBuilder.histogram("size", 1000, {
        extendedBounds: { min: 0, max: 10000 },
        hardBounds: { min: 0, max: 10000 },
        minDocCount: 1,
        offset: 500,
      });

      expect(agg.histogram.extended_bounds).toEqual({ min: 0, max: 10000 });
      expect(agg.histogram.hard_bounds).toEqual({ min: 0, max: 10000 });
      expect(agg.histogram.min_doc_count).toBe(1);
      expect(agg.histogram.offset).toBe(500);
    });
  });

  describe("dateHistogram", () => {
    test("creates date histogram with fixed interval", () => {
      const agg = AggregationBuilder.dateHistogram("timestamp", "1h");

      expect(agg).toEqual({
        date_histogram: { field: "timestamp", fixed_interval: "1h" },
      });
    });

    test("creates date histogram with options", () => {
      const agg = AggregationBuilder.dateHistogram("timestamp", "1d", {
        minDocCount: 0,
        extendedBounds: { min: 0, max: 10 },
      });

      expect(agg.date_histogram.min_doc_count).toBe(0);
      expect(agg.date_histogram.extended_bounds).toEqual({ min: 0, max: 10 });
    });
  });

  describe("range", () => {
    test("creates range aggregation", () => {
      const agg = AggregationBuilder.range("response_time", [
        { key: "fast", to: 100 },
        { key: "medium", from: 100, to: 500 },
        { key: "slow", from: 500 },
      ]);

      expect(agg.range.field).toBe("response_time");
      expect(agg.range.ranges).toHaveLength(3);
      expect(agg.range.ranges[0]!.key).toBe("fast");
      expect(agg.range.ranges[0]!.to).toBe(100);
    });

    test("creates keyed range aggregation", () => {
      const agg = AggregationBuilder.range(
        "price",
        [{ from: 0, to: 100 }],
        { keyed: true }
      );

      expect(agg.range.keyed).toBe(true);
    });
  });

  describe("metric aggregations", () => {
    test("creates avg aggregation", () => {
      const agg = AggregationBuilder.avg("response_time");
      expect(agg).toEqual({ avg: { field: "response_time", missing: undefined } });
    });

    test("creates avg aggregation with missing", () => {
      const agg = AggregationBuilder.avg("response_time", { missing: 0 });
      expect(agg.avg.missing).toBe(0);
    });

    test("creates sum aggregation", () => {
      const agg = AggregationBuilder.sum("bytes");
      expect(agg).toEqual({ sum: { field: "bytes", missing: undefined } });
    });

    test("creates min aggregation", () => {
      const agg = AggregationBuilder.min("price");
      expect(agg).toEqual({ min: { field: "price", missing: undefined } });
    });

    test("creates max aggregation", () => {
      const agg = AggregationBuilder.max("price");
      expect(agg).toEqual({ max: { field: "price", missing: undefined } });
    });

    test("creates count aggregation", () => {
      const agg = AggregationBuilder.count("field_name");
      expect(agg).toEqual({ value_count: { field: "field_name" } });
    });

    test("creates stats aggregation", () => {
      const agg = AggregationBuilder.stats("response_time");
      expect(agg).toEqual({ stats: { field: "response_time", missing: undefined } });
    });

    test("creates percentiles aggregation", () => {
      const agg = AggregationBuilder.percentiles("response_time");
      expect(agg).toEqual({
        percentiles: {
          field: "response_time",
          percents: undefined,
          missing: undefined,
        },
      });
    });

    test("creates percentiles with custom percents", () => {
      const agg = AggregationBuilder.percentiles("response_time", {
        percents: [50, 90, 99],
      });
      expect(agg.percentiles.percents).toEqual([50, 90, 99]);
    });
  });
});

// ============================================================================
// Error Classes Tests
// ============================================================================

describe("Error Classes", () => {
  describe("QuickwitError", () => {
    test("creates error with message and code", () => {
      const error = new QuickwitError("Test error", QuickwitErrorCode.UNKNOWN);

      expect(error.message).toBe("Test error");
      expect(error.code).toBe(QuickwitErrorCode.UNKNOWN);
      expect(error.name).toBe("QuickwitError");
    });

    test("creates error with options", () => {
      const cause = new Error("Original error");
      const error = new QuickwitError("Test error", QuickwitErrorCode.BAD_REQUEST, {
        status: 400,
        details: { message: "Details" },
        cause,
      });

      expect(error.status).toBe(400);
      expect(error.details).toEqual({ message: "Details" });
      expect(error.cause).toBe(cause);
    });

    test("toJSON returns correct structure", () => {
      const error = new QuickwitError("Test", QuickwitErrorCode.UNKNOWN, {
        status: 500,
        details: { field: "test" },
      });

      const json = error.toJSON();

      expect(json.name).toBe("QuickwitError");
      expect(json.message).toBe("Test");
      expect(json.code).toBe(QuickwitErrorCode.UNKNOWN);
      expect(json.status).toBe(500);
    });

    test("instanceof works correctly", () => {
      const error = new QuickwitError("Test", QuickwitErrorCode.UNKNOWN);

      expect(error instanceof QuickwitError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("ConnectionError", () => {
    test("creates connection error", () => {
      const error = new ConnectionError("Failed to connect");

      expect(error.message).toBe("Failed to connect");
      expect(error.code).toBe(QuickwitErrorCode.CONNECTION_ERROR);
      expect(error.name).toBe("ConnectionError");
      expect(error instanceof ConnectionError).toBe(true);
      expect(error instanceof QuickwitError).toBe(true);
    });

    test("includes cause", () => {
      const cause = new Error("Network error");
      const error = new ConnectionError("Failed", cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe("TimeoutError", () => {
    test("creates timeout error", () => {
      const error = new TimeoutError("Request timed out", 30000);

      expect(error.message).toBe("Request timed out");
      expect(error.code).toBe(QuickwitErrorCode.TIMEOUT);
      expect(error.timeout).toBe(30000);
      expect(error.name).toBe("TimeoutError");
      expect(error instanceof TimeoutError).toBe(true);
    });
  });

  describe("ValidationError", () => {
    test("creates validation error", () => {
      const error = new ValidationError("Invalid query");

      expect(error.message).toBe("Invalid query");
      expect(error.code).toBe(QuickwitErrorCode.VALIDATION_ERROR);
      expect(error.status).toBe(400);
      expect(error.name).toBe("ValidationError");
      expect(error instanceof ValidationError).toBe(true);
    });

    test("includes fields", () => {
      const error = new ValidationError("Invalid fields", {
        fields: ["query", "limit"],
      });

      expect(error.fields).toEqual(["query", "limit"]);
    });
  });

  describe("NotFoundError", () => {
    test("creates not found error", () => {
      const error = new NotFoundError("Index not found");

      expect(error.message).toBe("Index not found");
      expect(error.code).toBe(QuickwitErrorCode.NOT_FOUND);
      expect(error.status).toBe(404);
      expect(error.name).toBe("NotFoundError");
      expect(error instanceof NotFoundError).toBe(true);
    });

    test("includes resource info", () => {
      const error = new NotFoundError("Index not found", {
        resourceType: "index",
        resourceId: "logs",
      });

      expect(error.resourceType).toBe("index");
      expect(error.resourceId).toBe("logs");
    });
  });

  describe("UnauthorizedError", () => {
    test("creates unauthorized error", () => {
      const error = new UnauthorizedError();

      expect(error.message).toBe("Unauthorized");
      expect(error.code).toBe(QuickwitErrorCode.UNAUTHORIZED);
      expect(error.status).toBe(401);
      expect(error instanceof UnauthorizedError).toBe(true);
    });
  });

  describe("ForbiddenError", () => {
    test("creates forbidden error", () => {
      const error = new ForbiddenError();

      expect(error.message).toBe("Forbidden");
      expect(error.code).toBe(QuickwitErrorCode.FORBIDDEN);
      expect(error.status).toBe(403);
      expect(error instanceof ForbiddenError).toBe(true);
    });
  });

  describe("createErrorFromStatus", () => {
    test("creates ValidationError for 400", () => {
      const error = createErrorFromStatus(400, "Bad request");
      expect(error instanceof ValidationError).toBe(true);
    });

    test("creates UnauthorizedError for 401", () => {
      const error = createErrorFromStatus(401, "Unauthorized");
      expect(error instanceof UnauthorizedError).toBe(true);
    });

    test("creates ForbiddenError for 403", () => {
      const error = createErrorFromStatus(403, "Forbidden");
      expect(error instanceof ForbiddenError).toBe(true);
    });

    test("creates NotFoundError for 404", () => {
      const error = createErrorFromStatus(404, "Not found");
      expect(error instanceof NotFoundError).toBe(true);
    });

    test("creates TimeoutError for 408", () => {
      const error = createErrorFromStatus(408, "Timeout");
      expect(error instanceof TimeoutError).toBe(true);
    });

    test("creates QuickwitError for 500", () => {
      const error = createErrorFromStatus(500, "Server error");
      expect(error.code).toBe(QuickwitErrorCode.INTERNAL_SERVER_ERROR);
    });

    test("creates QuickwitError for 503", () => {
      const error = createErrorFromStatus(503, "Unavailable");
      expect(error.code).toBe(QuickwitErrorCode.SERVICE_UNAVAILABLE);
    });

    test("creates QuickwitError for unknown status", () => {
      const error = createErrorFromStatus(418, "I'm a teapot");
      expect(error.code).toBe(QuickwitErrorCode.UNKNOWN);
      expect(error.status).toBe(418);
    });
  });
});

// ============================================================================
// Integration-like Tests (using QueryBuilder + AggregationBuilder together)
// ============================================================================

describe("QueryBuilder + AggregationBuilder Integration", () => {
  test("builds complex query with multiple aggregations", () => {
    const query = new QueryBuilder()
      .query('level:error AND service:"api-gateway"')
      .timeRange(1704067200, 1704153600) // 2024-01-01 to 2024-01-02
      .limit(100)
      .sortBy("-timestamp")
      .agg("by_service", AggregationBuilder.terms("service", { size: 10 }))
      .agg("over_time", AggregationBuilder.dateHistogram("timestamp", "1h"))
      .agg("response_stats", AggregationBuilder.stats("response_time"))
      .build();

    expect(query.params.query).toBe('level:error AND service:"api-gateway"');
    expect(query.params.start_timestamp).toBe(1704067200);
    expect(query.params.end_timestamp).toBe(1704153600);
    expect(query.params.max_hits).toBe(100);
    expect(query.params.sort_by).toEqual(["-timestamp"]);
    expect(query.params.aggs).toHaveProperty("by_service");
    expect(query.params.aggs).toHaveProperty("over_time");
    expect(query.params.aggs).toHaveProperty("response_stats");
    expect(query.requiresPost).toBe(true);
  });

  test("builds nested aggregations", () => {
    const query = new QueryBuilder()
      .query("*")
      .agg(
        "by_level",
        AggregationBuilder.terms("level", {
          aggs: {
            by_service: AggregationBuilder.terms("service", {
              aggs: {
                avg_response: AggregationBuilder.avg("response_time"),
              },
            }),
          },
        })
      )
      .build();

    const byLevel = query.params.aggs!["by_level"] as {
      terms: { field: string };
      aggs: Record<string, unknown>;
    };
    expect(byLevel.terms.field).toBe("level");
    expect(byLevel.aggs).toHaveProperty("by_service");
  });
});

// ============================================================================
// NDJSON Serialization Tests
// ============================================================================

describe("toNDJSON", () => {
  test("serializes empty array to empty string", () => {
    const result = toNDJSON([]);
    expect(result).toBe("");
  });

  test("serializes single document with trailing newline", () => {
    const docs = [{ id: 1, name: "test" }];
    const result = toNDJSON(docs);
    expect(result).toBe('{"id":1,"name":"test"}\n');
  });

  test("serializes multiple documents with newlines", () => {
    const docs = [
      { id: 1, name: "first" },
      { id: 2, name: "second" },
      { id: 3, name: "third" },
    ];
    const result = toNDJSON(docs);
    // Split and filter empty strings (from trailing newline)
    const lines = result.split("\n").filter((line) => line.length > 0);

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ id: 1, name: "first" });
    expect(JSON.parse(lines[1]!)).toEqual({ id: 2, name: "second" });
    expect(JSON.parse(lines[2]!)).toEqual({ id: 3, name: "third" });
    // Verify trailing newline
    expect(result.endsWith("\n")).toBe(true);
  });

  test("handles nested objects", () => {
    const docs = [
      {
        timestamp: 1704067200,
        level: "error",
        metadata: { service: "api", region: "us-east-1" },
      },
    ];
    const result = toNDJSON(docs);
    const parsed = JSON.parse(result);

    expect(parsed.metadata.service).toBe("api");
    expect(parsed.metadata.region).toBe("us-east-1");
  });

  test("handles arrays in documents", () => {
    const docs = [{ tags: ["error", "critical", "api"] }];
    const result = toNDJSON(docs);
    const parsed = JSON.parse(result);

    expect(parsed.tags).toEqual(["error", "critical", "api"]);
  });

  test("handles special characters in strings", () => {
    const docs = [{ message: 'Error: "something" failed\nwith newline' }];
    const result = toNDJSON(docs);
    const parsed = JSON.parse(result);

    expect(parsed.message).toBe('Error: "something" failed\nwith newline');
  });

  test("handles null and undefined values", () => {
    const docs = [{ defined: "value", nullable: null, undef: undefined }];
    const result = toNDJSON(docs);
    const parsed = JSON.parse(result);

    expect(parsed.defined).toBe("value");
    expect(parsed.nullable).toBe(null);
    expect(parsed.undef).toBeUndefined();
  });

  test("handles numeric types correctly", () => {
    const docs = [
      {
        integer: 42,
        float: 3.14159,
        negative: -100,
        scientific: 1.5e10,
      },
    ];
    const result = toNDJSON(docs);
    const parsed = JSON.parse(result);

    expect(parsed.integer).toBe(42);
    expect(parsed.float).toBe(3.14159);
    expect(parsed.negative).toBe(-100);
    expect(parsed.scientific).toBe(1.5e10);
  });

  test("handles boolean values", () => {
    const docs = [{ active: true, deleted: false }];
    const result = toNDJSON(docs);
    const parsed = JSON.parse(result);

    expect(parsed.active).toBe(true);
    expect(parsed.deleted).toBe(false);
  });
});

// ============================================================================
// isFastFieldEnabled Tests
// ============================================================================

describe("isFastFieldEnabled", () => {
  const mk = (fast: Extract<FieldMapping, { type: "text" }>["fast"]): FieldMapping => ({
    name: "f",
    type: "text",
    fast,
  });

  test("undefined → false", () => {
    expect(isFastFieldEnabled(mk(undefined))).toBe(false);
  });

  test("false → false", () => {
    expect(isFastFieldEnabled(mk(false))).toBe(false);
  });

  test("true → true", () => {
    expect(isFastFieldEnabled(mk(true))).toBe(true);
  });

  test("normalizer raw → true", () => {
    expect(isFastFieldEnabled(mk({ normalizer: "raw" }))).toBe(true);
  });

  test("normalizer lowercase → true", () => {
    expect(isFastFieldEnabled(mk({ normalizer: "lowercase" }))).toBe(true);
  });
});

// ============================================================================
// HTTP Request Tests (stubbed fetch)
// ============================================================================

describe("HTTP requests", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const emptySearch = { num_hits: 7, hits: [], elapsed_time_micros: 1, errors: [] };

  function stubFetch(body: unknown = emptySearch, delayMs = 0) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        method: init.method ?? "GET",
        body: typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body,
      });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })),
          delayMs
        );
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;
    return calls;
  }

  const client = (timeout?: number) => new QuickwitClient({ endpoint: "http://qw.test", timeout });

  describe("dot-segment IDs", () => {
    const cases: [string, (c: QuickwitClient) => Promise<unknown>][] = [
      ["deleteSource('..')", (c) => c.index("logs").deleteSource("..")],
      ["deleteSource('.')", (c) => c.index("logs").deleteSource(".")],
      ["updateSource('..')", (c) => c.index("logs").updateSource("..", { source_id: "x", source_type: "file" } as never)],
      ["index('..').search()", (c) => c.index("..").search()],
      ["traces().listOperations('..')", (c) => c.traces().listOperations("..")],
    ];

    for (const [name, call] of cases) {
      test(`${name} is rejected before any request`, async () => {
        const calls = stubFetch();
        await expect(call(client())).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toHaveLength(0);
      });
    }

    test("IDs that merely contain dots are allowed", async () => {
      const calls = stubFetch();
      await client().index("logs.v1").deleteSource("src..2");
      expect(calls[0]?.url).toBe("http://qw.test/api/v1/indexes/logs.v1/sources/src..2");
    });
  });

  describe("search always uses POST", () => {
    test("string query", async () => {
      const calls = stubFetch();
      await client().index("logs").search("level:error");
      expect(calls[0]).toEqual({
        url: "http://qw.test/api/v1/logs/search",
        method: "POST",
        body: { query: "level:error" },
      });
    });

    test("params object joins list fields into strings", async () => {
      const calls = stubFetch();
      await client().index("logs").search({
        query: "x",
        search_fields: ["a", "b"],
        snippet_fields: ["a"],
        sort_by: ["-ts", "_score"],
        count_all: true,
      });
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.body).toEqual({
        query: "x",
        search_field: "a,b",
        snippet_fields: "a",
        sort_by: "-ts,_score",
        count_all: true,
      });
    });

    test("searchFirst() with a BuiltQuery", async () => {
      const calls = stubFetch();
      await client().index("logs").searchFirst(new QueryBuilder("x").limit(50).build());
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.body).toEqual({ query: "x", max_hits: 1 });
    });

    test("count() with a BuiltQuery", async () => {
      const calls = stubFetch();
      const n = await client().index("logs").count(new QueryBuilder("x").build());
      expect(n).toBe(7);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.body).toEqual({ query: "x", max_hits: 0, count_all: true });
    });
  });

  describe("ingest timeout", () => {
    const docs = [{ msg: "hi" }];
    const ingestOk = { num_docs_for_processing: 1 };

    test("wait_for outlasts a short client timeout", async () => {
      stubFetch(ingestOk, 50);
      const res = await client(10).index("logs").ingest(docs, { commit: "wait_for" });
      expect(res.num_docs_for_processing).toBe(1);
    });

    test("auto commit keeps the client timeout", async () => {
      stubFetch(ingestOk, 50);
      await expect(client(10).index("logs").ingest(docs)).rejects.toBeInstanceOf(TimeoutError);
    });

    test("explicit per-call timeout wins over the wait_for minimum", async () => {
      stubFetch(ingestOk, 50);
      await expect(
        client().index("logs").ingest(docs, { commit: "wait_for", timeout: 10 })
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    test("per-call timeout is not sent as a query param", async () => {
      const calls = stubFetch(ingestOk);
      await client().index("logs").ingest(docs, { commit: "wait_for", timeout: 1000 });
      expect(calls[0]?.url).toBe("http://qw.test/api/v1/logs/ingest?commit=wait_for");
    });
  });
});

describe("QuickwitError subclassing", () => {
  test("user subclasses keep their own prototype", () => {
    class RetryableError extends QuickwitError {
      retry() {
        return "again";
      }
    }
    const err = new RetryableError("boom");
    expect(err).toBeInstanceOf(RetryableError);
    expect(err).toBeInstanceOf(QuickwitError);
    expect(err.retry()).toBe("again");
  });
});
