// Tests for the workspace-layout checker. Fixtures are built inside a temp
// directory: a real repository tree would make every assertion depend on the
// repo's own drift, which is the thing under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWorkspace } from './check-workspace.mjs';

/** Build a throwaway tree. `spec` maps relative paths to file contents; a path
 *  ending in `/` is a directory, and a value of null means "empty file". */
function fixture(spec) {
  const root = mkdtempSync(join(tmpdir(), 'check-workspace-'));
  for (const [rel, body] of Object.entries(spec)) {
    const abs = join(root, rel);
    if (rel.endsWith('/')) mkdirSync(abs, { recursive: true });
    else {
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, body ?? '');
    }
  }
  return root;
}

function rules(root) {
  return checkWorkspace(root).map((v) => v.rule);
}

/** A tree that satisfies every rule. Each test below mutates one thing. */
const CLEAN = {
  'AGENTS.md': null, 'CLAUDE.md': null, 'CONTEXT.md': null,
  '.gitignore': null, 'package.json': null, 'vite.config.ts': null,
  'src/': null,
  'projects/': null, 'projects/ytwins.md': null,
  '.scratch/': null, '.scratch/README.md': null,
  '.scratch/ytwins/': null,
  '.scratch/ytwins/spec.md': null,
  '.scratch/ytwins/spec.en.md': null,
  '.scratch/ytwins/NEXT.md': null,
  '.scratch/ytwins/NEXT.en.md': null,
  '.scratch/ytwins/issues/': null,
  '.scratch/ytwins/issues/01-first.md': null,
  'docs/': null, 'docs/agents/': null, 'docs/adr/': null,
  'docs/ytwins/': null, 'docs/ytwins/parent-voice-principles.md': null,
  'tools/': null, 'tools/README.md': null,
  'tools/check-workspace.mjs': null,
  'archive/': null, 'archive/README.md': null,
};

test('a tree that follows the convention reports nothing', () => {
  const root = fixture(CLEAN);
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stray file at the repo root is a violation', () => {
  const root = fixture({ ...CLEAN, 'notes.md': null });
  try {
    const found = checkWorkspace(root);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'root-stray-file');
    assert.equal(found[0].path, 'notes.md');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a directory at the repo root is always allowed', () => {
  const root = fixture({ ...CLEAN, 'some-new-layer/': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a multi-context repo is not a violation', () => {
  const root = fixture({ 'CONTEXT-MAP.md': null, 'CONTEXT.md': null, 'docs/': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a non-tracker entry in .scratch/ is a violation', () => {
  const root = fixture({ ...CLEAN, '.scratch/backups/': null });
  try {
    assert.deepEqual(rules(root), ['scratch-foreign-entry']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a .scratch/ directory holding only by-products is not mistaken for an effort', () => {
  const root = fixture({ ...CLEAN, '.scratch/backups/cc-switch.db': 'x'.repeat(8) });
  try {
    const found = checkWorkspace(root);
    assert.deepEqual(found.map((v) => v.rule), ['scratch-foreign-entry']);
    assert.equal(found[0].path, '.scratch/backups/');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an effort dir may hold spec, NEXT, map and issues — and nothing else', () => {
  const root = fixture({ ...CLEAN, '.scratch/ytwins/decisions.md': null });
  try {
    const found = checkWorkspace(root);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'scratch-effort-foreign-entry');
    assert.equal(found[0].path, '.scratch/ytwins/decisions.md');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('map.md is allowed inside an effort dir', () => {
  const root = fixture({ ...CLEAN, '.scratch/ytwins/map.md': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a ticket file must be numbered NN-slug', () => {
  const root = fixture({ ...CLEAN, '.scratch/ytwins/issues/first.md': null });
  try {
    assert.deepEqual(rules(root), ['scratch-issue-name']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a ticket may carry an English pair alongside it', () => {
  const root = fixture({ ...CLEAN, '.scratch/ytwins/issues/01-first.en.md': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an effort product sitting in the docs/ root is a violation', () => {
  const root = fixture({ ...CLEAN, 'docs/品牌说明.md': null });
  try {
    const found = checkWorkspace(root);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'docs-root-effort-product');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no doc at all is allowed loose in the docs/ root', () => {
  const root = fixture({ ...CLEAN, 'docs/产品说明.md': null });
  try {
    assert.deepEqual(rules(root), ['docs-root-effort-product']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the skills guide is a workspace-level doc and is allowed in the docs/ root', () => {
  const root = fixture({ ...CLEAN, 'docs/Matt-Skills-使用指南.md': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skills-lock.json is a protocol file and is allowed at the root', () => {
  const root = fixture({ ...CLEAN, 'skills-lock.json': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an English pair for a projects overview is a violation', () => {
  const root = fixture({ ...CLEAN, 'projects/ytwins.en.md': null });
  try {
    const found = checkWorkspace(root);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'projects-en-pair');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a multi-file tool without a README is a violation', () => {
  const root = fixture({ ...CLEAN, 'tools/new-thing/': null, 'tools/new-thing/run.mjs': null });
  try {
    assert.deepEqual(rules(root), ['tools-dir-no-readme']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a single-file tool at the tools/ root needs no README', () => {
  const root = fixture({ ...CLEAN, 'tools/check-workspace.mjs': null });
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a file over the size cap in archive/ is a violation', () => {
  const root = fixture({ ...CLEAN, 'archive/cc-switch/a.db': 'x'.repeat(64) });
  try {
    const found = checkWorkspace(root, { maxArchiveBytes: 16 });
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'archive-large-file');
    assert.equal(found[0].path, 'archive/cc-switch/a.db');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the archive size cap is measured per file, not per directory', () => {
  const root = fixture({
    ...CLEAN,
    'archive/cc-switch/a.db': 'x'.repeat(16),
    'archive/cc-switch/b.db': 'x'.repeat(16),
  });
  try {
    assert.deepEqual(checkWorkspace(root, { maxArchiveBytes: 24 }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing directory is skipped silently, not reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-workspace-'));
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every violation points at a path and explains itself', () => {
  const root = fixture({ ...CLEAN, 'stray.md': null });
  try {
    const [found] = checkWorkspace(root);
    assert.equal(found.path, 'stray.md');
    assert.ok(found.message.length > 0);
    assert.doesNotMatch(found.message, /stray\.md/, 'the path is reported separately; the message must not repeat it');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
