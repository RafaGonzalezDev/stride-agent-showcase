import assert from "node:assert/strict";
import test from "node:test";

import { AuditLogger, EventStoreValidationError, InMemoryEventStore, SecretRedactor, SessionStore, validateEvents } from "../dist/index.js";

test("event store assigns sequence and hash chain per stream", async () => {
  const store = new InMemoryEventStore();
  const first = await store.append({ sessionId: "s1", streamId: "session:s1", type: "one", actor: "system", payload: { ok: true } });
  const second = await store.append({ sessionId: "s1", streamId: "session:s1", type: "two", actor: "agent", payload: { ok: true } });

  assert.equal(first.eventSequence, 1);
  assert.equal(second.eventSequence, 2);
  assert.equal(second.previousEventHash, first.eventHash);
  assert.equal((await store.validate()).eventCount, 2);
});

test("event store redacts before persistence", async () => {
  const store = new InMemoryEventStore({ redactor: new SecretRedactor() });
  await store.append({ sessionId: "s1", streamId: "audit:s1", type: "provider.error", actor: "provider", payload: { message: "sk-fake-secret-value" } });
  const events = await store.readAll();

  assert.equal(events[0].redactionApplied, true);
  assert.doesNotMatch(JSON.stringify(events[0].payload), /sk-fake-secret-value/);
});

test("validateEvents detects tampering", async () => {
  const store = new InMemoryEventStore();
  const event = await store.append({ sessionId: "s1", streamId: "audit:s1", type: "one", actor: "system", payload: { ok: true } });
  const tampered = { ...event, payload: { ok: false } };

  assert.throws(() => validateEvents([tampered]), EventStoreValidationError);
});

test("session and audit facades write separate streams", async () => {
  const store = new InMemoryEventStore();
  const sessions = new SessionStore(store);
  const audit = new AuditLogger(store);

  await sessions.startSession({ sessionId: "s1" });
  await audit.log({ sessionId: "s1", type: "permission.decided", actor: "agent", payload: { state: "allow" } });

  assert.equal((await sessions.readSession("s1")).length, 1);
  assert.equal((await audit.readAudit("s1")).length, 1);
});
