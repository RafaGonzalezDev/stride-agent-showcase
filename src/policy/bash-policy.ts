import { PolicyGate, matchesString } from "./gate.js";
import type {
  PermissionDecision,
  PermissionState,
  PolicyDecisionSource,
  PolicyEvaluation,
  PolicyPatternKind,
  PolicyRequest,
  PolicyRule,
  PolicyStringMatcher,
  PolicyToolDefault
} from "./types.js";

export interface BashCommandPolicyRequest {
  readonly rawCommand: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface BashCommandPattern {
  readonly kind: PolicyPatternKind;
  readonly value: string;
  readonly field?: "rawCommand" | "normalizedCommand";
  readonly partial?: boolean;
}

export interface BashCommandRule {
  readonly id: string;
  readonly decision: PermissionState;
  readonly source: Exclude<PolicyDecisionSource, "fallback">;
  readonly reason: string;
  readonly command: BashCommandPattern;
  readonly allowCompound?: boolean;
  readonly expiresAt?: string;
}

export interface BashCommandPolicyOptions {
  readonly rules?: readonly BashCommandRule[];
  readonly toolDefault?: PermissionDecision;
}

export interface BashCommandAnalysis {
  readonly rawCommand: string;
  readonly normalizedCommand: string;
  readonly hasCompoundOperators: boolean;
  readonly compoundOperators: readonly string[];
  readonly cwd?: string;
  readonly envKeys: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface BashPolicyEvaluation extends PolicyEvaluation {
  readonly bash: BashCommandAnalysis;
}

export class BashCommandPolicy {
  private readonly rules: readonly BashCommandRule[];
  private readonly toolDefault: PolicyToolDefault | undefined;

  public constructor(options: BashCommandPolicyOptions = {}) {
    this.rules = options.rules ?? [];
    this.toolDefault = options.toolDefault === undefined
      ? undefined
      : {
          decision: options.toolDefault,
          toolName: { kind: "exact", value: "bash" },
          capability: { kind: "exact", value: "shell:execute" }
        };
  }

  public evaluate(request: BashCommandPolicyRequest | PolicyRequest): BashPolicyEvaluation {
    const bashRequest = toBashCommandPolicyRequest(request);
    const bash = analyzeBashCommand(bashRequest);
    const gateRequest: PolicyRequest = {
      toolName: "bash",
      capability: "shell:execute",
      target: bash.normalizedCommand,
      ...(bashRequest.cwd === undefined ? {} : { cwd: bashRequest.cwd }),
      parameterSummary: {
        rawCommand: bash.rawCommand,
        normalizedCommand: bash.normalizedCommand,
        compoundOperators: bash.compoundOperators,
        envKeys: bash.envKeys,
        ...(bash.timeoutMs === undefined ? {} : { timeoutMs: bash.timeoutMs }),
        ...(bash.maxOutputBytes === undefined ? {} : { maxOutputBytes: bash.maxOutputBytes })
      }
    };

    const explicitCompoundAllow = this.rules.some(
      (rule) => rule.decision === "allow" && rule.allowCompound === true && matchesBashRule(rule, bash)
    );

    if (bash.hasCompoundOperators && !explicitCompoundAllow) {
      return {
        request: gateRequest,
        matchedRules: [],
        bash,
        decision: {
          state: "deny",
          source: "explicit",
          scope: "command",
          reason: "Compound bash commands require an explicit allow rule.",
          matchedRuleId: "bash.compound-command"
        }
      };
    }

    const evaluation = new PolicyGate({
      rules: this.rules.filter((rule) => matchesBashRule(rule, bash)).map(toMatchedPolicyRule),
      ...(this.toolDefault === undefined ? {} : { toolDefault: this.toolDefault })
    }).evaluate(gateRequest);

    return { ...evaluation, bash };
  }
}

export function normalizeBashCommand(rawCommand: string): string {
  return rawCommand.trim().replace(/\s+/g, " ");
}

function toBashCommandPolicyRequest(request: BashCommandPolicyRequest | PolicyRequest): BashCommandPolicyRequest {
  if ("rawCommand" in request) {
    return request;
  }

  const summary = request.parameterSummary;
  const rawCommand = readString(summary?.["rawCommand"]) ?? request.target ?? "";
  const timeoutMs = readNumber(summary?.["timeoutMs"]);
  const maxOutputBytes = readNumber(summary?.["maxOutputBytes"]);

  return {
    rawCommand,
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes })
  };
}

export function analyzeBashCommand(request: BashCommandPolicyRequest): BashCommandAnalysis {
  const compoundOperators = detectCompoundOperators(request.rawCommand);

  return {
    rawCommand: request.rawCommand,
    normalizedCommand: normalizeBashCommand(request.rawCommand),
    hasCompoundOperators: compoundOperators.length > 0,
    compoundOperators,
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    envKeys: Object.keys(request.env ?? {}).sort(),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.maxOutputBytes === undefined ? {} : { maxOutputBytes: request.maxOutputBytes })
  };
}

export function detectCompoundOperators(command: string): readonly string[] {
  const operators = new Set<string>();
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const current = command[index]!;
    const next = command[index + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (current === "\\") {
      escaped = true;
      continue;
    }

    if (current === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }

    if (current === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }

    if (singleQuoted) {
      continue;
    }

    if (doubleQuoted) {
      if (current === "$" && next === "(") {
        operators.add("$()");
        index += 1;
      } else if (current === "`") {
        operators.add("`");
      }
      continue;
    }

    if (current === "&" && next === "&") {
      operators.add("&&");
      index += 1;
      continue;
    }

    if (current === "|" && next === "|") {
      operators.add("||");
      index += 1;
      continue;
    }

    if (current === "$" && next === "(") {
      operators.add("$()");
      index += 1;
      continue;
    }

    if (current === "\n") {
      operators.add("newline");
      continue;
    }

    if (current === ";" || current === "|" || current === "`" || current === ">" || current === "<") {
      operators.add(current);
    }
  }

  return [...operators].sort();
}

function toPolicyRule(rule: BashCommandRule): PolicyRule {
  return {
    id: rule.id,
    decision: rule.decision,
    source: rule.source,
    scope: "command",
    reason: rule.reason,
    toolName: { kind: "exact", value: "bash" },
    capability: { kind: "exact", value: "shell:execute" },
    target: toStringMatcher(rule.command),
    ...(rule.expiresAt === undefined ? {} : { expiresAt: rule.expiresAt })
  };
}

function toMatchedPolicyRule(rule: BashCommandRule): PolicyRule {
  const policyRule = toPolicyRule(rule);
  const { target: _target, ...matchedPolicyRule } = policyRule;
  return matchedPolicyRule;
}

function toStringMatcher(pattern: BashCommandPattern): PolicyStringMatcher {
  return {
    kind: pattern.kind,
    value: pattern.value,
    ...(pattern.partial === undefined ? {} : { partial: pattern.partial })
  };
}

function matchesBashRule(rule: BashCommandRule, bash: BashCommandAnalysis): boolean {
  const field = rule.command.field ?? "normalizedCommand";
  return matchesString(toStringMatcher(rule.command), bash[field]);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
