/**
 * Real-provider tests — a directly executable, single-file entry.
 *
 *   node src/ai/provider.test.ts
 *
 * The same shape as `src/domain/domain.test.ts`, for the same two reasons: no
 * test framework, and no `node --test` (which spawns a child process per file,
 * something this environment denies outright).
 *
 * **What is tested here, and what is not.** The real provider's *semantic*
 * quality is not asserted anywhere — the spec leaves that to a manual smoke
 * (`tools/smoke-provider.mjs`). What is asserted is everything a check can
 * hold: that configuration selects the combination it says it selects, that
 * the HTTP and model layers are handed the right things, and that a model
 * answering with rubbish produces a diagnosable error rather than a made-up
 * reading.
 *
 * The network and the model are both **injected**, which is what keeps this
 * file deterministic and offline: `fetch` is a plain function the checks
 * replace, and the embedding loader is a function the checks replace. Nothing
 * here downloads anything or talks to a provider.
 *
 * @module ai/provider.test
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_CLOUD_LLM_BASE_URL,
  DEFAULT_CLOUD_LLM_MODEL,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_LLM_BASE_URL,
  resolveProviderConfig,
  type ProviderConfig,
} from './config.ts';
import { loadEnvFile, parseEnvFile } from './env-file.ts';
import { createCloudEmbedding } from './cloud-embedding.ts';
import { createLlmOperations, type LlmOperations } from './llm-provider.ts';
import { createLocalEmbedding, type LoadFeatureExtractor } from './local-embedding.ts';
import { createChatClient } from './openai-chat.ts';
import { createRealProvider } from './real-provider.ts';
import {
  optionalString,
  readJsonObject,
  requireBoolean,
  requireInputType,
  requireString,
  requireStringArray,
} from './structured.ts';

let failures = 0;
let checks = 0;

/** Run one named check; a throw is recorded and the run continues. */
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  checks += 1;
  try {
    await body();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A throwaway directory, removed when the check ends. */
async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ytwins-ai-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A repo root the checks can name, so default paths are checkable without touching disk. */
const REPO_ROOT = join('C:\\', 'somewhere', 'ytwins');

/** Resolve a configuration as the server would, from an ordinary environment. */
function resolve(env: Readonly<Record<string, string | undefined>>): ProviderConfig {
  return resolveProviderConfig(env, { repoRoot: REPO_ROOT });
}

console.log('provider configuration — the combination the environment names');

await check('with nothing configured, the default is a cloud LLM beside a local embedding', () => {
  const config = resolve({});
  assert.equal(config.choice, 'real', 'the real provider is what runs by default');
  assert.equal(config.llm.kind, 'cloud');
  assert.equal(config.llm.baseUrl, DEFAULT_CLOUD_LLM_BASE_URL);
  assert.equal(config.llm.model, DEFAULT_CLOUD_LLM_MODEL);
  assert.equal(config.embedding.kind, 'local');
  assert.equal(config.embedding.model, DEFAULT_LOCAL_EMBEDDING_MODEL);
});

await check('no key is ever invented: an unset or blank one reads as none', () => {
  assert.equal(resolve({}).llm.apiKey, null);
  assert.equal(resolve({ YTwins_LLM_API_KEY: '' }).llm.apiKey, null);
  assert.equal(resolve({ YTwins_LLM_API_KEY: '   ' }).llm.apiKey, null);
  assert.equal(resolve({ YTwins_LLM_API_KEY: ' sk-test ' }).llm.apiKey, 'sk-test');
});

await check('all four combinations are reachable by configuration alone', () => {
  const cloudLocal = resolve({});
  assert.deepEqual(
    [cloudLocal.llm.kind, cloudLocal.embedding.kind],
    ['cloud', 'local'],
    'cloud LLM + local embedding is the default',
  );

  const cloudCloud = resolve({
    YTwins_EMBEDDING: 'cloud',
    YTwins_EMBEDDING_BASE_URL: 'https://api.example.com/v1',
    YTwins_EMBEDDING_MODEL: 'text-embedding-3-small',
    YTwins_EMBEDDING_API_KEY: 'sk-embed',
  });
  assert.deepEqual([cloudCloud.llm.kind, cloudCloud.embedding.kind], ['cloud', 'cloud']);
  assert.equal(cloudCloud.embedding.baseUrl, 'https://api.example.com/v1');
  assert.equal(cloudCloud.embedding.apiKey, 'sk-embed');

  const localLocal = resolve({ YTwins_LLM: 'local' });
  assert.deepEqual([localLocal.llm.kind, localLocal.embedding.kind], ['local', 'local']);
  assert.equal(localLocal.llm.baseUrl, DEFAULT_LOCAL_LLM_BASE_URL, 'the local LLM endpoint');
  assert.equal(localLocal.llm.apiKey, null, 'a local LLM needs no key');

  const localCloud = resolve({
    YTwins_LLM: 'local',
    YTwins_LLM_BASE_URL: 'http://127.0.0.1:11434/v1',
    YTwins_EMBEDDING: 'cloud',
    YTwins_EMBEDDING_BASE_URL: 'https://api.example.com/v1',
    YTwins_EMBEDDING_API_KEY: 'sk-embed',
  });
  assert.deepEqual([localCloud.llm.kind, localCloud.embedding.kind], ['local', 'cloud']);
});

await check('the two halves are configured independently, key and all', () => {
  const config = resolve({
    YTwins_LLM: 'local',
    YTwins_LLM_API_KEY: 'sk-should-not-be-used',
    YTwins_EMBEDDING: 'cloud',
    YTwins_EMBEDDING_BASE_URL: 'https://api.example.com/v1',
  });
  assert.equal(config.llm.apiKey, 'sk-should-not-be-used', 'env is env: it is read, not policed');
  assert.equal(config.embedding.apiKey, null, 'and the embedding half does not borrow it');
});

await check('a cloud embedding with no endpoint says so by having none', () => {
  const config = resolve({ YTwins_EMBEDDING: 'cloud' });
  assert.equal(config.embedding.baseUrl, null);
  assert.equal(config.embedding.apiKey, null);
});

await check('a value nobody recognises is refused, naming the variable and the choices', () => {
  assert.throws(
    () => resolve({ YTwins_LLM: 'clod' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('YTwins_LLM') &&
      error.message.includes('clod'),
    'a typo must not quietly pick a different provider',
  );
  assert.throws(
    () => resolve({ YTwins_EMBEDDING: 'remote' }),
    (error: unknown) => error instanceof Error && error.message.includes('YTwins_EMBEDDING'),
  );
  assert.throws(
    () => resolve({ YTwins_PROVIDER: 'fake' }),
    (error: unknown) => error instanceof Error && error.message.includes('YTwins_PROVIDER'),
  );
  assert.throws(
    () => resolve({ YTwins_LLM_TIMEOUT_MS: 'soon' }),
    (error: unknown) => error instanceof Error && error.message.includes('YTwins_LLM_TIMEOUT_MS'),
  );
});

await check('the demo stand-in is reachable, and is the only alternative to the real one', () => {
  assert.equal(resolve({ YTwins_PROVIDER: 'demo' }).choice, 'demo');
  assert.equal(resolve({ YTwins_PROVIDER: 'REAL' }).choice, 'real', 'case is not a difference');
});

await check('the model files land in the data directory, which git already ignores', () => {
  const config = resolve({});
  assert.equal(config.embedding.cacheDir, join(REPO_ROOT, 'data', 'models'));
});

await check('the model host is configurable, so a mirror can stand in', () => {
  assert.equal(
    resolve({ YTwins_EMBEDDING_HOST: 'https://hf-mirror.com' }).embedding.remoteHost,
    'https://hf-mirror.com',
  );
  assert.ok(resolve({}).embedding.remoteHost.startsWith('https://'), 'and defaults to something');
});

console.log('\nprovider configuration — reading the environment file');

await check('a .env file is read the way a person writes one', () => {
  const parsed = parseEnvFile(
    [
      '# a comment, ignored',
      '',
      'YTwins_LLM=local',
      'export YTwins_LLM_MODEL="qwen2.5:7b"',
      "YTwins_LLM_API_KEY='sk-quoted'",
      'YTwins_EMBEDDING = cloud   # trailing comment',
      'NOT_A_PAIR',
    ].join('\n'),
  );
  assert.equal(parsed['YTwins_LLM'], 'local');
  assert.equal(parsed['YTwins_LLM_MODEL'], 'qwen2.5:7b', 'quotes are not part of the value');
  assert.equal(parsed['YTwins_LLM_API_KEY'], 'sk-quoted');
  assert.equal(parsed['YTwins_EMBEDDING'], 'cloud', 'spaces around the name are trimmed');
  assert.equal(parsed['NOT_A_PAIR'], undefined, 'a line with no value sets nothing');
});

await check('a key already in the environment wins over the file', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, '.env');
    writeFileSync(file, 'YTwins_LLM=local\nYTwins_LLM_MODEL=from-file\n', 'utf8');
    const env: Record<string, string | undefined> = { YTwins_LLM_MODEL: 'from-environment' };
    const loaded = await loadEnvFile(file, env);
    assert.equal(env['YTwins_LLM'], 'local', 'what the file has and the environment does not');
    assert.equal(env['YTwins_LLM_MODEL'], 'from-environment', 'the environment is not overwritten');
    assert.equal(loaded, true, 'and the caller is told a file was there');
  });
});

