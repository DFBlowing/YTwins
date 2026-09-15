/*
 * The three-act skeleton's browser entry.
 *
 * Only act one is wired to a real path: a drop really posts, really lands in the
 * local database, and really answers. Acts two and three are empty containers —
 * they hold no fake data and claim nothing they do not do. They get filled in by
 * tickets 07 and 06.
 *
 * Nothing here holds a credential of any kind; the browser never sees one.
 */

/** A drop as the server reports it. */
interface DropSummary {
  readonly id: string;
  readonly body: string;
  readonly droppedAt: string;
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

/** Render the drops that have been caught. An empty list renders as empty. */
function render(drops: readonly DropSummary[]): void {
  list.replaceChildren(
    ...drops.map((drop) => {
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
      return item;
    }),
  );
  empty.hidden = drops.length > 0;
}

async function loadDrops(): Promise<void> {
  const response = await fetch('/api/drops');
  if (!response.ok) return;
  const payload = (await response.json()) as { drops: DropSummary[] };
  render(payload.drops);
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
      const payload = (await response.json()) as { body: string; reply: string };
      reply.textContent = payload.reply;
      input.value = '';
      await loadDrops();
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
