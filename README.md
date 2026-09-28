# @rootprint-io/quickwit-js

[![npm](https://img.shields.io/npm/v/@rootprint-io/quickwit-js)](https://www.npmjs.com/package/@rootprint-io/quickwit-js)
[![license](https://img.shields.io/npm/l/@rootprint-io/quickwit-js)](LICENSE)

A TypeScript client for [Quickwit](https://quickwit.io) 0.9 with no runtime dependencies. It covers search, ingest, index management, and tracing.

Requires Quickwit 0.9.x and Node.js 18+ or Bun.

For a log explorer, trace views, and team access control with API keys and SSO on top of Quickwit, see [Rootprint](https://github.com/rootprint/rootprint), the self-hosted platform this client was built for.

## Installation

```bash
npm install @rootprint-io/quickwit-js
```

Moving from the deprecated `quickwit-js` package? The API is the same. Uninstall `quickwit-js` and change your imports to `@rootprint-io/quickwit-js`.

## Quick Start

```typescript
import { QuickwitClient } from "@rootprint-io/quickwit-js";

const client = new QuickwitClient("http://localhost:7280");
const logs = client.index("otel-logs-v0_9"); // Quickwit creates this index at startup

await logs.ingest(
  [{ timestamp_nanos: 1704067200, service_name: "checkout", severity_text: "ERROR", body: { message: "disk full" } }],
  { commit: "force" }
);

const { hits, num_hits } = await logs.search("severity_text:ERROR");
```

`QuickwitClient` manages the cluster, indexes, and templates. `client.index(id)` returns a handle for one index's search, ingest, sources, and delete tasks without sending a request.

## Conventions

Objects that mirror Quickwit's REST API use its snake_case names (`max_hits`, `detailed_response`). Builder methods, client options, and Jaeger parameters use camelCase (`sortBy()`, `indexId`, `minDuration`).

| Value | Unit |
|---|---|
| Search and delete-task timestamps, `timeRange()` | Unix seconds |
| Jaeger `start` / `end` | Unix microseconds |
| `timeout` options | Milliseconds |

## Client

```typescript
const client = new QuickwitClient({
  endpoint: "http://localhost:7280",
  timeout: 30_000,
});
```

| Option | Default | Description |
|---|---|---|
| `endpoint` | required | Quickwit base URL. Behind a reverse proxy, include its path prefix: `https://example.com/quickwit` |
| `timeout` | `30000` | Request timeout in milliseconds |
| `headers` | none | Headers for every request |
| `apiKey` | none | Sent as `X-API-Key` |
| `bearerToken` | none | Sent as `Authorization: Bearer <token>` |

Quickwit has no authentication of its own. Set `apiKey` or `bearerToken` when a gateway in front of it checks credentials.

```typescript
const ready = await client.isHealthy();
const live = await client.isLive();
const version = await client.getVersion({ timeout: 5_000 });
```

`isHealthy()` and `isLive()` return `false` on any failure, including an unreachable server, and never throw. Call `getVersion()` when you need the error. The health methods, `getVersion()`, and `getCluster()` accept per-call `{ timeout, headers }`, and `ingest()` accepts a per-call `timeout`. The other methods use the client defaults.

## Search

`search()` takes a query string, a request object, or a query builder. It defaults to the match-all query `*`.

```typescript
const response = await logs.search({
  query: "severity_text:ERROR",
  max_hits: 50,
  sort_by: ["timestamp_nanos"],
});

interface LogRecord {
  timestamp_nanos: number;
  service_name: string;
  severity_text: string;
  body: { message: string };
}

const errors = await logs.searchHits<LogRecord>("severity_text:ERROR");  // LogRecord[]
const latest = await logs.searchFirst<LogRecord>("severity_text:ERROR"); // LogRecord | undefined
const total = await logs.count("severity_text:ERROR");
```

Hits default to `Record<string, unknown>`. The type parameter types them without validating them.

### Query Builder

```typescript
const response = await logs.search(
  logs.query("disk")
    .timeRange(1704067200, 1704153600)
    .limit(20)
    .offset(40)
    .sortBy("timestamp_nanos", "desc")
    .searchFields("body.message")
    .countAll()
);
```

The builder also has `snippetFields()` for text fields, `dateRange(start, end)` for `Date` objects, `allowFailedSplits()`, and `clone()`. It throws `ValidationError` on invalid input, such as a negative limit or a third sort field.

Quickwit 0.9 sorts descending by default: `field` and `+field` sort descending, and `-field` sorts ascending. `.sortBy(field, "asc" | "desc")` writes the prefix for you.

### Aggregations

```typescript
import {
  AggregationBuilder,
  type BucketAggregationResult,
} from "@rootprint-io/quickwit-js";

const response = await logs.search(
  logs.query("*")
    .limit(0)
    .agg("by_severity", AggregationBuilder.terms("severity_text", { size: 10 }))
    .agg("over_time", AggregationBuilder.dateHistogram("timestamp_nanos", "1h"))
    .agg("services", AggregationBuilder.cardinality("service_name"))
);

const bySeverity = response.aggregations?.by_severity as BucketAggregationResult;
```

Cast each result to its type. Bucket aggregations return `BucketAggregationResult` and single-value metrics return `MetricAggregationResult`. `stats`, `extendedStats`, and `percentiles` each have their own result type. `dateHistogram` accepts fixed intervals such as `"1h"` only, because Quickwit 0.9 has no calendar intervals.

## Ingest

```typescript
const result = await logs.ingest(documents, {
  commit: "wait_for",
  detailed_response: true,
});

console.log(result.num_ingested_docs, result.num_rejected_docs, result.parse_failures);
```

| Option | Description |
|---|---|
| `commit` | `"auto"` (default) returns once Quickwit queues the documents, `"wait_for"` waits for the next scheduled commit, and `"force"` commits before returning |
| `detailed_response` | Adds per-document `parse_failures` (ingest v2) |
| `timeout` | Request timeout in milliseconds |

Ingest v2 returns HTTP 200 even when it rejects part of a batch, so check `num_rejected_docs`. Legacy ingest v1 returns `num_docs_for_processing` alone.

Quickwit's default `commit_timeout_secs` is 60, so the client gives `wait_for` requests a timeout of at least 90 seconds. Pass `timeout` for indexes with a longer commit timeout. A `wait_for` request can time out and still commit, so a retry can duplicate documents.

## Indexes

```typescript
await client.createIndex({
  version: "0.9",
  index_id: "logs",
  doc_mapping: {
    field_mappings: [
      { name: "timestamp", type: "datetime", input_formats: ["unix_timestamp"], fast: true },
      { name: "level", type: "text", tokenizer: "raw", fast: true },
      { name: "message", type: "text" },
    ],
    timestamp_field: "timestamp",
  },
});

const exists = await client.indexExists("logs");
const indexes = await client.listIndexes({ index_id_patterns: ["logs-*"] });
const metadata = await client.getIndex("logs");
const stats = await client.describeIndex("logs");

await client.clearIndex("logs");                     // delete documents, keep the index
await client.deleteIndex("logs", { dry_run: true }); // list files without deleting
await client.deleteIndex("logs");
```

`updateIndex(id, config)` replaces the whole configuration: Quickwit drops any optional field you omit, such as `retention`. To change one setting, copy `index_config` from `getIndex(id)` and edit it.

`indexExists()` returns `false` for a 404 and rethrows every other error.

## Sources

You manage sources through the index handle.

```typescript
await logs.createSource({
  version: "0.9",
  source_id: "kafka-logs",
  source_type: "kafka",
  params: { topic: "logs", client_params: { "bootstrap.servers": "localhost:9092" } },
});

await logs.toggleSource("kafka-logs", false);
await logs.resetSourceCheckpoint("kafka-logs");
await logs.deleteSource("kafka-logs");
```

`updateSource(id, config)` replaces a source's configuration. You can create and update `file`, `kafka`, `kinesis`, `pubsub`, and `pulsar` sources.

## Delete Tasks

```typescript
await logs.createDeleteTask({
  query: "severity_text:DEBUG",
  start_timestamp: 1704067200,
  end_timestamp: 1704153600,
});

const tasks = await logs.listDeleteTasks();
```

`createDeleteTask()` returns once Quickwit queues the task. Quickwit deletes the documents in the background.

## Index Templates

If you ingest into an index that does not exist yet, Quickwit creates it from the highest-`priority` template whose patterns match its ID.

```typescript
await client.createTemplate({
  version: "0.9",
  template_id: "logs-template",
  index_id_patterns: ["logs-*"],
  doc_mapping: { mode: "dynamic" },
});

const template = await client.getTemplate("logs-template");
await client.updateTemplate("logs-template", { ...template, priority: 10 });
await client.deleteTemplate("logs-template");
```

## Tracing

```typescript
const traces = client.traces(); // otel-traces-v0_* unless you pass an index ID or pattern

const services = await traces.listServices();
const operations = await traces.listOperations("checkout");

const matches = await traces.search({
  service: "checkout",
  start: 1704067200000000,
  end: 1704153600000000,
  minDuration: "100ms",
  tags: { error: "true" },
  limit: 20,
});

const trace = await traces.getTrace("1506026ddd216249555653218dc88a6c");
```

Quickwit 0.9 ignores the Jaeger `lookback` parameter, so bound searches with `start` and `end`.

`ingestOtlpTraces()` sends an encoded OpenTelemetry `ExportTraceServiceRequest` protobuf. The client ships no protobuf encoder, so build the `Uint8Array` with your OpenTelemetry exporter.

```typescript
const result = await client.ingestOtlpTraces(payload, {
  indexId: "otel-traces-v0_9", // optional
  contentEncoding: "gzip",     // set if you compressed the payload
});

console.log(result.partial_success?.rejected_spans ?? 0);
```

## Errors

Every error extends `QuickwitError`, which carries a `code`. Errors from a server response also carry the HTTP `status` and the server's `details`.

```typescript
import { NotFoundError, QuickwitError, TimeoutError } from "@rootprint-io/quickwit-js";

try {
  await logs.search("severity_text:ERROR");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error("Index not found");
  } else if (error instanceof TimeoutError) {
    console.error(`Timed out after ${error.timeout}ms`);
  } else if (error instanceof QuickwitError) {
    console.error(error.code, error.status, error.details?.message);
  }
}
```

| Class | Thrown for |
|---|---|
| `ValidationError` | Invalid input caught before sending, or HTTP 400 |
| `UnauthorizedError` / `ForbiddenError` | HTTP 401 / 403 |
| `NotFoundError` | HTTP 404 |
| `TimeoutError` | Client timeout, or HTTP 408 with `timeout` set to `0` |
| `ConnectionError` | Network failure |
| `QuickwitError` | Other statuses; `code` holds `CONFLICT`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`, `SERVICE_UNAVAILABLE`, or `UNKNOWN` |

## Development

Development needs [Bun](https://bun.sh) 1.3 or newer.

```bash
bun install
bun run typecheck
bun run test
bun run build
```

`bun run test` runs the unit tests. A bare `bun test` also picks up the integration suite, which creates and deletes indexes on `localhost:7280`.

The integration suite refuses non-loopback endpoints. Start a local Quickwit first:

```bash
docker run --rm -p 127.0.0.1:7280:7280 quickwit/quickwit:0.9.1 run
bun run test:integration
```

## Releasing

Bump `version` in `package.json`, merge to `main`, then push a matching tag such as `v0.5.1`. The [release workflow](.github/workflows/release.yml) checks the tag, runs the tests, publishes to npm through trusted publishing, and creates a [GitHub release](https://github.com/rootprint/quickwit-js/releases).

## License

[MIT](LICENSE)
