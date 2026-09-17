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

Open `http://127.0.0.1:5273`. At the foot of the page a **Three-act demo** block appears
(holding the three lines below) and beside it the **what leaves this machine** block.

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
