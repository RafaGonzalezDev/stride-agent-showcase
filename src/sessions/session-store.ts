import type { EventActor, EventStore, LocalEventEnvelope } from "../events/index.js";

export interface RecordSessionEventInput {
  readonly sessionId: string;
  readonly type: string;
  readonly actor: EventActor;
  readonly payload: unknown;
}

export class SessionStore {
  public constructor(private readonly eventStore: EventStore) {}

  public startSession(input: { readonly sessionId: string; readonly actor?: EventActor; readonly payload?: unknown }): Promise<LocalEventEnvelope> {
    return this.recordEvent({
      sessionId: input.sessionId,
      type: "session.started",
      actor: input.actor ?? "system",
      payload: input.payload ?? {}
    });
  }

  public closeSession(sessionId: string, payload: unknown = {}): Promise<LocalEventEnvelope> {
    return this.recordEvent({
      sessionId,
      type: "session.closed",
      actor: "system",
      payload
    });
  }

  public recordEvent(input: RecordSessionEventInput): Promise<LocalEventEnvelope> {
    return this.eventStore.append({
      sessionId: input.sessionId,
      streamId: `session:${input.sessionId}`,
      type: input.type,
      actor: input.actor,
      payload: input.payload
    });
  }

  public readSession(sessionId: string): Promise<readonly LocalEventEnvelope[]> {
    return this.eventStore.readStream(`session:${sessionId}`);
  }
}
