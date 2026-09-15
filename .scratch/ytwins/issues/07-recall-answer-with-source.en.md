# 07: Recall — asking about an old thing, answered with its source

**What to build:** Ask a question against the **records** (say "how is the final graded") and get an accurate answer
together with the **drop** it came from, checkable against the verbatim original text. When recall comes up short it
says **plainly that it found nothing** rather than inventing a plausible-sounding answer. So that this step can be
verified independently and early, the user can pin a "what day is it" time basis by hand instead of waiting days.

**Blocked by:** 01 (Project skeleton and the first "drop" end to end)

**Status:** ready-for-human

**Claimed and completed** (2026-09-15, redone after 02 was committed): RED → GREEN finished, all 14 recall
checks green, and act two (问) filled in as part of the same work. The process record is in `## Comments` below.

- [x] When a question hits a **record**, it returns an accurate answer and names the **drop** it came from.
- [x] When recall comes up short, it returns an explicit "found nothing" and generates no plausible-sounding answer.
- [x] The answer is traceable to the verbatim original text (the same content the user typed, byte for byte).
- [x] Both question parsing and answer generation go through the **AI provider port**, so tests using the fake provider are deterministic.
- [x] The user can pin a time basis by hand (for the demo's "a few days later" viewpoint); that basis affects answer wording and time references but never changes what is recalled.

## Comments

### 2026-09-15 — revisions after the two-axis `/code-review`

Both axes found real problems. All are fixed; below is **what changed** and **why two things were left alone**.

**Fixed (Spec axis).**

1. **One source became all matches.** It previously cited only the oldest match, but the composer receives
   *every* match and may have used a later one — so the original shown could be one the answer did not come
   from, and checkability is the only reason a source is shown. `sources` is now an array citing all matches.
2. **"Found nothing" no longer swallows "could not look".** A provider outage also returned `not-found`, and the
   page then said "留档里没有和这个问题相关的记录" — asserting that the user's own records lack something **nobody
   searched for**, which is a lie about their data. `unavailable` now exists separately: this attempt failed,
   versus searched-and-absent.
3. **A blank answer is not an answer.** The interface claimed an empty string could never be mistaken for an
   answer, but nothing checked. A provider returning `'   '` yielded `answered` with an empty body beside a
   source. Blank answers are now refused.
4. **`now` is finally observable in the demo.** The demo's composition was a fixed string, so the time basis had
   no observable effect and checkbox 5 was an empty claim. The demo answer now computes "提纲还有 N 天到期" from
   the basis (measured: 8 days with none, 5 days three days later, "已经过去了" past the deadline). The item also
   carries a real due date instead of always "待安排".
5. **The demo's match text was narrowed.** Single words like `期末` let "期末考完了" match, and it was then given
   a grading scheme it does not contain. Matching whole phrases means a passing mention is no longer answered.

**Fixed (Standards axis).**

6. **`cues` renamed to `matchText`.** `cues` reads as a domain noun and is not in `CONTEXT.md`; `domain.md` says
   that means either inventing language the project does not use or a real gap. It is the former — a retrieval
   mechanic, not a domain concept (and it deliberately avoids 关键词, which `CONTEXT.md` lists as a synonym to
   avoid for 词条). The name now describes the mechanism.
7. **`RecallRecord` deleted**, reusing `interface.ts`'s `RecallSource`; a field-by-field duplicate copy went too.
8. **`isFailure` is a real type guard again.** A `string[]` allow-list discarded narrowing, and a new *success*
   kind would silently become a throw until someone remembered to edit the array. It now allow-lists the
   *failure* kinds only: a new failure kind fails loudly, a new success kind needs no edit.
9. **Two misleading test names.** "provider that fails / throws synchronously" scripted only `respond`, so
   `parseQuestion` took the default empty match and returned `not-found` before any failure path — the named
   failure was never exercised. The failure is now scripted on the call the test names.
10. **The fake no longer invents answers.** Unscripted composition used to return a hard-coded Chinese sentence;
    it now fails, forcing tests to script it. Composing is the one call whose output is presented to the user as
    fact, so a default there is a test double making up an answer.
11. Two comments corrected: the demo provider claimed its preset data was the single shared source used by the
    domain tests too (which would invert the layering — `src/domain/` must not depend on `src/web/` — and was not
    true); and the fake's "shared by both operations" was stale (there are four).

**Deliberately unchanged, with reasons.**

- **Answers are statements, not "你似乎…"** (Standards finding 2). The 不确定语气 rule in
  `parent-voice-principles.md` binds **surfaced conclusions and collided answers**, because wording must match
  supporting evidence. A recall answer is a fact **looked up from the user's own record** and verifiable against
  the verbatim original — not a conclusion inferred from fragments — so hedging it would be worse. Whether the
  wording should be unified is an ambiguity created by `CONTEXT.md`'s 追溯 entry also calling its output 答案;
  **that call is the product author's** (editing the glossary's meaning is not an agent's to make unilaterally).
- **No confidence on `ComposeAnswerResult`** (Spec finding 3). The spec's port description has `compose` supply
  confidence, but confidence exists to grade **surfacing** wording (supporting terms, link strength, time span),
  which is ticket 06's area. Adding a field nothing reads would be speculative design; it can arrive with 06.

**Verification**: `tsc` clean; domain tests **41/41** (23 before + 18 recall); checker 21/21; `vite build`
succeeds; a real server re-verified every revision above end to end (including wording under three different
time bases, and a passing mention no longer being answered).

### 2026-09-15 — implementation record

**What was built.** The domain core gained `recall(question, options?)`, returning a discriminated union —
either `{kind:'answered', answer, source}` or `{kind:'not-found'}`. There is no "empty-string answer" shape, so a
caller cannot confuse the two.

**The split** (confirmed with the user earlier): the AI provider port gained the two ends — `parseQuestion`
(question → cues) and `composeAnswer` (matched records + time basis → answer sentence) — while **selection
between them is ordinary code in the domain core**: cues are trimmed, then looked for as substrings in the stored
originals. So "found nothing" is a fact about the data rather than a model's opinion, and the same question
recalls the same records every time.

**Decisions that are not obvious.**

1. **Blank cues are dropped first.** If a model returned `['']` or whitespace, every record would match, since
   every string contains the empty string — turning "nothing to look for" into "everything answers this". Once
   trimmed, an empty list is `not-found`.
2. **Every provider failure lands on the same `not-found`**: no provider, `parseQuestion` throwing, and
   `composeAnswer` throwing all converge. Recall has exactly one failure face for the user, and that face is honest.
3. **The composer is not called without evidence.** A test asserts this (`composed === 0`) — "found nothing" is
   said by code, not phrased by a model asked to describe an absence it cannot check.
4. **The source is the oldest match.** The composer may draw on several records, but an answer that cannot be
   traced to one piece of original text is not checkable, and checkability is the point.
5. **The time basis reaches the composer only**, never selection. It can change wording and time references; it
   cannot change what is recalled.
6. **`/api/recall` returns 200 for "found nothing"**, not 404: it is a real answer about the user's data, not an
   error status.

**Why a provider is wired into the server.** Per the spec, tickets 01–11 all run on a fake provider (the real one
arrives in 12). The server previously had none, which would have made act two answer "found nothing" forever. So
`src/web/demo-provider.ts` was added: it gathers the three acts' **preset data** in one place (the spec explicitly
allows the demo to run on preset data) and serves as the stand-in until 12. It holds no credential.

