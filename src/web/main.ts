/*
 * The three-act page's browser entry.
 *
 * All three acts run real paths. A drop really posts, really lands in the local
 * database, and really answers; a question really searches the stored originals
 * and comes back either with an answer and the drop it came from, or with a plain
 * "found nothing"; and the product really speaks first, once, when a drop carries
 * a feeling or when the user asks.
 *
 * Nothing here holds a credential of any kind; the browser never sees one.
 *
 * What act one shows is what ticket 02 added: dropping does not return the
 * **items** a fragment contained, because extraction runs after the drop has
 * already succeeded. So the page drops, then asks about that drop again until
 * it has been read — and the same read is what fills the list after a refresh.
 * There is deliberately no input type on this page: the system judges it
 * internally and the user is never asked for it.
 *
 * What act two shows is what ticket 07 added: an answer is never shown without
 * its **source**. The two travel together because the whole promise of asking is
 * that the user can check the answer against their own words — and when nothing
 * covers the question, the page says so rather than showing something plausible.
 *
 * What the reply is, after ticket 03: the drop is answered the moment it is
 * caught, with a line code itself vouches for, and the styled line takes that
 * place only once the parent-voice checks have passed it. The page therefore
 * shows the drop's reply rather than the POST response alone — a reload has to
 * show the same sentence, and the drop is where it is kept.
 *
 * What act one shows after ticket 04: each drop lists the **terms** it yielded,
 * in the user's own words, and a section below lists the **links** that have
 * grown between terms — each with why it exists and how strong it is. The
 * accumulation is meant to be invisible while it happens; what it produced is
 * not, or the user would have no way to tell a connection they agree with from
 * one the product invented. The hard edges are on screen as soon as a drop has
 * been read; the semantic ones follow within the moment the page gives them
 * (`LINK_GRACE_POLLS`), and a refresh shows everything that was decided later.
 *
 * What act one shows after ticket 05: the **portrait** — the conclusions the
 * accumulation settled into — with the terms behind each one and where it sits
 * in the **conclusion chain**. It is the same read as the links and gets the
 * same moment, because settling is a third job behind the reading and its timing
 * is deliberately invisible: a look deferred to the quiet window takes minutes,
 * so its sentence appears on a later load rather than in this one. There is
 * nothing here for the user to press: settling needs no participation, which is
 * the whole point of the feature.
 *
 * What act one shows after ticket 06: the one moment the product speaks first.
 * An emotional drop, or a question, makes the domain try to **surface** a
 * conclusion — at most one, never the same topic twice in a week, and never a
 * sentence that reads as a fact. The page shows what came of the attempt, and a
 * zero answer is shown as an ordinary outcome rather than as a fault: the attempt
 * failing to find a moment or a sayable thing is normal, while being unable to
 * ask at all is its own line, because those are different facts. The line itself
 * is never the page's to word — the conclusion was already written, and surfacing
 * picks which one, not how it reads.
 *
 * What act one shows after ticket 08: what is still to do. Opening the page is
 * meant to answer "what now?" on its own, so the **items** come first, arranged
 * on the timeline by the domain — soonest at the top, overdue ones leading it
 * rather than falling off — with everything that had no parsed time listed apart
 * as 「待安排」 rather than dropped. The order is not the page's to decide: it is
 * read from `/api/upcoming`, which is the domain's own answer, and the only thing
 * this file does with an item is draw it and let the user tick it off. There is
 * no calendar here and no conflict detection, and there is deliberately nothing
 * scheduling-shaped about a drop either — the user still types no time, and the
 * item already carries whatever time was read out of what they said.
 *
 * What act one shows after ticket 09: the way to **delete** a fragment, and it is
 * two steps rather than one. The button beside a drop removes nothing — it asks
 * the server what a deletion would take, and what comes back is the sentences
 * themselves, because a fragment typed in passing can turn out to be the ground
 * several judgements stand on and "2 conclusions came from it" asks the user to
 * trust a tally. The choice is then theirs: take them too, keep them and lose only
 * the original, or keep everything. Nothing on this page deletes by default, and
 * every read is re-run afterwards rather than edited in place, because a deletion
 * can change the drops, the links, the portrait and the timeline at once.
 */

/** One item parsed out of a drop, as the server reports it. */
interface Item {
  readonly id: string;
  readonly text: string;
  readonly dueAt: string | null;
  /** Still to do, or done. The one thing the user ever changes here. */
  readonly state: 'todo' | 'done';
  readonly dropId: string;
}

/**
 * What is still to do, arranged on the timeline, as the server reports it.
 *
 * Mirrors the domain's shape rather than flattening it into one list: the two
 * halves mean different things, and a page that merged them would be implying an
 * order for items that have no date to be ordered by.
 */
interface Upcoming {
  readonly due: readonly Item[];
  readonly unscheduled: readonly Item[];
}

/**
 * One term read out of a drop, as the server reports it.
 *
 * No vector travels with it — how the domain compares terms is not something
 * the page is owed, and showing the numbers would make an internal measurement
 * look like part of the product.
 */
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

/**
 * One link between two terms, as the server reports it.
 *
 * Carries its reason because a connection nobody can account for is a
 * connection nobody can trust: the page shows why the two are joined, not just
 * that they are.
 */
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
  /** The line this drop answered with — the product's smaller voice. */
  readonly reply: string;
}

