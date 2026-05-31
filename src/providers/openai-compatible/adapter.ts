import type { RuntimeProvider, RuntimeProviderRequest } from "../../runtime/index.js";
import { redactSecrets } from "../../security/redaction.js";
import { buildOpenAICompatibleRequest } from "./request-builder.js";
import { parseOpenAICompatibleResponse } from "./response-parser.js";
import type { OpenAICompatibleProviderOptions } from "./types.js";

export class OpenAICompatibleProviderAdapter {
  private readonly options: OpenAICompatibleProviderOptions;

  public constructor(options: OpenAICompatibleProviderOptions) {
    this.options = options;
  }

  public asRuntimeProvider(): RuntimeProvider {
    return (request) => this.complete(request);
  }

  public async complete(request: RuntimeProviderRequest) {
    const httpRequest = buildOpenAICompatibleRequest({
      baseUrl: this.options.baseUrl,
      apiKey: this.options.apiKey,
      model: this.options.model,
      messages: request.messages,
      ...(this.options.tools === undefined ? {} : { tools: this.options.tools })
    });

    try {
      const response = await this.options.transport.send(httpRequest);
      return parseOpenAICompatibleResponse(response.status, response.body);
    } catch (error) {
      throw redactProviderError(error);
    }
  }
}

function redactProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactSecrets(message).value);
}
