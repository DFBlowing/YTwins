/**
 * The cloud embedding: the same port, the other side of the privacy trade.
 *
 * The spec's default is a local embedding, and this exists because the default
 * is a *choice* rather than a rule: the four combinations are
 * cloud/local LLM × local/cloud embedding, and a machine that would rather not
 * hold a model and spend CPU has to be able to say so. Nothing else about the
 * product changes when it does — the domain compares whatever vectors it is
 * given, and only compares two of them when they came from the same model.
 *
 * It speaks the OpenAI `/embeddings` shape, which is what makes it the same
 * configurable thing as the chat half: one endpoint and one model id, whether
 * that endpoint is OpenAI, a compatible cloud, or a local server exposing the
 * same route.
 *
 * Note what it does **not** borrow: the LLM's key. The two halves are different
 * services with different credentials, and a configuration that fell back to
 * the chat key would send a credential to an endpoint nobody chose for it.
 *
 * @module ai/cloud-embedding
 */

import { DEFAULT_TIMEOUT_MS } from './config.ts';
import { ProviderCallError, isTimeoutError, shorten } from './errors.ts';
import type { Embedder } from './vectors.ts';
import { toVectors } from './vectors.ts';

/** What the cloud embedder needs. */
export interface CloudEmbeddingOptions {
  /** The OpenAI-compatible base URL. `/embeddings` is appended. */
  readonly baseUrl: string;
  readonly model: string;
  /** Its own secret, or null for an endpoint that wants none. */
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
  /** The transport. Defaults to the global `fetch`; injected by checks. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Build a cloud embedder.
 *
 * @param options - where to call, what to ask, and how long to wait.
 * @returns the embedder.
 */
export function createCloudEmbedding(options: CloudEmbeddingOptions): Embedder {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/u, '')}/embeddings`;
  const name = `云端 embedding「${options.model}」`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (options.apiKey !== null) headers['authorization'] = `Bearer ${options.apiKey}`;

  return {
    async embed(texts) {
      // The same reading as the local one: nothing to encode is nothing to do,
      // and an empty batch is a pointless request to pay for.
      if (texts.length === 0) return [];

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: options.model, input: texts, encoding_format: 'float' }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new ProviderCallError(
            `${name} 超时（${timeoutMs}ms 内没有响应），已放弃。`,
            { cause: error },
          );
        }
        throw new ProviderCallError(
          `${name} 连不上 ${url}：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new ProviderCallError(`${name} 返回 ${response.status}：${shorten(raw)}`);
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch (error) {
        throw new ProviderCallError(`${name} 返回的不是 JSON：${shorten(raw)}`, { cause: error });
      }

      const data = (envelope as { data?: unknown } | null)?.data;
      if (!Array.isArray(data)) {
        throw new ProviderCallError(`${name} 的返回里没有 data 数组：${shorten(raw)}`);
      }

      // The response is a list of objects, one per input, each carrying its
      // vector. Anything else — a count that does not line up, a vector that is
      // not numbers — is refused by `toVectors` rather than passed on.
      const vectors = data.map((entry) => (entry as { embedding?: unknown } | null)?.embedding);
      return toVectors(vectors, texts.length, name);
    },
  };
}