/** Where an answer came from, as the server reports it. */
interface RecallSource {
  readonly dropId: string;
  readonly body: string;
  readonly droppedAt: string;
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

/**
 * One record on the chain, as the server reports it.
 *
 * The three numbers beside the sentence are the ones its wording was read off,
 * and they travel to the page on purpose: the product should be able to say why
 * it spoke the way it did, and a number the user can read is what makes that an
 * answer rather than a reassurance. A `correction` carries zeros and no support,
 * because nothing was read off anything for it — it records what the user did,
 * and the page does not ask it to explain itself.
 */
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

/**
 * A sentence the user wrote beside a conclusion, and the drop it became.
 *
 * Mirrored rather than imported, like everything else in this file: it is browser
 * code and takes nothing from `src/domain/`.
 */
interface ConclusionAddition {
  readonly conclusion: ConclusionRef;
  readonly drop: { readonly id: string; readonly body: string; readonly reply: string };
}

/**
 * The outcome of asking a question.
 *
 * Mirrors the domain's discriminated union rather than an optional answer, so
 * the page cannot render an answer without having established that one exists —
 * and cannot conflate "your records do not cover this" with "the question could
 * not be put to them".
 */
type RecallResult =
  | { readonly kind: 'answered'; readonly answer: string; readonly sources: readonly RecallSource[] }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/**
 * The outcome of asking the product to speak first, as the server reports it.
 *
 * Mirrors the domain's union, so the page cannot render a line without having
 * established that one exists — and cannot confuse "there was nothing to say this
 * time" (ordinary) with "the question could not be put to the material at all".
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
      readonly kind: 'none';
      readonly reason: 'not-a-moment' | 'nothing-to-say' | 'cooldown' | 'held-back';
    };

/**
 * What the user may do about a conclusion a deletion would take with it.
 *
 * Spelled out here rather than imported from the domain: this file is browser
 * code and takes nothing from `src/domain/`, the same way `RecallResult` and
 * `SurfacingResult` above are mirrored rather than shared. Named once so the two
 * places that carry it — the result and the choice handler — cannot drift.
 */
type DeletionMode = 'cascade' | 'original-only' | 'keep';

/**
 * What deleting one fragment would take, as the server reports it.
 *
 * Mirrors the domain's shape: the conclusions come as the sentences themselves
 * rather than a count, because "2 conclusions came from it" asks the user to
 * trust a tally while showing the two sentences asks them to recognize what they
 * would be giving up. The count the page shows is this list's length.
 */
interface DeletionPreview {
  readonly dropId: string;
  readonly body: string;
  readonly conclusions: readonly ConclusionRef[];
  readonly terms: readonly string[];
}

/**
 * What a deletion did, as the server reports it.
 *
 * Null when nothing was removed, which is an ordinary answer and not a failure:
 * either the fragment was already gone, or the user read the preview and chose to
 * keep it.
 */
interface DeletionResult {
  readonly dropId: string;
  /** Only ever the conclusions that actually went — empty under 'original-only'. */
  readonly conclusions: readonly ConclusionRef[];
  readonly mode: DeletionMode;
}

function mustFind<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`页面缺失元素：${selector}`);
  return found;
}

const form = mustFind<HTMLFormElement>('#drop-form');
const input = mustFind<HTMLTextAreaElement>('#drop-input');
const send = mustFind<HTMLButtonElement>('#drop-send');
const reply = mustFind<HTMLParagraphElement>('#drop-reply');
const surfacedInline = mustFind<HTMLParagraphElement>('#drop-surface');
const list = mustFind<HTMLUListElement>('#drop-list');
const empty = mustFind<HTMLParagraphElement>('#drop-empty');
const linkList = mustFind<HTMLUListElement>('#link-list');
const linkEmpty = mustFind<HTMLParagraphElement>('#link-empty');
const conclusionList = mustFind<HTMLOListElement>('#conclusion-list');
const conclusionEmpty = mustFind<HTMLParagraphElement>('#conclusion-empty');

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

const askForm = mustFind<HTMLFormElement>('#ask-form');
const askInput = mustFind<HTMLInputElement>('#ask-input');
const askSend = mustFind<HTMLButtonElement>('#ask-send');
const askNow = mustFind<HTMLInputElement>('#ask-now');
const askLater = mustFind<HTMLButtonElement>('#ask-later');
const askError = mustFind<HTMLParagraphElement>('#ask-error');
const answerBlock = mustFind<HTMLElement>('#ask-answer');
const answerText = mustFind<HTMLParagraphElement>('#ask-answer-text');
const sourceList = mustFind<HTMLUListElement>('#ask-source-list');
const notFound = mustFind<HTMLParagraphElement>('#ask-not-found');
const unavailable = mustFind<HTMLParagraphElement>('#ask-unavailable');

