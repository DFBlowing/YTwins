/**
 * The local embedding: a small multilingual model, run on this machine's CPU,
 * offline, with no key.
 *
 * This is the half of the port that deliberately never leaves the machine. The
 * fragments the user typed are the most private thing the product holds, and
 * the spec's frozen decision is that the reading of them which needs a vector
 * happens here, in the same process as the database, rather than at somebody
 * else's endpoint. It costs a download once and CPU time per call, and it is
 * the only part of the real provider that needs no credential at all.
 *
 * **transformers.js is imported lazily.** Two reasons, and both matter: loading
 * it pulls in an ONNX runtime, which is a noticeable amount of work to do at
 * startup for a server that may be configured to use a cloud embedding instead;
 * and keeping it behind a dynamic import means the module graph — and so the
 * type checker and every other check — does not need the package to be present
 * to reason about this file.
 *
 * **The model is loaded once per process, on first use**, and the promise is
 * shared, so two calls that arrive together wait for one download rather than
 * racing into two. A load that *fails* clears the memo, because the commonest
 * failure is a network that was not there yet, and a process that had poisoned
 * itself would need a restart to recover from a bad minute.
 *
 * What this module does not do is decide anything: it returns vectors, and the
 * domain measures and thresholds them (`linking.ts`). Handing back a *verdict*
 * from here would move the product's judgement into a model.
 *
 * @module ai/local-embedding
 */

import { ProviderCallError } from './errors.ts';
import type { Embedder } from './vectors.ts';
import { toVectors } from './vectors.ts';

/** The tensor a feature-extraction pipeline hands back. Read through `tolist`. */
export interface EmbeddingTensor {
  tolist(): unknown;
}

/** One loaded model: encode these texts, mean-pooled and normalised. */
export type FeatureExtractor = (
  texts: string[],
  options: Readonly<Record<string, unknown>>,
) => Promise<EmbeddingTensor>;

/** How the model is built. Replaced by checks, so nothing here needs a download. */
export type LoadFeatureExtractor = (options: LocalEmbeddingOptions) => Promise<FeatureExtractor>;

/** What the embedder needs to be built. */
export interface LocalEmbeddingOptions {
  /** The model repository, e.g. `Xenova/multilingual-e5-small`. */
  readonly model: string;
  /** Where its files are cached. Inside the data directory, which git ignores. */
  readonly cacheDir: string;
  /** Where it is fetched from when it is not cached yet. */
  readonly remoteHost: string;
  /** The loader. Defaults to transformers.js; replaced by checks. */
  readonly load?: LoadFeatureExtractor | undefined;
}

/**
 * Which prefix a model was trained to be asked with.
 *
 * The e5 family is trained with `query: ` and `passage: ` in front of the text,
 * and asking it without one measurably degrades the similarity it returns. Both
 * ends here are the user's own wordings compared with each other — there is no
 * question and no document — so both are asked as queries, which is what the
 * model's authors recommend for symmetric comparison.
 *
 * Only this family gets it. A prefix a model was not trained for is noise, so
 * an unknown model is asked the words exactly as the user said them.
 */
function prefixForModel(model: string): string {
  return /(?:^|[/_-])e5(?:[/_-]|$)/iu.test(model) ? 'query: ' : '';
}

/**
 * How much of the model's weights to fetch and run.
 *
 * Quantised, because the sizes are not close: `fp32` for a 118-million-parameter
 * model is roughly 470 MB to download and hold, while the quantised weights are
 * around a quarter of that, and on a CPU the quantised ones are also faster.
 * The quality cost is small enough that the product's own thresholds — which
 * are calibrated per implementation anyway, and whose values were never
 * promised to be portable across models — are the thing that absorbs it.
 */
const LOCAL_DTYPE = 'q8';

/**
 * Build the model with transformers.js, on the CPU, from the local cache.
 *
 * @param options - the model, where it caches, and where it is fetched from.
 * @returns the extractor.
 */
async function loadWithTransformers(options: LocalEmbeddingOptions): Promise<FeatureExtractor> {
  const { env, pipeline } = await import('@huggingface/transformers');

  env.cacheDir = options.cacheDir;
  env.remoteHost = options.remoteHost;
  // A cached model is read from disk and nothing else is fetched, which is what
  // makes the fully-offline case — every call after the first — work at all.
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  const extractor = await pipeline('feature-extraction', options.model, { dtype: LOCAL_DTYPE });
  return async (texts, settings) => {
    const output = await extractor(texts, settings);
    return output as unknown as EmbeddingTensor;
  };
}

/**
 * Build the local embedder.
 *
 * @param options - the model, its cache directory, and optionally a loader.
 * @returns the embedder, which loads the model on first use.
 */
export function createLocalEmbedding(options: LocalEmbeddingOptions): Embedder {
  const load = options.load ?? loadWithTransformers;
  const prefix = prefixForModel(options.model);
  let loading: Promise<FeatureExtractor> | null = null;

  /** The loaded model, building it once and sharing the wait. */
  function extractor(): Promise<FeatureExtractor> {
    if (loading === null) {
      loading = load(options).catch((error: unknown) => {
        // Cleared, so the next call tries again: the usual failure is a first
        // run that could not reach the model host, and a server that needed a
        // restart after one bad minute would be a bad server.
        loading = null;
        throw new ProviderCallError(
          `本地 embedding 的模型「${options.model}」没能加载（缓存目录 ${options.cacheDir}）：` +
            `${error instanceof Error ? error.message : String(error)}。` +
            '第一次使用需要联网把模型下载到缓存目录；下载不动时可以用 YTwins_EMBEDDING_HOST 换一个镜像（例如 https://hf-mirror.com）。',
          { cause: error },
        );
      });
    }
    return loading;
  }

  return {
    async embed(texts) {
      // No texts is no work: encoding the empty batch would download a model to
      // multiply nothing by nothing.
      if (texts.length === 0) return [];

      const model = await extractor();
      const asked = texts.map((text) => `${prefix}${text}`);

      let tensor: EmbeddingTensor;
      try {
        tensor = await model(asked, { pooling: 'mean', normalize: true });
      } catch (error) {
        throw new ProviderCallError(
          `本地 embedding 编码失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      return toVectors(tensor.tolist(), asked.length, `本地 embedding 模型「${options.model}」`);
    },
  };
}
