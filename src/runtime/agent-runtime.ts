import type {
  AgentRuntimeErrorCode,
  AgentRuntimeOptions,
  AgentRuntimeResult,
  AgentRuntimeRunRequest,
  RoutedToolResult,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeMessage,
  RuntimeProviderResponse,
  RuntimeRedactor,
  RuntimeToolCall,
  ToolRouter
} from "./types.js";

const defaultMaxTurns = 6;

export class AgentRuntime {
  private readonly provider: AgentRuntimeOptions["provider"];
  private readonly toolRouter: ToolRouter;
  private readonly maxTurns: number;
  private readonly redactor: RuntimeRedactor | undefined;
  private readonly hooks: AgentRuntimeOptions["hooks"];
  private readonly stopOnPolicyFailure: boolean;

  public constructor(options: AgentRuntimeOptions) {
    this.provider = options.provider;
    this.toolRouter = options.toolRouter;
    this.maxTurns = validateMaxTurns(options.maxTurns ?? defaultMaxTurns);
    this.redactor = options.redactor;
    this.hooks = options.hooks;
    this.stopOnPolicyFailure = options.stopOnPolicyFailure ?? true;
  }

  public async run(request: AgentRuntimeRunRequest): Promise<AgentRuntimeResult> {
    const events: RuntimeEvent[] = [];
    const messages: RuntimeMessage[] = [...(request.messages ?? []), { role: "user", content: request.input }];
    const emit = (type: RuntimeEventType, payload: unknown) => this.emit(events, type, payload, request.onEvent);

    try {
      const maxTurns = validateMaxTurns(request.maxTurns ?? this.maxTurns);
      await this.recordSessionMessage(messages.at(-1)!);
      await emit("runtime.started", { maxTurns });

      for (let turn = 1; turn <= maxTurns; turn += 1) {
        await emit("provider.requested", { turn, messageCount: messages.length });
        const providerResponse = await this.provider({ messages: [...messages], turn });
        await emit("provider.completed", summarizeProviderResponse(turn, providerResponse));

        const assistantMessage = createAssistantMessage(providerResponse);
        messages.push(assistantMessage);
        await this.recordSessionMessage(assistantMessage);
        await emit("assistant.completed", summarizeAssistantResponse(turn, providerResponse));

        if (providerResponse.toolCalls === undefined || providerResponse.toolCalls.length === 0) {
          const output = providerResponse.content ?? "";
          await emit("runtime.completed", { output });
          return { ok: true, output, messages, events };
        }

        for (const toolCall of providerResponse.toolCalls) {
          await emit("tool.requested", createToolRequestPayload(toolCall));
          const routedResult = await this.toolRouter.run(toolCall);
          const completedEvent = await emit("tool.completed", routedResult);
          const toolMessage = createToolMessage(toolCall, routedResult, completedEvent.timestamp);
          messages.push(toolMessage);
          await this.recordSessionMessage(toolMessage);

          const policyStop = this.stopOnPolicyFailure ? createPolicyFailureStop(routedResult) : undefined;
          if (policyStop !== undefined) {
            await emit("runtime.failed", policyStop.payload);
            return {
              ok: false,
              output: "",
              messages,
              events,
              error: policyStop.error,
              errorCode: policyStop.errorCode
            };
          }
        }
      }

      const error = this.redact(`Runtime stopped after reaching maxTurns (${maxTurns}).`);
      await emit("runtime.failed", { error, reason: "maxTurns" });
      return { ok: false, output: "", messages, events, error, errorCode: "max-turns" };
    } catch (error) {
      const message = this.redact(errorToMessage(error));
      await emit("runtime.failed", { error: message });
      return { ok: false, output: "", messages, events, error: message, errorCode: "runtime-error" };
    }
  }

