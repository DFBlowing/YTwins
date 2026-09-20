#!/usr/bin/env node
/*
 * Check that the workspace layout still follows docs/agents/workspace-layout.md.
 *
 * Run it on demand — at the end of a session, before committing. It never
 * blocks anything and never runs automatically; it only makes drift visible.
 * The convention was written down on 2026-09-13 and had regressed within 24
 * hours, which is why this exists.
 *
 *   node tools/check-workspace.mjs
 *   node tools/check-workspace.mjs --max-archive-mb 4
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files allowed directly at the repo root. Everything else lives in a layer.
 *  The Node project files sit here because the web demo is built from the repo
 *  root; `CONTEXT-MAP.md` is allowed so that splitting the glossary into several
 *  contexts later does not trip the checker. `.env` and its template are here
 *  because the server reads its key from `<root>/.env` (see
 *  `src/ai/env-file.ts`): that path is a toolchain input, and this checker walks
 *  the filesystem rather than git, so the ignored `.env` is visible to it even
 *  though it is not in the repository. `README.md` sits here for the same reason
 *  `vite.config.ts` does: GitHub renders the repo-root README as the landing page,
 *  so no layer can hold it. `README.en.md` rides along as the English counterpart
 *  the language policy in `AGENTS.md` asks for — the one pair `projects/` is
 *  explicitly exempt from. */
const ROOT_ALLOWED_FILES = new Set([
  'AGENTS.md', 'CLAUDE.md', 'CONTEXT.md', 'CONTEXT-MAP.md', '.gitignore', 'skills-lock.json',
  'README.md', 'README.en.md',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'tsconfig.json',
  'vite.config.ts', '.env', '.env.example',
]);

/** Workspace-level docs allowed in the docs/ root. Effort products never are. */
const DOCS_ROOT_ALLOWED_FILES = new Set([
  'Matt-Skills-使用指南.md',
]);

/** `.scratch/` holds effort directories plus this one file. */
const SCRATCH_ROOT_ALLOWED_FILES = new Set(['README.md']);

/** What an effort directory may contain — see docs/agents/issue-tracker.md. */
const EFFORT_ALLOWED = [
  'spec.md', 'spec.en.md', 'NEXT.md', 'NEXT.en.md', 'map.md', 'map.en.md', 'issues',
];

/** A directory holding none of the primary markers is not an effort: it drifted in. */
const EFFORT_MARKERS = EFFORT_ALLOWED.filter((name) => !name.endsWith('.en.md'));

/** A ticket is one file per issue, numbered from 01, optionally with an English pair. */
const TICKET_NAME = /^\d{2}-[^.]+(\.en)?\.md$/;

export const DEFAULT_MAX_ARCHIVE_BYTES = 1024 * 1024;

/** Dirent list, or null when the directory does not exist. */
function readDir(abs) {
  try {
    return readdirSync(abs, { withFileTypes: true });
  } catch {
    return null;
  }
}

function filesUnder(abs, prefix, out = []) {
  for (const entry of readDir(abs) ?? []) {
    const childAbs = join(abs, entry.name);
    const childRel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) filesUnder(childAbs, childRel, out);
    else out.push({ rel: childRel, abs: childAbs });
  }
  return out;
}

/**
 * Audit `root` against the workspace layout convention.
 *
 * @param {string} root absolute path of the repo root
 * @param {{maxArchiveBytes?: number}} [options]
 * @returns {{rule: string, path: string, message: string}[]} violations, empty when clean
 */
