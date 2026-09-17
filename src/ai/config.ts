/**
 * Which provider the server runs, and where both halves of it point.
 *
 * The spec's frozen decision is "cloud LLM (DeepSeek `deepseek-flash`, JSON
 * output) beside a local embedding (transformers.js, offline, no key)", with
 * one escape hatch on each side: a cloud LLM may be swapped for a local one
 * (Ollama's OpenAI-compatible endpoint) and the local embedding for a cloud
 * one. That makes **four combinations**, and this module is the only place
 * that knows any of them exists — the domain core never learns which one it
 * got, which is the whole point of the port.
 *
 * Everything here is read from the environment and from ordinary values, so
 * the combination is a property of one machine rather than of the code:
 *
 * ```text
 * YTwins_PROVIDER=real|demo        which side of the port answers (demo = 01–11's stand-in)
 * YTwins_LLM=cloud|local           the language model
 * YTwins_LLM_BASE_URL=…            its OpenAI-compatible endpoint
 * YTwins_LLM_MODEL=…               the model id
 * YTwins_LLM_API_KEY=…             the secret; only the server ever sees it
 * YTwins_EMBEDDING=local|cloud     the embedding
 * YTwins_EMBEDDING_BASE_URL=…      its endpoint, when it is a cloud one
 * YTwins_EMBEDDING_MODEL=…         the model id (or the repository a local one is fetched from)
 * YTwins_EMBEDDING_API_KEY=…       its secret, if it needs one
 * YTwins_EMBEDDING_HOST=…          where a local model is fetched from (a mirror, when there has to be one)
 * ```
 *
 * **An unrecognised value is refused, loudly.** A typo that quietly picked the
 * cloud instead of the local model would send the user's fragments off the
 * machine while they believed otherwise, which is the one mistake this
 * configuration must not be able to make.
 *
 * @module ai/config
 */

import { join } from 'node:path';

/** The two sides of the port: the real implementation, or 01–11's stand-in. */
export const PROVIDER_CHOICES: readonly string[] = ['real', 'demo'];
export type ProviderChoice = 'real' | 'demo';

/** Where a language model runs. */
export const LLM_KINDS: readonly string[] = ['cloud', 'local'];
export type LlmKind = 'cloud' | 'local';

/** Where an embedding runs. */
export const EMBEDDING_KINDS: readonly string[] = ['local', 'cloud'];
export type EmbeddingKind = 'local' | 'cloud';

/**
 * The demo default: DeepSeek's OpenAI-compatible endpoint.
 *
 * Note the missing `/v1`: DeepSeek serves `/chat/completions` at the root, and
 * an OpenAI-compatible server that does have a `/v1` prefix is configured by
 * putting it in the variable. The path appended by the client is the same
 * either way.
 */
export const DEFAULT_CLOUD_LLM_BASE_URL = 'https://api.deepseek.com';
/** The model the spec froze: DeepSeek's flash tier, which is the cheap one. */
export const DEFAULT_CLOUD_LLM_MODEL = 'deepseek-flash';
/** Ollama's OpenAI-compatible endpoint, which is where a local LLM usually answers. */
export const DEFAULT_LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
/** A small multilingual model that a laptop can run; only a starting point. */
export const DEFAULT_LOCAL_LLM_MODEL = 'qwen2.5:7b';
/** A small multilingual embedding, run on the CPU by transformers.js. */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
/** Any OpenAI-compatible embeddings endpoint; only used when the cloud one is chosen. */
export const DEFAULT_CLOUD_EMBEDDING_MODEL = 'text-embedding-3-small';
/** Where a local model is fetched from when it is not cached yet. */
export const DEFAULT_EMBEDDING_HOST = 'https://huggingface.co';
/**
 * How long one model call may take before it is abandoned.
 *
 * Generous, because a local model on a CPU is slow and a slow answer is better
 * than no answer: the domain treats a call that never returns as an ordinary
 * failure, so this is only here to keep a stuck request from holding a queue
 * open forever.
 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** One half of the port: the language model. */
export interface LlmConfig {
  readonly kind: LlmKind;
  /** The OpenAI-compatible base URL. `/chat/completions` is appended to it. */
  readonly baseUrl: string;
  readonly model: string;
  /** The secret, or null when none is configured. Never logged, never sent to the page. */
  readonly apiKey: string | null;
  readonly timeoutMs: number;
}

