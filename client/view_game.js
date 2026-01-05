import { MSG, TAUNTS } from '../shared/protocol.js';
import { button, el } from './dom.js';
import { createInput } from './ws_input.js';
import { drawFrame } from './render.js';

export function createGameView({ state, net, onExitToLobby }) {
  const canvas = el('canvas', { width: 900, height: 660 });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Missing 2d context');

  const input = createInput();
  let followId = null;
  let showScoreboard = true;
  let roundEndInfo = null; // { winnerKey, timestamp }
  const activeTaunts = []; // { from, text, expiresAt }

  let lastButtons = null;
  function tickSend() {
    const buttons = input.sample();
    const dropPressed = !!buttons.drop && !lastButtons?.drop;
    const secondaryPressed = !!buttons.secondary && !lastButtons?.secondary;
    lastButtons = buttons;
    net.send({
      t: MSG.INPUT,
      buttons: {
        up: buttons.up,
        down: buttons.down,
        left: buttons.left,
        right: buttons.right,
        dropPressed,
        secondaryPressed,
      },
    });
  }

  const sendTimer = setInterval(tickSend, 1000 / 30);

  const scoreboard = el('div', { class: 'list' }, []);
  const scoreboardHint = el('div', { class: 'muted', text: 'Tab toggles scoreboard • Click player to follow' });
  const matchInfo = el('div', { class: 'muted', text: '' });
  const myStatsDiv = el('div', { class: 'my-stats' }, []);
  let lastScoreTick = -1;

  function refreshScoreboard(snap) {
    if (snap.tick === lastScoreTick) return;
    lastScoreTick = snap.tick;
    scoreboard.style.display = showScoreboard ? '' : 'none';
    scoreboardHint.style.display = showScoreboard ? '' : 'none';

    const me = snap.players.find((p) => p.id === state.reconnectToken);
    if (me && !me.alive && !followId) {
      followId = snap.players.find((p) => p.alive)?.id ?? null;
    }
    if (followId && !snap.players.find((p) => p.id === followId && p.alive)) {
      followId = snap.players.find((p) => p.alive)?.id ?? null;
    }

    // Update my stats display
    myStatsDiv.innerHTML = '';
    if (me) {
      const stats = me.stats ?? me.statsBase ?? {};
      const ability = me.ability ?? {};
      const abilities = [];
      if (ability.kick) abilities.push('Kick');
      if (ability.boxing) abilities.push('Punch');
      if (ability.hand) abilities.push('Hand');
      if (ability.trigger) abilities.push('Trigger');
      if (ability.jelly) abilities.push('Jelly');
      if (ability.spooge) abilities.push('Spooge');

      myStatsDiv.append(
        el('div', { class: 'stats-row' }, [
          el('span', {
            class: 'stat',
            text: `💣 ${stats.bombCap ?? 1}`,
            title: 'Bomb capacity: max bombs you can have active at once.',
          }),
          el('span', {
            class: 'stat',
            text: `🔥 ${stats.flame ?? 1}${ability.fullFire ? '+' : ''}`,
            title: 'Flame length: how far your bomb explosions reach (in tiles).',
          }),
          el('span', {
            class: 'stat',
            text: `⚡ ${stats.speed ?? 5}`,
            title: 'Speed: your movement speed tier.',
          }),
        ])
      );
      if (abilities.length > 0) {
        myStatsDiv.append(el('div', { class: 'muted', text: abilities.join(' • ') }));
      }
      const diseases = me.diseases ?? [];
      if (diseases.length > 0) {
        myStatsDiv.append(el('div', { class: 'disease-warning', text: `☠ ${diseases.join(', ')}` }));
      }
      if (!me.alive) {
        myStatsDiv.append(el('div', { class: 'muted', text: '💀 You are out - spectating' }));
      }
    }

    // Update scoreboard
    scoreboard.innerHTML = '';
    const sortedPlayers = [...snap.players].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return 0;
    });

    for (const p of sortedPlayers) {
      const teamBadge = p.team && p.team !== 'None' ? ` [${p.team}]` : '';
      const label = `${p.name}${teamBadge}`;
      const statusText = p.alive ? '●' : '○';
      const statusClass = p.alive ? 'alive' : 'dead';
      const isMe = p.id === state.reconnectToken;
      const isFollowing = p.id === followId;

      const row = el('div', { class: `item ${isMe ? 'me' : ''} ${isFollowing ? 'following' : ''}` }, [
        el('div', {}, [
          el('span', { class: `status ${statusClass}`, text: statusText }),
          el('span', { text: ` ${label}` }),
          p.isGold ? el('span', { class: 'gold-badge', text: ' 👑' }) : null,
        ].filter(Boolean)),
        el('div', { class: 'player-stats-mini' }, [
          el('span', { text: `💣${p.stats?.bombCap ?? 1}` }),
          el('span', { text: `🔥${p.stats?.flame ?? 1}` }),
        ]),
      ]);
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        followId = p.id;
      });
      scoreboard.append(row);
    }

    // Match info
    const round = state.game?.roundIndex;
    const target = state.game?.targetWins;
    const wins = state.game?.wins;
    if (round && target) {
      let winsText = '';
      if (wins && Object.keys(wins).length > 0) {
        winsText = Object.entries(wins)
          .map(([k, v]) => {
            const player = snap.players.find(p => p.id === k);
            const name = player?.name?.slice(0, 6) ?? k.slice(0, 4);
            return `${name}: ${v}`;
          })
          .join(' | ');
      }
      matchInfo.textContent = `Round ${round} of ${target}${winsText ? ` • ${winsText}` : ''}`;
    } else {
      matchInfo.textContent = '';
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      showScoreboard = !showScoreboard;
    }
  }
  window.addEventListener('keydown', onKeyDown);

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const snap = state.game?.snap;
    if (!snap) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#9aa4b2';
      ctx.font = '16px ui-sans-serif';
      ctx.fillText('Waiting for server...', 20, 30);
      return;
    }
    refreshScoreboard(snap);
    drawFrame(ctx, canvas.width, canvas.height, snap, state.game?.theme, followId, state.reconnectToken);

    // Draw round end overlay if applicable
    if (roundEndInfo && Date.now() - roundEndInfo.timestamp < 3000) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 24px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const winnerPlayer = snap.players.find(p => p.id === roundEndInfo.winnerKey);
      const winnerName = winnerPlayer?.name ?? roundEndInfo.winnerKey ?? 'Draw';
      ctx.fillText(`🏆 ${winnerName} wins the round!`, canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'left';
    }

    // Draw active taunts
    const now = Date.now();
    const validTaunts = activeTaunts.filter(t => t.expiresAt > now);
    activeTaunts.length = 0;
    activeTaunts.push(...validTaunts);

    if (activeTaunts.length > 0) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      let y = canvas.height - 10;
      for (let i = activeTaunts.length - 1; i >= 0; i--) {
        const t = activeTaunts[i];
        const alpha = Math.min(1, (t.expiresAt - now) / 1000);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        ctx.font = 'bold 14px ui-sans-serif';
        ctx.fillText(`${t.from}: "${t.text}"`, canvas.width - 10, y);
        y -= 20;
      }
      ctx.textAlign = 'left';
    }
  }
  frame();

  const unsub = net.onMessage((msg) => {
    if (msg.t === MSG.MATCH_END) {
      cleanup();
      onExitToLobby();
    }
    if (msg.t === MSG.EVENT && msg.e?.t === 'round_end') {
      roundEndInfo = { winnerKey: msg.e.winnerKey, timestamp: Date.now() };
      state.game.wins = msg.e.wins ?? state.game?.wins;
    }
    if (msg.t === MSG.EVENT && msg.e?.t === 'taunt') {
      activeTaunts.push({
        from: msg.e.from,
        fromId: msg.e.fromId,
        text: msg.e.text,
        expiresAt: Date.now() + 3000,
      });
      // Keep only recent taunts
      while (activeTaunts.length > 5) activeTaunts.shift();
    }
  });

  function cleanup() {
    clearInterval(sendTimer);
    cancelAnimationFrame(raf);
    unsub();
    window.removeEventListener('keydown', onKeyDown);
    input.dispose?.();
  }

  // Taunt buttons
  const tauntGrid = el('div', { class: 'taunt-grid' }, []);
  TAUNTS.forEach((text, idx) => {
    const btn = button(text.slice(0, 12) + (text.length > 12 ? '…' : ''), () => {
      net.send({ t: MSG.TAUNT, idx });
    });
    btn.classList.add('taunt-btn');
    btn.title = text;
    tauntGrid.append(btn);
  });

  const hud = el('div', { class: 'panel game-hud' }, [
    el('h2', { text: 'Match' }),
    el('div', { class: 'controls-hint muted', text: 'WASD/Arrows: Move • Space: Bomb/Pickup • Enter/Shift: Secondary • T: Taunt' }),
    el('h3', { text: 'Your Stats' }),
    myStatsDiv,
    el('h3', { text: 'Scoreboard' }),
    matchInfo,
    scoreboardHint,
    scoreboard,
    el('h3', { text: 'Taunts' }),
    tauntGrid,
    button('Exit to Lobby', () => {
      cleanup();
      onExitToLobby();
    }),
  ]);

  return el('div', { class: 'grid2' }, [el('div', { class: 'panel' }, [canvas]), hud]);
}
