/**
 * Configuration options for QuickwitClient
 */
export interface QuickwitConfig {
  /** Base URL of the Quickwit server (e.g., "http://localhost:7280") */
  endpoint: string;

  /** Optional API key for authentication */
  apiKey?: string;

  /** Optional bearer token for authentication */
  bearerToken?: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Default headers to include with every request */
  headers?: Record<string, string>;
}

/** Overrides for one client request. */
export interface RequestOptions {
  /** Request timeout in milliseconds. */
  timeout?: number;

  /** Headers to merge with the client defaults. */
  headers?: Record<string, string>;
}

/**
 * Response from the health check endpoint
 */
export interface HealthResponse {
  /** Whether the cluster is healthy */
  healthy: boolean;
}

/**
 * Index metadata returned by Quickwit (matches VersionedIndexMetadata)
 */
export interface IndexMetadata {
  /** Version of the metadata format */
  version: "0.9";

  /** Unique index UID (format: "index_id:ulid") */
  index_uid: string;

  /** Index configuration */
  index_config: IndexConfig;

  /** Checkpoint tracking source positions */
  checkpoint: Record<string, unknown>;

  /** Creation timestamp */
  create_timestamp?: number;

  /** Sources attached to the index */
  sources: SourceConfig[];
}

/**
 * Index configuration
 */
export interface IndexConfig {
  /** Version of the index configuration */
  version: "0.9" | "0.8";

  /** Index ID */
  index_id: string;

  /** Index URI */
  index_uri?: string;

  /** Document mapping configuration */
  doc_mapping: DocMapping;

  /** Indexing settings */
  indexing_settings?: IndexingSettings;

  /** Ingest API settings */
  ingest_settings?: IngestSettings;

  /** Search settings */
  search_settings?: SearchSettings;

  /** Retention policy */
  retention?: RetentionPolicy | null;
}

/**
 * Document mapping configuration
 */
export interface DocMapping {
  /** Document mapping UID */
  doc_mapping_uid?: string;

  /** Field mappings */
  field_mappings?: FieldMapping[];

  /** Tag fields for filtering */
  tag_fields?: string[];

  /** Timestamp field name */
  timestamp_field?: string;

  /** Mode for handling unmapped fields */
  mode?: "lenient" | "strict" | "dynamic";

  /** Dynamic mapping options (when mode is "dynamic") */
  dynamic_mapping?: Record<string, unknown>;

  /** Partition key */
  partition_key?: string;

  /** Maximum number of partitions */
  max_num_partitions?: number;

  /** Whether to store the original source documents */
  store_source?: boolean;

  /** Whether to store document size in a fast field */
  store_document_size?: boolean;

  /** Whether to record field presence for exists queries */
  index_field_presence?: boolean;

  /** Custom tokenizer definitions */
  tokenizers?: TokenizerEntry[];
}

/**
 * Custom tokenizer definition
 */
export interface TokenizerEntry {
  /** Tokenizer name */
  name: string;

  /** Tokenizer type */
  type: string;

  /** Additional tokenizer-specific configuration */
  [key: string]: unknown;
}

/** Normalizer name for text/json fields with fast columnar storage. */
export type FastFieldNormalizer = "raw" | "lowercase";

/**
 * Quickwit serializes `fast` as one of:
 *   - `false`    — disabled
 *   - `true`     — enabled with default normalizer (text/json) or plain-fast (numeric)
 *   - `{ normalizer }` — enabled with a specific normalizer (text/json only)
 *
 * Use `isFastFieldEnabled(field)` to check whether fast storage is on — a
 * plain `=== true` check silently misses the object form.
 */
export type FastFieldConfig = boolean | { normalizer: FastFieldNormalizer };

interface BaseFieldMapping {
  /** Field name */
  name: string;

  /** Optional human-readable description of the field (Quickwit 0.8+). */
  description?: string;

  /** Whether the field is stored */
  stored?: boolean;

  /** Whether the field is indexed */
  indexed?: boolean;

  /** Whether the field is required */
  required?: boolean;
}

export interface TextFieldMapping extends BaseFieldMapping {
  type: "text";
  tokenizer?: string;
  record?: "basic" | "freq" | "position";
  fieldnorms?: boolean;
  fast?: FastFieldConfig;
}

export interface NumericFieldMapping extends BaseFieldMapping {
  type: "i64" | "u64" | "f64";
  fast?: boolean;
  coerce?: boolean;
  output_format?: "number" | "string";
}

export interface BoolOrIpFieldMapping extends BaseFieldMapping {
  type: "bool" | "ip";
  fast?: boolean;
}

