# The three-act demo: the script

> This is **the script for running the demo yourself**, not a user guide and not a
> product requirement. Ticket 13 asks for the demo script to be written into the
> repository in Chinese so it can be reproduced later; this is the English
> counterpart of [`demo-script.md`](./demo-script.md), which stays the primary copy.
> The three acts run on **preset material**, and the same material is the one the
> domain tests read (`src/domain/preset.ts`).

## 0. In one sentence

Drop fragments into the box without choosing a type or filling in a time; they are
split into **items** and a **record**; days later a question about them is answered
accurately and names the drop it came from; one more feeling surfaces one conclusion
in an uncertain register, with the **terms** behind it listed. No account anywhere,
and the page states plainly which part of the data leaves this machine.

## 1. Starting it

The demo runs on the **preset provider** (`YTwins_PROVIDER=demo`): no network, no key,
the same sentence every time. The real provider is still the product's default (see
§7), but **do not demo on it** — its wording differs slightly each run, and this ticket
asks for "run it again and it comes back the same".

```powershell
# repository root, PowerShell
$env:YTwins_PROVIDER = "demo"
npm run server            # http://127.0.0.1:5273 by default
```

Open `http://127.0.0.1:5273/demo.html`. At the foot of the page a **Three-act demo** block appears
(holding the three lines below) and beside it the **what leaves this machine** block.

> **The address changed with ticket 15.** The root path `/` is now **the product itself** — the page with
> a single input box (see §8) — and the three-act page moved to `/demo.html` with not one line of it
> changed. The three acts are the **demo's and the regression suite's reference**; the fused page is the
> product.

**Demo mode keeps its own library**: `data/demo.sqlite`. That is a different file from
the `data/ytwins.sqlite` you normally use, so the reset button empties the former and
cannot touch what you have really dropped. The startup log says which file is in use.
Set `YTwins_DB` to point somewhere else; naming a file wins.

**The page says this about itself**: in demo mode, a line above the boxes in acts one and
three says that this server only understands the three lines at the foot of the page, and
the demo block repeats it — because anything outside the script yields **no terms and no
items**, and only a flat acknowledgement in reply, which looks like a broken product
rather than like a demo. In real mode (the default) that line is not shown.

Before presenting, press **Start the demo over** at the foot of the page and confirm
(two steps, like deletion). The library then holds only the preset leads: two fragments
about the exam, two about not sleeping. **This step is required** — the threshold is
"the same thing raised three times", and those two are the first two.

Rebuild the page only if `src/web/` changed (`npm run build:web`).

## 2. The three acts

The three tabs at the top of the page (drop / ask / surface) are the three acts.

### Act one: drop

- The line (**in demo mode the placeholder in the box is this line itself** — no 「比如：」
  prefix, so copy or paste the whole row; one extra character and it matches no preset
  fragment, which takes act one down with it):

  ```text
  老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲，好烦
  ```

- What is deliberately not done: **no type chosen, no time filled in, no tags**.
- What to expect:
  - A reply: 「听着，事情全堆在一起，心里挺堵的。」 (a feeling is present, so it is met first)
  - Under that drop, one **item**: 「下周三交提纲」, due the **next Wednesday at 09:00** (the material
    says 下周三 and code resolves it against the day; run it another day and the date moves with it)
  - Five **terms**, in the user's own wording: 期末怎么算分 / 平时分 40% / 期末考 60% / 下周三交提纲 / 好烦
  - One line surfaces under the box as well: 「我不太确定：你最近好像有几件事堆在一起，心里一直不太顺。」
    It is the same moment (an emotional drop makes the product try to speak), and act three demonstrates
    the line belonging to a **different** matter.

### Act two: ask

- Press **three days later** first (that is the "a few days later" viewpoint), then ask:

  ```text
  期末怎么算分
  ```

- What to expect:
  - The answer: 「平时分占 40%，期末考占 60%。提纲还有 N 天到期。」 — N is read off the viewpoint and the
    outline's deadline, so it follows the moment the question is asked (re-running within one demo leaves N
    unchanged).
  - Under 「来自这几次投递」, the source is **the** drop, quoted verbatim so it can be checked. The preset
    leads deliberately avoid the strings the question looks for, so the source is the fragment act one just
    dropped: answered, and checkable.
- Asking without setting the basis works too; the days are then counted from now.

