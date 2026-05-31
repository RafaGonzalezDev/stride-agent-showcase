export type PermissionState = "allow" | "ask" | "deny";
export type PolicyDecisionSource = "explicit" | "session" | "global" | "tool-default" | "fallback";
export type PolicyScope = "tool" | "capability" | "target" | "command";
export type PolicyPatternKind = "exact" | "glob" | "regex";

export interface PermissionDecision {
  readonly state: PermissionState;
  readonly source: PolicyDecisionSource;
  readonly scope: PolicyScope;
  readonly reason: string;
  readonly matchedRuleId?: string;
  readonly expiresAt?: string;
  readonly auditEventId?: string;
}

export interface PolicyStringMatcher {
  readonly kind: PolicyPatternKind;
  readonly value: string;
  readonly partial?: boolean;
}

export interface PolicyRequest {
  readonly toolName: string;
  readonly capability: string;
  readonly target?: string;
  readonly cwd?: string;
  readonly parameterSummary?: Readonly<Record<string, unknown>>;
}

export interface PolicyRule {
  readonly id: string;
  readonly decision: PermissionState;
  readonly source: Exclude<PolicyDecisionSource, "fallback">;
  readonly scope: PolicyScope;
  readonly reason: string;
  readonly toolName?: PolicyStringMatcher;
  readonly capability?: PolicyStringMatcher;
  readonly target?: PolicyStringMatcher;
  readonly expiresAt?: string;
}

export interface PolicyToolDefault {
  readonly decision: PermissionDecision;
  readonly toolName?: PolicyStringMatcher;
  readonly capability?: PolicyStringMatcher;
  readonly target?: PolicyStringMatcher;
}

export interface PolicyGateOptions {
  readonly rules?: readonly PolicyRule[];
  readonly toolDefault?: PermissionDecision | PolicyToolDefault;
}

export interface PolicyEvaluation {
  readonly request: PolicyRequest;
  readonly matchedRules: readonly PolicyRule[];
  readonly decision: PermissionDecision;
}

export interface PolicyGateContract {
  evaluate(request: PolicyRequest): PolicyEvaluation | Promise<PolicyEvaluation>;
}
