import { MSG } from '../shared/protocol.js';
import { createNetClient } from './net.js';
import { createGameView } from './view_game.js';
import { createLobbyView } from './view_lobby.js';
import { createMapsView } from './view_maps.js';
import { createMenuView } from './view_menu.js';
import { createEditorView } from './view_editor.js';
import { createReplaysView } from './view_replays.js';
import { createRatingsView } from './view_ratings.js';
import { createSettingsView } from './view_settings.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const net = createNetClient({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
});

const state = {
  screen: 'menu', // menu | lobby | game | maps | editor | settings
  lobby: null,
  game: null,
  maps: null,
  editor: null,
  replay: null,
  reconnectToken: localStorage.getItem('reconnectToken') ?? null,
  name: localStorage.getItem('playerName') ?? '',
  preferBinarySnapshots: localStorage.getItem('preferBinarySnapshots') === '1',
};

function setScreen(screen) {
  state.screen = screen;
  render();
}

function render() {
  root.innerHTML = '';
  if (state.screen === 'menu') {
    root.append(
      createMenuView({
        state,
        net,
        onJoinedLobby: () => setScreen('lobby'),
        onOpenMaps: () => setScreen('maps'),
        onOpenEditor: () => {
          state.editor = null;
          setScreen('editor');
        },
        onOpenReplays: () => setScreen('replays'),
        onOpenRatings: () => setScreen('ratings'),
        onOpenSettings: () => setScreen('settings'),
      }),
    );
    return;
  }
  if (state.screen === 'settings') {
    root.append(createSettingsView({ state, onBack: () => setScreen('menu') }));
    return;
  }
  if (state.screen === 'lobby') {
    root.append(
      createLobbyView({
        state,
        net,
        onStartMatch: () => setScreen('game'),
        onLeave: () => setScreen('menu'),
      }),
    );
    return;
  }
  if (state.screen === 'game') {
    root.append(
      createGameView({
        state,
        net,
        onExitToLobby: () => setScreen('lobby'),
      }),
    );
    return;
  }
  if (state.screen === 'maps') {
    root.append(
      createMapsView({
        state,
        onBack: () => setScreen('menu'),
        onOpenInEditor: (scheme, meta) => {
          state.editor = { scheme, meta };
          setScreen('editor');
        },
      }),
    );
    return;
  }
  if (state.screen === 'editor') {
    root.append(
      createEditorView({
        state,
        initial: state.editor,
        onBack: () => setScreen('menu'),
      }),
    );
    return;
  }
  if (state.screen === 'replays') {
    root.append(
      createReplaysView({
        state,
        onBack: () => setScreen('menu'),
        onPlay: (replay) => {
          state.replay = replay;
          setScreen('replay');
        },
      }),
    );
    return;
  }
  if (state.screen === 'replay') {
    root.append(
      createReplaysView({
        state,
        replay: state.replay,
        onBack: () => setScreen('replays'),
      }),
    );
    return;
  }
  if (state.screen === 'ratings') {
    root.append(createRatingsView({ onBack: () => setScreen('menu') }));
    return;
  }
}

net.onMessage((msg) => {
  if (msg.t === MSG.ERROR) {
    alert(msg.message ?? 'Server error');
    setScreen('menu');
    return;
  }
  if (msg.t === MSG.WELCOME) {
    localStorage.setItem('reconnectToken', msg.reconnectToken);
    state.reconnectToken = msg.reconnectToken;
    return;
  }
  if (msg.t === MSG.LOBBY_STATE) {
    state.lobby = msg;
    if (state.screen !== 'lobby') setScreen('lobby');
    return;
  }
  if (msg.t === MSG.MATCH_START) {
    state.game = {
      snap: null,
      scheme: msg.scheme,
      theme: msg.theme,
      settings: msg.settings,
      roundIndex: msg.roundIndex ?? null,
      wins: msg.wins ?? null,
      targetWins: msg.targetWins ?? null,
    };
    if (state.screen !== 'game') setScreen('game');
    return;
  }
  if (msg.t === MSG.SNAPSHOT) {
    if (!state.game) state.game = {};
    state.game.snap = msg.snap;
    return;
  }
  if (msg.t === MSG.EVENT) {
    if (msg.e?.t === 'round_end' && state.game) {
      state.game.wins = msg.e.wins ?? state.game.wins;
      return;
    }
    return;
  }
  if (msg.t === MSG.MATCH_END) {
    // Back to lobby for now.
    setScreen('lobby');
    return;
  }
});

net.connect().then(() => {
  net.send({
    t: MSG.HELLO,
    name: state.name || undefined,
    reconnectToken: state.reconnectToken || undefined,
    proto: state.preferBinarySnapshots ? 'binary' : undefined,
  });
});

async function handleHash() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);
  const mapId = params.get('map');
  if (!mapId) return;
  try {
    const res = await fetch(`/api/schemes/${encodeURIComponent(mapId)}`);
    if (!res.ok) return;
    const json = await res.json();
    if (!json.ok) return;
    state.editor = { scheme: json.scheme, meta: { ...(json.meta ?? {}), visibility: json.meta?.visibility ?? 'Community' }, readOnly: true };
    setScreen('editor');
  } catch {
    // ignore
  }
}
window.addEventListener('hashchange', () => handleHash());
handleHash();

render();
