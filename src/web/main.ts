/*
 * The three-act skeleton's browser entry.
 *
 * Only act one is wired to a real path: a drop really posts, really lands in the
 * local database, and really answers. Acts two and three are empty containers —
 * they hold no fake data and claim nothing they do not do. They get filled in by
 * tickets 07 and 06.
 *
 * Nothing here holds a credential of any kind; the browser never sees one.
 *
 * What act one shows is what ticket 02 added: dropping does not return the
 * **items** a fragment contained, because extraction runs after the drop has
 * already succeeded. So the page drops, then asks about that drop again until
 * it has been read — and the same read is what fills the list after a refresh.
 * There is deliberately no input type on this page: the system judges it
 * internally and the user is never asked for it.
 */

/** One item parsed out of a drop, as the server reports it. */
interface Item {
  readonly id: string;
  readonly text: string;
  readonly dueAt: string | null;
  readonly dropId: string;
}

/** A drop as the server reports it. */
interface DropSummary {
  readonly id: string;
  readonly body: string;
  readonly droppedAt: string;
  readonly items: readonly Item[];
  readonly extracted: boolean;
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
const list = mustFind<HTMLUListElement>('#drop-list');
const empty = mustFind<HTMLParagraphElement>('#drop-empty');

/** How many times to ask whether a fresh drop has been read, and how often. */
const POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 250;

/** Format a due time in Chinese terms, or say plainly that none was found. */
function formatDue(dueAt: string | null): string {
  if (dueAt === null) return '待安排';
  const when = new Date(dueAt);
  if (Number.isNaN(when.getTime())) return '待安排';
  return when.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
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
 * Render one drop and the items it caught.
 *
 * An unread drop says so rather than showing an empty list, because "nothing
 * has been read yet" and "there was nothing in it" are different facts and
 * showing the first as the second would be a quiet lie.
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

  item.append(body, when);

  if (drop.extracted) {
    if (drop.items.length > 0) {
      const caught = document.createElement('ul');
      caught.className = 'item-list';
      caught.append(...drop.items.map(renderItem));
      item.append(caught);
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

async function loadDrops(): Promise<readonly DropSummary[]> {
  const response = await fetch('/api/drops');
  if (!response.ok) return [];
  const payload = (await response.json()) as { drops: DropSummary[] };
  render(payload.drops);
  return payload.drops;
}

/** Ask about one drop, or null when the server cannot answer. */
async function loadDrop(dropId: string): Promise<DropSummary | null> {
  const response = await fetch(`/api/drops/${encodeURIComponent(dropId)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { drop: DropSummary };
  return payload.drop;
}

/**
 * Wait for a just-made drop to be read, then show what it caught.
 *
 * The wait is bounded: a provider that never answers must leave the page
 * showing an honest "not read yet" rather than spinning forever. Giving up is
 * not a failure — the drop is already safely stored, and a refresh looks again.
 */
async function settleDrop(dropId: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const drop = await loadDrop(dropId);
    if (drop === null) return;
    if (drop.extracted) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  await loadDrops();
}

/** Switch acts. Nothing else changes: the empty acts stay empty. */
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

  void (async () => {
    try {
      const response = await fetch('/api/drop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        const problem = (await response.json()) as { error?: string };
        reply.textContent = problem.error ?? '没接住，再试一次。';
        return;
      }
      const payload = (await response.json()) as { id: string; reply: string };
      reply.textContent = payload.reply;
      input.value = '';

      // The drop is already caught at this point. What is still running is
      // reading it, so the list is refreshed once that has had its chance.
      await loadDrops();
      await settleDrop(payload.id);
    } catch {
      reply.textContent = '连不上本地服务。';
    } finally {
      send.disabled = false;
    }
  })();
});

for (const tab of document.querySelectorAll<HTMLButtonElement>('.act-tab')) {
  tab.addEventListener('click', () => showAct(tab.dataset['act'] ?? 'drop'));
}

void loadDrops();
