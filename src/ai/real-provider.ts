/**
 * Joining the two halves into the port's real implementation.
 *
 * The language model and the embedding are configured, built and reported
 * separately, because they are separate things: one may be a cloud service and
 * the other a model on this disk, and a failure of either is a fact about that
 * half rather than about "the provider". This module is where they meet, and it
 * is the only place that knows both exist.
 *
 * **A half that is not configured is still a working half.** Each one that
 * cannot be built — a cloud LLM with no key, a cloud embedding with no endpoint
 * — becomes an implementation whose every call fails with the reason, naming
 * the variable that is missing. That is deliberately not a crash and not a
 * `null`: the domain is built to survive a provider that refuses (a drop is
 * still recorded and still answered by code, and a question says the records
 * could not be searched rather than that they contain nothing), so "the key is
 * not filled in yet" behaves like any other outage — except that the reason is
 * legible. Refusing to start would take the rest of the product down with it.
 *
 * What the caller gets back is the provider **and the notes**: one short line
 * per half, in Chinese, for the server to log at startup. The notes are the
 * only way a person finds out which combination their machine is actually
 * running, and they never include a key — only whether one is configured.
 *
 * @module ai/real-provider
 */

import type { AiProvider } from '../domain/ai-provider.ts';
import { createCloudEmbedding } from './cloud-embedding.ts';
import type { ProviderConfig } from './config.ts';
import { ProviderCallError } from './errors.ts';
import { createLlmOperations, type LlmOperations } from './llm-provider.ts';
import { createLocalEmbedding, type LoadFeatureExtractor } from './local-embedding.ts';
import { createChatClient } from './openai-chat.ts';
import type { Embedder } from './vectors.ts';

/** What the composition needs. */
export interface RealProviderOptions {
  readonly config: ProviderConfig;
  /** The chat transport. Defaults to the global `fetch`; injected by checks. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** The clock the prompts read "today" from. Defaults to the real present. */
  readonly now?: (() => Date) | undefined;
  /** The embedding loader. Defaults to transformers.js; injected by checks. */
  readonly loadExtractor?: LoadFeatureExtractor | undefined;
}

/** The provider, and what to tell the person running it. */
export interface RealProvider {
  readonly provider: AiProvider;
  /** One Chinese line per half, for the startup log. Never contains a key. */
  readonly notes: readonly string[];
}

/** One half that is built, or the reason it could not be. */
interface Built<T> {
  readonly value: T;
  readonly problem: string | null;
}

/** The vendor this machine is talking to, in one phrase, for the log and for a refusal. */
function vendorPhrase(config: ProviderConfig): string {
  const { llm } = config;
  if (llm.preset === null) {
    return llm.kind === 'cloud' ? '云端 LLM' : '本地 LLM（Ollama 一类）';
  }
  return `预设 ${llm.preset}（${llm.kind === 'cloud' ? '云端' : '本地'}）`;
}

/** What to say when the cloud LLM has no key, naming the vendor that is waiting. */
function noLlmKey(config: ProviderConfig): string {
  return (
    `没有配置 YTwins_LLM_API_KEY，${vendorPhrase(config)} 上的 ${config.llm.model} 用不了：` +
    '投递仍然会被记下来，但不会被解析，追问会说「问不到」。把 key 填进仓库根目录的 .env 再重启服务即可。'
  );
}

/** What to say when a cloud embedding has no endpoint to call. */
const NO_EMBEDDING_ENDPOINT =
  '选了云端 embedding 但没有配置 YTwins_EMBEDDING_BASE_URL，向量算不出来：' +
  '词条之间不会有语义链接（同一次投递里的硬边不受影响）。';

/** The eight language-model operations that leave the machine, for the unavailable case. */
const LLM_OPERATIONS = {
  respond: true,
  extract: true,
  judgeLink: true,
  judgeQuestion: true,
  composeConclusion: true,
  composeAnswer: true,
  parseQuestion: true,
  composeRecallAnswer: true,
} satisfies Record<keyof LlmOperations, true>;

/** The one operation that can stay on this machine, for the same case. */
const EMBED_OPERATIONS = { embed: true } satisfies Record<keyof Embedder, true>;

/**
 * An implementation whose every call fails with one reason.
 *
 * The list of operations is not written out here: it is read off the halves
 * above, and those are `satisfies Record<keyof …, true>` — so a tenth operation
 * added to the port fails the type check until it is listed. Without that, a
 * new port method would simply be **absent** from a provider that already
 * cannot answer, and the failure would move from a legible message to
 * `provider.foo is not a function`.
 */
function unavailable<T extends object>(operations: Record<string, true>, reason: string): T {
  const built: Record<string, unknown> = {};
  for (const operation of Object.keys(operations)) {
    built[operation] = () => Promise.reject(new ProviderCallError(reason));
  }
  return built as T;
}

