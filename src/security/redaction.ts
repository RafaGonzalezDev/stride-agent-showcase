export interface RedactionResult<T = unknown> {
  readonly value: T;
  readonly redactionApplied: boolean;
}

const textSecretPatterns: readonly { readonly name: string; readonly pattern: RegExp; readonly replacement: string }[] = [
  {
    name: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "<redacted-private-key>"
  },
  {
    name: "bearer_token",
    pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{12,}|sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/gi,
    replacement: "Bearer <redacted>"
  },
  {
    name: "openai_style_key",
    pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    replacement: "<redacted-api-key>"
  },
  {
    name: "github_token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g,
    replacement: "<redacted-github-token>"
  },
  {
    name: "env_secret",
    pattern: /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|KEY)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi,
    replacement: "$1=<redacted>"
  },
  {
    name: "named_secret",
    pattern: /\b(token|secret|password|api[_-]?key)\b\s*([:=])\s*([^\s]+)/gi,
    replacement: "$1$2<redacted>"
  }
];

export class SecretRedactor {
  public redactText(value: string): RedactionResult<string> {
    let redacted = value;

    for (const pattern of textSecretPatterns) {
      redacted = redacted.replace(pattern.pattern, pattern.replacement);
    }

    return {
      value: redacted,
      redactionApplied: redacted !== value
    };
  }

  public redact<T>(value: T): RedactionResult<T> {
    return redactValue(value, this) as RedactionResult<T>;
  }
}

export function redactSecrets(value: string): RedactionResult<string> {
  return new SecretRedactor().redactText(value);
}

function redactValue(value: unknown, redactor: SecretRedactor): RedactionResult<unknown> {
  if (typeof value === "string") {
    return redactor.redactText(value);
  }

  if (Array.isArray(value)) {
    let redactionApplied = false;
    const items = value.map((item) => {
      const redacted = redactValue(item, redactor);
      redactionApplied = redactionApplied || redacted.redactionApplied;
      return redacted.value;
    });

    return { value: items, redactionApplied };
  }

  if (value !== null && typeof value === "object") {
    let redactionApplied = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const redacted = shouldRedactObjectKey(key)
        ? { value: "<redacted>", redactionApplied: true }
        : redactValue(item, redactor);
      redactionApplied = redactionApplied || redacted.redactionApplied;
      return [key, redacted.value] as const;
    });

    return { value: Object.fromEntries(entries), redactionApplied };
  }

  return { value, redactionApplied: false };
}

function shouldRedactObjectKey(key: string): boolean {
  return /(?:token|secret|password|api[_-]?key|authorization)/i.test(key);
}
