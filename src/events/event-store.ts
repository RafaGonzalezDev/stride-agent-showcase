import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SecretRedactor } from "../security/redaction.js";
import { computeEventHash, createEventEnvelope, getHashableEvent } from "./hash.js";
import {
  EVENT_LOG_PHYSICAL_SCHEMA_VERSION,
  EventStoreValidationError,
  LOCAL_EVENT_SCHEMA_VERSION,
  type AppendEventInput,
  type EventLogRecord,
  type EventStore,
  type EventStoreValidationResult,
  type LocalEventEnvelope
} from "./types.js";

export interface EventStoreOptions {
  readonly redactor?: SecretRedactor;
}

export class InMemoryEventStore implements EventStore {
  private readonly redactor: SecretRedactor;
  private readonly events: LocalEventEnvelope[] = [];

  public constructor(options: EventStoreOptions = {}) {
    this.redactor = options.redactor ?? new SecretRedactor();
  }

  public async append(event: AppendEventInput): Promise<LocalEventEnvelope> {
    const streamEvents = this.events.filter((storedEvent) => storedEvent.streamId === event.streamId);
    const previous = streamEvents.at(-1);
    const redacted = this.redactor.redact(event.payload);
    const envelope = createEventEnvelope(
      event,
      (previous?.eventSequence ?? 0) + 1,
      previous?.eventHash ?? null,
      redacted.value,
      redacted.redactionApplied
    );
    this.events.push(envelope);
    return structuredClone(envelope) as LocalEventEnvelope;
  }

  public async readStream(streamId: string): Promise<readonly LocalEventEnvelope[]> {
    await this.validate();
    return this.events.filter((event) => event.streamId === streamId).map(cloneEvent);
  }

  public async readAll(): Promise<readonly LocalEventEnvelope[]> {
    await this.validate();
    return this.events.map(cloneEvent);
  }

  public async validate(): Promise<EventStoreValidationResult> {
    validateEvents(this.events);
    return { ok: true, eventCount: this.events.length };
  }
}

export interface FileEventStoreOptions extends EventStoreOptions {
  readonly filePath: string;
}

export class FileEventStore implements EventStore {
  private readonly filePath: string;
  private readonly redactor: SecretRedactor;

  public constructor(options: FileEventStoreOptions) {
    this.filePath = options.filePath;
    this.redactor = options.redactor ?? new SecretRedactor();
  }

  public async append(event: AppendEventInput): Promise<LocalEventEnvelope> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const events = await this.loadEvents();
    validateEvents(events);
    const streamEvents = events.filter((storedEvent) => storedEvent.streamId === event.streamId);
    const previous = streamEvents.at(-1);
    const redacted = this.redactor.redact(event.payload);
    const envelope = createEventEnvelope(
      event,
      (previous?.eventSequence ?? 0) + 1,
      previous?.eventHash ?? null,
      redacted.value,
      redacted.redactionApplied
    );
    const record: EventLogRecord = {
      physicalSchemaVersion: EVENT_LOG_PHYSICAL_SCHEMA_VERSION,
      event: envelope
    };
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    return cloneEvent(envelope);
  }

  public async readStream(streamId: string): Promise<readonly LocalEventEnvelope[]> {
    const events = await this.loadValidatedEvents();
    return events.filter((event) => event.streamId === streamId).map(cloneEvent);
  }

  public async readAll(): Promise<readonly LocalEventEnvelope[]> {
    return (await this.loadValidatedEvents()).map(cloneEvent);
  }

  public async validate(): Promise<EventStoreValidationResult> {
    const events = await this.loadValidatedEvents();
    return { ok: true, eventCount: events.length };
  }

  private async loadValidatedEvents(): Promise<readonly LocalEventEnvelope[]> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const events = await this.loadEvents();
    validateEvents(events);
    return events;
  }

  private async loadEvents(): Promise<LocalEventEnvelope[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && String(error.code) === "ENOENT") {
        return [];
      }
      throw error;
    }

    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const record = JSON.parse(line) as EventLogRecord;
        if (record.physicalSchemaVersion !== EVENT_LOG_PHYSICAL_SCHEMA_VERSION) {
          throw new EventStoreValidationError("invalid_physical_schema_version", "Unsupported event log physical schema version.");
        }
        return record.event;
      });
  }
}

export function validateEvents(events: readonly LocalEventEnvelope[]): void {
  const stateByStream = new Map<string, { expectedSequence: number; previousHash: string | null }>();

  for (const event of events) {
    if (event.schemaVersion !== LOCAL_EVENT_SCHEMA_VERSION) {
      throw new EventStoreValidationError("invalid_schema_version", "Unsupported event schema version.", event.streamId, event.eventSequence);
    }

    const state = stateByStream.get(event.streamId) ?? { expectedSequence: 1, previousHash: null };
    if (event.eventSequence !== state.expectedSequence) {
      throw new EventStoreValidationError("sequence_gap", "Event sequence gap detected.", event.streamId, event.eventSequence);
    }

    if (event.previousEventHash !== state.previousHash) {
      throw new EventStoreValidationError("previous_hash_mismatch", "Previous event hash mismatch detected.", event.streamId, event.eventSequence);
    }

    const expectedHash = computeEventHash(getHashableEvent(event));
    if (event.eventHash !== expectedHash) {
      throw new EventStoreValidationError("event_hash_mismatch", "Event hash mismatch detected.", event.streamId, event.eventSequence);
    }

    stateByStream.set(event.streamId, {
      expectedSequence: event.eventSequence + 1,
      previousHash: event.eventHash
    });
  }
}

function cloneEvent(event: LocalEventEnvelope): LocalEventEnvelope {
  return structuredClone(event) as LocalEventEnvelope;
}