export interface DatetimeFieldMapping extends BaseFieldMapping {
  type: "datetime";
  fast?: boolean;
  input_formats?: string[];
  output_format?: string;
  fast_precision?: "seconds" | "milliseconds" | "microseconds" | "nanoseconds";
}

export interface BytesFieldMapping extends BaseFieldMapping {
  type: "bytes";
  fast?: boolean;
  input_format?: "hex" | "base64";
  output_format?: "hex" | "base64";
}

export interface JsonFieldMapping extends BaseFieldMapping {
  type: "json";
  tokenizer?: string;
  record?: "basic" | "freq" | "position";
  expand_dots?: boolean;
  fast?: FastFieldConfig;
}

export interface ObjectFieldMapping extends BaseFieldMapping {
  type: "object";
  field_mappings: FieldMapping[];
}

export interface ConcatenateFieldMapping extends BaseFieldMapping {
  type: "concatenate";
  concatenate_fields: string[];
  include_dynamic_fields?: boolean;
  tokenizer?: string;
  record?: "basic" | "freq" | "position";
}

export type ArrayFieldMapping =
  | (Omit<TextFieldMapping, "type"> & { type: "array<text>" })
  | (Omit<NumericFieldMapping, "type"> & {
      type: "array<i64>" | "array<u64>" | "array<f64>";
    })
  | (Omit<BoolOrIpFieldMapping, "type"> & {
      type: "array<bool>" | "array<ip>";
    })
  | (Omit<DatetimeFieldMapping, "type"> & { type: "array<datetime>" })
  | (Omit<BytesFieldMapping, "type" | "fast"> & { type: "array<bytes>" })
  | (Omit<JsonFieldMapping, "type"> & { type: "array<json>" });

export type FieldMapping =
  | TextFieldMapping
  | NumericFieldMapping
  | BoolOrIpFieldMapping
  | DatetimeFieldMapping
  | BytesFieldMapping
  | JsonFieldMapping
  | ObjectFieldMapping
  | ConcatenateFieldMapping
  | ArrayFieldMapping;

/**
 * Indexing settings
 */
export interface IndexingSettings {
  /** Commit timeout in seconds */
  commit_timeout_secs?: number;

  /** Split number of docs threshold */
  split_num_docs_target?: number;

  /** Docstore block size in bytes */
  docstore_blocksize?: number;

  /** Docstore compression level */
  docstore_compression_level?: number;

  /** Merge policy */
  merge_policy?: MergePolicy;

  /** Resources configuration */
  resources?: ResourcesConfig;
}

/** Ingest API settings for an index. */
export interface IngestSettings {
  min_shards?: number;
  validate_docs?: boolean;
}

/**
 * Merge policy configuration
 */
export interface MergePolicy {
  /** Type of merge policy */
  type: "stable_log" | "no_merge" | "limit_merge";

  /** Minimum level size for stable_log */
  min_level_num_docs?: number;

  /** Merge factor */
  merge_factor?: number;

  /** Maximum merge factor */
  max_merge_factor?: number;

  /** Maturation period (e.g., "48 hours") */
  maturation_period?: string;

  /** Max finalize merge operations (limit_merge only) */
  max_finalize_merge_operations?: number;

  /** Max finalize split num docs (limit_merge only) */
  max_finalize_split_num_docs?: number;

  /** Max merge ops (limit_merge only) */
  max_merge_ops?: number;
}

/**
 * Resource configuration for indexing
 */
export interface ResourcesConfig {
  /** Heap size (e.g., "2 GB") */
  heap_size?: string;
}

/**
 * Search settings
 */
export interface SearchSettings {
  /** Default search fields */
  default_search_fields?: string[];
}

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  /** Retention period (e.g., "90 days", "1 year") */
  period: string;

  /** Retention schedule (cron expression) */
  schedule?: string;
}

export type SourceInputFormat =
  | "json"
  | "plain_text"
  | "plain"
  | "otlp_logs_json"
  | "otlp_logs_proto"
  | "otlp_logs_protobuf"
  | "otlp_trace_json"
  | "otlp_traces_json"
  | "otlp_trace_proto"
  | "otlp_trace_protobuf"
  | "otlp_traces_proto"
  | "otlp_traces_protobuf";

interface SourceConfigBase {
  source_id: string;
  enabled?: boolean;
  transform?: TransformConfig | null;
  input_format?: SourceInputFormat;
}

interface CurrentSourceVersion {
  version: "0.9" | "0.8";
  num_pipelines?: number;
}

