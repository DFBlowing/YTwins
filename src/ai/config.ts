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
 * **Changing vendor is changing one value.** `YTwins_LLM_PRESET` names one of
 * the five endpoints in the table below, and that row carries the three things
 * that actually differ between vendors: the base URL, the model, and where the
 * key goes. So "use Gemini instead" is `YTwins_LLM_PRESET=gemini` plus a key,
 * and "use a fourth vendor" is a row, not a branch — 「换 provider 是换值」, the
 * principle ticket 16 states and the one the port itself was frozen on. The
 * explicit variables below still win over a preset and are the escape hatch;
 * the ones that did win are recorded in `overrides`, because an override nobody
 * can see is a configuration drift. The one thing `YTwins_LLM` may not do is
 * contradict a preset about where the model runs — that is a lie about whether
 * the user's words leave the machine, and it is refused by name.
 *
 * Everything here is read from the environment and from ordinary values, so
 * the combination is a property of one machine rather than of the code:
 *
 * ```text
 * YTwins_PROVIDER=real|demo        which side of the port answers (demo = 01–11's stand-in)
 * YTwins_LLM=cloud|local           the language model (with a preset: agreement, not choice)
 * YTwins_LLM_PRESET=…              which vendor's endpoint to call (deepseek / gemini / opencode / ollama / custom)
 * YTwins_LLM_BASE_URL=…            its OpenAI-compatible endpoint — overrides the preset
 * YTwins_LLM_MODEL=…               the model id — overrides the preset
 * YTwins_LLM_API_KEY=…             the secret; only the server ever sees it
 * YTwins_LLM_HEADERS=…             extra request headers, `name=value;name=value` (never logged)
 * YTwins_EMBEDDING=local|cloud     the embedding
 * YTwins_EMBEDDING_BASE_URL=…      its endpoint, when it is a cloud one
 * YTwins_EMBEDDING_MODEL=…         the model id (or the repository a local one is fetched from)
 * YTwins_EMBEDDING_API_KEY=…       its secret, if it needs one
 * YTwins_EMBEDDING_HOST=…          where a local model is fetched from (a mirror, when there has to be one)
 * ```
 *
 * **The embedding half is deliberately not a preset.** Ticket 14 measured this:
 * the link thresholds are calibrated against one embedding, and swapping it
 * (e5-small → bge-small-zh-v1.5) moves a true pair from 0.875 to 0.456 and makes
 * the two distributions overlap. Changing embedding is changing a calibration,
 * not a value, so it stays behind an explicit base URL and key rather than a
 * one-line vendor switch.
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
export type ProviderChoice = 'real' | 'demo';
export const PROVIDER_CHOICES: readonly ProviderChoice[] = ['real', 'demo'];

/** Where a language model runs. */
export type LlmKind = 'cloud' | 'local';
export const LLM_KINDS: readonly LlmKind[] = ['cloud', 'local'];

/** Where an embedding runs. */
export type EmbeddingKind = 'local' | 'cloud';
export const EMBEDDING_KINDS: readonly EmbeddingKind[] = ['local', 'cloud'];

/**
 * The cloud endpoint used when no preset is chosen: DeepSeek's.
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

/**
 * The two headers the client writes from the request it is actually making.
 *
 * They live here rather than in `src/ai/openai-chat.ts` for one reason: that
 * module must not be given a configuration that collides with them, and a
 * refusal list is only honest if it is the same list the client writes. The
 * client imports this, so there is one copy; the client spreads it last, so
 * nobody can talk it into claiming a body it is not sending.
 */
export const PROTOCOL_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  accept: 'application/json',
};

/**
 * Where a vendor wants the key, and what goes in front of it.
 *
 * The one seam that lets a fourth vendor be a table row: `Authorization: Bearer`
 * is what every OpenAI-compatible endpoint in this table happens to use, but a
 * vendor that wants `x-goog-api-key`, or an `Authorization` with no scheme, is
 * the same shape with two different strings.
 */
export interface PresetAuth {
  /** The header's name, lower-case. This is the header `YTwins_LLM_HEADERS` may not take over. */
  readonly header: string;
  /** What is written before the key — `'Bearer '`, or `''` for a header that carries the key alone. */
  readonly scheme: string;
}

