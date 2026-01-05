import { button, el } from './dom.js';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createMapsView({ state, onBack, onOpenInEditor }) {
  const root = el('div', { class: 'panel' }, [
    el('h2', { text: 'Map Browser' }),
    el('div', { class: 'muted', text: 'Browse official and published schemes. Reporting is stored locally on the server.' }),
  ]);

  const listWrap = el('div', { class: 'panel' }, [el('div', { class: 'muted', text: 'Loading…' })]);
  const actions = el('div', { class: 'row' }, [button('Back', () => onBack?.()), button('Refresh', () => load())]);

  root.append(actions);

  async function load() {
    listWrap.innerHTML = '';
    listWrap.append(el('div', { class: 'muted', text: 'Loading…' }));
    try {
      const data = await fetchJson('/api/schemes');
      listWrap.innerHTML = '';

      const section = (title, items, { canReport } = {}) =>
        el('div', { class: 'panel' }, [
          el('h3', { text: title }),
          el(
            'div',
            { class: 'list' },
            items.map((m) =>
              el('div', { class: 'item' }, [
                el('div', {}, [
                  el('div', { text: m.name }),
                  el('div', { class: 'muted', text: `${m.visibility} • ${m.author}` }),
                ]),
                el('div', { class: 'row' }, [
                  button('Open', async () => {
                    const full = await fetchJson(`/api/schemes/${encodeURIComponent(m.id)}`);
                    onOpenInEditor?.(full.scheme, full.meta);
                  }),
                  canReport
                    ? button('Report', async () => {
                        const reason = prompt('Report reason (short):', 'Inappropriate content');
                        if (!reason) return;
                        const message = prompt('Optional details:', '');
                        await fetch('/api/reports', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ schemeId: m.id, reason, message }),
                        });
                        alert('Reported.');
                      })
                    : el('span', { class: 'pill', text: 'Official' }),
                  button('Copy Link', async () => {
                    const link = `${location.origin}/#map=${encodeURIComponent(m.id)}`;
                    await navigator.clipboard?.writeText(link);
                    alert('Link copied.');
                  }),
                ]),
              ]),
            ),
          ),
        ]);

      listWrap.append(
        section('Official', data.official ?? [], { canReport: false }),
        section('Published', data.published ?? [], { canReport: true }),
      );
    } catch (e) {
      listWrap.innerHTML = '';
      listWrap.append(el('div', { class: 'muted', text: `Failed to load: ${e?.message ?? e}` }));
    }
  }

  load();
  return el('div', { class: 'grid2' }, [root, listWrap]);
}
