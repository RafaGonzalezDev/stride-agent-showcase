import { createHash, randomUUID } from "node:crypto";
import type { AppendEventInput, LocalEventEnvelope } from "./types.js";
import { LOCAL_EVENT_SCHEMA_VERSION } from "./types.js";

export function createEventEnvelope(
  input: AppendEventInput,
  eventSequence: number,
  previousEventHash: string | null,
  payload: unknown,
  redactionApplied: boolean
): LocalEventEnvelope {
  const base = {
    id: randomUUID(),
    schemaVersion: LOCAL_EVENT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    sessionId: input.sessionId,
    streamId: input.streamId,
    eventSequence,
    previousEventHash,
    type: input.type,
    actor: input.actor,
    payload,
    redactionApplied
  } satisfies Omit<LocalEventEnvelope, "eventHash">;

  return {
    ...base,
    eventHash: computeEventHash(base)
  };
}

export function computeEventHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function getHashableEvent(event: LocalEventEnvelope): Omit<LocalEventEnvelope, "eventHash"> {
  const { eventHash: _eventHash, ...hashable } = event;
  return hashable;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
