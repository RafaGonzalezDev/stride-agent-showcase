export const LOCAL_EVENT_SCHEMA_VERSION = "stride.showcase.event.v1";
export const EVENT_LOG_PHYSICAL_SCHEMA_VERSION = "stride.showcase.log.v1";

export type EventActor = "system" | "user" | "agent" | "provider" | "tool";

export interface AppendEventInput {
  readonly sessionId: string;
  readonly streamId: string;
  readonly type: string;
  readonly actor: EventActor;
  readonly payload: unknown;
}

export interface LocalEventEnvelope {
  readonly id: string;
  readonly schemaVersion: typeof LOCAL_EVENT_SCHEMA_VERSION;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly streamId: string;
  readonly eventSequence: number;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
  readonly type: string;
  readonly actor: EventActor;
  readonly payload: unknown;
  readonly redactionApplied: boolean;
}

export interface EventLogRecord {
  readonly physicalSchemaVersion: typeof EVENT_LOG_PHYSICAL_SCHEMA_VERSION;
  readonly event: LocalEventEnvelope;
}

export interface EventStoreValidationResult {
  readonly ok: true;
  readonly eventCount: number;
}

export interface EventStore {
  append(event: AppendEventInput): Promise<LocalEventEnvelope>;
  readStream(streamId: string): Promise<readonly LocalEventEnvelope[]>;
  readAll(): Promise<readonly LocalEventEnvelope[]>;
  validate(): Promise<EventStoreValidationResult>;
}

export class EventStoreValidationError extends Error {
  public constructor(
    public readonly code: "invalid_physical_schema_version" | "invalid_schema_version" | "sequence_gap" | "previous_hash_mismatch" | "event_hash_mismatch",
    message: string,
    public readonly streamId?: string,
    public readonly eventSequence?: number
  ) {
    super(message);
    this.name = "EventStoreValidationError";
  }
}
