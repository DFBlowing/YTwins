# YTwins Web Demo Specification

Status: ready-for-agent

> This spec is the consolidation of three interview rounds (the terminology round and the boundary round) and two
> research documents (`docs/ytwins/parent-voice-principles.md`, `docs/ytwins/memory-linking-research.md`).
> All terminology comes from [`CONTEXT.md`](../../CONTEXT.md); no synonyms are invented here.
> The Chinese original is [`spec.md`](./spec.md).

## Problem Statement（问题陈述）

I am the only user of this product. Every day I have small things I want to drop in passing: a feeling, a decision,
something to get done, a sudden idea. They arrive without sentences and without format, and often several of them are
mixed into one message (for example, "the teacher explained how the final grade is computed today, so annoying" is
both an **item** and a **feeling**).

Today those things go nowhere: dropped into a notes app they are never looked at again, dropped into a chat window
they scatter, and turning them into any conclusion requires me to organise, classify, label and review them first —
and I do not want to do a single one of those things. The result is that **material is produced every day and no
conclusion is ever reached**. I am not even sure what I have actually cared about for the past six months.

Existing tools do not solve this: note apps want me to organise, chat assistants want a conversation right now (their
value lives inside that conversation, not in accumulation), and task apps only recognise a to-do. They all assume I am
willing to do clerical work for the tool, and my hard requirement is precisely that I am **not**.

There is a second worry. A tool like this — "an AI that records my fragments" — naturally raises two questions:
**what is it quietly training** (am I feeding something I do not understand?), and **will it take my data somewhere
else**. I need it to be honest with me, and I need to be able to delete things completely whenever I want.

## Solution（解决方案）

A **purely local, account-free** web demo (a phone app later). I only ever do one thing: **drop** fragments in.
Everything else happens behind the scenes:

- **Catch it**: an unformatted message arrives, and it automatically separates an **item** from a **record**,
  extracts **terms** from it (keeping my own wording), and answers me with one short line in **parent voice** —
  if there is feeling in it, it catches the feeling first; if there is none, it does not force one.
- **Settle**: where I cannot see, **links** grow between **terms** (semantically close, or appearing in the same
  **drop**). When one feeling or decision connects to enough terms and crosses the **threshold**, a **conclusion**
  is assembled. Conclusions accumulate and revise each other, forming a **portrait** and a **conclusion chain**.
- **Surface**: only when I drop something emotional or ask on my own initiative does it surface one **conclusion** or
  one **answer** assembled by **collision**, in uncertain wording. The strength of the wording is tied to the support
  behind it, and the same topic surfaces at most once every 7 days.

It also answers **recall** questions ("how is the final grade computed?" → an accurate answer plus which drop it came
from) and places **items** onto time (**scheduling**). The demo proves the chain with three acts:
**drop** → **ask** → **surface**.

It is **companionship**, not chat: it remembers me over time but never barges in. The value comes from accumulation,
not from conversation.

## User Stories（用户故事）

**Dropping and catching**

1. As a user, I want to drop a messy, unformatted, unclassified message straight into the input box, so that I do not
   have to decide what kind of thing it is first.
2. As a user, I want one message containing both a task and a feeling to work in a single drop, so that I do not have
   to split it into two.
3. As a user, I want no type to choose, no time to fill in and no tag to add when dropping, so that the act of
   dropping carries zero decision cost.
4. As a user, I want the system to separate an **item** from a **record** on its own, so that I never have to tidy up
   afterwards.
5. As a user, I want the **record** to preserve my exact words (no summary), so that when I recall it later I see what
   I actually said.
6. As a user, I want the system to assign an **input type** internally (feeling / decision / item / idea) without ever
   showing it or asking me to choose, so that I do not have to learn its taxonomy.
