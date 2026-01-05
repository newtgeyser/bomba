import { MSG } from '../shared/protocol.js';
import { button, el } from './dom.js';
import { EnclosementDepth } from '../shared/sim/enclosement.js';
import { OFFICIAL_SCHEMES } from '../shared/scheme/library.js';
import { THEMES } from '../shared/scheme/themes.js';

export function createLobbyView({ state, net, onStartMatch, onLeave }) {
  const lobby = state.lobby;
  if (!lobby) return el('div', { class: 'panel', text: 'Joining...' });

  const meToken = state.reconnectToken;
  const me = lobby.players.find((p) => p.reconnectToken === meToken);
  const isHost = !!me?.isHost;

  const playersList = el(
    'div',
    { class: 'list' },
    lobby.players.map((p) =>
      el('div', { class: 'item' }, [
        el('div', {}, [
          el('div', { text: p.name }),
          el('div', { class: 'muted', text: p.isHost ? 'Host' : p.ready ? 'Ready' : 'Not ready' }),
        ]),
        el('div', { class: 'pill', text: p.color }),
      ]),
    ),
  );

  const readyBtn = button(me?.ready ? 'Unready' : 'Ready', () => {
    net.send({ t: MSG.LOBBY_READY, ready: !me?.ready });
  });

  const startBtn = button(
    'Start',
    () => {
      net.send({ t: MSG.LOBBY_START });
      onStartMatch();
    },
    { primary: true },
  );

  const timerSelect = el(
    'select',
    {
      onchange: (e) => {
        const v = e.target.value;
        net.send({ t: MSG.LOBBY_SETTINGS, patch: { timerSeconds: v === 'Infinite' ? 'Infinite' : Number(v) } });
      },
      disabled: !isHost,
    },
    [
      ...[60, 90, 120, 180, 240, 300, 600].map((s) => el('option', { value: String(s), text: `${s / 60} min` })),
      el('option', { value: 'Infinite', text: 'Infinite' }),
    ],
  );
  timerSelect.value = String(lobby.settings.timerSeconds);

  const encloseSelect = el(
    'select',
    {
      onchange: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { enclosementDepth: e.target.value } }),
      disabled: !isHost,
    },
    Object.values(EnclosementDepth).map((d) => el('option', { value: d, text: d })),
  );
  encloseSelect.value = lobby.settings.enclosementDepth;

  const modeSelect = el(
    'select',
    {
      onchange: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { mode: e.target.value } }),
      disabled: !isHost,
    },
    [el('option', { value: 'FFA', text: 'Free-for-all' }), el('option', { value: 'Teams', text: '2 Teams' })],
  );
  modeSelect.value = lobby.settings.mode ?? 'FFA';

  const variantSelect = el(
    'select',
    {
      onchange: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { variant: e.target.value } }),
      disabled: !isHost,
    },
    [el('option', { value: 'Enhanced', text: 'Enhanced (2s fuse)' }), el('option', { value: 'Classic', text: 'Classic (3s fuse)' })],
  );
  variantSelect.value = lobby.settings.variant ?? 'Enhanced';

  const schemeSelect = el(
    'select',
    {
      onchange: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { schemeId: e.target.value } }),
      disabled: !isHost,
    },
    OFFICIAL_SCHEMES.map((s) => el('option', { value: s.id, text: s.name })),
  );
  schemeSelect.value = lobby.settings.schemeId ?? 'default';

  const themeSelect = el(
    'select',
    {
      onchange: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { themeId: e.target.value } }),
      disabled: !isHost,
    },
    THEMES.map((t) => el('option', { value: t.id, text: t.name })),
  );
  themeSelect.value = lobby.settings.themeId ?? 'green-acres';

  const goldToggle = el('input', {
    type: 'checkbox',
    checked: lobby.settings.goldBomberman ?? false,
    onchange: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { goldBomberman: !!e.target.checked } }),
    disabled: !isHost,
  });

  const chatLog = el('pre', { text: '' });
  const chatWrap = el('div', { class: 'chatlog' }, [chatLog]);
  const chatInput = el('input', {
    placeholder: 'Chat (Enter to send)',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const text = chatInput.value;
      chatInput.value = '';
      net.send({ t: MSG.LOBBY_CHAT, text });
    },
  });

  // Simple event log hook.
  if (!state._chatUnsub) {
    state._chatUnsub = net.onMessage((msg) => {
      if (msg.t !== MSG.EVENT) return;
      if (msg.e?.t === 'chat') {
        chatLog.textContent += `${msg.e.from}: ${msg.e.text}\n`;
        chatWrap.scrollTop = chatWrap.scrollHeight;
      }
    });
  }

  const targetWins = el('input', {
    type: 'number',
    min: '1',
    max: '20',
    step: '1',
    value: String(lobby.settings.targetWins ?? 5),
    disabled: !isHost,
    oninput: (e) => net.send({ t: MSG.LOBBY_SETTINGS, patch: { targetWins: Number(e.target.value) } }),
  });

  return el('div', { class: 'grid2' }, [
    el('div', { class: 'panel' }, [
      el('h2', { text: `Lobby ${lobby.code}${lobby.ranked ? ' (Ranked)' : ''}` }),
      playersList,
      el('div', { class: 'row' }, [
        readyBtn,
        isHost ? startBtn : el('span', { class: 'muted', text: 'Waiting for host...' }),
        button('Leave', () => {
          net.send({ t: MSG.LOBBY_LEAVE });
          onLeave();
        }),
      ]),
    ]),
    el('div', { class: 'panel chat' }, [
      el('h3', { text: 'Settings + Chat' }),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Mode' }), modeSelect]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Variant' }), variantSelect]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Timer' }), timerSelect]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Enclosement' }), encloseSelect]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Scheme' }), schemeSelect]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Theme' }), themeSelect]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'First to' }), targetWins]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Gold Bomberman' }), goldToggle]),
      chatWrap,
      chatInput,
    ]),
  ]);
}