/** Build the language-model half, saying why when it cannot be built. */
function buildLlm(config: ProviderConfig, options: RealProviderOptions): Built<LlmOperations> {
  if (config.llm.kind === 'cloud' && config.llm.apiKey === null) {
    const reason = noLlmKey(config);
    return { value: unavailable<LlmOperations>(LLM_OPERATIONS, reason), problem: reason };
  }
  return {
    value: createLlmOperations({
      client: createChatClient({
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        // The configuration built these from the preset: which header carries
        // the key is a vendor's business, and the client has none.
        headers: config.llm.headers,
        timeoutMs: config.llm.timeoutMs,
        fetch: options.fetch,
      }),
      now: options.now,
    }),
    problem: null,
  };
}

/** Build the embedding half, saying why when it cannot be built. */
function buildEmbedder(config: ProviderConfig, options: RealProviderOptions): Built<Embedder> {
  if (config.embedding.kind === 'local') {
    return {
      value: createLocalEmbedding({
        model: config.embedding.model,
        cacheDir: config.embedding.cacheDir,
        remoteHost: config.embedding.remoteHost,
        load: options.loadExtractor,
      }),
      problem: null,
    };
  }

  const baseUrl = config.embedding.baseUrl;
  if (baseUrl === null) {
    return {
      value: unavailable<Embedder>(EMBED_OPERATIONS, NO_EMBEDDING_ENDPOINT),
      problem: NO_EMBEDDING_ENDPOINT,
    };
  }

  return {
    value: createCloudEmbedding({
      baseUrl,
      model: config.embedding.model,
      apiKey: config.embedding.apiKey,
      timeoutMs: config.embedding.timeoutMs,
      fetch: options.fetch,
    }),
    problem: null,
  };
}

/**
 * One line saying which language model is in use.
 *
 * Which vendor, which endpoint and which model are named, plus whether a key is
 * configured, how many extra headers were configured and which explicit
 * variables overrode the preset. Never a key and never a header's value: a
 * session token is a credential too, so a count is all the log gets.
 */
function llmNote(config: ProviderConfig): string {
  const { llm } = config;
  const key = llm.apiKey === null ? (llm.kind === 'cloud' ? '缺 key' : '无需 key') : 'key 已配置';
  const extra = llm.extraHeaderCount === 0 ? '' : `；另带 ${llm.extraHeaderCount} 个额外请求头`;
  // The override is an escape hatch, not a silent drift: a machine whose base
  // URL is not the preset's says so in the one place a person looks.
  const overridden =
    llm.overrides.length === 0 ? '' : `；显式覆盖：${llm.overrides.join('、')}`;
  return `${vendorPhrase(config)}：${llm.baseUrl} · ${llm.model}（${key}${extra}${overridden}）`;
}

/**
 * The one thing an embedding swap costs, said every time this half is reported.
 *
 * The LLM half is a preset because a vendor is three values; the embedding half
 * is not, because the link thresholds are calibrated against one specific
 * vector space — Ticket 14 measured a genuinely related pair falling from 0.875
 * to 0.456 under another model. Making that a one-line key swap would hand the
 * user a set of thresholds nobody calibrated.
 */
const EMBEDDING_NOT_A_PRESET =
  'embedding 不在「选一家 + 填一个 key」的承诺里：链接阈值是对着当前这一个量出来的，' +
  '换它等于换一套标定（要重跑 ticket 14 那套实测）。';

/** One line saying which embedding is in use, and what a swap would cost. */
function embeddingNote(config: ProviderConfig): string {
  if (config.embedding.kind === 'cloud') {
    return (
      `云端 embedding：${config.embedding.baseUrl} · ${config.embedding.model}。` +
      EMBEDDING_NOT_A_PRESET
    );
  }
  return (
    `本地 embedding：${config.embedding.model}（缓存在 ${config.embedding.cacheDir}，第一次使用会联网下载）。` +
    EMBEDDING_NOT_A_PRESET
  );
}

/**
 * Build the real provider from a configuration.
 *
 * @param options - the configuration, and optionally the transport, clock and loader.
 * @returns the provider the domain is handed, and the notes for the log.
 */
export function createRealProvider(options: RealProviderOptions): RealProvider {
  const { config } = options;
  const llm = buildLlm(config, options);
  const embedding = buildEmbedder(config, options);

  const notes = [
    llmNote(config),
    embeddingNote(config),
    ...(llm.problem === null ? [] : [llm.problem]),
    ...(embedding.problem === null ? [] : [embedding.problem]),
  ];

  return {
    provider: {
      ...llm.value,
      embed: (request) => embedding.value.embed(request.texts).then((vectors) => ({ vectors })),
    },
    notes,
  };
}