const surfaceForm = mustFind<HTMLFormElement>('#surface-form');
const surfaceInput = mustFind<HTMLTextAreaElement>('#surface-input');
const surfaceSend = mustFind<HTMLButtonElement>('#surface-send');
const surfaceAgain = mustFind<HTMLButtonElement>('#surface-again');
const surfaceAgainHint = mustFind<HTMLSpanElement>('#surface-again-hint');
const surfaceReply = mustFind<HTMLParagraphElement>('#surface-reply');
const surfaceAsk = mustFind<HTMLButtonElement>('#surface-ask');
const surfaceMiss = mustFind<HTMLParagraphElement>('#surface-miss');
const surfaceResult = mustFind<HTMLElement>('#surface-result');
const surfaceText = mustFind<HTMLParagraphElement>('#surface-text');
const surfaceWhy = mustFind<HTMLParagraphElement>('#surface-why');
const surfaceSupport = mustFind<HTMLUListElement>('#surface-support');

/** How many times to ask whether a fresh drop has been read, and how often. */
const POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 250;
/**
 * How many extra rounds to give the drop's **wording** once its reading is in.
 *
 * The two are separate background jobs, and the reply is a second round trip
 * behind the reading — not a second reading. One second of grace is enough to
 * keep the line above the form and the line in the list saying the same thing;
 * past that the page shows what the drop has, which is always a real line.
 */
const REPLY_GRACE_POLLS = 4;

/**
 * How many extra rounds to give the links once a drop's reading is in.
 *
 * Linking is a **second** background job behind the reading, and it is behind
 * it by construction: a term has to be stored before it can be compared with
 * anything. So the links a drop produced are not all there the instant the drop
 * settles — the hard edges are, because code wrote them with the terms, while a
 * similarity edge waits on an embedding call. Rather than guess at a delay, the
 * list is re-read a few times over the next second. A link decided after that
 * appears on the next load, and nothing on screen is ever a placeholder.
 *
 * The same rounds cover the **conclusions**, which are a third job behind the
 * reading: a matter has to have been attached before settling can see it. A look
 * that is deferred to the quiet window takes minutes, so its conclusion appears
 * on a later load rather than here — which is honest, and the same read is what
 * brings it back.
 */
const LINK_GRACE_POLLS = 4;

/**
 * How many extra rounds to give a **surfacing** attempt after a drop.
 *
 * The attempt judges on the spot, but the drop it is about may still be being
 * read: extraction, the terms, the attachment into a matter and the reply are
 * separate background jobs, and the page cannot see which have landed. Reading
 * the drop back tells it extraction is done, which is *before* the attachment —
 * so a surfacing asked for at that moment may not yet see the fragment it is
 * about. Rather than guess at a delay, the attempt is repeated: asking again
 * costs nothing, an attempt that found nothing writes nothing down, and once
 * something has surfaced, asking again is answered `cooldown` — so the same line
 * can never arrive twice.
 *
 * Deliberately short. Each attempt judges on the spot (`settle`), which is the
 * moment being the user's rather than the invisible look's — but repeating it
 * more than a couple of times would be judging a pile over and over to no end,
 * so the wait is over in well under a second and giving up costs nothing.
 */
const SURFACE_GRACE_POLLS = 3;

/**
 * The moment an item's due time names, or null when it names none.
 *
 * One reading, because two places need it — the drop's own item list and the
 * scheduling list — and a due time that one of them decided was usable and the
 * other did not would show the same item two different ways. A time the clock
 * cannot parse counts as no time at all: it is not a date anybody can render,
 * which is also why the domain files such an item under 「待安排」.
 */
function dueMoment(dueAt: string | null): Date | null {
  if (dueAt === null) return null;
  const when = new Date(dueAt);
  return Number.isNaN(when.getTime()) ? null : when;
}

/** Format a due time in Chinese terms, or say plainly that none was found. */
function formatDue(dueAt: string | null): string {
  const when = dueMoment(dueAt);
  if (when === null) return '待安排';
  return when.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * How one item's time reads on the scheduling list (08).
 *
 * Relative where that is the useful thing — 「今天」「明天」「已过期」 is what someone
 * opening the page needs to know — and the calendar date either way, because
 * "tomorrow at what time" is the next question. Nothing here decides anything:
 * the order came from the domain, and this only says what each entry is.
 */
function dueLabel(item: Item): string {
  const when = dueMoment(item.dueAt);
  if (when === null) return '待安排';
  const clock = when.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

  const startOfDay = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(when) - startOfDay(new Date())) / 86_400_000);
  if (days < 0) return `已过期 · ${clock}`;
  if (days === 0) return `今天 · ${clock}`;
  if (days === 1) return `明天 · ${clock}`;
  return clock;
}

/**
 * Render one item of the scheduling list, with the box that advances it.
 *
 * The whole row is the control rather than a small checkbox: this is the one
 * thing in the product the user ever presses, and it is meant to be answerable
 * at a glance when the page is opened to find out what to do.
 *
 * An **unscheduled** item gets the same control and no date. It is not a lesser
 * entry — it is the promise that nothing typed is silently lost — so it is drawn
 * like the others and only the time is missing.
 */
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

/**
 * Show what is still to do.
 *
 * Its own read rather than part of a drop, because the list is not a drop's
 * property: it is every drop's items at once, arranged on the timeline. A read
 * that failed leaves the lists as they were and says so — "we could not read it"
 * and "there is nothing to do" are different facts, the distinction every other
 * load on this page draws too.
 */
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

