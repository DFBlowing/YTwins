/*
 * The one box's browser entry — the product itself (ticket 15).
 *
 * There is one input, and the product decides what was put into it: a fragment,
 * a question about something in the user's **records**, or a question about the
 * user. That decision is the **domain's** (`POST /api/deliver`), and this file
 * never makes it. What arrives back is one **delivery** — the drop as it stands
 * (the original, its reply, its items, its terms) plus whatever the domain
 * decided to say after it — and everything here does is draw it.
 *
 * What this page deliberately has **no** version of: tabs, a separate way in for
 * 「问」, a type picker, a time field, and any branch of its own that reads the
 * words to guess what they were. A page that guessed would be making a product
 * rule in the one place the product cannot explain it, which is exactly what
 * ticket 15 moved into the domain.
 *
 * **Why this file looks like `main.ts`.** The three-act page is frozen as the
 * demo's and the regression suite's reference — ticket 15 says, in as many
 * words, that it is not touched, and `main.ts` is part of it. So the reads and
 * the drawing that both pages need (the timeline, the links, the portrait, the
 * two light things the user may do to a conclusion, the deletion preview) exist
 * twice, on purpose and by that rule. Only the wrapper differs: this page draws
 * a **delivery** where the three-act page draws a drop and then three separate
 * acts. Unifying the two is a later decision, and it is cheap once the demo
 * page is allowed to change: the shapes are the same and neither file holds a
 * copy of anything the domain owns.
 *
 * One thing is held here rather than read back: the **speech** of each delivery
 * made in this session, keyed by drop id. What the product said to a question is
 * a fact about the moment it was asked — the answer was assembled then, and the
 * surfaced line was chosen then — and storing a transcript of it would be the
 * "conversation history" this product deliberately does not have. A refresh
 * therefore shows the deliveries without their speeches, which is also what the
 * three-act page does with an answer.
 *
 * Nothing here holds a credential of any kind; the browser never sees one.
 */

/** One item parsed out of a drop, as the server reports it. */
interface Item {
  readonly id: string;
  readonly text: string;
  readonly dueAt: string | null;
  readonly state: 'todo' | 'done';
  readonly dropId: string;
}

/** What is still to do, arranged on the timeline, as the server reports it. */
interface Upcoming {
  readonly due: readonly Item[];
  readonly unscheduled: readonly Item[];
}

/** One term read out of a drop, as the server reports it. */
interface Term {
  readonly id: string;
  readonly text: string;
  readonly dropId: string;
  readonly firstSeenAt: string;
}

/** One end of a link, as the server reports it. */
interface LinkedTerm {
  readonly id: string;
  readonly text: string;
}

/** One link between two terms, as the server reports it. */
interface TermLink {
  readonly id: string;
  readonly kind: 'same-drop' | 'similar';
  readonly strength: number;
  readonly reason: string;
  readonly from: LinkedTerm;
  readonly to: LinkedTerm;
}

/** A drop as the server reports it. */
interface DropSummary {
  readonly id: string;
  readonly body: string;
  readonly droppedAt: string;
  readonly items: readonly Item[];
  readonly terms: readonly Term[];
  readonly extracted: boolean;
  readonly reply: string;
}

/** One term, as the server names it: enough to show, no more. */
interface NamedTerm {
  readonly id: string;
  readonly text: string;
}

/** A conclusion named well enough to point at another one. */
interface ConclusionRef {
  readonly id: string;
  readonly text: string;
}

/** One record on the chain, as the server reports it. */
interface Conclusion {
  readonly id: string;
  readonly text: string;
  readonly kind: 'claim' | 'catch' | 'correction';
  readonly tier: 'weak' | 'medium' | 'strong' | null;
  readonly softened: boolean;
  readonly relation: 'first' | 'inherit' | 'overturn';
  readonly supersedes: ConclusionRef | null;
  readonly supersededBy: ConclusionRef | null;
  readonly createdAt: string;
  readonly support: readonly NamedTerm[];
  readonly mentions: number;
  readonly spanDays: number;
  readonly averageStrength: number;
}

/** A sentence the user wrote beside a conclusion, and the drop it became. */
interface ConclusionAddition {
  readonly conclusion: ConclusionRef;
  readonly drop: { readonly id: string; readonly body: string; readonly reply: string };
}

/** Where an answer came from, as the server reports it. */
interface RecallSource {
  readonly dropId: string;
  readonly body: string;
  readonly droppedAt: string;
}

/** The outcome of asking a question of the records. */
type RecallResult =
  | { readonly kind: 'answered'; readonly answer: string; readonly sources: readonly RecallSource[] }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/**
 * What the product said when the moment was raised.
 *
 * Mirrors the domain's union: one line shown as it was assembled, or several
 * conclusions brought together into an answer, or the ordinary reason there was
 * nothing to say.
 */