### Act three: surface

- The line:

  ```text
  这周总是睡不好，白天没精神，晚上躺下又清醒，有点撑不住
  ```

- What to expect:
  - A reply (also emotional, so the feeling is met first)
  - A surfaced line: 「我不太确定：你最近睡得不太好，白天也提不起劲。」
  - The **three terms** behind it (睡不好 / 没精神 / 躺下又清醒) and the four numbers the wording was read
    off (raised 3 times · 3 terms · spanning 0 days · average connection strength) — which is why
    "why did it say that" is answerable rather than a register a model felt like choosing.
- This is a **different** matter from act one: the 好烦 one has already been heard (a seven-day cooldown),
  the sleep one is new, which is why it is the one that surfaces now.

## 3. Running it again

Same material, same chain, same result. When the audience asks for it once more:

1. Press **Start the demo over** at the foot of the page;
2. Confirm (two steps, because it empties the whole library);
3. Run the three acts again.

The result is identical to the previous run, word for word (bar the moment the fragments were
dropped). Repeatability is itself checked: one domain check runs the three acts twice and compares,
and `tools/e2e-ticket-13.mjs` does the same over real HTTP.

## 4. The data boundary (the page states it too)

The 「哪些数据会离开这台机器」 block is read from the server, off how **this** machine is actually
wired (`/api/privacy`); it is not copy written into the page, because a page stating one combination
while the server ran another is that disclosure lying to itself.

- **Demo mode (this script)**: nothing leaves this machine. The answers, the judgements and the
  embedding are all computed locally, with no network and no key.