export function checkWorkspace(root, options = {}) {
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const found = [];
  const report = (rule, path, message) => found.push({ rule, path, message });

  for (const entry of readDir(root) ?? []) {
    if (entry.isDirectory()) continue;
    if (!ROOT_ALLOWED_FILES.has(entry.name)) {
      report('root-stray-file', entry.name,
        '根目录不该有文件 —— 它属于 projects/、docs/、archive/、tools/ 或 .scratch/');
    }
  }

  for (const entry of readDir(join(root, '.scratch')) ?? []) {
    if (!entry.isDirectory()) {
      if (!SCRATCH_ROOT_ALLOWED_FILES.has(entry.name)) {
        report('scratch-foreign-entry', `.scratch/${entry.name}`,
          '.scratch/ 里只该有 effort 目录和 README.md');
      }
      continue;
    }
    const effort = `.scratch/${entry.name}`;
    const inner = readDir(join(root, '.scratch', entry.name)) ?? [];
    const names = new Set(inner.map((e) => e.name));
    if (!EFFORT_MARKERS.some((marker) => names.has(marker))) {
      report('scratch-foreign-entry', `${effort}/`,
        '看起来不是一个 effort（里面没有 spec、NEXT、map 或 issues）—— 它该去 docs/ 或 archive/');
      continue;
    }
    for (const innerEntry of inner) {
      if (!EFFORT_ALLOWED.includes(innerEntry.name)) {
        report('scratch-effort-foreign-entry', `${effort}/${innerEntry.name}`,
          '不在 effort 允许的清单里（spec / NEXT / map / issues）—— effort 产物去 docs/，副产物去 archive/');
        continue;
      }
      if (innerEntry.name !== 'issues') continue;
      for (const ticket of readDir(join(root, '.scratch', entry.name, 'issues')) ?? []) {
        if (ticket.isDirectory() || !TICKET_NAME.test(ticket.name)) {
          report('scratch-issue-name', `${effort}/issues/${ticket.name}`,
            'ticket 文件名应形如 01-<slug>.md（可带 .en 对照件）');
        }
      }
    }
  }

  for (const entry of readDir(join(root, 'docs')) ?? []) {
    if (entry.isDirectory()) continue;
    if (!DOCS_ROOT_ALLOWED_FILES.has(entry.name)) {
      report('docs-root-effort-product', `docs/${entry.name}`,
        'docs/ 根只留工作区级文档；effort 产物应进 docs/<effort>/');
    }
  }

  for (const entry of readDir(join(root, 'projects')) ?? []) {
    if (entry.isDirectory()) continue;
    if (entry.name.endsWith('.en.md')) {
      report('projects-en-pair', `projects/${entry.name}`,
        '总览只出中文一份，不给它配英文对照件');
    }
  }

  for (const entry of readDir(join(root, 'tools')) ?? []) {
    if (!entry.isDirectory()) continue;
    const hasReadme = (readDir(join(root, 'tools', entry.name)) ?? [])
      .some((f) => f.name === 'README.md');
    if (!hasReadme) {
      report('tools-dir-no-readme', `tools/${entry.name}/`,
        '多文件工具缺 README.md —— 它要解释这个工具做什么、怎么跑');
    }
  }

  for (const file of filesUnder(join(root, 'archive'), 'archive')) {
    if (statSync(file.abs).size <= maxArchiveBytes) continue;
    report('archive-large-file', file.rel,
      `超过 ${Math.round(maxArchiveBytes / 1024)} KB —— 归档前先瘦身`);
  }

  return found;
}

function main(argv) {
  let maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES;
  const mbIndex = argv.indexOf('--max-archive-mb');
  if (mbIndex !== -1) {
    const megabytes = Number(argv[mbIndex + 1]);
    if (!Number.isFinite(megabytes) || megabytes <= 0) {
      console.error(`--max-archive-mb expects a positive number, got ${argv[mbIndex + 1] ?? '(nothing)'}`);
      return 2;
    }
    maxArchiveBytes = megabytes * 1024 * 1024;
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const found = checkWorkspace(root, { maxArchiveBytes });

  if (found.length === 0) {
    console.log('workspace layout: clean');
    return 0;
  }
  console.log(`workspace layout: ${found.length} violation(s)\n`);
  for (const v of found) console.log(`  [${v.rule}] ${v.path} — ${v.message}`);
  console.log('\n规则见 docs/agents/workspace-layout.md。');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
