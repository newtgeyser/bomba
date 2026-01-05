import { TICK_HZ } from '../shared/constants.js';
import { makePlayer, makeWorld } from '../shared/sim/world.js';
import { EnclosementDepth } from '../shared/sim/enclosement.js';
import { applyItemPickup } from '../shared/sim/items.js';
import { drawFrame } from './render.js';
import { button, el } from './dom.js';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function unpackButtons(bits) {
  return {
    up: (bits & 1) !== 0,
    down: (bits & 2) !== 0,
    left: (bits & 4) !== 0,
    right: (bits & 8) !== 0,
    dropPressed: (bits & 16) !== 0,
    secondaryPressed: (bits & 32) !== 0,
  };
}

function createReplayPlayer({ replay, onBack }) {
  const panel = el('div', { class: 'panel' }, [
    el('h2', { text: `Replay: ${replay.scheme?.name ?? replay.id}` }),
    el('div', { class: 'muted', text: `${replay.ranked ? 'Ranked' : 'Casual'} • ${new Date(replay.createdAt).toLocaleString()}` }),
  ]);

  const canvas = el('canvas', { width: 900, height: 660 });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Missing 2d context');

  const rounds = Array.isArray(replay.rounds) && replay.rounds.length
    ? replay.rounds
    : [{ seed: replay.seed, frames: replay.frames ?? [], result: replay.result ?? null }];
  const total = rounds.reduce((s, r) => s + (r.frames?.length ?? 0), 0);

  const info = el('div', { class: 'muted', text: '' });
  const slider = el('input', { type: 'range', min: '0', max: String(Math.max(0, total - 1)), value: '0', step: '1' });
  const playBtn = button('Play', () => toggle());

  let playing = false;
  let frameIndex = 0;
  let raf = 0;
  let lastTs = 0;
  let acc = 0;

  function buildWorldUntil(index) {
    const scheme = replay.scheme;
    const settings = replay.settings ?? {};
    const mkWorld = (seed) => {
      const world = makeWorld({
        scheme,
        seed,
        settings: {
          roundSeconds: settings.timerSeconds === 'Infinite' ? Infinity : settings.timerSeconds ?? Infinity,
          enclosementDepth: settings.enclosementDepth ?? EnclosementDepth.None,
        },
      });
      for (let i = 0; i < replay.players.length; i++) {
        const meta = replay.players[i];
        const spawn = scheme.spawns[i % scheme.spawns.length];
        const p = makePlayer({
          id: meta.id,
          name: meta.name,
          color: meta.color,
          spawnTx: spawn.x,
          spawnTy: spawn.y,
          scheme,
        });
        p.team = (settings.mode === 'Teams' ? spawn.team : 'None') ?? 'None';
        p.statsBase.fuseTicks = settings.variant === 'Classic' ? 180 : 120;
        p.stats.fuseTicks = p.statsBase.fuseTicks;
        world.addPlayer(p);
      }
      if (replay.goldCarryover?.winnerToken && replay.goldCarryover?.itemType) {
        const p = world.players.get(replay.goldCarryover.winnerToken);
        if (p) {
          p.isGold = true;
          applyItemPickup(world, p, replay.goldCarryover.itemType, { source: 'gold' });
        }
      }
      return world;
    };

    let remaining = index;
    let world = null;
    for (const round of rounds) {
      const frames = round.frames ?? [];
      world = mkWorld(round.seed ?? replay.seed);
      const upto = Math.min(remaining, frames.length - 1);
      for (let i = 0; i <= upto; i++) {
        const frame = frames[i];
        for (let j = 0; j < replay.players.length; j++) {
          const pid = replay.players[j].id;
          world.applyInput(pid, unpackButtons(frame[j] ?? 0));
        }
        world.step();
      }
      remaining -= frames.length;
      if (remaining < 0) break;
    }
    return world ?? mkWorld(replay.seed);
  }

  let world = buildWorldUntil(-1);

  function setFrame(idx) {
    frameIndex = Math.max(0, Math.min(total - 1, idx));
    slider.value = String(frameIndex);
    world = buildWorldUntil(frameIndex);
    redraw();
  }

  function redraw() {
    const snap = world.getSnapshot();
    drawFrame(ctx, canvas.width, canvas.height, snap, replay.theme, null);
    info.textContent = `Tick ${snap.tick} • Frame ${frameIndex + 1}/${total}`;
  }

  function toggle() {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    if (playing) {
      lastTs = performance.now();
      acc = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  function loop(ts) {
    if (!playing) return;
    const dt = ts - lastTs;
    lastTs = ts;
    acc += dt;
    const stepMs = 1000 / TICK_HZ;
    while (acc >= stepMs) {
      acc -= stepMs;
      if (frameIndex >= total - 1) {
        playing = false;
        playBtn.textContent = 'Play';
        break;
      }
      frameIndex++;
      // For simplicity, rebuild on round boundaries.
      world = buildWorldUntil(frameIndex);
      slider.value = String(frameIndex);
    }
    redraw();
    raf = requestAnimationFrame(loop);
  }

  slider.addEventListener('input', () => {
    playing = false;
    playBtn.textContent = 'Play';
    setFrame(Number(slider.value));
  });

  redraw();

  panel.append(
    el('div', { class: 'row' }, [playBtn, slider, button('Back', () => onBack?.())]),
    info,
    canvas,
  );
  return panel;
}

export function createReplaysView({ state, replay, onBack, onPlay }) {
  if (replay) return createReplayPlayer({ replay, onBack });

  const root = el('div', { class: 'panel' }, [el('h2', { text: 'Replays' }), el('div', { class: 'muted', text: 'Server-recorded inputs; deterministic playback in the browser.' })]);
  const list = el('div', { class: 'panel' }, [el('div', { class: 'muted', text: 'Loading…' })]);
  const actions = el('div', { class: 'row' }, [button('Back', () => onBack?.()), button('Refresh', () => load())]);
  root.append(actions);

  async function load() {
    list.innerHTML = '';
    list.append(el('div', { class: 'muted', text: 'Loading…' }));
    try {
      const data = await fetchJson('/api/replays');
      list.innerHTML = '';
      const rows = (data.replays ?? []).map((r) =>
        el('div', { class: 'item' }, [
          el('div', {}, [
            el('div', { text: r.schemeName }),
            el('div', { class: 'muted', text: `${r.ranked ? 'Ranked' : 'Casual'} • ${new Date(r.createdAt).toLocaleString()}` }),
          ]),
          el('div', { class: 'row' }, [
            button('Play', async () => {
              const full = await fetchJson(`/api/replays/${encodeURIComponent(r.id)}`);
              onPlay?.(full.replay);
            }),
          ]),
        ]),
      );
      list.append(el('div', { class: 'list' }, rows.length ? rows : [el('div', { class: 'muted', text: 'No replays yet.' })]));
    } catch (e) {
      list.innerHTML = '';
      list.append(el('div', { class: 'muted', text: `Failed to load: ${e?.message ?? e}` }));
    }
  }

  load();
  return el('div', { class: 'grid2' }, [root, list]);
}