- **The real provider (the product's default)**: the **original text** — what you dropped, the question
  you asked, and the fragments and terms handed to the model so it can answer — goes to a cloud LLM
  (`api.deepseek.com`'s `deepseek-flash` by default). The embedding runs on this machine's CPU, so terms
  stay local. The API key lives only in the repository's `.env`, and the page cannot see it.
- If the block cannot be read, it says 「这次没读到数据边界」. It never renders as "nothing leaves".

## 5. Questions from the floor

- **Why is "start the demo over" two steps?** Because it is the only action in the product that empties
  everything at once. Deletion (the button beside each drop) is two steps as well: first it says what
  would go with it, then you choose.
- **Why did act one surface a line already?** Surfacing happens on an emotional drop or on a question you
  asked. Act one's fragment carries a feeling, so the product tries there. Act three demonstrates the
  line belonging to another matter — one line per turn at most, seven days of quiet per topic.
- **Why is act three's "drop the first line again" button still there?** It is for the other way of
  demoing, with no leads at all: the same sentence has to be dropped a third time to cross the threshold.
  The preset material's route does not need it.
- **Why does "so what do you think of me lately" often answer "not again this time"?** It needs two or
  more conclusions the user has not heard yet to assemble into one **answer**; after the three acts both
  matters have been surfaced, so they are cooling. That chain's regression lives in
  `tools/e2e-ticket-11.mjs`, not in this script.
- **Why is the item's date computed from 下周三 rather than written down?** Because that is what the
  material says, and a fixed date would read "overdue" a few days from now. The real provider converts
  relative times against today in the same way.

## 6. Regression (after changing code)

```powershell
node src/domain/domain.test.ts     # the domain, including "the acts run twice and match"
node src/ai/provider.test.ts       # the real provider's wiring (no network)
node tools/e2e-ticket-13.mjs       # the acts over real HTTP (demo mode, and the real server's boundary)
node tools/e2e-ticket-15.mjs       # the one box over real HTTP (all four routings, and both addresses)
node tools/e2e-ticket-02.mjs       # … the 02–11 regression scripts, one at a time
npm run typecheck
npm run build:web                  # only after changing src/web/
node tools/check-workspace.mjs
```

## 7. Two providers, both run before choosing (recorded 2026-09-17)

Both routes were run before ticket 13 was implemented (the record is in the ticket's `## Comments`):

- **The preset provider (the demo path)**: repeatable word for word, offline, free — and the only one
  that can satisfy "the preset data is the data the domain tests use".
- **The real provider**: the chain is real (a real LLM reading the text, a real local embedding), but the
  wording differs each run, it needs a key and a network, and "the same thing raised three times" has to
  be typed out live several times.

So: **the demo runs on the preset provider, and the product still defaults to the real one** (leave
`YTwins_PROVIDER` unset for real). The real chain's manual smoke is `npm run smoke`.

**Switching vendor is one line plus one key (ticket 16).** `.env` needs exactly two: `YTwins_LLM_PRESET=`
followed by one of `deepseek` / `gemini` / `opencode` / `ollama` / `custom`, and `YTwins_LLM_API_KEY=`
followed by that vendor's key. A preset carries the **endpoint, the default model and where the key goes**
(`Authorization: Bearer` for deepseek / gemini / opencode / custom; ollama runs on this machine and wants
no key), so changing vendor changes a value rather than a call path. The table and each row's provenance
are in `.env.example` and in the doc comment of `src/ai/config.ts`.

- `YTwins_LLM_BASE_URL` / `YTwins_LLM_MODEL` / `YTwins_LLM_HEADERS` still exist and still **win over the
  preset** — the startup log names which of them did, because an override nobody can see is configuration
  drift. It also says which vendor the preset was and whether a key is configured.
- With a preset chosen, `YTwins_LLM` may only **agree** with it: calling a cloud endpoint "local" is
  **refused loudly**, because it would tell the user their words never left the machine. `custom` is the
  exception — that row is the one place where the variable is the only thing that can know.
- An endpoint that wants a header of its own (opencode's `x-opencode-session`) is configured with
  `YTwins_LLM_HEADERS=x-opencode-session=…`. **Header values never reach the log** (it prints a count),
  and an illegal name — a space or a colon in it, one trying to take over `content-type` / `accept`, or
  one trying to take over the key's header while a key is configured — is refused loudly.
- **The embedding half is not part of the "one key" promise.** The link thresholds were calibrated against
  one embedding (ticket 14 measured a true pair falling from 0.875 to 0.456 when it was swapped to
  `bge-small-zh-v1.5`), so the local model stays the default, a cloud embedding still needs an explicit
  endpoint and key, and swapping it means redoing that calibration — the startup log says so every time.

## 8. The product itself: one box (ticket 15)

The other page on the same server: the root path, `http://127.0.0.1:5273/`. **One input box** — no tabs,
no separate way in for 「问」, no controls for type or time. Whether the words are a fragment, a question
about something in the **records**, or a question about **you** is decided by the **domain**
(`src/domain/routing.ts` plus the port's `judgeQuestion`), and the page only shows what came of it.

One look at each of the four kinds of input (a fragment counts twice — with and without a feeling, which is why
the table has five rows; in demo mode only the script's own lines read, so of the first three rows only act one's
line and act two's question can be shown):

| What goes in | What you should see |
|---|---|
| a fragment, no feeling | just the reply, plus the items and terms it yielded |
| a fragment carrying a feeling | the same, **plus** the one line the moment surfaced |
| a question about something really said (e.g. 「期末怎么算分」) | 「留档里是这么说的」 + the answer + **来自这几次投递** with the originals; **no judgement** is pushed this turn |
| a question about something never said (e.g. 「上周的会议纪要放哪了」) | a plain "the records do not cover this"; again, no judgement |
| a question about the user (e.g. 「你觉得我最近怎么样」) | 「把几条汇成的一句」 when two or more conclusions can be assembled, and the fallback of one surfaced line when they cannot |

**When it cannot tell, it does not guess**: a turn that cannot be judged a question is not treated as one —
better to say one line less than to answer a thought spoken aloud as though it were a question. Code reads
the shape first (a question mark, or a phrase like 「怎么」/「为什么」/「哪」) and only hands the unclear cases
to a model; where the shape is a trailing 「吗」/「呢」 the drop's own **input type** decides, so a feeling
worded that way — 「下周三交提纲吗」 — stays a fragment.

**What demo mode can show on this page**: act one's line (a fragment with a feeling → surfaced) and act
two's question (→ recall, with its source). **A question about yourself cannot be shown** — the preset
table has no such line, so it reads as a fragment — and nothing off script reads at all; the page says so
above its box. To see all four routings, use the real provider.

**This page keeps no conversation**: a recall answer and a surfaced line belong to **the moment they were
said** and live only in that session's page; after a refresh what remains is the delivery itself (the
original, its reply, its items, its terms) and the portrait. That is deliberate — this product is
**陪伴**, not 陪聊.
