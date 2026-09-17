/*
 * The manual smoke for the real provider — the one thing about it that is not
 * asserted automatically.
 *
 *   node tools/smoke-provider.mjs               # both halves
 *   node tools/smoke-provider.mjs llm           # only the language model
 *   node tools/smoke-provider.mjs embedding     # only the embedding
 *
 * The spec is explicit about why this exists and why it is manual: the real
 * implementation is checked by hand for "it connects, and what comes back has
 * the shape it should" (ticket 12), and its **semantic quality** is never
 * asserted automatically — a check that pinned "the model judged these two
 * similar enough" would be pinning a model's mood, and would fail the day the
 * model changed for reasons that say nothing about this product.
 *
 * So this tool does two different things at once:
 *
 *  - it **checks structure** and exits non-zero when the shape is wrong (a
 *    field missing, a call that will not connect, a vector that is not a
 *    vector). That part is a real check, run by hand.
 *  - it **prints what came back**, so a person can read the sentences and the
 *    similarity numbers and judge them. Nothing here asserts that they are
 *    good.
 *
 * It uses the real provider, the real `.env`, and the real network. It costs a
 * few thousand tokens of the user's key and, on a first run, one model
 * download (about 120 MB into `data/models`, which git ignores).
 */

import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProviderConfigError, resolveProviderConfig } from '../src/ai/config.ts';
import { loadEnvFile } from '../src/ai/env-file.ts';
import { createRealProvider } from '../src/ai/real-provider.ts';
import { CONCLUSION_INSTRUCTIONS } from '../src/domain/conclusions.ts';
import { REPLY_INSTRUCTIONS } from '../src/domain/parent-voice.ts';
import { ANSWER_INSTRUCTIONS } from '../src/domain/surfacing.ts';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** What to smoke: both halves, or just one. */
const which = process.argv[2] ?? 'all';
if (!['all', 'llm', 'embedding'].includes(which)) {
  console.error(`用法：node tools/smoke-provider.mjs [all|llm|embedding]（收到「${which}」）`);
  process.exit(2);
}

let checks = 0;
let failures = 0;