type SurfacingResult =
  | {
      readonly kind: 'surfaced';
      readonly text: string;
      readonly tier: 'weak' | 'medium' | 'strong';
      readonly conclusion: ConclusionRef;
      readonly support: readonly NamedTerm[];
      readonly mentions: number;
      readonly spanDays: number;
      readonly averageStrength: number;
      readonly surfacedAt: string;
    }
  | {
      readonly kind: 'answered';
      readonly text: string;
      readonly tier: 'weak' | 'medium' | 'strong';
      readonly softened: boolean;
      readonly conclusions: readonly ConclusionRef[];
      readonly support: readonly NamedTerm[];
      readonly mentions: number;
      readonly spanDays: number;
      readonly averageStrength: number;
      readonly answeredAt: string;
    }
  | {
      readonly kind: 'none';
      readonly reason: 'not-a-moment' | 'nothing-to-say' | 'cooldown' | 'held-back';
    };

/**
 * What the domain decided to say after the drop, as the server reports it.
 *
 * The page's own copy of the domain's union, and the whole point of the page:
 * which of the three it is was decided before this arrived, and there is
 * deliberately nothing here that could re-decide it.
 */
type DeliverySpeech =
  | { readonly kind: 'recall'; readonly result: RecallResult }
  | { readonly kind: 'surface'; readonly result: SurfacingResult }
  | { readonly kind: 'none' };

/** One delivery: the drop, and what was said after it. */
interface Delivery {
  readonly drop: DropSummary;
  readonly speech: DeliverySpeech;
}

/** What the user may do about a conclusion a deletion would take with it. */
type DeletionMode = 'cascade' | 'original-only' | 'keep';

/** What deleting one fragment would take, as the server reports it. */
interface DeletionPreview {
  readonly dropId: string;
  readonly body: string;
  readonly conclusions: readonly ConclusionRef[];
  readonly terms: readonly string[];
}

/** What a deletion did, as the server reports it. */
interface DeletionResult {
  readonly dropId: string;
  readonly conclusions: readonly ConclusionRef[];
  readonly mode: DeletionMode;
}

/** The demo's three lines, as the server holds them. */
interface DemoActs {
  readonly drop: string;
  readonly question: string;
  readonly feeling: string;
}

/** What leaves this machine, as the server reports it. */
interface DataBoundary {
  readonly leaves: readonly string[];
  readonly stays: readonly string[];
}

function mustFind<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`页面缺失元素：${selector}`);
  return found;
}

const form = mustFind<HTMLFormElement>('#deliver-form');
const input = mustFind<HTMLTextAreaElement>('#deliver-input');
const send = mustFind<HTMLButtonElement>('#deliver-send');
const status = mustFind<HTMLParagraphElement>('#deliver-status');
const deliveryList = mustFind<HTMLUListElement>('#delivery-list');
const deliveryEmpty = mustFind<HTMLParagraphElement>('#delivery-empty');

const removal = mustFind<HTMLElement>('#removal');
const removalBody = mustFind<HTMLQuoteElement>('#removal-body');
const removalCount = mustFind<HTMLParagraphElement>('#removal-count');
const removalList = mustFind<HTMLUListElement>('#removal-list');
const removalTerms = mustFind<HTMLParagraphElement>('#removal-terms');
const removalCascade = mustFind<HTMLButtonElement>('#removal-cascade');
const removalOriginal = mustFind<HTMLButtonElement>('#removal-original');
const removalCancel = mustFind<HTMLButtonElement>('#removal-cancel');
const removalNote = mustFind<HTMLParagraphElement>('#removal-note');

const dueList = mustFind<HTMLUListElement>('#due-list');
const dueEmpty = mustFind<HTMLParagraphElement>('#due-empty');
const unscheduledList = mustFind<HTMLUListElement>('#unscheduled-list');
const unscheduledEmpty = mustFind<HTMLParagraphElement>('#unscheduled-empty');
const scheduleProblem = mustFind<HTMLParagraphElement>('#schedule-problem');

const linkList = mustFind<HTMLUListElement>('#link-list');
const linkEmpty = mustFind<HTMLParagraphElement>('#link-empty');
const conclusionList = mustFind<HTMLOListElement>('#conclusion-list');
const conclusionEmpty = mustFind<HTMLParagraphElement>('#conclusion-empty');

const demoNotice = mustFind<HTMLParagraphElement>('#demo-notice');

const boundaryLeaves = mustFind<HTMLUListElement>('#boundary-leaves');
const boundaryLeavesNone = mustFind<HTMLParagraphElement>('#boundary-leaves-none');
const boundaryStays = mustFind<HTMLUListElement>('#boundary-stays');
const boundaryProblem = mustFind<HTMLParagraphElement>('#boundary-problem');

/** How many times to ask whether a fresh drop's wording has landed, and how often. */
const REPLY_GRACE_POLLS = 4;
const POLL_INTERVAL_MS = 250;

/**
 * How many extra rounds to give the links, the conclusions and the timeline.
 *
 * Linking is a second job behind the reading and settling is a third, so what a
 * delivery set off is not all there the instant the response arrives. Rather
 * than guess at a delay the reads are repeated a few times over the next second;
 * a conclusion that is deferred to the quiet window appears on a later load, and
 * nothing on screen is ever a placeholder.
 */
const ACCUMULATION_GRACE_POLLS = 4;