/**
 * Advance one item, and show the list as it now stands.
 *
 * The list is re-read from the server rather than edited in place: the order the
 * domain put it in is the thing being shown, and a page that removed a row by
 * hand would be keeping a second opinion about it. Finishing something is also
 * the one case where a row legitimately disappears, so the re-read is the honest
 * way to show that it did.
 */
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
 * The two lists, which are one control surface.
 *
 * Both are drawn with the same row and the same button, so both have to answer
 * the same click — a 「待安排」 entry is not a lesser item, it is an item whose
 * time nobody knew, and a button that did nothing on one list and worked on the
 * other would be the page lying about which entries it can act on.
 */
const scheduleLists: readonly HTMLUListElement[] = [dueList, unscheduledList];

/**
 * One delegated listener per list.
 *
 * Delegated rather than one listener per row because the rows are replaced on
 * every read: a listener attached to a row would be thrown away with it, and the
 * one that replaced it would have to remember to attach its own.
 */
for (const scheduleList of scheduleLists) {
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

/**
 * Render one term the drop yielded.
 *
 * The user's own words, shown as they were said. Deliberately with no category
 * and no score beside it: a term is something that can be brought up again, not
 * a label the product has put on the user.
 */
function renderTerm(term: Term): HTMLLIElement {
  const chip = document.createElement('li');
  chip.className = 'term-chip';
  chip.textContent = term.text;
  return chip;
}

/**
 * Render one link between two terms.
 *
 * Both wordings and the reason, because "these two are connected" on its own is
 * a claim the user cannot check — and the strength is on one scale for both
 * kinds, so a hard edge and a similarity can be compared rather than merely
 * listed side by side.
 */
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
 * Render one drop and the items it caught.
 *
 * An unread drop says so rather than showing an empty list, because "nothing
 * has been read yet" and "there was nothing in it" are different facts and
 * showing the first as the second would be a quiet lie.
 *
 * The drop's **reply** is shown with it rather than only in the line above the
 * form: it belongs to that drop, so a reload shows what was said the first time
 * instead of an empty screen where the answer used to be.
 *
 * The **terms** it yielded are shown the same way and for the same reason: they
 * are what this fragment contributed, and a term said here appears here even if
 * it is one the product already knew.
 */
function renderDrop(drop: DropSummary): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'drop-item';

  const body = document.createElement('p');
  body.className = 'drop-body';
  body.textContent = drop.body;

  const when = document.createElement('time');
  when.className = 'drop-when';
  when.dateTime = drop.droppedAt;
  when.textContent = new Date(drop.droppedAt).toLocaleString('zh-CN');

  const reply = document.createElement('p');
  reply.className = 'drop-reply';
  reply.textContent = drop.reply;

  // 09: the way in to deletion. Deliberately not a delete button — it removes
  // nothing and asks the server what a deletion **would** take, because a
  // fragment typed in passing can turn out to be the ground a judgement stands
  // on and the user is owed that before they act rather than after.
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'drop-remove';
  remove.dataset['dropId'] = drop.id;
  remove.textContent = '删掉这次投递';

  item.append(body, when, reply, remove);

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
      said.append(...drop.terms.map(renderTerm));
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

/** Render the drops that have been caught. An empty list renders as empty. */
function render(drops: readonly DropSummary[]): void {
  list.replaceChildren(...drops.map(renderDrop));
  empty.hidden = drops.length > 0;
}

/** The drops recorded so far, or null when the server could not answer. */
async function readDrops(): Promise<readonly DropSummary[] | null> {
  const response = await fetch('/api/drops');
  if (!response.ok) return null;
  const payload = (await response.json()) as { drops: DropSummary[] };
  return payload.drops;
}

async function loadDrops(): Promise<readonly DropSummary[]> {
  // A read that failed leaves the list as it was rather than claiming the user
  // never dropped anything — "we could not read it" and "there is nothing" are
  // different facts, the same distinction act two draws.
  const drops = (await readDrops().catch(() => null)) ?? [];
  render(drops);
  return drops;
}

/**
 * The deletion the user is being asked about, or null when nothing is pending.
 *
 * Held because the choice is made **after** the preview is on screen: the two
 * buttons below answer a question that was asked a moment earlier, and a page
 * that guessed which fragment they referred to would be deleting on a guess.
 */
let pendingRemoval: DeletionPreview | null = null;

/** Put a deletion preview on screen, and hold what the buttons will act on. */
function showRemoval(preview: DeletionPreview): void {
  pendingRemoval = preview;
  removalBody.textContent = preview.body;

  const count = preview.conclusions.length;
  // The sentence the spec asks for, and only when it is true: a fragment that fed
  // nothing says so plainly rather than announcing "0 conclusions came from it",
  // which reads like a count rather than like an answer.
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
  // Named so the user can see what would go with it. A word they say elsewhere is
  // not listed, because it would not go — the list is the answer to "what do I
  // lose", not to "what was in it".
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

/**
 * Ask what deleting one fragment would take, and put the question on screen.
 *
 * Nothing is deleted by this call, and that is the point of it being a separate
 * step: a product that acted on the first click would be asking the user to
 * approve a consequence they were never shown.
 */
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

/**
 * Carry out the choice the user just made, and show the lists as they now stand.
 *
 * Every read on this page is re-run afterwards rather than edited in place: a
 * deletion can change the drops, the links, the portrait and the timeline at
 * once, and a page that removed a row by hand would be keeping its own opinion
 * about what is left. Re-reading is also the honest way to show that something
 * is gone.
 */
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
    removalNote.textContent = deletionLine(payload.deleted);

    await loadDrops();
    await loadLinks();
    await loadConclusions();
    await loadUpcoming();
  } catch {
    removalNote.textContent = '连不上本地服务。';
  } finally {
    for (const button of [removalCascade, removalOriginal, removalCancel]) button.disabled = false;
  }
}