/** One vendor's OpenAI-compatible endpoint: a row of the table below, keyed by its own name. */
export interface LlmPreset {
  /**
   * Where the model runs, or null when the row cannot know and the environment must say.
   *
   * Never a soft default: with the key in `YTwins_LLM` disagreeing, the product
   * would call a cloud endpoint "local" — and tell the user, wrongly, that
   * their words never leave the machine.
   */
  readonly kind: LlmKind | null;
  /** The endpoint, or null when the row cannot know it and the environment must say. */
  readonly baseUrl: string | null;
  /** The model, or null for the same reason. */
  readonly model: string | null;
  /** Where this vendor wants the key. */
  readonly auth: PresetAuth;
  /**
   * Headers **every** request to this vendor carries, if any.
   *
   * A secret does not belong here — this table is in git. A per-session header
   * (`x-opencode-session` and its like) goes in `YTwins_LLM_HEADERS`, which is
   * read at startup from the machine and never printed.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/** Where the key goes when no preset says: today's shape, and OpenAI's own. */
const DEFAULT_AUTH: PresetAuth = { header: 'authorization', scheme: 'Bearer ' };

/**
 * The five endpoints this product knows, checked against the vendors themselves
 * on 2026-09-18 rather than remembered.
 *
 *  - **deepseek** — `GET https://api.deepseek.com/models` answered 200 with
 *    `deepseek-flash` and `deepseek-v4-pro`. Endpoint, auth and default model
 *    are therefore facts this machine has seen, not a reading of a doc.
 *  - **gemini** — Google's official OpenAI compatibility layer: base URL
 *    `https://generativelanguage.googleapis.com/v1beta/openai/`,
 *    `Authorization: Bearer $GEMINI_API_KEY`. The model is the one its own
 *    examples name — `gemini-3.8-flash` when this row was checked, where the
 *    ticket had written the example from the day it was opened
 *    (`gemini-3.6-flash`). (https://ai.google.dev/gemini-api/docs/openai)
 *  - **opencode** — OpenCode Zen's gateway. Only its `/chat/completions` tier is
 *    promised here: the same host also serves `/responses`, `/messages` and
 *    `/models/<id>`, three shapes this product does not speak. The model is the
 *    DeepSeek one in that tier, `deepseek-v4-flash`. (https://opencode.ai/docs/zen/)
 *  - **ollama** — a model on this machine, at the endpoint Ticket 12 already
 *    used. It needs no key; a key that is configured anyway is used, exactly as
 *    it is on the no-preset local path.
 *  - **custom** — the escape hatch. It deliberately knows nothing, so
 *    `YTwins_LLM_BASE_URL` and `YTwins_LLM_MODEL` must both be given, and
 *    `YTwins_LLM=local` is how a machine says its custom endpoint is its own.
 *    Guessing "OpenAI" for a machine that never said so would be an invented fact.
 *
 * `x-opencode-session` appears in reports of Zen's free/Go tiers and in
 * third-party clients (openclaw, zed), which is why extra headers are a
 * configuration field at all — and why they live in `.env` rather than here.
 */
export const LLM_PRESETS = {
  deepseek: {
    kind: 'cloud',
    baseUrl: DEFAULT_CLOUD_LLM_BASE_URL,
    model: DEFAULT_CLOUD_LLM_MODEL,
    auth: DEFAULT_AUTH,
    headers: {},
  },
  gemini: {
    kind: 'cloud',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    auth: DEFAULT_AUTH,
    headers: {},
  },
  opencode: {
    kind: 'cloud',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'deepseek-v4-flash',
    auth: DEFAULT_AUTH,
    headers: {},
  },
  ollama: {
    kind: 'local',
    baseUrl: DEFAULT_LOCAL_LLM_BASE_URL,
    model: DEFAULT_LOCAL_LLM_MODEL,
    auth: DEFAULT_AUTH,
    headers: {},
  },
  custom: {
    kind: null,
    baseUrl: null,
    model: null,
    auth: DEFAULT_AUTH,
    headers: {},
  },
} as const satisfies Record<string, LlmPreset>;

/** The names a `YTwins_LLM_PRESET` may hold, in the order the table lists them. */
export type LlmPresetName = keyof typeof LLM_PRESETS;
export const LLM_PRESET_NAMES: readonly LlmPresetName[] = Object.keys(
  LLM_PRESETS,
) as LlmPresetName[];

/** One half of the port: the language model. */
export interface LlmConfig {
  readonly kind: LlmKind;
  /** Which preset this machine chose, or null when it named the endpoint itself. */
  readonly preset: LlmPresetName | null;
  /**
   * The explicit variables that were set on top of the preset, in reading order.
   *
   * Only `YTwins_LLM_BASE_URL` and `YTwins_LLM_MODEL` can appear: `YTwins_LLM`
   * is not an override but an agreement (see `LlmPreset.kind` — a kind that
   * contradicts the preset is refused, and one that agrees overrides nothing),
   * and `YTwins_LLM_HEADERS` adds rather than overrides. Empty whenever no
   * preset is chosen, and empty for `custom` (which *asks for* those variables
   * rather than being overridden by them). The startup log prints these, so a
   * preset that is not the whole story says so.
   */
  readonly overrides: readonly string[];
  /** The OpenAI-compatible base URL. `/chat/completions` is appended to it. */
  readonly baseUrl: string;
  readonly model: string;
  /**
   * The secret, or null when none is configured. Never logged, never sent to the page.
   *
   * The semantic half of the pair below: this is what "is a key configured?"
   * reads, while `headers` is the same key in the shape the wire wants. Both
   * are built from one `readOptional` in one object literal, so they cannot
   * disagree about whether a key exists.
   */
  readonly apiKey: string | null;
  /**
   * Every request header beyond the protocol's own, auth included.
   *
   * Values are secrets — a session token is as good as a key — so they are
   * never logged, never counted by value, and never reach the page. The client
   * only ever hands them to `fetch`.
   */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * How many headers `YTwins_LLM_HEADERS` added on top of the preset's own.
   *
   * A count, and only a count: the startup log prints it so that "this machine
   * is not running the plain preset" is visible, and the values are credentials
   * that must never be written down.
   */
  readonly extraHeaderCount: number;
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
function readOneOf<T extends string>(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  allowed: readonly T[],
  whenAbsent: T | null,
): T | null {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return whenAbsent;
  const value = raw.trim().toLowerCase();
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ProviderConfigError(
      `环境变量 ${name} 的值「${raw.trim()}」不认识；可用值是 ${allowed.join(' / ')}。`,
    );
  }
  return match;
}

/** The same, for a value that has a default rather than a "not said". */
function readChoice<T extends string>(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return readOneOf(env, name, allowed, fallback) ?? fallback;
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

/** Which preset this machine asked for, or null when it asked for none. */
function readPresetName(
  env: Readonly<Record<string, string | undefined>>,
): LlmPresetName | null {
  return readOneOf(env, 'YTwins_LLM_PRESET', LLM_PRESET_NAMES, null);
}

/**
 * A value the environment may state, a preset may supply, or a default may cover.
 *
 * The three are tried in that order, which is the whole of "显式变量优先于预设":
 * an explicit value always wins, and `overrodePreset` says whether it won over
 * something — a preset that supplied no value (or no preset at all) is not
 * being overridden, which is why `custom`'s two required variables are not
 * reported as overrides of it.
 */
function readFromPreset(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  presetName: LlmPresetName | null,
  field: 'baseUrl' | 'model',
  fallback: string,
  what: string,
): { readonly value: string; readonly overrodePreset: boolean } {
  const stated = readOptional(env, name);
  const fromPreset = presetName === null ? null : LLM_PRESETS[presetName][field];
  if (stated !== null) return { value: stated, overrodePreset: fromPreset !== null };
  if (fromPreset !== null) return { value: fromPreset, overrodePreset: false };
  if (presetName === null) return { value: fallback, overrodePreset: false };
  throw new ProviderConfigError(
    `预设 ${presetName} 不能自己决定${what}：请在 ${name} 里给出来。`,
  );
}

/** A header name is a token: no spaces, no colons, no controls (RFC 9110 §5.6.2). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;

/**
 * The extra request headers a machine configured, as `name=value;name=value`.
 *
 * Read here and handed to the client as plain values, because `src/ai/openai-chat.ts`
 * is not allowed to know any vendor: it knows "base URL, model, and these
 * headers", which is also what makes a fourth vendor a table row.
 *
 * Names are lower-cased (they are not case-sensitive on the wire), and three
 * things are refused rather than sent:
 *
 *  - the header the key goes in, *when there is a key* — two sources for one
 *    credential means one of them silently loses, and the key is the one source
 *    this product promises. With no key configured nothing else writes that
 *    header, so it is left available: a local gateway asking for `Basic …` or
 *    for `Authorization: Bearer <its own token>` is a real machine;
 *  - `content-type` / `accept`, which the client writes from the request it is
 *    actually making. Letting a configuration claim the body is `text/plain`
 *    while it sends JSON is a failure nobody would enjoy diagnosing;
 *  - a segment that is not `name=value`, or a name that is not a token.
 *
 * A refusal never quotes a value: the one thing these strings are is
 * credentials, and an error message goes to the log.
 */
function readHeaders(
  env: Readonly<Record<string, string | undefined>>,
  authHeader: string,
  hasKey: boolean,
): Readonly<Record<string, string>> {
  const raw = readOptional(env, 'YTwins_LLM_HEADERS');
  if (raw === null) return {};

  const headers: Record<string, string> = {};
  const segments = raw.split(';');
  for (const [index, segment] of segments.entries()) {
    const entry = segment.trim();
    if (entry.length === 0) continue;

    const separator = entry.indexOf('=');
    if (separator <= 0) {
      throw new ProviderConfigError(
        `环境变量 YTwins_LLM_HEADERS 里第 ${index + 1} 段不是一段「名字=值」；` +
          '多段之间用 ; 隔开，例如 x-opencode-session=abc。' +
          '（这一段不回显：它可能是凭证。）',
      );
    }
    const name = entry.slice(0, separator).trim().toLowerCase();
    if (!HEADER_NAME.test(name)) {
      throw new ProviderConfigError(
        `环境变量 YTwins_LLM_HEADERS 里第 ${index + 1} 段的请求头名字不是合法的头名` +
          '（不许有空格、冒号或控制字符）。',
      );
    }
    if (hasKey && name === authHeader) {
      throw new ProviderConfigError(
        `环境变量 YTwins_LLM_HEADERS 里不许出现 ${authHeader}：已经配置了 ` +
          'YTwins_LLM_API_KEY，两处写同一个头会有一个静默失效。',
      );
    }
    if (name in PROTOCOL_HEADERS) {
      throw new ProviderConfigError(
        `环境变量 YTwins_LLM_HEADERS 里不许出现 ${name}：这个头由客户端按请求本身写死，` +
          '配置它只会让请求自相矛盾。',
      );
    }
    headers[name] = entry.slice(separator + 1).trim();
  }
  return headers;
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
  const presetName = readPresetName(env);
  const preset: LlmPreset | null = presetName === null ? null : LLM_PRESETS[presetName];

  // A preset knows where its model runs, so `YTwins_LLM` may only agree with it
  // — except for `custom`, whose row is null there precisely because the
  // environment is the only thing that can know. Disagreeing with a known
  // vendor is refused rather than obeyed: `YTwins_LLM=local` beside a cloud
  // endpoint would make this product call a cloud service "local" in the
  // startup log and in the page's own data-boundary disclosure, and the user
  // would believe their words never left the machine. That is the one mistake
  // this module exists to make impossible.
  const presetKind = preset?.kind ?? null;
  const llmKind = readChoice<LlmKind>(env, 'YTwins_LLM', LLM_KINDS, presetKind ?? 'cloud');
  if (presetKind !== null && llmKind !== presetKind) {
    throw new ProviderConfigError(
      `预设 ${presetName} 跑在${presetKind === 'cloud' ? '云端' : '本机'}，` +
        `而 YTwins_LLM=${llmKind} 与它矛盾：认错了会把你说的话送去你以为是本机的那个地方。` +
        '要指向别处的端点，请用 YTwins_LLM_PRESET=custom 把端点与模型都显式写出来。',
    );
  }
  const embeddingKind = readChoice<EmbeddingKind>(
    env,
    'YTwins_EMBEDDING',
    EMBEDDING_KINDS,
    'local',
  );

  const cloudLlm = llmKind === 'cloud';
  const cloudEmbedding = embeddingKind === 'cloud';

  const baseUrl = readFromPreset(
    env,
    'YTwins_LLM_BASE_URL',
    presetName,
    'baseUrl',
    cloudLlm ? DEFAULT_CLOUD_LLM_BASE_URL : DEFAULT_LOCAL_LLM_BASE_URL,
    '端点',
  );
  const model = readFromPreset(
    env,
    'YTwins_LLM_MODEL',
    presetName,
    'model',
    cloudLlm ? DEFAULT_CLOUD_LLM_MODEL : DEFAULT_LOCAL_LLM_MODEL,
    '模型',
  );
  const apiKey = readOptional(env, 'YTwins_LLM_API_KEY');
  const auth = preset?.auth ?? DEFAULT_AUTH;
  const extraHeaders = readHeaders(env, auth.header, apiKey !== null);

  const overrides = [
    ...(baseUrl.overrodePreset ? ['YTwins_LLM_BASE_URL'] : []),
    ...(model.overrodePreset ? ['YTwins_LLM_MODEL'] : []),
  ];

  return {
    choice: readChoice<ProviderChoice>(env, 'YTwins_PROVIDER', PROVIDER_CHOICES, 'real'),
    llm: {
      kind: llmKind,
      preset: presetName,
      overrides,
      baseUrl: baseUrl.value,
      model: model.value,
      apiKey,
      // The key is the one header a preset decides the shape of; a key that is
      // not configured writes nothing at all, which is what a local endpoint
      // wants and what an unconfigured cloud one is told about elsewhere.
      headers: {
        ...(preset?.headers ?? {}),
        ...(apiKey === null ? {} : { [auth.header]: `${auth.scheme}${apiKey}` }),
        ...extraHeaders,
      },
      extraHeaderCount: Object.keys(extraHeaders).length,
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
