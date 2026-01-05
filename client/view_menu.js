import { MSG } from '../shared/protocol.js';
import { GAME_VERSION } from '../shared/constants.js';
import { button, el } from './dom.js';

export function createMenuView({ state, net, onJoinedLobby, onOpenMaps, onOpenEditor, onOpenReplays, onOpenRatings, onOpenSettings }) {
  const nameInput = el('input', {
    value: state.name,
    placeholder: 'Display name (optional)',
    oninput: (e) => {
      state.name = e.target.value;
      localStorage.setItem('playerName', state.name);
      net.send({ t: MSG.SET_NAME, name: state.name });
    },
  });

  const joinCode = el('input', { placeholder: 'Lobby code (e.g. ABC123)' });

  const binaryToggle = el('input', {
    type: 'checkbox',
    checked: state.preferBinarySnapshots,
    onchange: (e) => {
      state.preferBinarySnapshots = !!e.target.checked;
      localStorage.setItem('preferBinarySnapshots', state.preferBinarySnapshots ? '1' : '0');
      alert('Reload the page to renegotiate snapshot protocol.');
    },
  });

  const actions = el('div', { class: 'row' }, [
    button(
      'Quick Play',
      () => {
        net.send({ t: MSG.QUEUE_JOIN, ranked: false });
        onJoinedLobby();
      },
      { primary: true },
    ),
    button(
      'Ranked Quick Play (2p)',
      () => {
        net.send({ t: MSG.QUEUE_JOIN, ranked: true });
        onJoinedLobby();
      },
      { primary: true },
    ),
    button(
      'Create Lobby',
      () => {
        net.send({ t: MSG.LOBBY_CREATE });
        onJoinedLobby();
      },
      { primary: true },
    ),
    button('Join Lobby', () => {
      const code = joinCode.value.trim().toUpperCase();
      if (!code) return;
      net.send({ t: MSG.LOBBY_JOIN, code });
      onJoinedLobby();
    }),
  ]);

  const extras = el('div', { class: 'row' }, [
    button('Map Browser', () => onOpenMaps?.()),
    button('Map Editor', () => onOpenEditor?.()),
    button('Replays', () => onOpenReplays?.()),
    button('Leaderboard', () => onOpenRatings?.()),
    button('Settings', () => onOpenSettings?.()),
  ]);

  return el('div', { class: 'panel' }, [
    el('h1', { text: 'Atomic Bomberman Online' }),
    el('div', { class: 'muted', text: `v${GAME_VERSION} — Server-authoritative multiplayer with full Atomic items.` }),
    el('div', { class: 'row' }, [nameInput, joinCode]),
    el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Binary snapshots' }), binaryToggle]),
    actions,
    extras,
    el('p', {
      class: 'muted',
      text: 'Controls: WASD/Arrows move • Space bomb/pickup • Enter/Shift secondary • T taunt • Gamepad supported',
    }),
  ]);
}
