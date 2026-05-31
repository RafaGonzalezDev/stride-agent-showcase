import type { EventActor, EventStore, LocalEventEnvelope } from "../events/index.js";

export interface AuditLogInput {
  readonly sessionId: string;
  readonly type: string;
  readonly actor: EventActor;
  readonly payload: unknown;
}

export class AuditLogger {
  public constructor(private readonly eventStore: EventStore) {}

  public log(input: AuditLogInput): Promise<LocalEventEnvelope> {
    return this.eventStore.append({
      sessionId: input.sessionId,
      streamId: `audit:${input.sessionId}`,
      type: input.type,
      actor: input.actor,
      payload: input.payload
    });
  }

  public readAudit(sessionId: string): Promise<readonly LocalEventEnvelope[]> {
    return this.eventStore.readStream(`audit:${sessionId}`);
  }
}
