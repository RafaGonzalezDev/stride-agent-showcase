import { AuditLogger } from "../audit/index.js";
import { InMemoryEventStore } from "../events/index.js";
import { PolicyGate } from "../policy/index.js";
import { createFakeProvider } from "../providers/index.js";
import { AgentRuntime, DefaultToolRouter, type RuntimeEvent, type RuntimeMessage } from "../runtime/index.js";
import { SecretRedactor } from "../security/redaction.js";
import { SessionStore } from "../sessions/index.js";
import { BashTool, EditTool, ListTool, ReadTool, SearchTool, WriteTool, type Tool } from "../tools/index.js";
import type { CliRunDependencies } from "./types.js";

export function createDefaultCliDependencies(cwd: string): CliRunDependencies {
  const secretRedactor = new SecretRedactor();
  const redactor = {
    redact(value: string): string {
      return secretRedactor.redactText(value).value;
    }
  };
  const eventStore = new InMemoryEventStore({ redactor: secretRedactor });
  const sessionStore = new SessionStore(eventStore);
  const auditLogger = new AuditLogger(eventStore);
  const sessionId = "demo-session";
  const policyGate = new PolicyGate({
    rules: [
      {
        id: "allow-read-tools",
        decision: "allow",
        source: "global",
        scope: "capability",
        reason: "Read-only demo tools are allowed.",
        capability: { kind: "exact", value: "filesystem:read" }
      },
      {
        id: "ask-write-tools",
        decision: "ask",
        source: "global",
        scope: "capability",
        reason: "Write tools require explicit approval in this demo.",
        capability: { kind: "exact", value: "filesystem:write" }
      },
      {
        id: "ask-shell-tools",
        decision: "ask",
        source: "global",
        scope: "capability",
        reason: "Shell execution requires explicit approval in this demo.",
        capability: { kind: "exact", value: "shell:execute" }
      }
    ]
  });
  const tools = createBaseTools();
  const toolRouter = new DefaultToolRouter({
    tools: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
    toolContext: { workspaceRoot: cwd, policyGate },
    redactor
  });
  const runtime = new AgentRuntime({
    provider: createFakeProvider(),
    toolRouter,
    redactor,
    hooks: {
      async onEvent(event: RuntimeEvent): Promise<void> {
        await sessionStore.recordEvent({
          sessionId,
          type: event.type,
          actor: actorForEvent(event),
          payload: event.payload
        });
      },
      async onAuditEvent(event: RuntimeEvent): Promise<void> {
        await auditLogger.log({
          sessionId,
          type: event.type,
          actor: actorForEvent(event),
          payload: event.payload
        });
      },
      async onSessionMessage(message: RuntimeMessage): Promise<void> {
        await sessionStore.recordEvent({
          sessionId,
          type: "session.message",
          actor: actorForMessage(message),
          payload: message
        });
      }
    }
  });

  return { runtime, redactor };
}

function createBaseTools(): readonly Tool[] {
  return [new ListTool(), new ReadTool(), new SearchTool(), new WriteTool(), new EditTool(), new BashTool()];
}

function actorForEvent(event: RuntimeEvent) {
  if (event.type.startsWith("provider.")) {
    return "provider" as const;
  }
  if (event.type.startsWith("tool.")) {
    return "tool" as const;
  }
  return "agent" as const;
}

function actorForMessage(message: RuntimeMessage) {
  if (message.role === "user") {
    return "user" as const;
  }
  if (message.role === "tool") {
    return "tool" as const;
  }
  if (message.role === "system") {
    return "system" as const;
  }
  return "agent" as const;
}