/** Run one named step; a throw is recorded, printed, and the run continues. */
async function step(name, body) {
  checks += 1;
  try {
    const detail = await body();
    console.log(`  ok   ${name}`);
    if (detail !== undefined && detail !== '') {
      for (const line of String(detail).split('\n')) console.log(`       ${line}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A cosine between two vectors, for reporting only. */
function cosine(a, b) {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    left += a[index] ** 2;
    right += b[index] ** 2;
  }
  return dot / (Math.sqrt(left) * Math.sqrt(right));
}

/** Something a person can read, without dumping a whole vector. */
function show(value) {
  return JSON.stringify(value, null, 2);
}

// ── the configuration this machine is actually running ──────────────────────
await loadEnvFile(join(REPO_ROOT, '.env'), process.env);

let config;
try {
  config = resolveProviderConfig(process.env, { repoRoot: REPO_ROOT });
} catch (error) {
  if (error instanceof ProviderConfigError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

if (config.choice === 'demo') {
  console.error(
    'YTwins_PROVIDER=demo：现在跑的是预置假 provider，没有真实的模型可冒烟。\n' +
      '把 .env 里那行去掉（或改成 real）再跑这个工具。',
  );
  process.exit(2);
}

const { provider, notes } = createRealProvider({ config });
console.log('这次冒烟跑的配置：');
for (const note of notes) console.log(`  · ${note}`);
console.log('');

// ── the language model ──────────────────────────────────────────────────────
if (which === 'all' || which === 'llm') {
  console.log('语言模型（真实端点，真实 key）');

  const fragment = '老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲，好烦';

  await step('respond —— 给这次投递一句回应', async () => {
    const { reply } = await provider.respond({
      body: fragment,
      brief: { emotionPresent: true, adviceRequested: false },
      instructions: REPLY_INSTRUCTIONS,
    });
    assert.equal(typeof reply, 'string');
    assert.ok(reply.trim().length > 0, '回应不能是空的');
    return reply;
  });

  await step('extract —— 读出事项、词条与输入类型', async () => {
    const reading = await provider.extract({ body: fragment });
    assert.ok(['emotion', 'decision', 'item', 'idea'].includes(reading.inputType));
    assert.ok(Array.isArray(reading.items) && Array.isArray(reading.terms));
    for (const item of reading.items) {
      assert.equal(typeof item.text, 'string');
      assert.ok(item.dueAt === null || typeof item.dueAt === 'string');
    }
    assert.ok(
      reading.anchor === null || reading.terms.includes(reading.anchor),
      'anchor 必须是词条里的一条，否则这次读法是自相矛盾的',
    );
    return show(reading);
  });

  await step('judgeLink —— 灰区里判一对词条', async () => {
    const { related } = await provider.judgeLink({
      from: '想学吉他',
      to: '琴行的帖子',
      similarity: 0.78,
    });
    assert.equal(typeof related, 'boolean');
    return `related = ${related}`;
  });

  await step('parseQuestion —— 问一句，看它去原文里找什么', async () => {
    const { matchText } = await provider.parseQuestion({ question: '期末怎么算分来着？' });
    assert.ok(Array.isArray(matchText));
    assert.ok(matchText.length > 0, '这个问题本该找得到线索');
    return show(matchText);
  });

  await step('composeConclusion —— 把一件事汇成一句', async () => {
    const { text } = await provider.composeConclusion({
      anchor: '好烦',
      terms: ['期末怎么算分', '下周三交提纲', '好烦'],
      tier: 'weak',
      instructions: CONCLUSION_INSTRUCTIONS,
    });
    assert.ok(text.trim().length > 0, '句子不能是空的');
    return text;
  });

  await step('composeAnswer —— 把几条小结论汇成一句', async () => {
    const { text } = await provider.composeAnswer({
      conclusions: ['你最近好像有几件事堆在一起', '你似乎真的很想学吉他'],
      terms: ['期末怎么算分', '好烦', '想学吉他', '体验课'],
      tier: 'medium',
      instructions: ANSWER_INSTRUCTIONS,
    });
    assert.ok(text.trim().length > 0, '答案不能是空的');
    return text;
  });

  await step('composeRecallAnswer —— 用记录回答一次追问', async () => {
    const { answer } = await provider.composeRecallAnswer({
      question: '期末怎么算分',
      records: [
        {
          dropId: 'smoke-1',
          body: fragment,
          droppedAt: '2026-09-17T02:00:00.000Z',
        },
      ],
      now: '2026-09-20T02:00:00.000Z',
    });
    assert.ok(answer.trim().length > 0, '答案不能是空的');
    return answer;
  });

  console.log('');
}

// ── the embedding ───────────────────────────────────────────────────────────
if (which === 'all' || which === 'embedding') {
  console.log('embedding（本机 CPU 或云端端点，看配置）');
  if (config.embedding.kind === 'local') {
    console.log(`  （第一次运行会把模型下载到 ${config.embedding.cacheDir}，约 120MB）`);
  }

  const phrases = ['好烦', '心里堵得慌', '平时分 40%', '想学吉他'];

  await step('embed —— 每段文本一个向量', async () => {
    const { vectors } = await provider.embed({ texts: phrases });
    assert.equal(vectors.length, phrases.length, '有几段文本就该有几个向量');
    const [first] = vectors;
    assert.ok(first !== undefined && first.length > 0, '向量不能是空的');
    for (const vector of vectors) {
      assert.equal(vector.length, first.length, '同一批向量长度必须一致');
      for (const part of vector) assert.equal(typeof part, 'number');
    }
    return `维度 ${first.length}，${vectors.length} 段文本`;
  });

  await step('余弦相似度 —— 只报数，好坏由人判断', async () => {
    const { vectors } = await provider.embed({ texts: phrases });
    const [annoyed, blocked, grade, guitar] = vectors;
    assert.ok(annoyed && blocked && grade && guitar);
    return [
      `「好烦」×「心里堵得慌」 = ${cosine(annoyed, blocked).toFixed(3)}  ← 应该明显更高`,
      `「好烦」×「平时分 40%」  = ${cosine(annoyed, grade).toFixed(3)}`,
      `「好烦」×「想学吉他」    = ${cosine(annoyed, guitar).toFixed(3)}`,
      '（阈值与三段式在 src/domain/linking.ts，这里不判定，也不断言）',
    ].join('\n');
  });

  console.log('');
}

console.log(`${checks - failures}/${checks} 步通过`);
if (failures > 0) {
  console.error(`${failures} 步失败 —— 结构或连通性有问题，逐条看上面的 FAIL。`);
  process.exit(1);
}
