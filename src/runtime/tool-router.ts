import type {
  RoutedToolResult,
  RuntimeRedactor,
  RuntimeTool,
  RuntimeToolCall,
  ToolRouterOptions
} from "./types.js";
import type { ToolContext, ToolResult } from "../tools/index.js";

export class DefaultToolRouter {
  private readonly registry: ToolRouterOptions["registry"];
  private readonly tools: Readonly<Record<string, RuntimeTool>>;
  private readonly toolContext: ToolContext;
  private readonly redactor: RuntimeRedactor | undefined;

  public constructor(options: ToolRouterOptions) {
    this.registry = options.registry;
    this.tools = options.tools ?? {};
    this.toolContext = options.toolContext;
    this.redactor = options.redactor;
  }

  public async run(call: RuntimeToolCall): Promise<RoutedToolResult> {
    const tool = this.registry?.get(call.name) ?? this.tools[call.name];

    if (tool === undefined) {
      return {
        toolCallId: call.id,
        name: call.name,
        status: "error",
        error: this.redact(`Unknown tool: ${call.name}`)
      };
    }

    if (tool.policyEnforced !== true) {
      return {
        toolCallId: call.id,
        name: call.name,
        status: "error",
        error: this.redact(`Tool is not registered with policy enforcement metadata: ${call.name}`)
      };
    }

    try {
      const result = await tool.execute(call.arguments, this.toolContext);
      return normalizeToolResult(call, redactToolResult(result, this.redactor));
    } catch (error) {
      return {
        toolCallId: call.id,
        name: call.name,
        status: "error",
        error: this.redact(errorToMessage(error))
      };
    }
  }

  private redact(value: string): string {
    return this.redactor?.redact(value) ?? value;
  }
}

function normalizeToolResult(call: RuntimeToolCall, result: ToolResult<unknown>): RoutedToolResult {
  return {
    toolCallId: call.id,
    name: call.name,
    status: result.ok ? "success" : "failure",
    result
  };
}

function redactToolResult(result: ToolResult<unknown>, redactor: RuntimeRedactor | undefined): ToolResult<unknown> {
  return redactValue(result, redactor) as ToolResult<unknown>;
}

function redactValue(value: unknown, redactor: RuntimeRedactor | undefined): unknown {
  if (redactor === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactor.redact(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactor));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, redactor)]));
  }

  return value;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