  private async emit(
    events: RuntimeEvent[],
    type: RuntimeEventType,
    payload: unknown,
    onEvent: AgentRuntimeRunRequest["onEvent"]
  ): Promise<RuntimeEvent> {
    const event: RuntimeEvent = {
      type,
      timestamp: new Date().toISOString(),
      payload: redactPayload(payload, this.redactor)
    };

    events.push(event);
    await onEvent?.(event);
    await this.hooks?.onEvent?.(event);
    await this.hooks?.onAuditEvent?.(event);
    return event;
  }

  private async recordSessionMessage(message: RuntimeMessage): Promise<void> {
    await this.hooks?.onSessionMessage?.(message);
  }

  private redact(value: string): string {
    return this.redactor?.redact(value) ?? value;
  }
}

function validateMaxTurns(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("maxTurns must be a positive integer.");
  }

  return value;
}

function createAssistantMessage(response: RuntimeProviderResponse): RuntimeMessage {
  return {
    role: "assistant",
    content: response.content ?? "",
    ...(response.toolCalls === undefined || response.toolCalls.length === 0 ? {} : { toolCalls: response.toolCalls })
  };
}

function createToolMessage(toolCall: RuntimeToolCall, result: RoutedToolResult, occurredAt: string): RuntimeMessage {
  return {
    role: "tool",
    name: toolCall.name,
    toolCallId: toolCall.id,
    content: JSON.stringify({ occurredAt, ...result })
  };
}

function createToolRequestPayload(toolCall: RuntimeToolCall): object {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    arguments: createSafeDisplayArguments(toolCall.name, toolCall.arguments)
  };
}

function createSafeDisplayArguments(toolName: string, args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }

  const record = args as Record<string, unknown>;
  const allowedKeys = toolName === "read"
    ? ["path", "maxBytes"]
    : toolName === "list"
      ? ["path", "maxDepth", "maxEntries"]
      : toolName === "search"
        ? ["path", "maxResults"]
        : toolName === "write" || toolName === "edit"
          ? ["path"]
          : [];

  return Object.fromEntries(allowedKeys.flatMap((key) => record[key] === undefined ? [] : [[key, record[key]]]));
}

function summarizeProviderResponse(turn: number, response: RuntimeProviderResponse): object {
  return {
    turn,
    hasOutput: response.content !== undefined && response.content.length > 0,
    toolCallCount: response.toolCalls?.length ?? 0
  };
}

function summarizeAssistantResponse(turn: number, response: RuntimeProviderResponse): object {
  return {
    turn,
    content: response.content ?? "",
    toolCallCount: response.toolCalls?.length ?? 0
  };
}

interface PolicyFailureStop {
  readonly error: string;
  readonly errorCode: AgentRuntimeErrorCode;
  readonly payload: object;
}

function createPolicyFailureStop(result: RoutedToolResult): PolicyFailureStop | undefined {
  const toolResult = result.result;
  if (toolResult === undefined || toolResult.ok !== false) {
    return undefined;
  }

  if (toolResult.code === "policy-required") {
    return {
      error: "Tool execution requires approval.",
      errorCode: "needs-approval",
      payload: {
        error: "Tool execution requires approval.",
        reason: "needs-approval",
        toolCallId: result.toolCallId,
        name: result.name,
        audit: toolResult.audit
      }
    };
  }

  if (toolResult.code === "policy-denied") {
    return {
      error: "Tool execution was denied by policy.",
      errorCode: "permission-denied",
      payload: {
        error: "Tool execution was denied by policy.",
        reason: "permission-denied",
        toolCallId: result.toolCallId,
        name: result.name,
        audit: toolResult.audit
      }
    };
  }

  return undefined;
}

function redactPayload(payload: unknown, redactor: RuntimeRedactor | undefined): unknown {
  if (redactor === undefined) {
    return payload;
  }

  if (typeof payload === "string") {
    return redactor.redact(payload);
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactPayload(item, redactor));
  }

  if (payload !== null && typeof payload === "object") {
    return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, redactPayload(value, redactor)]));
  }

  return payload;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