/** The other half: the embedding. */
export interface EmbeddingConfig {
  readonly kind: EmbeddingKind;
  readonly model: string;
  /** The endpoint, for a cloud embedding. Null when none was configured. */
  readonly baseUrl: string | null;
  /** Its secret, or null. Not inherited from the LLM half: they are different services. */
  readonly apiKey: string | null;
  /** Where a local model's files are cached. Inside the data directory, which git ignores. */
  readonly cacheDir: string;
  /** Where a local model is fetched from, when it is not cached. */
  readonly remoteHost: string;
  readonly timeoutMs: number;
}

/** Everything the composition root needs to build a provider. */
export interface ProviderConfig {
  readonly choice: ProviderChoice;
  readonly llm: LlmConfig;
  readonly embedding: EmbeddingConfig;
}

/** What the resolver is allowed to depend on besides the environment. */
export interface ConfigContext {
  /** The repository root, so the model cache can be placed under its data directory. */
  readonly repoRoot: string;
}

/**
 * The configuration refused something it was handed.
 *
 * Its own type so the server can tell "this machine is misconfigured" (worth a
 * message and a non-zero exit) from "a model misbehaved" (an ordinary failure
 * the product already survives).
 */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/** Read one of a fixed set of values, refusing anything else by name. */
function readChoice<T extends string>(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  allowed: readonly string[],
  fallback: T,
): T {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = raw.trim().toLowerCase();
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ProviderConfigError(
      `环境变量 ${name} 的值「${raw.trim()}」不认识；可用值是 ${allowed.join(' / ')}。`,
    );
  }
  return match as T;
}

/** A non-empty environment value, or the fallback when there is none. */
function readText(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: string,
): string {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  return value.length === 0 ? fallback : value;
}

/**
 * An optional value: absent and blank both mean "none configured".
 *
 * Used for the secrets and for the cloud embedding's endpoint, because the two
 * want the same reading — a variable that is set but empty is somebody having
 * left a placeholder behind, not a value.
 */
function readOptional(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const raw = env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

/** A positive whole number of milliseconds, refused by name when it is not one. */
function readMilliseconds(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new ProviderConfigError(
      `环境变量 ${name} 需要是一个正整数（毫秒），拿到的是「${raw.trim()}」。`,
    );
  }
  return value;
}

/**
 * Resolve the provider configuration from an environment.
 *
 * Pure: it reads the record it is handed and touches nothing else, so a check
 * can pin every combination without a machine being configured either way.
 *
 * @param env - the environment, usually `process.env` after `.env` has been loaded.
 * @param context - the repository root, for the model cache's location.
 * @returns the configuration, with defaults filled in.
 * @throws ProviderConfigError when a value is not one this product knows.
 */
export function resolveProviderConfig(
  env: Readonly<Record<string, string | undefined>>,
  context: ConfigContext,
): ProviderConfig {
  const llmKind = readChoice<LlmKind>(env, 'YTwins_LLM', LLM_KINDS, 'cloud');
  const embeddingKind = readChoice<EmbeddingKind>(
    env,
    'YTwins_EMBEDDING',
    EMBEDDING_KINDS,
    'local',
  );

  const cloudLlm = llmKind === 'cloud';
  const cloudEmbedding = embeddingKind === 'cloud';

  return {
    choice: readChoice<ProviderChoice>(env, 'YTwins_PROVIDER', PROVIDER_CHOICES, 'real'),
    llm: {
      kind: llmKind,
      baseUrl: readText(
        env,
        'YTwins_LLM_BASE_URL',
        cloudLlm ? DEFAULT_CLOUD_LLM_BASE_URL : DEFAULT_LOCAL_LLM_BASE_URL,
      ),
      model: readText(
        env,
        'YTwins_LLM_MODEL',
        cloudLlm ? DEFAULT_CLOUD_LLM_MODEL : DEFAULT_LOCAL_LLM_MODEL,
      ),
      apiKey: readOptional(env, 'YTwins_LLM_API_KEY'),
      timeoutMs: readMilliseconds(env, 'YTwins_LLM_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    },
    embedding: {
      kind: embeddingKind,
      model: readText(
        env,
        'YTwins_EMBEDDING_MODEL',
        cloudEmbedding ? DEFAULT_CLOUD_EMBEDDING_MODEL : DEFAULT_LOCAL_EMBEDDING_MODEL,
      ),
      baseUrl: cloudEmbedding ? readOptional(env, 'YTwins_EMBEDDING_BASE_URL') : null,
      apiKey: cloudEmbedding ? readOptional(env, 'YTwins_EMBEDDING_API_KEY') : null,
      cacheDir: join(context.repoRoot, 'data', 'models'),
      remoteHost: readText(env, 'YTwins_EMBEDDING_HOST', DEFAULT_EMBEDDING_HOST),
      timeoutMs: readMilliseconds(env, 'YTwins_EMBEDDING_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    },
  };
}