interface LegacySourceVersion {
  version: "0.7";
  desired_num_pipelines?: number;
  max_num_pipelines_per_indexer?: number;
}

export interface FileSourceNotification {
  type: "sqs";
  queue_url: string;
  message_type: "s3_notification" | "raw_uri";
  deduplication_window_duration_secs?: number;
  deduplication_window_max_messages?: number;
  deduplication_cleanup_interval_secs?: number;
}

export type FileSourceParams =
  | { filepath: string; notifications?: never }
  | { filepath?: never; notifications: [FileSourceNotification] };

export interface KafkaSourceParams {
  topic: string;
  client_log_level?: "debug" | "info" | "warn" | "error";
  client_params?: Record<string, unknown>;
  enable_backfill_mode?: boolean;
}

interface KinesisSourceParamsBase {
  stream_name: string;
  enable_backfill_mode?: boolean;
}

export type KinesisSourceParams = KinesisSourceParamsBase &
  (
    | { region: string; endpoint?: never }
    | { region?: never; endpoint: string }
    | { region?: never; endpoint?: never }
  );

export interface PubSubSourceParams {
  subscription: string;
  enable_backfill_mode?: boolean;
  credentials_file?: string;
  project_id?: string;
  max_messages_per_pull?: number;
}

export interface PulsarSourceParams {
  topics: string[];
  address: string;
  consumer_name?: string;
  authentication?: PulsarSourceAuth;
}

export type PulsarSourceAuth =
  | { token: string }
  | {
      oauth2: {
        issuer_url: string;
        credentials_url: string;
        audience?: string;
        scope?: string;
      };
    };

type SourceParams =
  | { source_type: "file"; params: FileSourceParams }
  | { source_type: "kafka"; params: KafkaSourceParams }
  | { source_type: "kinesis"; params: KinesisSourceParams }
  | { source_type: "pubsub"; params: PubSubSourceParams }
  | { source_type: "pulsar"; params: PulsarSourceParams }
  | { source_type: "vec"; params: { docs: string[]; batch_num_docs: number; partition?: string } }
  | { source_type: "void"; params: Record<string, never> }
  | { source_type: "ingest" | "ingest-api" | "ingest-cli" | "stdin"; params?: never };

export type SourceConfig = SourceConfigBase &
  (CurrentSourceVersion | LegacySourceVersion) &
  SourceParams;

type WritableSourceParams =
  | { source_type: "file"; params: FileSourceParams }
  | { source_type: "kafka"; params: KafkaSourceParams }
  | { source_type: "kinesis"; params: KinesisSourceParams }
  | { source_type: "pubsub"; params: PubSubSourceParams }
  | { source_type: "pulsar"; params: PulsarSourceParams };

/** Source configuration accepted by the REST create and update endpoints. */
export type SourceConfigRequest = SourceConfigBase &
  (CurrentSourceVersion | LegacySourceVersion) &
  WritableSourceParams;

/**
 * Transform configuration for sources
 */
export interface TransformConfig {
  /** VRL script for transformation */
  script: string;

  /** Timezone for datetime parsing */
  timezone?: string;
}

/**
 * HTTP method types
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  /** Response data */
  data: T;

  /** HTTP status code */
  status: number;

  /** Response headers */
  headers: Headers;
}

// ============================================================================
// Ingest Types
// ============================================================================

/**
 * Commit mode for document ingestion
 */
export type CommitMode = "auto" | "wait_for" | "force";

/**
 * Options for document ingestion
 */
export interface IngestOptions {
  /**
   * Controls when ingested documents become searchable
   * - "auto" (default): Documents queued immediately; searchable after automatic commit
   * - "wait_for": Wait for commit based on time/document thresholds
   * - "force": Trigger immediate commit after processing (slower but guaranteed searchable)
   */
  commit?: CommitMode;

  /** Include individual parse failures in the response (ingest v2 only). */
  detailed_response?: boolean;

  /**
   * Request timeout in ms. Defaults to the client timeout, raised to at least 90s for
   * `commit: "wait_for"`. Set it explicitly for indexes with `commit_timeout_secs` above 60.
   */
  timeout?: number;
}

/**
 * Response from the ingest API
 */
export interface IngestResponse {
  /** Number of documents queued for processing */
  num_docs_for_processing: number;

  /** Number of documents accepted by ingest v2. */
  num_ingested_docs?: number;

  /** Number of documents rejected during parsing by ingest v2. */
  num_rejected_docs?: number;

  /** Individual failures, present when detailed_response is true. */
  parse_failures?: IngestParseFailure[];
}

