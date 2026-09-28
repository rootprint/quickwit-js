# quickwit-js

A TypeScript client for Quickwit 0.9 search, ingestion, index management, and tracing APIs.

## Installation

```bash
npm install quickwit-js
# or
bun add quickwit-js
```

Node.js 18 or newer is required. The package provides ESM and CommonJS entry points.

## Client

```typescript
import { QuickwitClient } from "quickwit-js";

const client = new QuickwitClient({
  endpoint: "http://localhost:7280",
  timeout: 30_000,
  apiKey: "optional-api-key",
  bearerToken: "optional-bearer-token",
});

const ready = await client.isHealthy();
const live = await client.isLive();
const version = await client.getVersion({ timeout: 5_000 });
const cluster = await client.getCluster({ timeout: 5_000 });
```

The endpoint may include a reverse-proxy path prefix, such as `https://example.com/quickwit`.

## Search

```typescript
const logs = client.index("logs");

const response = await logs.search({
  query: "level:error",
  max_hits: 50,
  sort_by: ["timestamp"],
});

console.log(response.hits);
```

`search()`, `searchHits()`, and `searchFirst()` default to the match-all query `*` when you omit the query.

### Query Builder

```typescript
const response = await logs.search(
  logs.query("error")
    .timeRange(1704067200, 1704153600)
    .limit(20)
    .sortBy("timestamp", "desc")
    .searchFields("message", "body")
    .snippetFields("message")
    .countAll()
);
```

Quickwit 0.9 uses an unusual sort mini-language:

- `timestamp` and `+timestamp` sort descending.
- `-timestamp` sorts ascending.
- `.sortBy("timestamp", "desc")` and `.sortBy("timestamp", "asc")` handle these prefixes for you.
- You may call `.sortBy()` twice to sort on two fields.

### Aggregations

```typescript
import { AggregationBuilder } from "quickwit-js";

const response = await logs.search(
  logs.query("*")
    .limit(0)
    .agg("by_level", AggregationBuilder.terms("level", { size: 10 }))
    .agg("over_time", AggregationBuilder.dateHistogram("timestamp", "1h"))
    .agg("latency", AggregationBuilder.extendedStats("response_time"))
    .agg("services", AggregationBuilder.cardinality("service"))
);
```

Supported builders include terms, histogram, fixed-interval date histogram, range, average, sum, min, max, count, stats, extended stats, percentiles, and cardinality.

Quickwit 0.9 does not support calendar date histograms. Histogram bounds use `extendedBounds` and `hardBounds`:

```typescript
AggregationBuilder.histogram("response_time", 100, {
  extendedBounds: { min: 0, max: 1000 },
  hardBounds: { min: 0, max: 1000 },
});
```

## Ingest

```typescript
const result = await logs.ingest(documents, {
  commit: "wait_for",
  detailed_response: true,
});

console.log({
  submitted: result.num_docs_for_processing,
  ingested: result.num_ingested_docs,
  rejected: result.num_rejected_docs,
  failures: result.parse_failures,
});
```

Quickwit ingest v2 returns HTTP 200 for partially accepted batches. Check `num_rejected_docs` even when the request succeeds. `parse_failures` is present only when `detailed_response` is enabled. Legacy ingest v1 returns only `num_docs_for_processing` and does not support detailed responses.

Commit modes are `auto`, `wait_for`, and `force`. `wait_for` blocks until the next commit (Quickwit's default `commit_timeout_secs` is 60), so its request timeout is raised to at least 90s. Pass `timeout` in the ingest options for indexes with a longer commit timeout. A timed-out `wait_for` ingest may still commit, so retrying it can duplicate documents.

## Indexes

```typescript
await client.createIndex({
  version: "0.9",
  index_id: "logs",
  doc_mapping: {
    field_mappings: [
      {
        name: "timestamp",
        type: "datetime",
        input_formats: ["unix_timestamp"],
        fast: true,
      },
      { name: "level", type: "text", tokenizer: "raw", fast: true },
      { name: "message", type: "text" },
    ],
    timestamp_field: "timestamp",
  },
});

const indexes = await client.listIndexes();
const metadata = await client.getIndex("logs");
const stats = await client.describeIndex("logs");

await client.clearIndex("logs");
await client.deleteIndex("logs");
```

Index handles also provide source creation, update, deletion, checkpoint reset, and enable/disable methods.

## Delete Tasks

```typescript
const task = await logs.createDeleteTask({
  query: "level:debug",
  search_fields: ["message"],
  start_timestamp: 1704067200,
  end_timestamp: 1704153600,
});

const tasks = await logs.listDeleteTasks();
```

Delete tasks run asynchronously inside Quickwit.

## Index Templates

```typescript
const templates = await client.listTemplates();
const template = await client.getTemplate("logs-template");

await client.createTemplate({
  version: "0.9",
  template_id: "logs-template",
  index_id_patterns: ["logs-*"],
  doc_mapping: { mode: "dynamic" },
});

await client.updateTemplate("logs-template", template);
await client.deleteTemplate("logs-template");
```

## Tracing

### Jaeger Query API

```typescript
const traces = client.traces(); // Uses otel-traces-v0_*

const services = await traces.listServices();
const operations = await traces.listOperations("checkout");

const matches = await traces.search({
  service: "checkout",
  operation: "POST /orders",
  start: 1704067200000000, // Unix epoch microseconds
  end: 1704153600000000,
  minDuration: "100ms",
  tags: { error: "true" },
  limit: 20,
});

const trace = await traces.getTrace("1506026ddd216249555653218dc88a6c");
```

Quickwit accepts `lookback` for Jaeger compatibility but does not apply it in version 0.9.

### OTLP Protobuf Ingest

Pass an encoded OpenTelemetry `ExportTraceServiceRequest` protobuf message:

```typescript
const result = await client.ingestOtlpTraces(encodedPayload);

await client.ingestOtlpTraces(encodedPayload, {
  indexId: "otel-traces-v0_9",
});

console.log(result.partial_success?.rejected_spans ?? 0);
```

The client does not include an OpenTelemetry protobuf implementation. Use your existing OpenTelemetry exporter or protobuf package to produce the `Uint8Array` payload.

## Errors

```typescript
import {
  ConnectionError,
  NotFoundError,
  QuickwitError,
  TimeoutError,
} from "quickwit-js";

try {
  await logs.search("error");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error("Index not found");
  } else if (error instanceof TimeoutError) {
    console.error(`Timed out after ${error.timeout}ms`);
  } else if (error instanceof ConnectionError) {
    console.error("Could not reach Quickwit");
  } else if (error instanceof QuickwitError) {
    console.error(error.status, error.details);
  }
}
```

`indexExists()` returns `false` only for a 404 response. It rethrows connection, authentication, timeout, and server errors.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Integration tests refuse non-loopback endpoints and must use a local Quickwit instance:

```bash
QUICKWIT_ENDPOINT=http://localhost:7280 bun run test:integration
```

## Compatibility

`quickwit-js` 0.4 targets Quickwit 0.9. The client intentionally omits lower-level and diagnostic routes such as search-plan, tail, splits, mark-for-deletion, node config, indexing diagnostics, metrics, `_elastic`, developer endpoints, and OTLP logs.

## License

MIT