7. As a user, I want **terms** extracted from a drop in my own wording ("want to learn guitar", not "musical
   interest"), so that later conclusions are still in language I recognise.
8. As a user, I want one short **reply** after each drop, so that I know it landed rather than vanishing into a hole.
9. As a user, I want **interaction** not to be required daily, so that coming back after several days still works and
   nothing nags me to check in.
10. As a user, I want a drop to succeed immediately (the raw text is stored first; extraction may be slower), so that I
    neither wait nor risk losing anything.

**Parent voice**

11. As a user, I want the first sentence of the reply to be an emotional response when the input carries feeling —
    not information, a conclusion, advice or a question — so that I am caught first.
12. As a user, I want it to put my feeling into words for me ("you seem…", "sounds like…") rather than demanding that
    I explain the cause first, so that I do not have to argue my case while hurting.
13. As a user, I want it to describe the specific thing and never define my personality (not even "positively"), so
    that I am not labelled.
14. As a user, I want it not to give advice by default, so that my own problem-solving is not taken away from me.
15. As a user, I want advice only when I explicitly ask "what should I do", or when I have already named a direction
    myself — and then at most one piece, which I may refuse — so that the choice always stays with me.
16. As a user, I want it not to decide for me, not to settle my next step, and never to announce "I have arranged it
    for you", so that I am not sidelined.
17. As a user, I want it never to ask "why", so that I am not interrogated.
18. As a user, I want at most one question per turn, and never a repeat of something I already answered, so that the
    exchange does not become an interrogation.
19. As a user, I want it to stop probing when I say "I don't want to talk about it / never mind / it's fine", leaving
    only the shortest statement of presence, so that I keep the right to be silent.
20. As a user, I want no unrequested reminders (sleep, water, efficiency, health), so that care is not a burden.
21. As a user, I want it not to steer me towards "happy things" to cover the pain, so that my feelings are taken
    seriously.
22. As a user, I want it to distinguish accepting a feeling from endorsing a judgement, so that I am understood
    without being encouraged to stop reflecting.
23. As a user, I want replies to stay within about 3 sentences / 60 characters by default, with no pet names and no
    filler interjections standing in for content, so that it sounds neither like customer service nor like nagging.
24. As a user, I want no "but / at least" turn at the end, so that the acceptance in the first half is not revoked.
25. As a user, I want it to admit and repair a bad reply directly (no explaining, no defending, no long apology), so
    that the relationship is repaired rather than performed.
26. As a user, I want it to reply in Chinese only, so that the product does not put on a foreign accent.

**Settling, links and conclusions**

27. As a user, I want **links** to grow between **terms** automatically, so that associations need no manual work.
28. As a user, I want two kinds of link — semantically close (cosine similarity of pretrained embeddings plus a
    threshold) and appearing in the same drop — so that both similarity of meaning and "said together at the time"
    are captured.
29. As a user, I want a **conclusion** assembled automatically once a feeling or decision connects to enough terms
    and crosses the **threshold**, so that conclusions come from my accumulation rather than from one conversation.
30. As a user, I want the **threshold** to be a count threshold (enough terms connected), not a time threshold, so
    that "it came up three times" means more than "three days passed".
31. As a user, I want the whole **settling** process to be invisible, so that I neither participate in it nor have to
    understand its mechanics.
32. As a user, I want each **conclusion** to be a plain declarative sentence (for example, "you seem to really want to
    learn guitar"), so that I can immediately tell whether it is right.
33. As a user, I want the **portrait** to be nothing more than the set of conclusions (not a second hidden model), so
    that it holds no secrets from me.
34. As a user, I want conclusions to be revisable later — overturned or inherited — so that my growth is recorded
    rather than frozen.
35. As a user, I want the **conclusion chain** to be read-only by default but available whenever I look, so that I can
    always see why it thinks what it thinks.
36. As a user, I want to mark a conclusion as "not true" and have that count as an **overturning** in the chain, so
    that correcting it stays a very light act.
37. As a user, I want to add a sentence of my own next to a conclusion and have that sentence itself become a
    **drop**, so that my feedback also enters the material.
38. As a user, I want no scoring, liking or bulk-feedback feature, so that I am not pulled into "training it" — that
    is the red line of imperceptibility.
39. As a user, I want every conclusion to tell me which terms support it, so that I do not have to take it on trust.

**Surfacing and answers**

40. As a user, I want no push by default — attempts only when I drop something emotional or ask on my own initiative —
    so that it does not disturb me.
41. As a user, I want the same topic surfaced at most once every **7 days**, so that the same thing is not repeated
    back at me.
42. As a user, I want at most one thing surfaced per turn, so that surfacing is "one sentence", not "a report".
43. As a user, I want everything surfaced to be phrased in uncertain language ("you seem…", "lately you…"), so that
    the wording matches the support.
44. As a user, I want the strength of that wording to be driven by explainable numbers (number of supporting terms,
    link strength, time span) rather than by the model feeling out a tone on the spot, so that it can later answer
    "why did you say that at the time".
45. As a user, I want an **answer** to be one sentence assembled from several conclusions that could only come from my
    own data, so that it does not hand me generic filler.
46. As a user, I want to be able to ask "how have I been lately?", so that I get an observation when I want one.
47. As a user, I want it to stay silent or say "I am not sure" when support is thin, so that it does not burn my trust
    with assertions.

**Recall and scheduling**

48. As a user, I want an accurate answer when I ask about a **record**, together with the drop it came from, so that I
    can check it.
49. As a user, I want it to say plainly that it found nothing when recall fails, rather than inventing a plausible
    answer, so that it deserves trust.
50. As a user, I want **items** placed onto time automatically (I never fill in the time), so that scheduling costs me
    no extra effort.
51. As a user, I want items without a parsed time kept as "to be scheduled" rather than dropped, so that nothing I
    have to do gets lost.
52. As a user, I want to see the list of upcoming items, so that opening the page tells me what is due.
53. As a user, I want the demo to skip system-level push and reminder reliability guarantees, so that the
    "catch → settle → surface" chain is built right first.

**Data, privacy and maintainability**

54. As a user, I want the product to run purely locally with no account, so that it is genuinely mine.
55. As a user, I want to be told explicitly "N conclusions came from this" when deleting a drop, and to decide whether
    they go too, so that deletion is both clean and unsurprising.
56. As a user, I want no trace of a deleted drop left in recall or conclusions after a cascade delete, so that
    "deleted" really means deleted.
57. As a user, I want it to state clearly which data leaves this machine (in the demo: the raw text sent to the cloud
    LLM), so that I can make my own privacy trade-off.
58. As a user, I want to be able to switch inference to fully local (Ollama) by configuration alone later, without
    touching domain logic, so that I can re-choose between privacy and speed.
59. As a user, I want the entire interface replaceable without touching domain logic when the phone app happens, so
    that the endgame does not require a rewrite.
60. As a user, I want it to train no model and introduce no graph database, so that I can maintain this project alone
    for a long time.
61. As a user, I want the yearly API cost to stay in the one-dollar range, so that cost is never a reason not to use
    it.

**The three demo acts**

62. As a presenter, I want the first act, "drop", to show in one go: a messy message containing grading rules and one
    emotional line, dropped with no type chosen and no time filled in, from which an item and a record are separated
    automatically.
63. As a presenter, I want the second act, "ask", to ask "how is the final grade computed?" from a "a few days later"
    vantage point and get an accurate answer with its source.
64. As a presenter, I want the third act, "surface", to surface one conclusion in uncertain wording after another
    emotional drop, with enough preloaded terms behind it.
65. As a presenter, I want all three acts to run stably and repeatably on preloaded data, so that the demo does not
    depend on luck.

## Implementation Decisions（实现决策）

### Test seams (two)

1. **The domain core interface (the highest seam).** Domain logic — drop parsing, settling, surfacing, scheduling,
   recall, and the application of parent voice — lives behind a single module that exposes only a few task-shaped
   operations. Every automated test drives that interface, and it is the only thing the web interface layer is
   allowed to depend on. Neither the interface layer nor the storage layer gets a seam.
2. **The AI provider port (the only external-dependency seam).** Every non-deterministic external intelligence call
   goes through this port:
   - `extract`: structure a drop's text into terms (preserving the user's words) plus input type and
     feeling/decision markers;
   - `embed`: encode text into vectors (used for link cosine similarity);
   - `judgeLink`: decide whether two terms are semantically close (called only in the grey zone);
   - `compose`: assemble supporting conclusions/terms into one answer, with its own confidence;
   - `respond`: generate the reply to a drop under the parent-voice constraints.

   The real implementation and a fake one are interchangeable. The fake returns scripted results per input, so domain
   tests are fully deterministic.

### Modules

- **Domain core**: holder of the highest seam. Internally split by responsibility: **drop parsing** (drop → item /
  record / terms + input type), **settling** (links, threshold accumulation, conclusion assembly, portrait,
  conclusion chain), **surfacing** (timing, cooldown, wording grading), **scheduling** (items onto time),
  **recall** (Q&A over records plus sources), and **applying parent voice** (turning the hard constraints into
  instructions and checks). Those internal divisions are not seams; tests do not reach through them.
- **AI provider port**: one interface, two implementations (real / fake).
- **Storage**: a local SQLite file holding drop and record text, terms, links, conclusions, the conclusion chain,
  items, and surfacing history.
- **Interface layer**: the web demo (three acts), working only through the domain core interface.

### Shape of the domain core interface

Operations are named in domain vocabulary and return **task-shaped** values ("what this drop caught and what the
reply is"), not storage-shaped ones (no tables, no id assembly, no SQL). At minimum:

- **Drop once**: returns the item produced by this drop (possibly none), the record, the extracted terms, and the
  reply given to the user.
- **Ask for recall**: returns an answer grounded in the **facts** held in the records, plus its source (which drop or
  drops); when recall fails it returns an explicit "not found" result rather than inventing one. What it answers are
  facts, not **judgments**, so they are stated plainly without hedging (see `CONTEXT.md`).
- **Request a surfacing**: returns zero or one conclusion/answer; zero is a normal outcome (in cooldown, or support
  too thin).
- **Read the portrait / read the conclusion chain**: read-only views including each conclusion's supporting terms and
  its overturn/inherit relations.
- **Mark a conclusion "not true"**: records an overturning in the chain; the original conclusion is kept.
- **Add a sentence of my own beside a conclusion**: that sentence enters the same pipeline as a new drop.
- **List items**: due and to-be-scheduled items in time order.
- **Preview deleting a drop**: returns the fact "N conclusions came from this", for the user to decide.
- **Confirm deleting a drop**: cascades or removes only the raw text per the user's choice, and makes later recall
  and conclusions stop referring to it.

### Data and algorithm decisions

- **Raw text is stored in full, never summarised.** The record and the drop body are the same faithful content; items
  and terms both point back to the drop they came from.
- **Extraction is asynchronous to storage.** As soon as a drop arrives its raw text is stored and "caught" is
  returned; extraction failing or lagging never breaks the drop, and can be retried later.
- **Two kinds of link**: (1) semantically close — cosine similarity of term embeddings with a three-band rule (high
  scores connect, low scores do not, the **grey zone** goes to `judgeLink` or is left unconnected for now);
  (2) same-drop co-occurrence — a hard edge needing no model. Link strength is comparable and each link keeps its
  reason.
- **Threshold assembly copies the shape of Generative Agents**: crossing the threshold produces a conclusion while
  storing the terms that support it. **The threshold is a count threshold**, carried by a configurable constant whose
  initial value is chosen so that act three of the demo reliably triggers while not every drop does.
  > **Amended 2026-09-16 (measured by ticket 05's prototype)**: the original wording was "each term carries an
  > LLM-assigned relevance score, and the scores accumulate". Measurement says the count is **how many times the
  > matter has been raised** — not terms, not relevance scores — otherwise a single fragment stuffed with terms would
  > speak more easily. The full table of values and the rubric is at the end of [`issues/05`](issues/05-conclusion-threshold-portrait-chain.md)'s
  > `## Comments`, and `CONTEXT.md`'s 阈值 entry was rewritten to match. What is kept from Generative Agents is the
  > *shape* (accumulate → cross the threshold → assemble a conclusion with its support); only "what accumulates" changed.
- **Assembly is debounced**: the threshold is not evaluated after every single drop, but after "a quiet period" or
  "several accumulated drops", so that a few mutually dependent messages are not assembled into a wrong conclusion
  too early.
- **Explainability of answers**: every answer/conclusion carries a list of supporting terms, and **wording strength is
  mapped from explainable numbers** (number of supporting terms, average link strength, time span) rather than chosen
  freely by the LLM.
  > **Amended 2026-09-16 (when ticket 05 landed)**: there is no single "confidence" number — one scalar would crush
  > three different kinds of evidence into a spuriously precise figure. What shipped is **three wording bands**
  > (weak / medium / strong) read off those three numbers, with the numbers themselves stored beside the conclusion and
  > readable on the page ("why it said that"), so "it can say why" still holds.
- **Uncertain wording is a hard constraint** that applies to **answers** and **surfacings** only; it does not rewrite
  ordinary replies.
- **The conclusion chain is append-only in effect**: marking "not true" records an overturning; the old conclusion is
  neither overwritten nor deleted (consistent with "raw text kept in full + recallable later"), so old conclusions
  require versions and a superseded relation.
  > **Corrected 2026-09-17 (when 10 landed)**: "records an overturning" lands as **appending a record to the chain**
  > (`kind: 'correction'`, `relation: 'overturn'`, `supersedes` pointing at the rejected one). The text of that record is
  > **a fact written by code** (「你标了这条不对。」) with no model involved: the user has just said the reading was
  > wrong, and having a model phrase a "corrected version" would be the product using that rejection to invent another
  > view of the user — one it does not hold. The record **also reaches the corpus layer**: a matter that was rejected is
  > discounted by `overturnedOverlapFactor` (0.3 by default) when attachment measures overlap, so it no longer counts as
  > "the same thing", and anything said about it afterwards steps one band softer (`overturnedBandDrop`, 1 by default) —
  > what is lowered is the **classification**, never the fact. Not one of the three numbers is touched; the step itself
  > is stored with that conclusion as a **fourth input** (`softened`) and named by the page under "why did it say that",
  > so the band and the numbers beside it cannot contradict each other.
  > "Add a sentence of your own" is a **drop** (wording stored verbatim, terms extracted, taking part in settling) and it
  > is **pinned** to the matter that conclusion came from: writing it beside the conclusion is the user stating "this is
  > about that" more clearly than any overlap could. Full account in [`issues/10`](./issues/10-revision-overturn-and-append.en.md)
  > under `## Comments`.
- **Surfacing timing and cooldown**: attempted only on an emotional drop or a user-initiated question; the same topic
  cools down for 7 days; at most one item per turn. The engineering definition of **topic** is "semantic overlap
  between the supporting term sets" — overlap above an internal ratio counts as the same topic.
  > **Corrected 2026-09-16 (when 06 landed)**: "an emotional drop" is read **two ways, either of which is enough** —
  > the emotion cues code can see, **or** the **input type** the model gave that drop being emotional. The shape of the
  > uncertain register is settled too: it is not read back out of the sentence by asking whether it "is stated as an
  > assertion" (that cannot be done — see the same clause in `parent-voice-principles.md`), it is **written in**: the
  > band is mapped from the three numbers above, and at the surfacing moment code picks one of that band's own openings
  > to put in front of the sentence. The cooldown's **record** (`surfacing_`) becomes an entity with it. The full
  > account is in [`issues/06`](./issues/06-surfacing.en.md) under `## Comments`.
  > **Corrected 2026-09-17 (when 11 landed)**: **asking directly** is not a second channel but the same moment's other
  > trigger — `requestSurfacing()` without a `dropId` — so the cooldown and the per-turn cap are one set by
  > construction and the two can never each produce an item in the same turn. When the user asks, and the material can
  > bring **two or more** conclusions together, they are assembled into one **answer** (`answerFloor`, 2 by default and
  > only ever stricter — one conclusion is not a smaller answer), at most `answerLimit` of them (4 by default), taking
  > the **newest** ones because the question is what the user is like *lately*; the result carries **which conclusions**
  > it was made of and the terms behind them. The wording still comes from the one mapping: the three numbers are read
  > as sets (union of terms, sum of mentions, furthest span, mean connection strength) and spoken through 05's band
  > function and 06's opening table — the **union**, because that union is the support the page lists beside the
  > sentence, so the band and the numbers next to it cannot tell two stories. Ticket 10's step still applies: if any of
  > the conclusions brought together was itself stepped down for a matter the user rejected, the answer steps down with
  > it (`softened` travels with the result and the page says so), because an answer may not speak more firmly than the
  > thing it rests on. When there is no answer to give — fewer than two sayable right now, or a provider
  > that cannot write it — nothing is forced and nothing goes silent: the moment falls back to surfacing the one
  > conclusion there is. The cooldown records **one row per conclusion the answer used** (reusing `surfacing_`, no
  > schema change), so "already heard" holds for the question and for a drop alike. Full account in
  > [`issues/11`](./issues/11-answer-on-request.en.md) under `## Comments`.
- **Cascade delete**: two steps — preview the number of affected conclusions and state it explicitly, then execute per
  the user's choice; storage enforces it with foreign-key cascades so no orphans remain, and the text of a deleted
  drop no longer appears in any recall result.

### How parent voice is enforced

The 15 executable reply rules in `docs/ytwins/parent-voice-principles.md` are hard constraints, enforced as follows:

- The mechanically checkable ones (sentence/character limits, starting with "why", number of questions, banned word
  lists, contrast endings, pet names) are **checked in code** rather than trusted to the model.
- On a failed check, **regenerate once**; if the second attempt still fails, **fall back to one safe minimal reply**
  (an emotional response or a record acknowledgement, depending on whether the input carries feeling), so that a
  violating reply never reaches the user.
- The judgement-based ones (catching feeling first, whether advice is being given, whether a label is applied) are
  constrained by putting the rules into the AI provider's instructions, with tests asserting the **behavioural
  properties**.

### Stack and runtime shape

- **TypeScript + Node as a single project** (project files at the repository root), with domain logic and the
  interface layer in two top-level directories under `src/`; the further structure inside `src/` is left to
  implementation.
  > **Corrected 2026-09-17 (when 12 landed)**: there are now **three** top-level directories under `src/` — the new
  > one is `src/ai/`, holding the **implementation side of the port** (cloud/local LLM, local/cloud embedding,
  > configuration and `.env` reading). The reason: the port's implementation is neither **domain logic** nor the
  > **interface layer**, which is what the sentence above separates; and it must not be replaced along with the
  > interface layer — when the web demo is replaced by a mobile client, `src/web/` goes away entirely and `src/ai/`
  > has to stay. The dependency direction is therefore fixed at `src/web/ → src/ai/ → src/domain/` and
  > `src/web/ → src/domain/`, with the domain side depending on no implementation at all (12's diff touches not one
  > line of `src/domain/**`).
- **A local Node server** (listening on the loopback address only) plus a **Vite-built web page**. The API key lives
  only in a server-side environment file (not in git); the browser never sees it.
- **A SQLite file** as storage, with `ON DELETE CASCADE` foreign keys carrying cascade deletion.
- **Default real implementation of the AI provider port**: the cloud LLM is DeepSeek `deepseek-flash` (OpenAI-
  compatible endpoint with JSON output) handling `extract` / `judgeLink` / `compose` / `respond`; embeddings run on
  local CPU with a pretrained **multilingual** small model (such as `multilingual-e5-small` and friends, run inside
  Node via transformers.js), fully offline and needing no key. Model files are not committed.
- **Switchable**: configuration selects among "cloud OpenAI-compatible endpoint / local Ollama" and "local / cloud
  embeddings" — four combinations — with domain logic unaware of the difference.
- **Not introduced**: any agent memory framework (mem0 / Letta / Cognee / LangMem), any graph database, any model
  training or fine-tuning. What is borrowed is their patterns (threshold assembly, debouncing, invalidate-don't-
  delete), not their code.
- **How tests run**: single process, no child-process spawning (spawning hits `EPERM` in a restricted sandbox).
  Prefer Node's built-in type stripping to run test entry points directly (Node v22.23.2 on this machine supports
  it), and do not introduce a test runner that fans out child processes.

## Testing Decisions（测试决策）

- **What counts as a good test**: assert **external behaviour** only. Tests start from the domain core interface and
  assert facts the user can observe — whether an item was separated, whether the record is faithful, whether a recall
  answer names its source, whether a reply catches feeling first, whether surfacing respects the cooldown and the
  one-per-turn cap, whether a deleted drop truly disappears. They do not assert SQL table structure, internal
  function calls, or whole prompt strings.
- **Modules under test**: the domain core (end-to-end through its interface, with all AI supplied deterministically
  by the fake provider); the real implementation of the AI provider port gets only a small **manual smoke test**
  (it connects and returns the expected shape), never a test of its semantic quality.
  > **Corrected 2026-09-17 (when 12 landed)**: that sentence separates **semantic quality** from **structure**, and
  > that is the line the implementation drew — `src/ai/provider.test.ts` (`npm run test:ai`) asserts the latter
  > automatically: that configuration selects each of the four combinations, that every field a model claims is
  > checked by name, that a parse failure produces a named error, that the key only ever reaches the
  > `Authorization` header (not the body, the URL or an error message), that local vectors come back one per text
  > with a consistent width, and that one broken half leaves the other working. The former — whether a sentence
  > reads well, whether two terms are judged alike — is asserted **nowhere**; it is printed for a human by
  > `tools/smoke-provider.mjs`. Those checks are **injected** (`fetch` and the model loader are constructor
  > parameters), so they reach no network and download nothing, and stay as deterministic as the domain tests.
  > "Not tested" was always about the **model's judgement**, not about **the code's wiring**.
- **Not tested**: the web DOM (the three acts are walked through by hand), SQLite internals, the output quality of
  real LLMs/embeddings, and cost.
- **Shape of the fake provider**: a scripted implementation returning preset JSON per call, plus scripts that
  **deliberately violate reply rules**, used to verify the **check → regenerate once → fall back to a safe reply**
  path.
- **Key behaviours that must be tested** (covering the highest risks):
  1. One mixed message yields both an item and a record, and the record is the raw text;
  2. An emotional input's reply opens with an emotional response, contains no "why", and stays within 3 sentences;
  3. A recall hit names its source; a miss says plainly that nothing was found;
  4. No conclusion before the threshold; a conclusion after it, carrying its supporting terms;
  5. The same topic does not resurface during cooldown; at most one surfacing per turn;
  6. Surfacings and answers are always in uncertain wording;
  7. Deleting reports the number of affected conclusions on preview; after a confirmed cascade, recall no longer
     returns its content;
  8. After marking "not true", the old conclusion is still in the chain and the new one stands in an overturning
     relation to it.
- **Precedent**: the only existing test in this repository is `tools/check-workspace.test.mjs` — a single executable
  file with assertions expressed through its exit code, run as `node tools/check-workspace.test.mjs` (**not**
  `node --test`, which spawns and hits EPERM in a restricted sandbox). New tests follow that shape and runner; no
  test framework is introduced until there is a second unit under test.
- **Test data precedent**: none yet. Domain tests build their own **preloaded data** (shared with act three of the
  demo), because the demo's repeatability depends on that same data.

## Out of Scope（不在范围内）

- Sign-up, login, multiple users, accounts and data isolation (purely local, single user).
- Mobile (the endgame target; not part of this spec).
- System-level push, notifications and reminder reliability guarantees; conflict detection; a full calendar UI.
- Introducing a graph database, a vector database, or any agent memory framework.
- Any model training / fine-tuning; any confidence calibration work; semantic-entropy multi-sampling.
- Cross-user data matching (the "kindred spirit" idea) and putting the domain online.
- Tuning real AI generation quality (prompt iteration, model comparison); the demo only requires the chain to hold
  and behaviour to be assertable.
- **Measuring** and optimising fully local inference (the provider layer keeps the door open; switching to local
  Ollama is a later stage).

## Further Notes（补充说明）

- **Script for the three demo acts** (following the boundaries already frozen in `NEXT.md`): (1) **drop** — drop a
  messy message containing the grading rules the teacher gave plus one emotional line, choose no type and fill in no
  time, and watch an item and a record separate automatically; (2) **ask** — from a "a few days later" vantage point,
  ask "how is the final grade computed?", get an accurate answer and see which drop it came from; (3) **surface** —
  drop another emotional line and watch one conclusion surface in uncertain wording, supported by **preloaded terms**.
  All three acts run on preloaded data so that they repeat.
- **Cost and privacy**: per the research ledger, the yearly API cost for a single user is roughly **$0.20–1.00**; the
  demo default is "raw text leaves the machine (cloud LLM) + embeddings stay local". This is the only trade-off in
  this project worth agonising over, and the implementation decisions leave a switch for it.
- **Research conclusions already absorbed**: train no model; link with pretrained embeddings plus a threshold; copy
  the shape of Generative Agents for threshold assembly; adopt the two patterns of debouncing and invalidate-don't-
  delete; CPU throughput lacks a primary source, so **this spec promises no local latency figures** — measure on your
  own machine before going local.
- **Authoritative source for parent voice**: `docs/ytwins/parent-voice-principles.md`. Its closing section, "rules
  added by the product author" (uncertain wording; the length cap being an engineering setting), is as binding as the
  book-derived part; this spec does not copy its rule text, only the way it is enforced.
- **First-time setup needs one human action**: obtaining and storing the cloud LLM API key (in the server-side
  environment file). Only a human can do this; use `/wizard` to generate an interactive script if needed, and do not
  write it into an agent's implementation ticket.
- **Parameters still without values** (tuning, not terminology, and not blocking): threshold value, grey-zone bounds,
  debounce window, topic overlap ratio, and the term relevance scoring rubric. They live in configurable constants
  with an initial value that makes act three of the demo work, to be calibrated on real data later.
- **Expected schema changes**: the first storage cut already contains seven entities — drop/record, term, link,
  conclusion, conclusion chain, item, surfacing history; if answer versioning is introduced later it reuses the
  overturn/inherit relation of the conclusion chain rather than growing a parallel mechanism.