export interface IngestParseFailure {
  message: string;
  document: string;
  reason: "invalid_json" | "invalid_schema" | "unspecified";
}

// ============================================================================
// Index Management Types
// ============================================================================

/**
 * Request body for creating a new index
 */
export interface CreateIndexRequest {
  /** Version of the index configuration format */
  version: "0.9" | "0.8";

  /** Unique index ID */
  index_id: string;

  /** Index URI (storage location) */
  index_uri?: string;

  /** Document mapping configuration */
  doc_mapping: DocMapping;

  /** Indexing settings */
  indexing_settings?: IndexingSettings;

  /** Ingest API settings */
  ingest_settings?: IngestSettings;

  /** Search settings */
  search_settings?: SearchSettings;

  /** Retention policy */
  retention?: RetentionPolicy;
}

// ============================================================================
// Index Stats Types
// ============================================================================

/**
 * Index statistics from the describe endpoint
 */
export interface IndexStats {
  /** Index ID */
  index_id: string;

  /** Index URI */
  index_uri: string;

  /** Number of published splits */
  num_published_splits: number;

  /** Total size of published splits in bytes */
  size_published_splits: number;

  /** Number of published documents */
  num_published_docs: number;

  /** Uncompressed size of published documents in bytes */
  size_published_docs_uncompressed: number;

  /** Name of the timestamp field, if any */
  timestamp_field_name?: string;

  /** Minimum timestamp across all documents */
  min_timestamp?: number;

  /** Maximum timestamp across all documents */
  max_timestamp?: number;
}

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for listing indexes
 */
export interface ListIndexesOptions {
  /** Glob patterns to filter index IDs (e.g., ["logs-*", "metrics-*"]) */
  index_id_patterns?: string[];
}

/**
 * Options for creating an index
 */
export interface CreateIndexOptions {
  /** Overwrite the index if it already exists */
  overwrite?: boolean;
}

/**
 * Options for deleting an index
 */
export interface DeleteIndexOptions {
  /** Perform a dry run without actually deleting */
  dry_run?: boolean;
}

/**
 * Options for updating an index
 */
export interface UpdateIndexOptions {
  /** Create the index if it doesn't exist */
  create?: boolean;
}

/**
 * Options for updating a source
 */
export interface UpdateSourceOptions {
  /** Create the source if it doesn't exist */
  create?: boolean;
}

/**
 * File entry returned by delete operations
 */
export interface FileEntry {
  split_id: string;
  num_docs: number;
  uncompressed_docs_size_bytes: number;
  file_name: string;
  file_size_bytes: number;
}

export interface QuickwitVersion {
  build: {
    build_date: string;
    build_profile: string;
    build_target: string;
    cargo_pkg_version: string;
    commit_date: string;
    commit_hash: string;
    commit_short_hash: string;
    commit_tags: string[];
    version: string;
  };
  runtime: {
    num_cpus: number;
    num_threads_blocking: number;
    num_threads_non_blocking: number;
  };
}

export interface ClusterNodeId {
  node_id: string;
  generation_id: number;
  gossip_advertise_addr: string;
}

export interface ClusterSnapshot {
  cluster_id: string;
  self_node_id: ClusterNodeId;
  ready_nodes: ClusterNodeId[];
  live_nodes: ClusterNodeId[];
  dead_nodes: ClusterNodeId[];
  chitchat_state_snapshot: Record<string, unknown>;
}

export interface DeleteQueryRequest {
  query: string;
  search_fields?: string[];
  start_timestamp?: number;
  end_timestamp?: number;
}

export interface DeleteQuery {
  index_uid: string;
  query_ast: string;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
}

export interface DeleteTask {
  create_timestamp: number;
  opstamp: number;
  delete_query?: DeleteQuery | null;
}

export interface IndexTemplate {
  version: "0.9";
  template_id: string;
  index_id_patterns: string[];
  description?: string | null;
  index_root_uri?: string | null;
  priority?: number;
  doc_mapping: DocMapping;
  indexing_settings?: IndexingSettings;
  ingest_settings?: IngestSettings;
  search_settings?: SearchSettings;
  retention?: RetentionPolicy | null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if fast columnar storage is enabled for this field.
 *
 * Fast is ON when `fast` is `true` or a `{ normalizer }` object.
 * Fast is OFF when `fast` is `false` or missing.
 *
 * Prefer this over `f.fast === true`, which silently misses the object form
 * used by text/json fields with an explicit normalizer.
 */
export function isFastFieldEnabled(f: FieldMapping): boolean {
  return "fast" in f && f.fast !== undefined && f.fast !== false;
}
