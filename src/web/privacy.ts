/**
 * What leaves this machine, said in the user's own terms.
 *
 * The product sends some of what the user says to a model, and the spec's one
 * promise about that is that the user is told **which part** — not that nothing
 * leaves, and not a policy nobody can check. The question "which part" only has
 * an answer relative to how this machine is actually wired (a cloud language
 * model, a local one, a local or cloud embedding, or the demo's preset stand-in),
 * so it is read off the resolved configuration rather than written into the page
 * as copy: a page that stated one combination while the server ran another would
 * be exactly the dishonesty this disclosure exists to prevent.
 *
 * It is deliberately **two lists of facts**, not a reassurance. Each line names
 * something the user could go and check — the endpoint, the model, the file the
 * key is in — because that is what makes the disclosure worth reading.
 *
 * @module web/privacy
 */

import type { ProviderConfig } from '../ai/config.ts';

/** The two halves of the disclosure, in plain Chinese. */
export interface DataBoundary {
  /** What goes off this machine, one fact per line. Empty is a real answer. */
  readonly leaves: readonly string[];
  /** What never does, one fact per line. */
  readonly stays: readonly string[];
}

/** The host of a URL, or the URL itself when it cannot be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Read the boundary off one configuration.
 *
 * @param config - what this machine is actually running.
 * @returns what leaves, and what does not.
 */
export function describeDataBoundary(config: ProviderConfig): DataBoundary {
  // The demo's stand-in answers from a table in `src/domain/preset.ts`: it has no
  // network of any kind, which is a stronger statement than "the model is local"
  // and is worth saying as its own thing rather than as one case of the others.
  if (config.choice === 'demo') {
    return {
      leaves: [],
      stays: [
        '三幕跑在预置素材上：答话、判断和 embedding 全在这台机器上算，整个过程不联网，什么都不离开这台机器。',
        '你丢进来的原文只落在这台机器的数据库里。',
      ],
    };
  }

  const leaves: string[] = [];
  const stays: string[] = [];

  if (config.llm.kind === 'cloud') {
    leaves.push(
      `你说的话会整段送到云端语言模型（${hostOf(config.llm.baseUrl)} 的 ${config.llm.model}）：投递原文、你问的问题，以及为了让模型答得出来而挑给它的那几段原文和你自己的词条。`,
    );
  } else {
    stays.push(
      `语言模型跑在这台机器上（${hostOf(config.llm.baseUrl)}），你说的话不经过任何外部服务。`,
    );
  }

  if (config.embedding.kind === 'cloud') {
    leaves.push(
      `你的词条文本会送到云端 embedding（${config.embedding.baseUrl === null ? '未配置端点' : hostOf(config.embedding.baseUrl)} 的 ${config.embedding.model}），用来算词条之间的相似度。`,
    );
  } else {
    stays.push(
      `embedding 在这台机器的 CPU 上算（${config.embedding.model}），词条不出机器；模型文件在 data/models/ 下。`,
    );
  }

  stays.push('原文、词条、链接、小结论与事项都只写在本机的 data/ytwins.sqlite 里。');
  stays.push(
    config.llm.apiKey === null && config.embedding.apiKey === null
      ? '没有任何 API key 被配置，也没有任何 key 离开过这台机器。'
      : 'API key 只在本机的 .env 里，只用于服务端发请求；页面拿不到它，数据库里也没有它。',
  );

  return { leaves, stays };
}
