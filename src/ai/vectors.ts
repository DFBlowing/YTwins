/**
 * Checking the vectors that arrive from an external model runtime.
 *
 * Both embeddings — the local one and the cloud one — end up here, and for the
 * same reason: this is where a runtime's output becomes the product's evidence.
 * A ragged batch, a string in a vector or a missing one would otherwise reach
 * the domain, which compares vectors of equal length and silently ignores the
 * rest — so a broken embedding would look exactly like "these two wordings have
 * nothing to do with each other", which is a claim about the user's words that
 * nobody made.
 *
 * @module ai/vectors
 */

import { ProviderCallError } from './errors.ts';

/**
 * Texts in, vectors out.
 *
 * The shape both embeddings are built to — the one that runs on this machine
 * and the one that runs at an endpoint. It lives here rather than beside either
 * of them because it is neither: it is the neutral form the composition joins
 * to the language model's half.
 */
export interface Embedder {
  /**
   * Encode the texts.
   *
   * @param texts - the texts to encode, in the order the vectors are wanted.
   * @returns one vector per text.
   */
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/**
 * Read a batch of vectors, or fail naming what was wrong with it.
 *
 * @param value - whatever the runtime handed back.
 * @param asked - how many texts were sent, so a short or long batch is caught.
 * @param operation - the implementation's name, for the error message.
 * @returns the vectors, as plain arrays.
 * @throws ProviderCallError for anything that is not one vector per text.
 */
export function toVectors(value: unknown, asked: number, operation: string): number[][] {
  if (!Array.isArray(value)) {
    throw new ProviderCallError(`${operation} 没有返回一批向量。`);
  }
  if (value.length !== asked) {
    throw new ProviderCallError(`${operation} 被问了 ${asked} 段文本，却返回了 ${value.length} 个向量。`);
  }

  let width: number | null = null;
  return value.map((entry, index) => {
    if (!Array.isArray(entry)) {
      throw new ProviderCallError(`${operation} 第 ${index + 1} 个向量不是数组。`);
    }
    if (entry.length === 0) {
      throw new ProviderCallError(`${operation} 第 ${index + 1} 个向量是空的。`);
    }
    if (width === null) width = entry.length;
    else if (entry.length !== width) {
      throw new ProviderCallError(
        `${operation} 的向量长度不一致：第一个是 ${width}，第 ${index + 1} 个是 ${entry.length}；长度不同的向量无法比较。`,
      );
    }
    return entry.map((part) => {
      if (typeof part !== 'number' || !Number.isFinite(part)) {
        throw new ProviderCallError(`${operation} 第 ${index + 1} 个向量里有不是数字的元素。`);
      }
      return part;
    });
  });
}
