# stride-agent-showcase

A sanitized TypeScript/Node showcase for a policy-gated coding-agent runtime.

This project demonstrates how AI-assisted developer automation can be designed around explicit permission decisions, safe tool boundaries, provider abstraction, redaction, append-only events, and auditable execution.

## What it demonstrates

- A central permission model with `allow`, `ask`, and `deny` decisions.
- Policy-gated filesystem and shell tools.
- A runtime loop that can process provider tool calls.
- A fake provider for deterministic local demos without credentials.
- An optional OpenAI-compatible adapter with injected transport for tests or future integration.
- Secret redaction before tool output or event persistence.
- Append-only session/audit event streams with hash-chain validation.
- A small plugin manifest, registry, and loader boundary.

## Quick start

```sh
npm install
npm run check
npm run build
node dist/cli/main.js --print "list files" --json
```

The default CLI composition uses the fake provider and in-memory audit/session stores. It does not require network access or provider credentials.

## Example prompts

```sh
node dist/cli/main.js --print "summarize this project"
node dist/cli/main.js --print "list files" --json
node dist/cli/main.js --print "read README" --json
node dist/cli/main.js --print "try bash" --json
```

The `try bash` example returns a structured approval-required result because shell execution is `ask` by default in the demo policy.

## Architecture

```txt
CLI -> Runtime -> Provider
        |          |
        |          -> Fake provider or OpenAI-compatible adapter
        |
        -> Tool router -> policy-gated tools
        -> Session/audit hooks -> redacted append-only event store
```

## Safety boundaries

- No credentials are required for tests or the default CLI demo.
- Examples use fake secrets only to validate redaction.
- Generated output, local environment files, sessions, logs, and private planning artifacts are excluded.
- The original private repository history is not used.
- Shell commands and file writes are approval-required in the default CLI policy.

## Development

```sh
npm run build
npm test
npm run typecheck
npm run check
```

## Repository structure

```txt
src/
├── audit/       # audit facade over event streams
├── cli/         # safe print workflow
├── events/      # append-only event store and hash validation
├── plugins/     # manifest validation, registry, loader
├── policy/      # permission gate and bash command policy
├── providers/   # fake and OpenAI-compatible providers
├── runtime/     # agent loop and tool router
├── security/    # secret redaction
├── sessions/    # session facade over event streams
└── tools/       # policy-gated filesystem and shell tools
```

## License

MIT. See [`LICENSE`](LICENSE).

## Roadmap

See [`plan.md`](./plan.md) for the implementation plan and current status.
