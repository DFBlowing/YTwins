/**
 * The OpenAI-compatible chat call the language model half is built on.
 *
 * One shape of request serves every operation: a system message carrying the
 * product's rules and the shape of the answer, a user message carrying the
 * material, and `response_format: { type: 'json_object' }` asking for the JSON
 * that the operations then check field by field. DeepSeek's documentation is
 * explicit about the two things that matters for: JSON mode wants the word
 * "json" and an example in the prompt, and it **sometimes returns empty
 * content** — so an empty answer is diagnosed as the known quirk it is rather
 * than reported as a mystery.
 *
 * The endpoint is not hard-coded. `baseUrl` is whatever an OpenAI-compatible
 * server answers on — DeepSeek's `https://api.deepseek.com`, an OpenAI-compatible
 * cloud, or Ollama's `http://127.0.0.1:11434/v1` — and `/chat/completions` is
 * appended to it. The local option is why nothing here assumes a key exists:
 * `apiKey: null` sends no `Authorization` header at all, which is what a local
 * model expects.
 *
 * **`fetch` is injected.** Not for tidiness: it is the one thing standing
 * between this code and a network, and a check that could not replace it could
 * only ever test this module by calling a real model — which would make the
 * suite non-deterministic, cost money, and fail on a train. With it replaced,
 * every failure path below is pinned by a check.
 *
 * @module ai/openai-chat
 */

import { DEFAULT_TIMEOUT_MS } from './config.ts';
import { ProviderCallError, isTimeoutError, shorten } from './errors.ts';
import { readJsonObject } from './structured.ts';

/** One message, in the shape every OpenAI-compatible endpoint takes. */
export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/** Everything the client needs, none of it read from the environment directly. */
export interface ChatClientOptions {
  /** The base URL. `/chat/completions` is appended; a trailing slash is fine. */
  readonly baseUrl: string;
  readonly model: string;
  /** The secret, or null for an endpoint that wants no key (a local one). */
  readonly apiKey: string | null;
  /** How long one call may take. Defaults to two minutes. */
  readonly timeoutMs?: number;
  /** The transport. Defaults to the global `fetch`; injected by tests. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/** The port's one way in: ask for a JSON object, name the call for the errors. */
export interface ChatClient {
  /**
   * Ask once, and read the JSON object out of the answer.
   *
   * @param messages - the system rules and the material, in that order.
   * @param operation - the operation's name, used in every error message.
   * @returns the parsed object.
   * @throws ProviderCallError for every way this can fail.
   */
  askJson(messages: readonly ChatMessage[], operation: string): Promise<Record<string, unknown>>;
}

/** The assistant's message content out of an OpenAI-compatible envelope. */
function readContent(raw: string, operation: string): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new ProviderCallError(
      `调用 ${operation} 时端点返回的不是 JSON：${shorten(raw)}`,
      { cause: error },
    );
  }

  const choices = (envelope as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    // Quoted in full, because this shape of answer is almost always the
    // endpoint telling us something (a proxy, a wrong URL, a model that does
    // not exist) and the body is the only place it says what.
    throw new ProviderCallError(
      `调用 ${operation} 时端点没有返回任何 choices：${shorten(raw)}`,
    );
  }

  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderCallError(
      `调用 ${operation} 时端点返回的 choices[0].message.content 不是字符串：${shorten(raw)}`,
    );
  }
  return content;
}

/**
 * Build a client for one endpoint.
 *
 * @param options - where to call, what to ask, and how long to wait.
 * @returns the client.
 */
export function createChatClient(options: ChatClientOptions): ChatClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/u, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  // Only when there is a key: an empty `Bearer ` on a local endpoint is a
  // header the server has to decide what to do about, and some reject it.
  if (options.apiKey !== null) headers['authorization'] = `Bearer ${options.apiKey}`;

  return {
    async askJson(messages, operation) {
      const body = {
        model: options.model,
        messages,
        stream: false,
        // Low but not zero: this is a reading of the user's own words, and the
        // same fragment read twice should read the same way.
        temperature: 0.2,
        response_format: { type: 'json_object' },
      };

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new ProviderCallError(
            `调用 ${operation} 超时（${timeoutMs}ms 内没有响应），已放弃。`,
            { cause: error },
          );
        }
        throw new ProviderCallError(
          `调用 ${operation} 时连不上模型端点 ${url}：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new ProviderCallError(
          `调用 ${operation} 时端点返回 ${response.status}：${shorten(raw)}`,
        );
      }

      return readJsonObject(readContent(raw, operation), operation);
    },
  };
}
