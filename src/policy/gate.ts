import type {
  PermissionDecision,
  PolicyDecisionSource,
  PolicyEvaluation,
  PolicyGateOptions,
  PolicyRequest,
  PolicyRule,
  PolicyStringMatcher,
  PolicyToolDefault
} from "./types.js";

const sourcePriority = new Map<PolicyDecisionSource, number>([
  ["explicit", 0],
  ["session", 1],
  ["global", 2],
  ["tool-default", 3],
  ["fallback", 4]
]);

export class PolicyGate {
  private readonly rules: readonly PolicyRule[];
  private readonly toolDefault: PolicyToolDefault | undefined;

  public constructor(options: PolicyGateOptions = {}) {
    this.rules = options.rules ?? [];
    this.toolDefault = normalizeToolDefault(options.toolDefault);
  }

  public evaluate(request: PolicyRequest): PolicyEvaluation {
    const matchedRules = this.rules.filter((rule) => matchesRule(rule, request));
    const denyRule = selectRule(matchedRules.filter((rule) => rule.decision === "deny"));

    if (denyRule !== undefined) {
      return createRuleEvaluation(request, matchedRules, denyRule);
    }

    const selectedRule = selectRule(matchedRules);
    if (selectedRule !== undefined) {
      return createRuleEvaluation(request, matchedRules, selectedRule);
    }

    if (this.toolDefault !== undefined && matchesToolDefault(this.toolDefault, request)) {
      return {
        request,
        matchedRules,
        decision: this.toolDefault.decision
      };
    }

    return {
      request,
      matchedRules,
      decision: {
        state: "ask",
        source: "fallback",
        scope: "tool",
        reason: "No policy rule or tool default matched the request."
      }
    };
  }
}

export function matchesString(matcher: PolicyStringMatcher, value: string): boolean {
  if (matcher.kind === "exact") {
    return matcher.partial === true ? value.includes(matcher.value) : value === matcher.value;
  }

  if (matcher.kind === "glob") {
    return globToRegExp(matcher.value, matcher.partial === true).test(value);
  }

  const source = matcher.partial === true ? matcher.value : anchorRegexSource(matcher.value);
  return new RegExp(source).test(value);
}

function matchesRule(rule: PolicyRule, request: PolicyRequest): boolean {
  return (
    matchesOptional(rule.toolName, request.toolName) &&
    matchesOptional(rule.capability, request.capability) &&
    matchesOptional(rule.target, request.target ?? "")
  );
}

function matchesToolDefault(toolDefault: PolicyToolDefault, request: PolicyRequest): boolean {
  return (
    hasDefaultMatcher(toolDefault) &&
    matchesOptional(toolDefault.toolName, request.toolName) &&
    matchesOptional(toolDefault.capability, request.capability) &&
    matchesOptional(toolDefault.target, request.target ?? "")
  );
}

function hasDefaultMatcher(toolDefault: PolicyToolDefault): boolean {
  return toolDefault.toolName !== undefined || toolDefault.capability !== undefined || toolDefault.target !== undefined;
}

function normalizeToolDefault(value: PermissionDecision | PolicyToolDefault | undefined): PolicyToolDefault | undefined {
  if (value === undefined) {
    return undefined;
  }

  if ("decision" in value) {
    return value;
  }

  return { decision: value };
}

function matchesOptional(matcher: PolicyStringMatcher | undefined, value: string): boolean {
  return matcher === undefined || matchesString(matcher, value);
}

function selectRule(rules: readonly PolicyRule[]): PolicyRule | undefined {
  let selected: PolicyRule | undefined;

  for (const rule of rules) {
    if (selected === undefined || getPriority(rule.source) < getPriority(selected.source)) {
      selected = rule;
    }
  }

  return selected;
}

function getPriority(source: PolicyDecisionSource): number {
  return sourcePriority.get(source) ?? sourcePriority.get("fallback")!;
}

function createRuleEvaluation(request: PolicyRequest, matchedRules: readonly PolicyRule[], rule: PolicyRule): PolicyEvaluation {
  return {
    request,
    matchedRules,
    decision: {
      state: rule.decision,
      source: rule.source,
      scope: rule.scope,
      reason: rule.reason,
      matchedRuleId: rule.id,
      ...(rule.expiresAt === undefined ? {} : { expiresAt: rule.expiresAt })
    }
  };
}

function anchorRegexSource(source: string): string {
  const startsAnchored = source.startsWith("^");
  const endsAnchored = source.endsWith("$");
  return `${startsAnchored ? "" : "^"}${source}${endsAnchored ? "" : "$"}`;
}

function globToRegExp(pattern: string, partial: boolean): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(partial ? escaped : `^${escaped}$`);
}
