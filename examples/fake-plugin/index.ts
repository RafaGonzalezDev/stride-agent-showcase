import type { PluginRegistrationContext } from "../../src/plugins/index.js";

export default {
  register(context: PluginRegistrationContext): void {
    context.registerTool({
      name: "echo",
      description: "Return a short safe message.",
      capability: "demo:echo",
      policyEnforced: true,
      async execute() {
        return {
          ok: true,
          output: { message: "hello from a safe demo plugin" },
          audit: {
            toolName: "example.safe-tools.echo",
            capability: "demo:echo",
            sideEffect: false
          }
        };
      }
    });
  }
};