**Verification**: `tsc --noEmit` clean; domain tests 37/37 (23 before + 14 recall); the workspace checker and its
tests pass; `vite build` succeeds (needs one unrestricted run — see the sandbox notes in `NEXT.md`); and a real
server was exercised end to end — drop the demo fragment → item extracted → ask "期末怎么算分" → answer with the
verbatim original as its source; ask something unrelated → an explicit "found nothing".

### 2026-09-15 — why it was paused once

**Why.** Tickets 02 and 07 edit the same files (`interface.ts` is the one both must change). Ticket 02's work was
**uncommitted** and mid-way through a `dropped.id` → `dropped.dropId` rename (`tsc` reported 11 `TS2339`s). With
both tickets editing the same uncommitted files, git cannot separate them, so continuing 07 would only entangle
the two tickets' state.

**What was withdrawn.** 07's four changes left the working tree and were backed up under `archive/ticket-07-wip/`
(`/archive/*` is gitignored). The withdrawal was **deletion-only**, verified file by file: `domain.test.ts`
−284/+0, `fake-provider.ts` −69/+0, and `ai-provider.ts` gained one line only from reflowing a doc comment.
**Ticket 02's state was not altered.**

**A trap worth remembering on resume**: the backups were taken *before* ticket 02 finished its rename, so copying
them back would have reverted 02's fix. Resuming therefore meant **re-applying 07's changes onto the committed
files**, not restoring the backups. One more: the backup's tests used an earlier draft's script field names
(`byQuestion` / `byCompose`) rather than the final fake's (`parseQuestionByQuestion` / `composeFallback`); these
were reconciled.
