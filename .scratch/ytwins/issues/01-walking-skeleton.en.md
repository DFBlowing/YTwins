# 01: Project skeleton and the first "drop" end to end

**What to build:** From an empty repo to a running local web page. Open the page, drop an unformatted fragment into
the input box, and it immediately replies "caught it"; the **record** is stored verbatim, and the sentence is still
there after a refresh. This drop succeeds with no AI involved at all — because it establishes the shape of the
"extraction is asynchronous to persistence" decision. It also sets the first TDD precedent: a single-process test
entry driven by a fake **AI provider**, fully deterministic.

This ticket also raises the **page skeleton for all three acts** at once: the three views' layout and Chinese copy
take shape together, with acts ② and ③ as empty shells at this point (they are filled in by 07 and 06 respectively).
The reason is that the skeleton's shape is already frozen in the spec and every later ticket hangs something inside
it, so building it early carries no rework risk; but **only act ① is wired to the real chain** — acts ② and ③ take
no fake data and implement no logic. They are not "pages demonstrated with fake data", only containers with nothing
in them yet.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] The repo holds one TypeScript + Node project (project files at the repo root), with domain logic and the UI layer in two top-level directories under `src/`.
      → `package.json`, `tsconfig.json` and `vite.config.ts` at the repo root; `src/domain/` and `src/web/`.
- [x] A **domain core** module exists whose interface's first operation is "**drop once**", returning a **task-shaped** result (what this drop caught) — no tables, no id assembly, no SQL exposed.
      → `drop()` in `src/domain/interface.ts` returns `DropResult` (body + reply); storage detail sits behind the `storage.ts` port.
- [x] An **AI provider port** interface exists with a **fake implementation** that returns scripted results per input; every test in this ticket is driven by it.
      → `src/domain/ai-provider.ts` is the port; `src/domain/fake-provider.ts` returns scripted results per body and can be scripted to hang or throw.
- [x] The local Node server listens on the loopback address only; the page is built by Vite; the browser can obtain no API key.
      → `src/web/server.ts` binds `127.0.0.1`; the browser bundle contains no credential-shaped string (verified).
- [x] After a drop, the **record** body is byte-for-byte the string the user typed (original text stored in full, never a summary).
      → Tests assert a byte-for-byte round trip including whitespace and newlines; end-to-end verification checked Chinese text too.
- [x] The drop's return does not wait on any extraction: even when the fake provider is configured to be slow or to throw, the drop still persists and still returns "caught it".
      → `core.ts` persists first and never awaits the provider; tests assert both the hanging and the throwing script.
- [x] The **record** survives a page refresh (data lands in a local SQLite file).
      → Data lands in `data/ytwins.sqlite`; verified to survive an actual **server restart**.
- [x] A directly executable single-file test entry exists, run via Node's built-in type stripping, spawning **no child processes**, **not** using `node --test`, and introducing no test framework.
      → `node src/domain/domain.test.ts`, with its own assertions and the exit code as the result.
- [x] The **page skeleton for all three acts** goes up at once: the drop, ask, and surface views all exist, with layout and Chinese copy in shape and switchable between one another.
      → Three `data-act-panel` sections in `src/web/index.html`, with three switchable tabs at the top.
- [x] Only act ① is wired to the real chain inside the skeleton (it really drops, really persists, really replies); acts ② (ask) and ③ (surface) are empty shells taking no fake data and implementing no logic.
      → End-to-end verification proved act ① really persists; acts ② and ③ carry only the line "这一幕还没实现。"
- [x] The skeleton contains no data fabricated for demonstration and no hard-coded outputs — what is empty renders empty, and what is unimplemented says plainly that it is unimplemented.
      → The list is driven by a real `/api/drops` response and shows "还没有丢过东西。" when empty.

## Comments

**2026-09-15 — implementation complete, with two deviations from the spec's letter (both confirmed with the author)**

1. **The environment falsified the required test-entry shape.** The ticket required "a single-file test entry + Node's
   built-in type stripping + no child processes + not `node --test`", but those two requirements cannot both hold on this
   machine: Node v22.23.2's type stripping here is **strip-only** (measured), and a test file using `node:test` **must**
   print TAP output, which can only be captured by spawning a child. Resolution: a single-file entry with its own
   assertions and the exit code as the result, mirroring `tools/check-workspace.test.mjs`. Confirmed.
2. **Storage uses `node:sqlite`, not the `better-sqlite3` written in the spec.** Node v22.5+ ships `node:sqlite`, which
   means zero third-party runtime dependencies and working foreign-key cascades (`PRAGMA foreign_keys = ON`, measured).
   Confirmed.

**Two facts discovered during implementation, worth recording:**

- **`vite build` hits `spawn EPERM` in this sandbox** — esbuild starts a service child process, which is denied.
  Building `dist/web` needs one unconfined execution. `npm install` is the same story (lifecycle scripts spawn).
  **Expect this in day-to-day development.**
- The first version of `resolveStaticFile` returned the build directory itself for `GET /`, and `readFile` threw
  `EISDIR`, **taking the whole server down**. Fixed: directories are refused, a failed static serve degrades to a 404,
  and a handler rejection can no longer become an unhandled rejection. This bug was caught by end-to-end measurement,
  not by a unit test — recorded here as a precedent.