/**
 * The speech of each delivery made in this session, by drop id.
 *
 * See the module header: a speech is a fact about the moment, not a record the
 * product keeps, so it lives in the page and dies with the tab.
 */
const speeches = new Map<string, DeliverySpeech>();

const when = (iso: string): string => new Date(iso).toLocaleString('zh-CN');

/** The moment an item's due time names, or null when it names none. */
function dueMoment(dueAt: string | null): Date | null {
  if (dueAt === null) return null;
  const parsed = new Date(dueAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Format a due time in Chinese terms, or say plainly that none was found. */
function formatDue(dueAt: string | null): string {
  const parsed = dueMoment(dueAt);
  if (parsed === null) return '待安排';
  return parsed.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** How one item's time reads on the scheduling list: relative where that helps. */
function dueLabel(item: Item): string {
  const parsed = dueMoment(item.dueAt);
  if (parsed === null) return '待安排';
  const clock = parsed.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

  const startOfDay = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(parsed) - startOfDay(new Date())) / 86_400_000);
  if (days < 0) return `已过期 · ${clock}`;
  if (days === 0) return `今天 · ${clock}`;
  if (days === 1) return `明天 · ${clock}`;
  return clock;
}

/** Render one item of the scheduling list, with the box that advances it. */
function renderScheduledItem(item: Item, dated: boolean): HTMLLIElement {
  const row = document.createElement('li');
  row.className = dated ? 'due-row' : 'due-row due-row-none';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'due-toggle';
  toggle.dataset['itemId'] = item.id;
  toggle.setAttribute('aria-label', `标记「${item.text}」为已办`);
  toggle.textContent = '未办';

  const text = document.createElement('span');
  text.className = 'due-text';
  text.textContent = item.text;

  row.append(toggle, text);
  if (!dated) return row;

  const label = dueLabel(item);
  const due = document.createElement('time');
  due.className = label.startsWith('已过期') ? 'due-when due-when-past' : 'due-when';
  if (item.dueAt !== null) due.dateTime = item.dueAt;
  due.textContent = label;
  row.append(due);
  return row;
}

/** Show what is still to do, as the domain arranged it. */
async function loadUpcoming(): Promise<void> {
  try {
    const response = await fetch('/api/upcoming');
    if (!response.ok) throw new Error('read failed');
    const upcoming = (await response.json()) as Upcoming;

    dueList.replaceChildren(...upcoming.due.map((item) => renderScheduledItem(item, true)));
    dueEmpty.hidden = upcoming.due.length > 0;
    unscheduledList.replaceChildren(
      ...upcoming.unscheduled.map((item) => renderScheduledItem(item, false)),
    );
    unscheduledEmpty.hidden = upcoming.unscheduled.length > 0;
    scheduleProblem.textContent = '';
  } catch {
    scheduleProblem.textContent = '这次没读到待办列表，稍后再试试。';
  }
}

/** Advance one item, and show the list as it now stands. */
async function advanceItem(itemId: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const response = await fetch(`/api/items/${encodeURIComponent(itemId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    if (!response.ok) {
      scheduleProblem.textContent = '没能改成已办，再试一次。';
      return;
    }
    scheduleProblem.textContent = '';
    await loadUpcoming();
  } catch {
    scheduleProblem.textContent = '连不上本地服务。';
  } finally {
    button.disabled = false;
  }
}

/**
 * One delegated listener per list, because the rows are replaced on every read.
 *
 * Both lists are the same control surface: a 「待安排」 entry is not a lesser
 * item, it is an item whose time nobody knew, and a button that worked on one
 * list and did nothing on the other would be the page lying about what it can
 * act on.
 */
for (const scheduleList of [dueList, unscheduledList]) {
  scheduleList.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.due-toggle');
    const itemId = button?.dataset['itemId'];
    if (button === null || button === undefined || itemId === undefined) return;
    void advanceItem(itemId, button);
  });
}

/** Render one item: what it is, and when it is due (or that it is not). */
function renderItem(item: Item): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'item-row';

  const text = document.createElement('span');
  text.className = 'item-text';
  text.textContent = item.text;

  const due = document.createElement('time');
  due.className = item.dueAt === null ? 'item-due item-due-none' : 'item-due';
  if (item.dueAt !== null) due.dateTime = item.dueAt;
  due.textContent = formatDue(item.dueAt);

  row.append(text, due);
  return row;
}

/** One term chip: the user's own words, with no category and no score. */
function termChips(terms: readonly NamedTerm[] | readonly Term[]): HTMLLIElement[] {
  return terms.map((term) => {
    const chip = document.createElement('li');
    chip.className = 'term-chip';
    chip.textContent = term.text;
    return chip;
  });
}

/** Render one link between two terms. */
function renderLink(link: TermLink): HTMLLIElement {
  const row = document.createElement('li');
  row.className = `link-row link-${link.kind}`;

  const pair = document.createElement('p');
  pair.className = 'link-pair';
  pair.textContent = `「${link.from.text}」 — 「${link.to.text}」`;

  const why = document.createElement('p');
  why.className = 'link-why';

  const reason = document.createElement('span');
  reason.className = 'link-reason';
  reason.textContent = link.reason;

  const strength = document.createElement('span');
  strength.className = 'link-strength';
  strength.textContent = `强度 ${link.strength.toFixed(2)}`;

  why.append(reason, strength);
  row.append(pair, why);
  return row;
}

/**
 * How firmly the sentence was allowed to speak, in the words the page shows.
 *
 * A catch is not a weak claim — it is the substitute for one — and a correction
 * is not a claim at all. A surfacing is never either, so the band is the whole
 * story there.
 */
function bandLabel(
  kind: 'claim' | 'catch' | 'correction',
  tier: 'weak' | 'medium' | 'strong' | null,
): string {
  if (kind === 'correction') return '修正';
  if (kind === 'catch') return '承接';
  if (tier === 'strong') return '强档';
  if (tier === 'medium') return '中档';
  return '弱档';
}

/** Why it said that, from the numbers its wording was read off. */
function whySpoken(spoken: {
  readonly mentions: number;
  readonly spanDays: number;
  readonly averageStrength: number;
  readonly support: readonly NamedTerm[];
}): string {
  const mentioned = `被提起 ${spoken.mentions} 次`;
  const terms = `${spoken.support.length} 个词条`;
  const spanned = `跨 ${spoken.spanDays} 天`;
  const tied = `平均连接 ${spoken.averageStrength.toFixed(2)}`;
  return `${mentioned} · ${terms} · ${spanned} · ${tied}`;
}

/** Whether the chain has already answered this record with a correction. */
function isOverturned(conclusion: Conclusion, corrections: ReadonlySet<string>): boolean {
  return conclusion.supersededBy !== null && corrections.has(conclusion.supersededBy.id);
}

/** Render one record on the chain, with what supports it and where it sits. */
function renderConclusion(
  conclusion: Conclusion,
  corrections: ReadonlySet<string>,
): HTMLLIElement {
  const row = document.createElement('li');
  row.className = `conclusion-row conclusion-${conclusion.kind}`;

  const text = document.createElement('p');
  text.className = 'conclusion-text';
  text.textContent = conclusion.text;

  const meta = document.createElement('p');
  meta.className = 'conclusion-meta';

  const band = document.createElement('span');
  band.className = 'conclusion-band';
  band.textContent = bandLabel(conclusion.kind, conclusion.tier);

  const when_ = document.createElement('time');
  when_.className = 'conclusion-when';
  when_.dateTime = conclusion.createdAt;
  when_.textContent = when(conclusion.createdAt);

  meta.append(band, when_);

  if (conclusion.supersedes !== null) {
    const chain = document.createElement('span');
    chain.className = 'conclusion-chain';
    chain.textContent =
      conclusion.kind === 'correction'
        ? `推翻了「${conclusion.supersedes.text}」`
        : `承自「${conclusion.supersedes.text}」`;
    meta.append(chain);
  }
  if (conclusion.supersededBy !== null) {
    const chain = document.createElement('span');
    chain.className = 'conclusion-chain';
    chain.textContent = isOverturned(conclusion, corrections)
      ? '后来被你标为不对'
      : `后来被「${conclusion.supersededBy.text}」接过`;
    meta.append(chain);
  }

  row.append(text, meta);

  if (conclusion.kind !== 'correction') {
    const why = document.createElement('p');
    why.className = 'conclusion-why';
    // The step down is named out loud rather than left to be worked out from the
    // numbers: they alone earn the band above them, and a reader who checked
    // would otherwise find the page telling two stories about one sentence.
    why.textContent = conclusion.softened
      ? `为什么这么说：${whySpoken(conclusion)}（这件事你标过不对，语气退了一档）`
      : `为什么这么说：${whySpoken(conclusion)}`;
    row.append(why);
  }

  if (conclusion.support.length > 0) {
    const support = document.createElement('ul');
    support.className = 'conclusion-support';
    support.append(...termChips(conclusion.support));
    row.append(support);
  }

  row.append(renderConclusionActions(conclusion, corrections));
  return row;
}

/**
 * The two light things the user may do to one conclusion (ticket 10).
 *
 * 「不对」 is offered only where there is a judgement to disagree with and
 * nothing has been said against it yet; the box for a sentence is offered
 * everywhere. There is deliberately nothing else: no score, no thumb, no "tell
 * me more like this".
 */
function renderConclusionActions(
  conclusion: Conclusion,
  corrections: ReadonlySet<string>,
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'conclusion-actions';

  if (conclusion.kind !== 'correction' && !isOverturned(conclusion, corrections)) {
    const wrong = document.createElement('button');
    wrong.type = 'button';
    wrong.className = 'conclusion-wrong';
    wrong.textContent = '这条不对';
    wrong.addEventListener('click', () => void markWrong(conclusion.id, wrong));
    actions.append(wrong);
  }

  const openNote = document.createElement('button');
  openNote.type = 'button';
  openNote.className = 'conclusion-note-open';
  openNote.textContent = '补一句自己的话';

  const note = document.createElement('form');
  note.className = 'conclusion-note';
  note.hidden = true;

  const noteInput = document.createElement('textarea');
  noteInput.className = 'conclusion-note-input';
  noteInput.rows = 2;
  noteInput.placeholder = '比如：其实不是期末，是论文那边的事';
  noteInput.setAttribute('aria-label', '补一句自己的话');

  const noteSend = document.createElement('button');
  noteSend.type = 'submit';
  noteSend.className = 'conclusion-note-send';
  noteSend.textContent = '补上';

  const noteLine = document.createElement('p');
  noteLine.className = 'conclusion-note-line';
  noteLine.setAttribute('role', 'status');
  noteLine.setAttribute('aria-live', 'polite');

  note.append(noteInput, noteSend);
  openNote.addEventListener('click', () => {
    note.hidden = false;
    openNote.hidden = true;
    noteInput.focus();
  });
  note.addEventListener('submit', (event) => {
    event.preventDefault();
    void addNote(conclusion.id, noteInput, noteSend, noteLine);
  });

  actions.append(openNote, note, noteLine);
  return actions;
}

/** Mark one conclusion wrong, and show the chain with the correction on it. */
async function markWrong(conclusionId: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  const response = await fetch(`/api/conclusions/${encodeURIComponent(conclusionId)}/wrong`, {
    method: 'POST',
  });
  if (!response.ok) {
    button.disabled = false;
    button.textContent = '没能标上，再试一次';
    return;
  }
  await loadConclusions();
}

/**
 * Write a sentence beside one conclusion, and settle what it sets off.
 *
 * The sentence is a **drop**, so it is answered like one: the page shows the
 * line it was answered with rather than a "saved" of its own invention, and the
 * delivery it makes appears in the list like any other — without a speech, since
 * this one was not put to the box.
 */
async function addNote(
  conclusionId: string,
  noteInput: HTMLTextAreaElement,
  noteSend: HTMLButtonElement,
  line: HTMLParagraphElement,
): Promise<void> {
  const body = noteInput.value.trim();
  if (body.length === 0) {
    line.textContent = '还没写呢。';
    return;
  }

  noteSend.disabled = true;
  const response = await fetch(`/api/conclusions/${encodeURIComponent(conclusionId)}/append`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    noteSend.disabled = false;
    line.textContent = '这次没写进去，再试一次。';
    return;
  }

  const payload = (await response.json()) as { addition: ConclusionAddition };
  noteInput.value = '';
  await loadDeliveries();
  const settled = await settleReply(payload.addition.drop.id, payload.addition.drop.reply);
  line.textContent = settled ?? payload.addition.drop.reply;
  noteSend.disabled = false;
  await settleAccumulation();
}

/** Load the portrait — which is the conclusion chain. */
async function loadConclusions(): Promise<readonly Conclusion[] | null> {
  const response = await fetch('/api/conclusions');
  if (!response.ok) return null;
  const payload = (await response.json()) as { conclusions: Conclusion[] };
  // What each row needs of the others is one bit — whether the record that
  // replaced it was a correction — so the page keeps that and not the whole chain.
  const corrections = new Set(
    payload.conclusions
      .filter((conclusion) => conclusion.kind === 'correction')
      .map((conclusion) => conclusion.id),
  );
  conclusionList.replaceChildren(
    ...payload.conclusions.map((conclusion) => renderConclusion(conclusion, corrections)),
  );
  conclusionEmpty.hidden = payload.conclusions.length > 0;
  return payload.conclusions;
}

/** Load the links between terms. */
async function loadLinks(): Promise<readonly TermLink[] | null> {
  const response = await fetch('/api/links');
  if (!response.ok) return null;
  const payload = (await response.json()) as { links: TermLink[] };
  linkList.replaceChildren(...payload.links.map(renderLink));
  linkEmpty.hidden = payload.links.length > 0;
  return payload.links;
}

/** Give the semantic half of linking — and the settling behind it — its moment. */
async function settleAccumulation(): Promise<void> {
  for (let attempt = 0; attempt < ACCUMULATION_GRACE_POLLS; attempt += 1) {
    await loadLinks();
    await loadConclusions();
    await loadUpcoming();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * The deletion the user is being asked about, or null when nothing is pending.
 *
 * Held because the choice is made **after** the preview is on screen: the
 * buttons answer a question asked a moment earlier, and a page that guessed
 * which fragment they referred to would be deleting on a guess.
 */
let pendingRemoval: DeletionPreview | null = null;

/** Put a deletion preview on screen, and hold what the buttons will act on. */
function showRemoval(preview: DeletionPreview): void {
  pendingRemoval = preview;
  removalBody.textContent = preview.body;

  const count = preview.conclusions.length;
  removalCount.textContent =
    count === 0 ? '没有小结论是从它来的。' : `有 ${count} 条小结论是从它来的：`;
  removalList.replaceChildren(
    ...preview.conclusions.map((conclusion) => {
      const row = document.createElement('li');
      row.className = 'removal-conclusion';
      row.textContent = conclusion.text;
      return row;
    }),
  );
  removalTerms.textContent =
    preview.terms.length === 0
      ? ''
      : `同时会去掉只在这里说过的词条：${preview.terms.join('、')}`;

  removal.hidden = false;
  removalNote.textContent = '';
  removalCascade.focus();
}

/** Close the confirmation, whether anything was deleted or not. */
function hideRemoval(): void {
  removal.hidden = true;
  pendingRemoval = null;
}

/** What a finished deletion means, in words the page can show. */
function deletionLine(result: DeletionResult | null): string {
  if (result === null || result.mode === 'keep') return '保留了，什么都没删。';
  const count = result.conclusions.length;
  if (result.mode === 'cascade') {
    return count === 0 ? '已经删掉了。' : `已经删掉了，连同 ${count} 条小结论。`;
  }
  return '原文已经删掉了，小结论按你选的留了下来。';
}

/** Ask what deleting one fragment would take, and put the question on screen. */
async function askToRemove(dropId: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const response = await fetch(`/api/deletions/${encodeURIComponent(dropId)}`);
    if (!response.ok) {
      removalNote.textContent = '没能读到这次投递，稍后再试试。';
      return;
    }
    const payload = (await response.json()) as { preview: DeletionPreview };
    showRemoval(payload.preview);
  } catch {
    removalNote.textContent = '连不上本地服务。';
  } finally {
    button.disabled = false;
  }
}

/** Carry out the choice the user just made, and show the page as it now stands. */
async function carryOutRemoval(mode: DeletionMode): Promise<void> {
  const preview = pendingRemoval;
  if (preview === null) return;

  for (const button of [removalCascade, removalOriginal, removalCancel]) button.disabled = true;
  try {
    const response = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dropId: preview.dropId, mode }),
    });
    if (!response.ok) {
      const problem = (await response.json()) as { error?: string };
      removalNote.textContent = problem.error ?? '没删成，再试一次。';
      return;
    }
    const payload = (await response.json()) as { deleted: DeletionResult | null };
    hideRemoval();
    // The speech belonged to a delivery that is now gone, and the delivery list
    // is re-read rather than edited: a deletion can change the drops, the links,
    // the portrait and the timeline at once.
    speeches.delete(preview.dropId);
    removalNote.textContent = deletionLine(payload.deleted);
    await loadEverything();
  } catch {
    removalNote.textContent = '连不上本地服务。';
  } finally {
    for (const button of [removalCascade, removalOriginal, removalCancel]) button.disabled = false;
  }
}

/** What a zero answer means, in words the page can show. */
function missLine(reason: 'not-a-moment' | 'nothing-to-say' | 'cooldown' | 'held-back'): string {
  if (reason === 'cooldown') return '这件事 7 天内已经浮过一次了，先不重复。';
  if (reason === 'nothing-to-say') return '还没有沉淀到能说出口的一句。';
  return '这次先不说。';
}

/**
 * What the product said after one delivery, drawn as part of that delivery.
 *
 * Three shapes, and the page draws them apart rather than as variations of one
 * another: 追溯 answers a question about the **records** and always names the
 * drops it came from, 浮现 is a judgement and carries the numbers its wording was
 * read off, and `none` is the ordinary case where there was nothing to add and
 * nothing to explain.
 *
 * The one case that has to be worded carefully is a question the moment could
 * not answer at all: the user asked, so an empty answer is not allowed to read
 * as silence-with-no-explanation, and it is not allowed to read as "your records
 * do not cover this" either — that would be a claim about their own material
 * that nobody made.
 */
function renderSpeech(speech: DeliverySpeech): HTMLElement | null {
  if (speech.kind === 'none') return null;

  const block = document.createElement('div');
  block.className = `speech speech-${speech.kind}`;

  if (speech.kind === 'recall') {
    const result = speech.result;
    const label = document.createElement('p');
    label.className = 'speech-label';
    label.textContent = '留档里是这么说的';

    if (result.kind === 'not-found') {
      // The records were searched. Saying nothing covers the question is then a
      // statement about the user's own data, and a true one.
      label.textContent = '留档里';
      const line = document.createElement('p');
      line.className = 'speech-text';
      line.textContent = '没有和这个问题相关的记录。';
      block.append(label, line);
      return block;
    }

    if (result.kind === 'unavailable') {
      // Nothing was searched. This deliberately does NOT reuse the line above:
      // telling the user their records lack something nobody looked for would be
      // a lie about their own data.
      label.textContent = '';
      const line = document.createElement('p');
      line.className = 'speech-text';
      line.textContent = '这次没能查到留档，稍后再问一次。';
      block.append(line);
      return block;
    }

    const text = document.createElement('p');
    text.className = 'speech-text';
    text.textContent = result.answer;

    const sourceLabel = document.createElement('p');
    sourceLabel.className = 'speech-source-label';
    sourceLabel.textContent = '来自这几次投递：';

    const sources = document.createElement('ul');
    sources.className = 'answer-source-list';
    for (const source of result.sources) {
      const item = document.createElement('li');
      item.className = 'answer-source-item';
      const body = document.createElement('blockquote');
      body.className = 'answer-source-body';
      body.textContent = source.body;
      const at = document.createElement('time');
      at.className = 'answer-source-when';
      at.dateTime = source.droppedAt;
      at.textContent = when(source.droppedAt);
      item.append(body, at);
      sources.append(item);
    }

    block.append(label, text, sourceLabel, sources);
    return block;
  }

  const result = speech.result;
  if (result.kind === 'none') {
    const line = document.createElement('p');
    line.className = 'speech-miss';
    line.textContent = missLine(result.reason);
    block.append(line);
    return block;
  }

  const assembled = result.kind === 'answered' ? result.conclusions : [];
  const label = document.createElement('p');
  label.className = 'speech-label';
  label.textContent = result.kind === 'answered' ? '把几条汇成的一句' : '浮出来的这一条';

  const text = document.createElement('p');
  text.className = 'speech-text';
  text.textContent = result.text;

  const why = document.createElement('p');
  why.className = 'speech-why';
  const numbers = `为什么这么说：${whySpoken(result)}`;
  why.textContent =
    result.kind === 'answered' && result.softened
      ? `${numbers}（其中一条你标过不对，语气退了一档）`
      : numbers;

  const support = document.createElement('ul');
  support.className = 'surfaced-support';
  support.append(...termChips(result.support));

  block.append(label, text, why, support);

  if (assembled.length > 0) {
    const fromLabel = document.createElement('p');
    fromLabel.className = 'speech-source-label';
    fromLabel.textContent = '它是由这几条汇成的：';
    const from = document.createElement('ul');
    from.className = 'surfaced-conclusions';
    for (const conclusion of assembled) {
      const item = document.createElement('li');
      item.className = 'surfaced-conclusion';
      item.textContent = conclusion.text;
      from.append(item);
    }
    block.append(fromLabel, from);
  }

  return block;
}

/**
 * Render one delivery: the original, its reply, what it caught, and what was
 * said after it.
 *
 * An unread delivery says so rather than showing an empty list — "nothing has
 * been read yet" and "there was nothing in it" are different facts. The speech
 * is drawn only where this session has one (see the module header).
 */
function renderDelivery(drop: DropSummary): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'drop-item';

  const body = document.createElement('p');
  body.className = 'drop-body';
  body.textContent = drop.body;

  const at = document.createElement('time');
  at.className = 'drop-when';
  at.dateTime = drop.droppedAt;
  at.textContent = when(drop.droppedAt);

  const reply = document.createElement('p');
  reply.className = 'drop-reply';
  reply.textContent = drop.reply;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'drop-remove';
  remove.dataset['dropId'] = drop.id;
  remove.textContent = '删掉这次投递';

  item.append(body, at, reply, remove);

  // 追溯 or 浮现 (ticket 15), placed right after the line the drop was answered
  // with, because it is the rest of the same answer to the same words.
  const speech = speeches.get(drop.id);
  if (speech !== undefined) {
    const block = renderSpeech(speech);
    if (block !== null) item.append(block);
  }

  if (drop.extracted) {
    if (drop.items.length > 0) {
      const caught = document.createElement('ul');
      caught.className = 'item-list';
      caught.append(...drop.items.map(renderItem));
      item.append(caught);
    }
    if (drop.terms.length > 0) {
      const said = document.createElement('ul');
      said.className = 'term-list';
      said.append(...termChips(drop.terms));
      item.append(said);
    }
  } else {
    const pending = document.createElement('p');
    pending.className = 'item-pending';
    pending.textContent = '还没读完这条。';
    item.append(pending);
  }

  return item;
}

/**
 * Draw the deliveries, newest first.
 *
 * A one-box product is about what was just said, so the newest waits at the top
 * rather than at the end of an ever-growing list.
 */
function renderDeliveries(drops: readonly DropSummary[]): void {
  deliveryList.replaceChildren(...[...drops].reverse().map(renderDelivery));
  deliveryEmpty.hidden = drops.length > 0;
}

/** The deliveries recorded so far, or null when the server could not answer. */
async function readDeliveries(): Promise<readonly DropSummary[] | null> {
  const response = await fetch('/api/drops');
  if (!response.ok) return null;
  const payload = (await response.json()) as { drops: DropSummary[] };
  return payload.drops;
}

/**
 * Load the deliveries.
 *
 * A read that failed leaves the list as it was rather than claiming the user
 * never dropped anything: "we could not read it" and "there is nothing" are
 * different facts.
 */
async function loadDeliveries(): Promise<readonly DropSummary[]> {
  const drops = (await readDeliveries().catch(() => null)) ?? [];
  renderDeliveries(drops);
  return drops;
}

/** Ask about one drop, or null when the server cannot answer. */
async function readDrop(dropId: string): Promise<DropSummary | null> {
  const response = await fetch(`/api/drops/${encodeURIComponent(dropId)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { drop: DropSummary };
  return payload.drop;
}

/**
 * Wait for a just-made drop's styled **reply** to land, and hand it back.
 *
 * The reading is already in when a delivery comes back — `deliver` waits for it
 * — but the styled line is its own background job, so the line in the response
 * may still be the one code itself vouches for. The wait is bounded, and what it
 * gives up on is that line, which is a real line and not a placeholder.
 *
 * @param dropId - the drop to wait for.
 * @param pending - the line the delivery carried.
 * @returns the line as it now stands, or null when the server could not answer.
 */
async function settleReply(dropId: string, pending: string): Promise<string | null> {
  let latest: string | null = null;
  for (let attempt = 0; attempt < REPLY_GRACE_POLLS; attempt += 1) {
    const drop = await readDrop(dropId);
    if (drop === null) return null;
    latest = drop.reply;
    if (drop.reply !== pending) return drop.reply;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return latest;
}

/**
 * Post one delivery, and settle everything it sets off.
 *
 * This is the whole of the page's interaction, and it makes **one** call: which
 * of 投递 / 追溯 / 浮现 the words turned out to be was decided by the domain before
 * anything came back, and this file never asks a second endpoint to find out.
 */
async function deliver(body: string): Promise<void> {
  send.disabled = true;
  status.textContent = '在读它…';

  try {
    const response = await fetch('/api/deliver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      const problem = (await response.json()) as { error?: string };
      status.textContent = problem.error ?? '没接住，再试一次。';
      return;
    }

    const delivery = (await response.json()) as Delivery;
    input.value = '';
    speeches.set(delivery.drop.id, delivery.speech);

    // Drawn from the delivery first, so the speech is on screen the moment it is
    // known, and then re-read: the reading's items and terms are already in the
    // delivery, while the styled reply and the accumulation behind it land a
    // moment later.
    await loadDeliveries();
    const settled = await settleReply(delivery.drop.id, delivery.drop.reply);
    status.textContent = settled ?? delivery.drop.reply;
    await settleAccumulation();
  } catch {
    status.textContent = '连不上本地服务。';
  } finally {
    send.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = input.value;
  if (body.trim().length === 0) return;
  void deliver(body);
});

// Delegated, because the rows are replaced on every read.
deliveryList.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.drop-remove');
  const dropId = button?.dataset['dropId'];
  if (button === null || button === undefined || dropId === undefined) return;
  void askToRemove(dropId, button);
});

removalCascade.addEventListener('click', () => void carryOutRemoval('cascade'));
removalOriginal.addEventListener('click', () => void carryOutRemoval('original-only'));
removalCancel.addEventListener('click', () => void carryOutRemoval('keep'));

/** Every read the page draws from, in one call. */
async function loadEverything(): Promise<void> {
  await loadDeliveries();
  await loadLinks();
  await loadConclusions();
  await loadUpcoming();
}

/** One fact on the boundary lists, as a row the page can show. */
function renderFact(line: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'boundary-fact';
  item.textContent = line;
  return item;
}

/**
 * Show which part of what the user says leaves this machine.
 *
 * A read that failed leaves **nothing** on screen and says that it failed: an
 * empty pair of lists would render as "nothing leaves", which is the exact
 * opposite of what is known at that moment.
 */
async function loadBoundary(): Promise<void> {
  try {
    const response = await fetch('/api/privacy');
    if (!response.ok) throw new Error('read failed');
    const payload = (await response.json()) as { boundary: DataBoundary };
    boundaryLeaves.replaceChildren(...payload.boundary.leaves.map(renderFact));
    boundaryLeavesNone.hidden = payload.boundary.leaves.length > 0;
    boundaryStays.replaceChildren(...payload.boundary.stays.map(renderFact));
    boundaryProblem.textContent = '';
  } catch {
    boundaryLeaves.replaceChildren();
    boundaryLeavesNone.hidden = true;
    boundaryStays.replaceChildren();
    boundaryProblem.textContent = '这次没读到数据边界，稍后再试试。';
  }
}

/**
 * Say out loud what demo mode cannot read, at the box.
 *
 * The stand-in answers from a table, so anything outside the script reads as
 * nothing at all — no terms, no items, and a flat acknowledgement in reply. That
 * looks like the product being broken rather than like a demo being a demo. In
 * real mode (the default) this stays hidden, because there it is not true.
 */
async function loadDemo(): Promise<void> {
  try {
    const response = await fetch('/api/demo');
    if (!response.ok) throw new Error('read failed');
    const payload = (await response.json()) as { demo: { acts: DemoActs } | null };
    const acts = payload.demo?.acts ?? null;
    if (acts === null) return;
    demoNotice.textContent =
      '演示模式：这个服务只认 `/demo.html` 页尾那三句台词，自己随手写的内容它读不出词条，也不会有事项。';
    demoNotice.hidden = false;
    // The box carries the first act's line exactly, as the three-act page does:
    // a placeholder with an example prefix in front of it would be copied on
    // stage along with the prefix, and such a fragment matches no preset reading.
    if (input.value.length === 0) input.placeholder = acts.drop;
  } catch {
    // A server that cannot say whether it has a demo says nothing at the box:
    // "nobody told me" and "there is no demo" are different facts, and neither
    // is worth an error at the top of the page.
  }
}

void loadEverything();
void loadDemo();
void loadBoundary();