// Delegated, like the scheduling list and for the same reason: the rows are
// replaced on every read, so a listener attached to a row would be thrown away
// with it.
list.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.drop-remove');
  const dropId = button?.dataset['dropId'];
  if (button === null || button === undefined || dropId === undefined) return;
  void askToRemove(dropId, button);
});

removalCascade.addEventListener('click', () => void carryOutRemoval('cascade'));
removalOriginal.addEventListener('click', () => void carryOutRemoval('original-only'));
removalCancel.addEventListener('click', () => void carryOutRemoval('keep'));

/**
 * Load the links between terms.
 *
 * Its own read rather than part of a drop: links are not a drop's property —
 * they are the accumulation itself, and one of them can join a term said today
 * to one said weeks ago. A failure here leaves the list as it was rather than
 * claiming nothing is connected, because "we could not read it" and "there is
 * nothing" are different facts.
 *
 * @returns the links as last read, or null when the server could not answer.
 */
async function loadLinks(): Promise<readonly TermLink[] | null> {
  const response = await fetch('/api/links');
  if (!response.ok) return null;
  const payload = (await response.json()) as { links: TermLink[] };
  linkList.replaceChildren(...payload.links.map(renderLink));
  linkEmpty.hidden = payload.links.length > 0;
  return payload.links;
}

/**
 * Give the semantic half of linking — and the settling behind it — its moment.
 *
 * See `LINK_GRACE_POLLS`: the wait is bounded on purpose. Giving up is not a
 * failure — what is there is real, and the next load looks again.
 */