await check('no file is not an error: it is a machine that has not been configured yet', async () => {
  await withTempDir(async (dir) => {
    const env: Record<string, string | undefined> = {};
    const loaded = await loadEnvFile(join(dir, '.env'), env);
    assert.equal(loaded, false);
    assert.deepEqual(env, {});
  });
});

console.log('\nstructured output — what comes back, and what to say when it is rubbish');

/** A JSON answer as a model actually sends it: sometimes fenced, sometimes chatty. */
const FENCED = '```json\n{ "related": true }\n```';

await check('a fenced answer is read as the object inside the fence', () => {
  assert.deepEqual(readJsonObject(FENCED, 'judgeLink'), { related: true });
});

await check('an answer with a sentence around it is still found', () => {
  assert.deepEqual(readJsonObject('好的，结果如下：{ "related": false } 希望有用。', 'judgeLink'), {
    related: false,
  });
});

await check('an answer that is not JSON at all is refused, diagnosably', () => {
  assert.throws(
    () => readJsonObject('我觉得它们有点关系。', 'judgeLink'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('judgeLink') &&
      error.message.includes('我觉得它们有点关系。'),
    'the error has to name the call and show what came back, or nobody can act on it',
  );
});

await check('a truncated answer is refused rather than half-read', () => {
  assert.throws(
    () => readJsonObject('{ "related": tr', 'judgeLink'),
    (error: unknown) => error instanceof Error && error.message.includes('judgeLink'),
  );
});

await check('an answer that is a list where an object was asked for is refused', () => {
  assert.throws(
    () => readJsonObject('[1, 2, 3]', 'extract'),
    (error: unknown) => error instanceof Error && error.message.includes('extract'),
  );
});

await check('a field of the wrong shape is refused by name and by value', () => {
  assert.throws(
    () => requireString({ reply: 42 }, 'reply', 'respond'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('reply') &&
      error.message.includes('respond'),
  );
  assert.throws(
    () => requireBoolean({ related: 'yes' }, 'related', 'judgeLink'),
    (error: unknown) => error instanceof Error && error.message.includes('related'),
  );
  assert.throws(
    () => requireStringArray({ matchText: '期末' }, 'matchText', 'parseQuestion'),
    (error: unknown) => error instanceof Error && error.message.includes('matchText'),
  );
  assert.throws(
    () => requireStringArray({ matchText: ['期末', 7] }, 'matchText', 'parseQuestion'),
    (error: unknown) => error instanceof Error && error.message.includes('matchText'),
  );
  assert.throws(
    () => requireString({}, 'reply', 'respond'),
    (error: unknown) => error instanceof Error && error.message.includes('reply'),
    'a missing field is the same failure as a wrong one',
  );
});

await check('an input type nobody recognises is refused, listing the four there are', () => {
  assert.equal(requireInputType({ inputType: 'emotion' }, 'inputType', 'extract'), 'emotion');
  assert.equal(requireInputType({ inputType: ' Emotion ' }, 'inputType', 'extract'), 'emotion');
  assert.throws(
    () => requireInputType({ inputType: 'mood' }, 'inputType', 'extract'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('mood') &&
      error.message.includes('emotion') &&
      error.message.includes('idea'),
    'a typo in the reading must not quietly become a different kind of input',
  );
});

await check('an absent optional field reads as nothing, and a present one is kept', () => {
  assert.equal(optionalString({ anchor: null }, 'anchor', 'extract'), null);
  assert.equal(optionalString({}, 'anchor', 'extract'), null);
  assert.equal(optionalString({ anchor: '  ' }, 'anchor', 'extract'), null);
  assert.equal(optionalString({ anchor: '好烦' }, 'anchor', 'extract'), '好烦');
  assert.throws(
    () => optionalString({ anchor: 7 }, 'anchor', 'extract'),
    (error: unknown) => error instanceof Error && error.message.includes('anchor'),
  );
});

console.log('\nopenai-compatible chat — one call, and what its failures say');

/** One recorded request, so a check can read what the client actually sent. */
interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
  /** The body, parsed, for the ordinary case. */
  readonly body: Record<string, unknown>;
  /** The headers, lower-cased, as `fetch` would receive them. */
  readonly headers: Record<string, string>;
}

/** A `fetch` that answers from a handler and remembers every call. */
function recordingFetch(
  respond: (call: { url: string; init: RequestInit }) => Response | Promise<Response>,
): { fetch: typeof globalThis.fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const request = init ?? {};
    const raw = typeof request.body === 'string' ? request.body : '{}';
    calls.push({
      url,
      init: request,
      body: JSON.parse(raw) as Record<string, unknown>,
      headers: Object.fromEntries(
        Object.entries((request.headers ?? {}) as Record<string, string>).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      ),
    });
    return respond({ url, init: request });
  };
  return { fetch: fake as unknown as typeof globalThis.fetch, calls };
}

/** An OpenAI-shaped answer carrying one message. */
function completion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const SAY_SOMETHING = [{ role: 'user' as const, content: '你好' }];

await check('one call reaches the endpoint, asking for JSON from the configured model', async () => {
  const { fetch, calls } = recordingFetch(() => completion('{ "reply": "嗯。" }'));
  const client = createChatClient({
    baseUrl: DEFAULT_CLOUD_LLM_BASE_URL,
    model: 'deepseek-flash',
    apiKey: 'sk-secret',
    fetch,
  });

  const answer = await client.askJson([{ role: 'system', content: '规则' }, ...SAY_SOMETHING], 'respond');

  assert.deepEqual(answer, { reply: '嗯。' });
  const [call] = calls;
  assert.equal(call?.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(call?.body['model'], 'deepseek-flash');
  assert.deepEqual(call?.body['response_format'], { type: 'json_object' });
  assert.equal(call?.body['stream'], false);
  assert.deepEqual(call?.body['messages'], [
    { role: 'system', content: '规则' },
    { role: 'user', content: '你好' },
  ]);
});

await check('the key goes in the Authorization header, and into nothing else', async () => {
  const { fetch, calls } = recordingFetch(() => completion('{}'));
  const client = createChatClient({
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: 'sk-secret',
    fetch,
  });
  await client.askJson(SAY_SOMETHING, 'respond');

  const [call] = calls;
  assert.equal(call?.headers['authorization'], 'Bearer sk-secret');
  assert.ok(!JSON.stringify(call?.body).includes('sk-secret'), 'not in the body');
  assert.ok(!(call?.url ?? '').includes('sk-secret'), 'not in the query string either');
});

await check('a base URL with a trailing slash does not double the separator', async () => {
  const { fetch, calls } = recordingFetch(() => completion('{}'));
  const client = createChatClient({
    baseUrl: 'https://api.example.com/v1/',
    model: 'm',
    apiKey: null,
    fetch,
  });
  await client.askJson(SAY_SOMETHING, 'respond');
  assert.equal(calls[0]?.url, 'https://api.example.com/v1/chat/completions');
});

await check('a local endpoint with no key sends no Authorization header at all', async () => {
  const { fetch, calls } = recordingFetch(() => completion('{}'));
  const client = createChatClient({
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: null,
    fetch,
  });
  await client.askJson(SAY_SOMETHING, 'respond');
  assert.equal(calls[0]?.headers['authorization'], undefined);
});

await check('a refusal is reported with the status and what the server said', async () => {
  const { fetch } = recordingFetch(
    () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 }),
  );
  const client = createChatClient({ baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: 'sk-secret', fetch });
  await assert.rejects(
    () => client.askJson(SAY_SOMETHING, 'extract'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('402') &&
      error.message.includes('Insufficient Balance') &&
      error.message.includes('extract'),
  );
});

await check('the key never appears in an error message', async () => {
  const { fetch } = recordingFetch(() => new Response('unauthorized', { status: 401 }));
  const client = createChatClient({
    baseUrl: 'https://api.deepseek.com',
    model: 'm',
    apiKey: 'sk-must-not-leak',
    fetch,
  });
  await assert.rejects(
    () => client.askJson(SAY_SOMETHING, 'respond'),
    (error: unknown) => error instanceof Error && !error.message.includes('sk-must-not-leak'),
  );
});

await check('empty content is reported as the JSON-mode quirk it is', async () => {
  const { fetch } = recordingFetch(() => completion(''));
  const client = createChatClient({ baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: null, fetch });
  await assert.rejects(
    () => client.askJson(SAY_SOMETHING, 'composeConclusion'),
    (error: unknown) => error instanceof Error && error.message.includes('composeConclusion'),
  );
});

await check('an answer with no choices is reported, showing what the body was', async () => {
  const { fetch } = recordingFetch(
    () => new Response('{"id":"x","object":"chat.completion"}', { status: 200 }),
  );
  const client = createChatClient({ baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: null, fetch });
  await assert.rejects(
    () => client.askJson(SAY_SOMETHING, 'parseQuestion'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('parseQuestion') &&
      error.message.includes('choices'),
  );
});

await check('a model that never answers is abandoned, and says so', async () => {
  const { fetch } = recordingFetch(
    ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        // The client's own timeout is an `AbortSignal.timeout`, whose timer does
        // **not** keep the event loop alive — a bare wait on it would let this
        // whole test file exit before the timeout ever fired (exit code 13, no
        // failing check, which is exactly the sort of quiet wrong answer a test
        // must not be able to give). This held timer is what keeps the process
        // alive long enough for the client to give up on its own terms.
        const hold = setTimeout(
          () => reject(new Error('the client never gave up')),
          2000,
        );
        init.signal?.addEventListener('abort', () => {
          clearTimeout(hold);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
  const client = createChatClient({
    baseUrl: 'https://api.deepseek.com',
    model: 'm',
    apiKey: null,
    timeoutMs: 30,
    fetch,
  });
  await assert.rejects(
    () => client.askJson(SAY_SOMETHING, 'respond'),
    (error: unknown) =>
      error instanceof Error && error.message.includes('respond') && error.message.includes('超时'),
  );
});

await check('a network that is not there is reported rather than thrown raw', async () => {
  const { fetch } = recordingFetch(() => {
    throw new TypeError('fetch failed');
  });
  const client = createChatClient({ baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: null, fetch });
  await assert.rejects(
    () => client.askJson(SAY_SOMETHING, 'respond'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('respond') &&
      error.message.includes('fetch failed'),
  );
});

console.log('\nthe language model half — what each operation asks for, and what it hands back');

/** The messages one recorded call carried. */
function messagesOf(call: RecordedCall | undefined): { role: string; content: string }[] {
  return (call?.body['messages'] ?? []) as { role: string; content: string }[];
}

/** Everything the model was told in its instructions, as one string. */
function systemOf(call: RecordedCall | undefined): string {
  return messagesOf(call)
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
}

/** Everything the model was handed as material, as one string. */
function userOf(call: RecordedCall | undefined): string {
  return messagesOf(call)
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n');
}

/** A client wired to one canned answer, plus the calls it made. */
function canned(answer: string): { operations: LlmOperations; calls: RecordedCall[] } {
  const { fetch, calls } = recordingFetch(() => completion(answer));
  const client = createChatClient({
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: 'sk-secret',
    fetch,
  });
  // A pinned clock, so "today" is a fact of the check rather than of the day it
  // was run on. 2026-09-17 is the Thursday the demo's own deadline hangs off.
  const operations = createLlmOperations({
    client,
    now: () => new Date(2026, 8, 17, 10, 0, 0),
  });
  return { operations, calls };
}

const REPLY_RULES = ['只用中文。', '不超过 3 句。'];

await check('respond hands over the rules and the situation, and returns the line', async () => {
  const { operations, calls } = canned('{ "reply": "听起来今天挺累的。" }');
  const result = await operations.respond({
    body: '今天开会开到六点，好累',
    brief: { emotionPresent: true, adviceRequested: false },
    instructions: REPLY_RULES,
  });

  assert.equal(result.reply, '听起来今天挺累的。');
  const system = systemOf(calls[0]);
  for (const rule of REPLY_RULES) assert.ok(system.includes(rule), `the rules travel: ${rule}`);
  assert.ok(system.includes('情绪'), 'and the model is told a feeling is present');
  assert.ok(userOf(calls[0]).includes('今天开会开到六点，好累'), 'and the drop itself, verbatim');
});

await check('a retry is told exactly what the first attempt broke', async () => {
  const { operations, calls } = canned('{ "reply": "嗯。" }');
  await operations.respond({
    body: '好累',
    brief: { emotionPresent: true, adviceRequested: false },
    instructions: REPLY_RULES,
    violations: ['too-long', 'offers-advice'],
  });
  const system = systemOf(calls[0]);
  assert.ok(system.includes('too-long'), 'a reroll that is not told what was wrong is just a reroll');
  assert.ok(system.includes('offers-advice'));
});

await check('extract reads the whole reading back, and tells the model what day it is', async () => {
  const { operations, calls } = canned(
    JSON.stringify({
      inputType: 'item',
      items: [{ text: '下周三交提纲', dueAt: '2026-09-23T09:00:00.000Z' }, { text: '想学吉他', dueAt: null }],
      terms: ['期末怎么算分', '下周三交提纲', '好烦'],
      anchor: '好烦',
    }),
  );
  const reading = await operations.extract({ body: '老师讲了期末怎么算分，下周三交提纲，好烦' });

  assert.deepEqual(reading, {
    inputType: 'item',
    items: [
      { text: '下周三交提纲', dueAt: '2026-09-23T09:00:00.000Z' },
      { text: '想学吉他', dueAt: null },
    ],
    terms: ['期末怎么算分', '下周三交提纲', '好烦'],
    anchor: '好烦',
  });
  const system = systemOf(calls[0]);
  assert.ok(system.includes('2026-09-17'), 'a relative date cannot be resolved without today');
  assert.ok(system.includes('星期四'), 'nor without which day of the week that is');
});

await check('an extract answer with no anchor reads as no anchor, not as a missing field', async () => {
  const { operations } = canned(
    JSON.stringify({ inputType: 'idea', items: [], terms: ['随便想想'], anchor: null }),
  );
  const reading = await operations.extract({ body: '随便想想' });
  assert.equal(reading.anchor, null);
  assert.deepEqual(reading.items, []);
});

await check('a reading of a kind nobody knows is refused, naming this call', async () => {
  const { operations } = canned(
    JSON.stringify({ inputType: 'mood', items: [], terms: [], anchor: null }),
  );
  await assert.rejects(
    () => operations.extract({ body: '好烦' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('extract') &&
      error.message.includes('mood'),
  );
});

await check('judgeLink shows the model both wordings and the score it is settling', async () => {
  const { operations, calls } = canned('{ "related": true }');
  const verdict = await operations.judgeLink({ from: '想学吉他', to: '琴行的帖子', similarity: 0.78 });

  assert.equal(verdict.related, true);
  const material = userOf(calls[0]);
  assert.ok(material.includes('想学吉他') && material.includes('琴行的帖子'));
  assert.ok(material.includes('0.78'), 'a judge asked without the score is judging blind');
});

await check('composeConclusion is handed the feeling, the words and the band', async () => {
  const { operations, calls } = canned('{ "text": "你最近好像有几件事堆在一起" }');
  const instructions = ['这是判断，不是事实。'];
  const result = await operations.composeConclusion({
    anchor: '好烦',
    terms: ['期末怎么算分', '好烦'],
    tier: 'weak',
    instructions,
  });

  assert.equal(result.text, '你最近好像有几件事堆在一起', 'the band frame is not the model’s to add');
  const system = systemOf(calls[0]);
  assert.ok(system.includes('这是判断，不是事实。'));
  assert.ok(system.includes('weak'), 'the band is context for the wording');
  const material = userOf(calls[0]);
  assert.ok(material.includes('好烦'));
  assert.ok(material.includes('期末怎么算分'));
});

await check('composeAnswer is handed the conclusions and their words, and nothing else', async () => {
  const { operations, calls } = canned('{ "text": "你最近这几件事好像是连在一起的" }');
  const instructions = ['只从这里给的事实出发。'];
  const conclusions = ['你最近好像有几件事堆在一起', '你似乎真的很想学吉他'];
  const terms = ['好烦', '想学吉他', '体验课'];
  await operations.composeAnswer({ conclusions, terms, tier: 'medium', instructions });

  const material = userOf(calls[0]);
  for (const line of [...conclusions, ...terms]) {
    assert.ok(material.includes(line), `the material travels: ${line}`);
  }

  // The other half of "只可能出自这个用户自己的数据" (ticket 11) is structural:
  // nothing generic is sent with this request, so the only lines the model is
  // given are the user's own sentences and words. Reading the lines back out
  // and comparing them to what was handed in is how that is pinned.
  const quoted = material
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:[-•]|\d+[.、])\s*/u, '').trim())
    .filter((line) => line.length > 0 && !line.endsWith('：'));
  assert.deepEqual(quoted, [...conclusions, ...terms], 'every line is the user’s, and only theirs');

  // And the instructions are **not** the only generic text that may travel:
  // this is the half the first version of this check missed. Ticket 11 forbade
  // putting a persona ("你是一个温柔的朋友…") into this call, because a persona
  // is generic text and the whole promise is that an answer could only have
  // been said about this user. So every line of the system message has to be
  // one of the pieces this request itself carries: one of its rules, the task,
  // the band, or the output contract.
  const allowed = [
    ...instructions,
    '任务：',
    '档位',
    '必须遵守的规则：',
    '输出 JSON',
    '只输出一个 JSON 对象',
  ];
  const generic = systemOf(calls[0])
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !allowed.some((piece) => line.includes(piece)))
    // The numbered rules themselves, which are the request's own words.
    .filter((line) => !/^\d+\.\s/u.test(line));
  assert.deepEqual(generic, [], 'no persona, no product blurb, nothing the request did not carry');
});

await check('parseQuestion asks for the phrases to look for, not for an opinion', async () => {
  const { operations, calls } = canned('{ "matchText": ["期末怎么算分", "平时分"] }');
  const parsed = await operations.parseQuestion({ question: '期末怎么算分来着？' });
  assert.deepEqual(parsed.matchText, ['期末怎么算分', '平时分']);
  assert.ok(userOf(calls[0]).includes('期末怎么算分来着？'), 'the question travels verbatim');
});

await check('composeRecallAnswer states the records as of the pinned moment', async () => {
  const { operations, calls } = canned('{ "answer": "平时分占 40%，期末考占 60%。" }');
  const result = await operations.composeRecallAnswer({
    question: '期末怎么算分',
    records: [
      { dropId: 'd1', body: '老师今天讲了期末怎么算分：平时分 40%', droppedAt: '2026-09-17T02:00:00.000Z' },
    ],
    now: '2026-09-20T02:00:00.000Z',
  });

  assert.equal(result.answer, '平时分占 40%，期末考占 60%。');
  const material = userOf(calls[0]);
  assert.ok(material.includes('平时分 40%'), 'the user’s own words, so the answer can be checked');
  assert.ok(material.includes('2026-09-20'), 'and the moment it is answering as of');
});

await check('judgeQuestion asks what the words are addressed to, and reads both arms back', async () => {
  const asking = canned('{ "asks": true, "about": "self" }');
  const judged = await asking.operations.judgeQuestion({
    body: '你觉得我最近怎么样',
    shape: 'question',
  });
  assert.deepEqual(judged, { asks: true, about: 'self' });
  const system = systemOf(asking.calls[0]);
  assert.ok(system.includes('question'), 'the shape ordinary code read is handed over as the reason for asking');
  assert.ok(system.includes('records') && system.includes('self'), 'and both arms are named to the model');
  assert.ok(userOf(asking.calls[0]).includes('你觉得我最近怎么样'), 'the words travel verbatim');

  // The arm that is not an arm: 「下周三交提纲吗」 said to oneself. It needs no
  // `about`, and a model that volunteered one anyway must not be read as having
  // answered something it did not.
  const notAsking = canned('{ "asks": false, "about": "records" }');
  const denied = await notAsking.operations.judgeQuestion({
    body: '下周三交提纲吗',
    shape: 'unclear',
  });
  assert.deepEqual(denied, { asks: false }, 'a reading of "not a question" is the whole answer');
});

await check('an `about` nobody knows is refused, naming this call', async () => {
  const { operations } = canned('{ "asks": true, "about": "the weather" }');
  await assert.rejects(
    () => operations.judgeQuestion({ body: '明天天气如何', shape: 'question' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('judgeQuestion') &&
      error.message.includes('the weather'),
  );
});

await check('every operation’s failure names the operation that failed', async () => {
  const { fetch } = recordingFetch(() => completion('我不太想回答这个。'));
  const client = createChatClient({
    baseUrl: 'https://api.deepseek.com',
    model: 'm',
    apiKey: null,
    fetch,
  });
  const operations = createLlmOperations({ client });

  const calls = [
    ['respond', () => operations.respond({ body: 'x', brief: { emotionPresent: false, adviceRequested: false }, instructions: [] })],
    ['extract', () => operations.extract({ body: 'x' })],
    ['judgeLink', () => operations.judgeLink({ from: 'a', to: 'b', similarity: 0.8 })],
    ['judgeQuestion', () => operations.judgeQuestion({ body: 'x', shape: 'question' })],
    ['composeConclusion', () => operations.composeConclusion({ anchor: 'a', terms: ['a'], tier: 'weak', instructions: [] })],
    ['composeAnswer', () => operations.composeAnswer({ conclusions: ['a'], terms: ['a'], tier: 'weak', instructions: [] })],
    ['parseQuestion', () => operations.parseQuestion({ question: 'x' })],
    [
      'composeRecallAnswer',
      () => operations.composeRecallAnswer({ question: 'x', records: [{ dropId: 'd', body: 'y', droppedAt: 'now' }], now: 'now' }),
    ],
  ] as const;

  for (const [what, call] of calls) {
    await assert.rejects(
      call,
      (error: unknown) => error instanceof Error && error.message.includes(what),
      `${what} must say which call failed`,
    );
  }
});

console.log('\nthe local embedding — the model runs here, and never leaves');

/** A stand-in for transformers.js's pipeline, counting how often it was built. */
function fakeExtractor(vectors: unknown, loadCount: { value: number }): LoadFeatureExtractor {
  return async () => {
    loadCount.value += 1;
    return async () => ({ tolist: () => vectors });
  };
}

await check('the model is loaded once, on first use, and shared after that', async () => {
  const loads = { value: 0 };
  const embedder = createLocalEmbedding({
    model: 'Xenova/multilingual-e5-small',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load: fakeExtractor([[1, 0]], loads),
  });

  assert.equal(loads.value, 0, 'nothing is downloaded until something is actually encoded');
  await embedder.embed(['好烦']);
  await embedder.embed(['想学吉他']);
  assert.equal(loads.value, 1, 'the model stays loaded for the process');
});

await check('one vector per text comes back, in the order asked', async () => {
  const embedder = createLocalEmbedding({
    model: 'm',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load: fakeExtractor([[1, 0, 0], [0, 1, 0]], { value: 0 }),
  });
  const vectors = await embedder.embed(['好烦', '想学吉他']);
  assert.deepEqual(vectors, [[1, 0, 0], [0, 1, 0]]);
});

await check('an e5 model is asked the way it was trained to be asked', async () => {
  let asked: readonly string[] = [];
  const load: LoadFeatureExtractor = async () => async (texts) => {
    asked = texts;
    return { tolist: () => [[1], [1]] };
  };
  const embedder = createLocalEmbedding({
    model: 'Xenova/multilingual-e5-small',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load,
  });

  await embedder.embed(['好烦', '期末怎么算分']);
  assert.deepEqual(asked, ['query: 好烦', 'query: 期末怎么算分']);
});

await check('a model with no known convention is asked the words as they are', async () => {
  let asked: readonly string[] = [];
  const load: LoadFeatureExtractor = async () => async (texts) => {
    asked = texts;
    return { tolist: () => [[1]] };
  };
  const embedder = createLocalEmbedding({
    model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load,
  });

  await embedder.embed(['好烦']);
  assert.deepEqual(asked, ['好烦'], 'a prefix a model was not trained for would be noise');
});

await check('a model that cannot be loaded says what to do about it', async () => {
  const embedder = createLocalEmbedding({
    model: 'Xenova/multilingual-e5-small',
    cacheDir: 'D:\\data\\models',
    remoteHost: 'https://huggingface.co',
    load: async () => {
      throw new Error('getaddrinfo ENOTFOUND huggingface.co');
    },
  });

  await assert.rejects(
    () => embedder.embed(['好烦']),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('D:\\data\\models') &&
      error.message.includes('YTwins_EMBEDDING_HOST') &&
      error.message.includes('ENOTFOUND'),
    'a first run that cannot download is the commonest failure there is, and it is not a mystery',
  );
});

await check('an answer that does not line up with the texts is refused', async () => {
  const tooFew = createLocalEmbedding({
    model: 'm',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load: fakeExtractor([[1, 0]], { value: 0 }),
  });
  await assert.rejects(
    () => tooFew.embed(['a', 'b']),
    (error: unknown) => error instanceof Error && error.message.includes('2'),
  );

  const ragged = createLocalEmbedding({
    model: 'm',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load: fakeExtractor([[1, 0], [1]], { value: 0 }),
  });
  await assert.rejects(
    () => ragged.embed(['a', 'b']),
    (error: unknown) => error instanceof Error && error.message.includes('长度'),
    'two vectors of different lengths can never be compared, so one of them is wrong',
  );

  const notNumbers = createLocalEmbedding({
    model: 'm',
    cacheDir: 'C:\\cache',
    remoteHost: 'https://huggingface.co',
    load: fakeExtractor([['一']], { value: 0 }),
  });
  await assert.rejects(
    () => notNumbers.embed(['a']),
    (error: unknown) => error instanceof Error && error.message.includes('数字'),
  );
});

console.log('\nthe cloud embedding — the other way to get vectors');

await check('the texts go to /embeddings and the vectors come back in order', async () => {
  const { fetch, calls } = recordingFetch(
    () =>
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }), {
        status: 200,
      }),
  );
  const embedder = createCloudEmbedding({
    baseUrl: 'https://api.example.com/v1',
    model: 'text-embedding-3-small',
    apiKey: 'sk-embed',
    fetch,
  });

  const vectors = await embedder.embed(['好烦', '想学吉他']);
  assert.deepEqual(vectors, [[0.1, 0.2], [0.3, 0.4]]);

  const [call] = calls;
  assert.equal(call?.url, 'https://api.example.com/v1/embeddings');
  assert.equal(call?.body['model'], 'text-embedding-3-small');
  assert.deepEqual(call?.body['input'], ['好烦', '想学吉他']);
  assert.equal(call?.headers['authorization'], 'Bearer sk-embed');
  assert.ok(!JSON.stringify(call?.body).includes('sk-embed'));
});

await check('a cloud embedding that refuses is reported with the status', async () => {
  const { fetch } = recordingFetch(() => new Response('model not found', { status: 404 }));
  const embedder = createCloudEmbedding({
    baseUrl: 'https://api.example.com/v1',
    model: 'nope',
    apiKey: null,
    fetch,
  });
  await assert.rejects(
    () => embedder.embed(['a']),
    (error: unknown) => error instanceof Error && error.message.includes('404'),
  );
});

await check('a cloud embedding that returns the wrong number of vectors is refused', async () => {
  const { fetch } = recordingFetch(
    () => new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }),
  );
  const embedder = createCloudEmbedding({
    baseUrl: 'https://api.example.com/v1',
    model: 'm',
    apiKey: null,
    fetch,
  });
  await assert.rejects(
    () => embedder.embed(['a', 'b']),
    (error: unknown) => error instanceof Error && error.message.includes('2'),
  );
});

console.log('\nthe real provider — both halves, or a clear reason why not');

/** A configuration as the server would resolve it, from an environment. */
function configFrom(env: Readonly<Record<string, string | undefined>>): ProviderConfig {
  return resolveProviderConfig(env, { repoRoot: REPO_ROOT });
}

/** The nine operations the port declares, so a check can insist on all of them. */
const PORT_OPERATIONS = [
  'respond',
  'extract',
  'embed',
  'judgeLink',
  'judgeQuestion',
  'composeConclusion',
  'composeAnswer',
  'parseQuestion',
  'composeRecallAnswer',
] as const;

await check('all nine operations are there, whichever halves are configured', () => {
  const { provider } = createRealProvider({
    config: configFrom({ YTwins_LLM_API_KEY: 'sk-secret' }),
    fetch: recordingFetch(() => completion('{}')).fetch,
  });
  for (const operation of PORT_OPERATIONS) {
    assert.equal(typeof provider[operation], 'function', `${operation} is on the port`);
  }
});

await check('a cloud LLM with no key is not a crash: each call says what is missing', async () => {
  const { provider, notes } = createRealProvider({
    config: configFrom({}),
    fetch: recordingFetch(() => completion('{}')).fetch,
  });

  assert.ok(
    notes.some((note) => note.includes('YTwins_LLM_API_KEY')),
    'the startup log has to say why the model is not answering',
  );

  // Every operation, not a sample: a provider that is standing in for one that
  // cannot answer still has to **be** the port. A name missing here is a call
  // that would fail with `is not a function` instead of with the reason.
  const calls: Readonly<Record<string, () => Promise<unknown>>> = {
    respond: () =>
      provider.respond({ body: 'x', brief: { emotionPresent: false, adviceRequested: false }, instructions: [] }),
    extract: () => provider.extract({ body: 'x' }),
    judgeLink: () => provider.judgeLink({ from: 'a', to: 'b', similarity: 0.8 }),
    judgeQuestion: () => provider.judgeQuestion({ body: 'x', shape: 'question' }),
    composeConclusion: () =>
      provider.composeConclusion({ anchor: 'a', terms: ['a'], tier: 'weak', instructions: [] }),
    composeAnswer: () => provider.composeAnswer({ conclusions: ['a'], terms: ['a'], tier: 'weak', instructions: [] }),
    parseQuestion: () => provider.parseQuestion({ question: 'x' }),
    composeRecallAnswer: () =>
      provider.composeRecallAnswer({
        question: 'x',
        records: [{ dropId: 'd', body: 'y', droppedAt: '2026-09-20T02:00:00.000Z' }],
        now: '2026-09-20T02:00:00.000Z',
      }),
  };

  for (const [operation, call] of Object.entries(calls)) {
    await assert.rejects(
      call,
      (error: unknown) =>
        error instanceof Error && error.message.includes('YTwins_LLM_API_KEY'),
      `${operation} must fail with the reason, not with a mysterious error`,
    );
  }
});

await check('the startup notes say which pair is in use, and never the key', () => {
  const config = configFrom({
    YTwins_LLM_API_KEY: 'sk-must-not-leak',
    YTwins_EMBEDDING: 'cloud',
    YTwins_EMBEDDING_BASE_URL: 'https://api.example.com/v1',
    YTwins_EMBEDDING_API_KEY: 'sk-embed-must-not-leak',
  });
  const { notes } = createRealProvider({ config, fetch: recordingFetch(() => completion('{}')).fetch });
  const said = notes.join('\n');

  assert.ok(said.includes('deepseek-flash'), 'the model in use is named');
  assert.ok(said.includes('api.example.com'), 'and the embedding endpoint');
  assert.ok(!said.includes('sk-must-not-leak'), 'the secrets are not');
  assert.ok(!said.includes('sk-embed-must-not-leak'));
});

await check('a local LLM needs no key, and a local embedding says where its files go', () => {
  const { notes } = createRealProvider({
    config: configFrom({ YTwins_LLM: 'local' }),
    loadExtractor: fakeExtractor([[1]], { value: 0 }),
  });
  const said = notes.join('\n');
  assert.ok(said.includes('127.0.0.1:11434'), 'the local endpoint is named');
  assert.ok(said.includes(DEFAULT_LOCAL_EMBEDDING_MODEL), 'the embedding model is named');
  assert.ok(said.includes(join(REPO_ROOT, 'data', 'models')), 'and where it will be cached');
  assert.ok(!said.includes('YTwins_LLM_API_KEY'), 'and no key is asked for');
});

await check('the halves are independent: a broken embedding still leaves the model working', async () => {
  const { fetch, calls } = recordingFetch(() => completion('{ "reply": "嗯。" }'));
  const { provider } = createRealProvider({
    // A cloud embedding with no endpoint configured: nothing to call.
    config: configFrom({ YTwins_LLM_API_KEY: 'sk-secret', YTwins_EMBEDDING: 'cloud' }),
    fetch,
  });

  const result = await provider.respond({
    body: '好累',
    brief: { emotionPresent: true, adviceRequested: false },
    instructions: [],
  });
  assert.equal(result.reply, '嗯。');
  assert.equal(calls.length, 1, 'the model half reached the endpoint');

  await assert.rejects(
    () => provider.embed({ texts: ['好烦'] }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('YTwins_EMBEDDING_BASE_URL'),
    'and the embedding half says exactly what is missing',
  );
});

await check('the embedding half is the local one by default, and reaches no network', async () => {
  const loads = { value: 0 };
  const { provider } = createRealProvider({
    config: configFrom({ YTwins_LLM_API_KEY: 'sk-secret' }),
    loadExtractor: fakeExtractor([[1, 0], [0, 1]], loads),
    fetch: recordingFetch(() => {
      throw new Error('nothing should be fetched for a local embedding');
    }).fetch,
  });

  const { vectors } = await provider.embed({ texts: ['好烦', '想学吉他'] });
  assert.deepEqual(vectors, [[1, 0], [0, 1]]);
  assert.equal(loads.value, 1);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exitCode = 1;
}
