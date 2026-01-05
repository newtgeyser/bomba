import { button, el } from './dom.js';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createRatingsView({ onBack }) {
  const left = el('div', { class: 'panel' }, [
    el('h2', { text: 'Leaderboard' }),
    el('div', { class: 'muted', text: 'Local dev leaderboard (Elo). Identity is reconnect token, not accounts.' }),
    el('div', { class: 'row' }, [button('Back', () => onBack?.()), button('Refresh', () => load())]),
  ]);
  const right = el('div', { class: 'panel' }, [el('div', { class: 'muted', text: 'Loading…' })]);

  async function load() {
    right.innerHTML = '';
    right.append(el('div', { class: 'muted', text: 'Loading…' }));
    try {
      const data = await fetchJson('/api/ratings');
      const rows = (data.leaderboard ?? []).map((p, idx) =>
        el('div', { class: 'item' }, [
          el('div', {}, [el('div', { text: `${idx + 1}. ${p.name ?? 'Unknown'}` }), el('div', { class: 'muted', text: p.token.slice(0, 8) })]),
          el('div', { class: 'pill', text: String(p.rating ?? 1200) }),
        ]),
      );
      right.innerHTML = '';
      right.append(el('div', { class: 'list' }, rows.length ? rows : [el('div', { class: 'muted', text: 'No ratings yet.' })]));
    } catch (e) {
      right.innerHTML = '';
      right.append(el('div', { class: 'muted', text: `Failed to load: ${e?.message ?? e}` }));
    }
  }

  load();
  return el('div', { class: 'grid2' }, [left, right]);
}