async function settleAccumulation(): Promise<void> {
  for (let attempt = 0; attempt < LINK_GRACE_POLLS; attempt += 1) {
    await loadLinks();
    await loadConclusions();
    // The scheduling list is read on the same rounds, and for the same reason a
    // third time: a fragment that carried a time has its item written behind the
    // reading, and the page cannot see which of its background jobs has landed.
    await loadUpcoming();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * How firmly the sentence was allowed to speak, in the words the page shows.
 *
 * A catch is not a weak claim: it is the substitute for one, so it says so
 * rather than taking a band it never earned. A correction is not a claim at all
 * — it is what the user did to the one before it — so it says that instead. A
 * surfacing is never either of those: one asserts nothing and the other is not
 * the product's to show, so the band is the whole story there.
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

/**
 * Why it said that, from the numbers it was read off.
 *
 * The sentence is a judgement, and the whole reason its wording was mapped from
 * numbers instead of chosen by a model is so this answer can be given later.
 * "被提起 N 次" is the threshold's unit; the span and the connection strength are
 * what the band was read from. Shared by the portrait and the surfacing, because
 * it is the same four numbers either way.
 */
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

/**
 * Whether the chain has already answered this record with a correction.
 *
 * One rule with one name, because two things ask it — what the forward relation
 * says, and whether the record may still be rejected — and a page that answered
 * it twice could show "后来被你标为不对" on a row that still offered the button.
 *
 * @param conclusion - the record being read.
 * @param corrections - the ids of the corrections on the chain.
 * @returns true when this record has been rejected.
 */
function isOverturned(conclusion: Conclusion, corrections: ReadonlySet<string>): boolean {
  return conclusion.supersededBy !== null && corrections.has(conclusion.supersededBy.id);
}

/**
 * Render one record on the chain, with what supports it and where it sits.
 *
 * The support terms are the user's own words, so the sentence can be checked
 * against them — a judgement nobody can check is one they have to take on trust,
 * and this product does not ask for that. The chain is shown as a sentence of
 * its own ("承自…", "推翻了…"), because "which of these came first" is part of
 * what makes a portrait read as a history rather than as a list of verdicts.
 *
 * The two light actions sit on the record they are about (10), and they are the
 * only things a conclusion can be given: 「不对」 is offered where there is a
 * judgement to disagree with and nothing has been said against it yet, and 「补
 * 一句自己的话」 everywhere — including beside a correction, where writing down
 * what one actually meant is the obvious next thing. There is deliberately
 * nothing else: no score, no thumb, no "tell me more like this".
 *
 * @param conclusion - the record to render.
 * @param corrections - the ids of the corrections on the chain, so a relation can
 *   say what it points at — a successor that is a correction is not a record that
 *   "carried on", and the page says so.
 */
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

  const when = document.createElement('time');
  when.className = 'conclusion-when';
  when.dateTime = conclusion.createdAt;
  when.textContent = new Date(conclusion.createdAt).toLocaleString('zh-CN');

  meta.append(band, when);

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

  // What it was read off, and only where there was something to read it off:
  // asking a correction to explain itself would be asking the user's own tap to
  // justify itself with numbers it never had.
  if (conclusion.kind !== 'correction') {
    const why = document.createElement('p');
    why.className = 'conclusion-why';
    // The step down is named here rather than left to be worked out from the
    // numbers, because the numbers alone earn the band above them: a reader who
    // checked would otherwise find the page telling two stories about one
    // sentence. The fourth input is the user's own rejection.
    why.textContent = conclusion.softened
      ? `为什么这么说：${whySpoken(conclusion)}（这件事你标过不对，语气退了一档）`
      : `为什么这么说：${whySpoken(conclusion)}`;
    row.append(why);
  }

  if (conclusion.support.length > 0) {
    const support = document.createElement('ul');
    support.className = 'conclusion-support';
    for (const term of conclusion.support) {
      const chip = document.createElement('li');
      chip.className = 'term-chip';
      chip.textContent = term.text;
      support.append(chip);
    }
    row.append(support);
  }

  row.append(renderConclusionActions(conclusion, corrections));
  return row;
}

/**
 * The two light things the user may do to one conclusion.
 *
 * Both are one tap and one sentence, and neither asks the user to supply
 * anything the product should already know: 「不对」 carries no reason, and the
 * box for a sentence is a box and not a form. That is the shape of the product
 * rather than an unfinished version of feedback — a conclusion is not something
 * the user maintains (`CONTEXT.md`, 无感).
 */
function renderConclusionActions(
  conclusion: Conclusion,
  corrections: ReadonlySet<string>,
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'conclusion-actions';

  // Offered only where there is a judgement to disagree with, and only while
  // nothing has been said against it: a second tap is the same fact, and the
  // product does not collect taps. The domain refuses the same two cases, so the
  // page is not the only thing standing between a caller and a meaningless
  // record — it is only the thing that keeps the button off the screen.
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

/**
 * Mark one conclusion wrong, and show the chain with the correction on it.
 *
 * The button is disabled while the request is out and stays disabled once it has
 * landed, because the reload that follows renders the record as overturned — a
 * second tap would be the same fact, and there is nothing for it to do.
 */
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
 * The sentence is a **drop**, so it is answered like one and everything behind it
 * runs the same way — reading, wording, settling. The page therefore waits for
 * it exactly as it waits for a drop typed at the top, and shows the line it was
 * answered with rather than a "saved" of its own invention.
 */
async function addNote(
  conclusionId: string,
  input: HTMLTextAreaElement,
  send: HTMLButtonElement,
  line: HTMLParagraphElement,
): Promise<void> {
  const body = input.value.trim();
  if (body.length === 0) {
    line.textContent = '还没写呢。';
    return;
  }

  send.disabled = true;
  const response = await fetch(`/api/conclusions/${encodeURIComponent(conclusionId)}/append`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    send.disabled = false;
    line.textContent = '这次没写进去，再试一次。';
    return;
  }

  const payload = (await response.json()) as { addition: ConclusionAddition };
  input.value = '';
  await loadDrops();
  const settled = await settleDrop(payload.addition.drop.id, payload.addition.drop.reply);
  line.textContent = settled?.reply ?? payload.addition.drop.reply;
  send.disabled = false;
  await settleAccumulation();
}

/**
 * Load the portrait — which is the conclusion chain.
 *
 * One read for both, because they are one thing: the portrait is the set of
 * conclusions, and the chain is the relations between them. What the user may do
 * here is the two light things ticket 10 opened, and nothing else — settling
 * still needs no participation from them, so there is no step to keep.
 *
 * @returns the conclusions as last read, or null when the server could not answer.
 */
async function loadConclusions(): Promise<readonly Conclusion[] | null> {
  const response = await fetch('/api/conclusions');
  if (!response.ok) return null;
  const payload = (await response.json()) as { conclusions: Conclusion[] };
  // What each row needs of the others is one bit — whether the record that
  // replaced it was a correction — so the page keeps that and not the whole
  // chain: a row that could look up any other record would be a row that could
  // start depending on the rest of the portrait.
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

/** Ask about one drop, or null when the server cannot answer. */
async function loadDrop(dropId: string): Promise<DropSummary | null> {
  const response = await fetch(`/api/drops/${encodeURIComponent(dropId)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { drop: DropSummary };
  return payload.drop;
}

/**
 * Wait for a just-made drop to be read, and give its reply a moment to land.
 *
 * The wait is bounded: a provider that never answers must leave the page
 * showing an honest "not read yet" rather than spinning forever. Giving up is
 * not a failure — the drop is already safely stored, and a refresh looks again.
 *
 * The drop's styled **reply** is composed behind it as its own job, so once the
 * reading is in there is a short grace for the wording too: `pending` is the
 * line the POST handed back, and a line still equal to it is one the provider
 * has not replaced yet. When the grace runs out the line stands as it is — it is
 * a line the drop was caught with, not a placeholder, and the list on the next
 * load picks up whatever replaced it.
 *
 * @param dropId - the drop to wait for.
 * @param pending - the line the drop was caught with.
 * @returns the drop as last read, or null when the server could not answer.
 */
async function settleDrop(dropId: string, pending: string): Promise<DropSummary | null> {
  let latest: DropSummary | null = null;
  let grace = 0;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const drop = await loadDrop(dropId);
    if (drop === null) break;
    latest = drop;
    if (drop.extracted) {
      if (drop.reply !== pending || grace >= REPLY_GRACE_POLLS) break;
      grace += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  await loadDrops();
  return latest;
}

/**
 * Post one drop and settle everything it sets off.
 *
 * The three jobs behind a drop — reading it, wording its reply, settling and
 * linking what it added — are each given their moment, in the order they depend
 * on one another: reading first, because everything else is about what was read.
 *
 * @param body - the text to drop, exactly as typed.
 * @returns the drop's id and its line, or null when the drop itself failed.
 */
async function postDrop(body: string): Promise<{ readonly id: string; readonly reply: string } | null> {
  const response = await fetch('/api/drop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { id: string; reply: string };

  await loadDrops();
  const settled = await settleDrop(payload.id, payload.reply);
  await settleAccumulation();
  return { id: payload.id, reply: settled?.reply ?? payload.reply };
}

/**
 * Ask the product to speak first.
 *
 * A `null` return means the question could not be put to the material at all,
 * which is deliberately not the same fact as "there was nothing to say" — the
 * same distinction act two draws. The domain holds the two triggers and the
 * cooldown, so nothing here decides whether this is a moment.
 *
 * @param dropId - the drop that raised the moment, or nothing when the user asked.
 * @returns what came of the attempt, or null when the server could not answer.
 */
async function askToSurface(dropId?: string): Promise<SurfacingResult | null> {
  const response = await fetch('/api/surface', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dropId === undefined ? {} : { dropId }),
  });
  if (!response.ok) return null;
  return (await response.json()) as SurfacingResult;
}

/**
 * Ask for a surfacing about a drop that has just been made.
 *
 * See `SURFACE_GRACE_POLLS`: the attempt may land before the drop has been
 * attached to the material it belongs to, so "nothing to say" is the one answer
 * worth asking about again. Every other answer is a settled fact about the user's
 * material and will not change by asking.
 *
 * @param dropId - the drop that raised the moment.
 * @returns what came of the attempt, or null when the server could not answer.
 */
async function surfaceAfterDrop(dropId: string): Promise<SurfacingResult | null> {
  let result = await askToSurface(dropId);
  for (let attempt = 0; attempt < SURFACE_GRACE_POLLS; attempt += 1) {
    if (result === null || result.kind === 'surfaced') return result;
    if (result.reason !== 'nothing-to-say') return result;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    result = await askToSurface(dropId);
  }
  return result;
}

/** What a zero answer means, in words the page can show. */
function missLine(reason: 'not-a-moment' | 'nothing-to-say' | 'cooldown' | 'held-back'): string {
  if (reason === 'cooldown') return '这件事 7 天内已经浮过一次了，先不重复。';
  if (reason === 'nothing-to-say') return '还没有沉淀到能说出口的一句。';
  // Not a moment, or a turn the product chose not to use. Both are the product
  // keeping quiet, and naming which one would be showing the user its internals.
  return '这次先不说。';
}

/** Show what act three's attempt came to. */
function renderSurfacing(result: SurfacingResult | null): void {
  surfaceResult.hidden = true;
  surfaceMiss.hidden = true;

  if (result === null) {
    // Nothing was asked. Reusing the "there was nothing to say" line here would
    // tell the user something about their own material that nobody looked at.
    surfaceMiss.textContent = '这次没能问到，稍后再试试。';
    surfaceMiss.hidden = false;
    return;
  }

  if (result.kind === 'none') {
    surfaceMiss.textContent = missLine(result.reason);
    surfaceMiss.hidden = false;
    return;
  }

  surfaceText.textContent = result.text;
  surfaceWhy.textContent = `为什么这么说：${whySpoken(result)}`;
  surfaceSupport.replaceChildren(
    ...result.support.map((term) => {
      const chip = document.createElement('li');
      chip.className = 'term-chip';
      chip.textContent = term.text;
      return chip;
    }),
  );
  surfaceResult.hidden = false;
}

/** Format a moment as a value a `datetime-local` input accepts (local time). */
function toLocalInputValue(when: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return `${date}T${time}`;
}

/**
 * Clear act two's result.
 *
 * Answer, sources and both failure lines are cleared together, so a new question
 * can never leave the previous outcome on screen beside its own.
 */
function clearAnswer(): void {
  answerBlock.hidden = true;
  answerText.textContent = '';
  sourceList.replaceChildren();
  notFound.hidden = true;
  unavailable.hidden = true;
  askError.textContent = '';
}

/** One cited drop: the user's own words, and when they said them. */
function renderSource(source: RecallSource): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'answer-source-item';

  const body = document.createElement('blockquote');
  body.className = 'answer-source-body';
  body.textContent = source.body;

  const when = document.createElement('time');
  when.className = 'answer-source-when';
  when.dateTime = source.droppedAt;
  when.textContent = new Date(source.droppedAt).toLocaleString('zh-CN');

  item.append(body, when);
  return item;
}

/** Show the outcome of one question. */
function renderAnswer(result: RecallResult): void {
  clearAnswer();

  if (result.kind === 'not-found') {
    // The records were searched. Saying nothing covers the question is then a
    // statement about the user's own data, and a true one.
    notFound.hidden = false;
    return;
  }

  if (result.kind === 'unavailable') {
    // Nothing was searched. This deliberately does NOT reuse the "nothing
    // covers this" line: telling the user their records lack something nobody
    // looked for would be a lie about their own data.
    unavailable.hidden = false;
    return;
  }

  answerText.textContent = result.answer;
  sourceList.replaceChildren(...result.sources.map(renderSource));
  answerBlock.hidden = false;
}

/** Report a problem without letting a previous answer linger beside it. */
function showAskProblem(message: string): void {
  clearAnswer();
  askError.textContent = message;
}

/** Switch acts. Act three stays an empty container. */
function showAct(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.act-tab')) {
    if (tab.dataset['act'] === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-act-panel]')) {
    panel.hidden = panel.dataset['actPanel'] !== name;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = input.value;
  if (body.trim().length === 0) return;

  send.disabled = true;
  reply.textContent = '';
  surfacedInline.hidden = true;

  void (async () => {
    try {
      const dropped = await postDrop(body);
      if (dropped === null) {
        reply.textContent = '没接住，再试一次。';
        return;
      }
      reply.textContent = dropped.reply;
      input.value = '';

      // The moment the product may speak first. Act one shows the line without
      // the evidence behind it — that belongs to the portrait below — and shows
      // nothing at all when there is nothing to say, because surfacing never
      // pushes.
      const surfaced = await surfaceAfterDrop(dropped.id);
      if (surfaced !== null && surfaced.kind === 'surfaced') {
        surfacedInline.textContent = surfaced.text;
        surfacedInline.hidden = false;
      }
      await refreshSurfaceAgain();
    } catch {
      reply.textContent = '连不上本地服务。';
    } finally {
      send.disabled = false;
    }
  })();
});

/**
 * Point act three's repeat button at the material this database actually holds.
 *
 * The third act is "say the same thing until it is the third time", because the
 * threshold counts mentions. Rather than keep a second copy of the preset
 * sentence in the page — which would drift from the provider's script and quietly
 * turn the demo into nothing — the button re-drops the first thing the user
 * really dropped, read back from the store.
 */
async function refreshSurfaceAgain(): Promise<void> {
  const first = (await readDrops().catch(() => null))?.[0];
  if (first === undefined) {
    surfaceAgain.disabled = true;
    surfaceAgainHint.textContent = '先在「丢」里丢一句。';
    return;
  }
  surfaceAgain.disabled = false;
  surfaceAgainHint.textContent = `同一句：${first.body}`;
}

/** Drop one fragment from act three, and show what came of it. */
async function surfaceFromDrop(body: string): Promise<void> {
  if (body.trim().length === 0) return;
  surfaceSend.disabled = true;
  surfaceAgain.disabled = true;
  surfaceReply.textContent = '';
  surfaceResult.hidden = true;
  surfaceMiss.hidden = true;

  try {
    const dropped = await postDrop(body);
    if (dropped === null) {
      surfaceReply.textContent = '没接住，再试一次。';
      return;
    }
    surfaceReply.textContent = dropped.reply;
    surfaceInput.value = '';
    renderSurfacing(await surfaceAfterDrop(dropped.id));
    await refreshSurfaceAgain();
  } catch {
    surfaceReply.textContent = '连不上本地服务。';
  } finally {
    surfaceSend.disabled = false;
    surfaceAgain.disabled = false;
  }
}

surfaceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void surfaceFromDrop(surfaceInput.value);
});

surfaceAgain.addEventListener('click', () => {
  void (async () => {
    const first = (await readDrops().catch(() => null))?.[0];
    if (first === undefined) {
      await refreshSurfaceAgain();
      return;
    }
    await surfaceFromDrop(first.body);
  })();
});

surfaceAsk.addEventListener('click', () => {
  surfaceAsk.disabled = true;
  surfaceResult.hidden = true;
  surfaceMiss.hidden = true;

  void (async () => {
    let result: SurfacingResult | null = null;
    try {
      result = await askToSurface();
    } catch {
      // A fetch that never reached the server is not an answer about the user's
      // material, so it is reported as "could not ask" rather than as silence.
      result = null;
    }
    renderSurfacing(result);
    surfaceAsk.disabled = false;
  })();
});

askForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = askInput.value;
  if (question.trim().length === 0) return;

  askSend.disabled = true;
  clearAnswer();

  void (async () => {
    try {
      // The pinned basis is optional and sent only when the user set one, so an
      // untouched field means "answer as of now" rather than a made-up moment.
      const now = askNow.value.length > 0 ? new Date(askNow.value).toISOString() : undefined;
      const response = await fetch('/api/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, now }),
      });
      if (!response.ok) {
        const problem = (await response.json()) as { error?: string };
        showAskProblem(problem.error ?? '没问到，再试一次。');
        return;
      }
      renderAnswer((await response.json()) as RecallResult);
    } catch {
      showAskProblem('连不上本地服务。');
    } finally {
      askSend.disabled = false;
    }
  })();
});

// The demo's "a few days later" viewpoint, in one click. It only fills the
// field — the question still has to be asked, so nothing is answered unasked.
askLater.addEventListener('click', () => {
  const later = new Date();
  later.setDate(later.getDate() + 3);
  askNow.value = toLocalInputValue(later);
});

for (const tab of document.querySelectorAll<HTMLButtonElement>('.act-tab')) {
  tab.addEventListener('click', () => showAct(tab.dataset['act'] ?? 'drop'));
}

void loadDrops();
void loadLinks();
void loadConclusions();
void loadUpcoming();
void refreshSurfaceAgain();
