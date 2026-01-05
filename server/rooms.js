import crypto from 'node:crypto';
import path from 'node:path';
import { TICK_HZ } from '../shared/constants.js';
import { MSG, TAUNTS, makeServerHello, safeParseJson } from '../shared/protocol.js';
import { EnclosementDepth } from '../shared/sim/enclosement.js';
import { ItemType } from '../shared/scheme/schema.js';
import { getOfficialScheme } from '../shared/scheme/library.js';
import { getTheme } from '../shared/scheme/themes.js';
import { applyItemPickup } from '../shared/sim/items.js';
import { makePlayer, makeWorld } from '../shared/sim/world.js';
import { encodeSnapshotBin } from '../shared/net/snapshot_bin.js';

function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function nowMs() {
  return Date.now();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function packButtons(input) {
  const i = input ?? {};
  return (
    (i.up ? 1 : 0) |
    (i.down ? 2 : 0) |
    (i.left ? 4 : 0) |
    (i.right ? 8 : 0) |
    (i.dropPressed ? 16 : 0) |
    (i.secondaryPressed ? 32 : 0)
  );
}

const COLOR_POOL = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f1c40f',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#ec87c0',
  '#95a5a6',
  '#34495e',
];

export function createRoomManager({ store, ratings }) {
  const clientsByToken = new Map(); // reconnectToken -> client
  const roomsByCode = new Map(); // code -> room
  const queue = {
    waiting: [], // reconnectToken[]
  };
  const gracePeriodSeconds = 10;
  const goldRoulettePool = [
    ItemType.BombUp,
    ItemType.FireUp,
    ItemType.FullFire,
    ItemType.SpeedUp,
    ItemType.SpeedDown,
    ItemType.Kick,
    ItemType.BoxingGlove,
    ItemType.PowerGlove,
    ItemType.RemoteControl,
    ItemType.RubberBomb,
    ItemType.LineBomb,
  ];

  function makeClient({ socket }) {
    const reconnectToken = randomId('rt_');
    const client = {
      id: randomId('c_'),
      socket,
      name: `Guest-${reconnectToken.slice(-4)}`,
      reconnectToken,
      roomCode: null,
      ready: false,
      connectedAt: nowMs(),
      lastSeenAt: nowMs(),
      protocol: 'json',
      input: null,
      disconnectedAt: null,
      reconnectDisabled: false,
    };
    clientsByToken.set(reconnectToken, client);
    return client;
  }

  function send(client, msg) {
    if (!client.socket) return;
    client.socket.sendText(JSON.stringify(msg));
  }

  function sendSnapshot(client, snap) {
    if (!client.socket) return;
    if (client.protocol === 'binary') {
      const payload = encodeSnapshotBin(snap);
      client.socket.sendBinary(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength));
      return;
    }
    send(client, { t: MSG.SNAPSHOT, code: client.roomCode, snap });
  }

  function broadcast(room, msg) {
    for (const tok of room.clientTokens) {
      const c = clientsByToken.get(tok);
      if (c?.socket) send(c, msg);
    }
  }

  function broadcastSnapshot(room, snap) {
    for (const tok of room.clientTokens) {
      const c = clientsByToken.get(tok);
      if (c?.socket) sendSnapshot(c, snap);
    }
  }

  function lobbyState(room) {
    const players = [...room.clientTokens]
      .map((tok) => clientsByToken.get(tok))
      .filter(Boolean)
      .map((c, idx) => ({
        name: c.name,
        reconnectToken: c.reconnectToken,
        ready: c.ready,
        connected: !!c.socket,
        isHost: c.reconnectToken === room.hostToken,
        color: room.colors.get(c.reconnectToken) ?? COLOR_POOL[idx % COLOR_POOL.length],
      }));

    return {
      t: MSG.LOBBY_STATE,
      code: room.code,
      status: room.status,
      ranked: room.ranked,
      hostToken: room.hostToken,
      players,
      settings: room.settings,
    };
  }

  function createRoom({ hostToken, quickPlay, ranked }) {
    let code = randomCode();
    while (roomsByCode.has(code)) code = randomCode();
    const room = {
      code,
      status: 'lobby', // lobby | playing
      createdAt: nowMs(),
      hostToken,
      quickPlay,
      ranked: !!ranked,
      clientTokens: new Set([hostToken]),
      colors: new Map(),
      settings: {
        mode: 'FFA',
        variant: 'Enhanced',
        timerSeconds: 180,
        enclosementDepth: EnclosementDepth.ALittle,
        schemeId: 'default',
        themeId: 'green-acres',
        goldBomberman: false,
        targetWins: 5,
      },
      world: null,
      gameLoop: null,
      lastMatch: null, // { scheme, theme, seed }
      goldCarryover: null, // { winnerToken, itemType }
      replay: null,
      match: null, // { baseSeed, targetWins, wins, roundIndex, scheme, theme, players }
      intermissionTicks: 0,
      inputDelayTicks: 4,
      snapshotEveryTicks: 3,
    };
    roomsByCode.set(code, room);
    assignColors(room);
    return room;
  }

  function assignColors(room) {
    const used = new Set(room.colors.values());
    let idx = 0;
    for (const tok of room.clientTokens) {
      if (room.colors.has(tok)) continue;
      while (idx < COLOR_POOL.length && used.has(COLOR_POOL[idx])) idx++;
      room.colors.set(tok, COLOR_POOL[idx % COLOR_POOL.length]);
      used.add(room.colors.get(tok));
      idx++;
    }
  }

  function joinRoom(client, room) {
    leaveRoom(client);
    room.clientTokens.add(client.reconnectToken);
    client.roomCode = room.code;
    client.ready = false;
    assignColors(room);
    broadcast(room, lobbyState(room));
  }

  function leaveRoom(client) {
    if (!client.roomCode) return;
    const room = roomsByCode.get(client.roomCode);
    client.roomCode = null;
    client.ready = false;
    if (!room) return;
    room.clientTokens.delete(client.reconnectToken);
    room.colors.delete(client.reconnectToken);

    // Host migration: first remaining.
    if (room.hostToken === client.reconnectToken) {
      room.hostToken = room.clientTokens.values().next().value ?? null;
    }

    if (room.clientTokens.size === 0) {
      stopRoom(room);
      roomsByCode.delete(room.code);
      return;
    }

    broadcast(room, lobbyState(room));
  }

  function stopRoom(room) {
    if (room.gameLoop) clearInterval(room.gameLoop);
    room.gameLoop = null;
    room.world = null;
    room.lastMatch = null;
    room.replay = null;
    room.match = null;
    room.intermissionTicks = 0;
    room.status = 'lobby';
    for (const tok of room.clientTokens) {
      const c = clientsByToken.get(tok);
      if (c) c.input = null;
    }
  }

  function startMatch(room) {
    if (room.status !== 'lobby') return;
    const tokens = [...room.clientTokens];
    const maxPlayers = room.ranked ? 2 : 10;
    if (tokens.length < 2) return;
    if (room.ranked && tokens.length !== 2) return;
    if (tokens.length > maxPlayers) return;

    for (const tok of tokens) {
      const c = clientsByToken.get(tok);
      if (!c) continue;
      if (tok !== room.hostToken && !c.ready) return;
    }

    const scheme = getOfficialScheme(room.settings.schemeId);
    const theme = getTheme(room.settings.themeId);
    const players = tokens.map((tok, i) => {
      const client = clientsByToken.get(tok);
      return {
        id: tok,
        name: client?.name ?? `Guest-${tok.slice(-4)}`,
        color: room.colors.get(tok) ?? COLOR_POOL[i % COLOR_POOL.length],
      };
    });

    room.status = 'playing';
    room.match = {
      baseSeed: crypto.randomBytes(4).readUInt32LE(0),
      targetWins: clamp(room.settings.targetWins ?? 5, 1, 20),
      wins: {}, // key -> count (player token or team)
      roundIndex: 0,
      scheme,
      theme,
      players,
    };
    room.intermissionTicks = 0;

    room.replay = {
      id: `rep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      createdAt: Date.now(),
      ranked: room.ranked,
      scheme,
      theme,
      settings: room.settings,
      baseSeed: room.match.baseSeed,
      players,
      goldCarryover: room.settings.goldBomberman ? room.goldCarryover : null,
      rounds: [],
      matchResult: null,
    };

    startRound(room);
    ensureGameLoop(room);
  }

  function startRound(room) {
    if (!room.match) return;
    room.match.roundIndex++;
    const roundSeed = (room.match.baseSeed ^ room.match.roundIndex) >>> 0;
    const timerSeconds =
      room.settings.timerSeconds === 'Infinite' ? Infinity : clamp(room.settings.timerSeconds, 60, 10 * 60);

    const scheme = room.match.scheme;
    const theme = room.match.theme;

    room.world = makeWorld({
      scheme,
      seed: roundSeed,
      settings: { roundSeconds: timerSeconds, enclosementDepth: room.settings.enclosementDepth },
    });

    // Spawn players (stable order from match start).
    const players = [];
    for (let i = 0; i < room.match.players.length; i++) {
      const meta = room.match.players[i];
      const spawn = scheme.spawns[i % scheme.spawns.length];
      const p = makePlayer({
        id: meta.id,
        name: meta.name,
        color: meta.color,
        spawnTx: spawn.x,
        spawnTy: spawn.y,
        scheme,
      });
      p.team = room.settings.mode === 'Teams' ? spawn.team : 'None';
      p.statsBase.fuseTicks = room.settings.variant === 'Classic' ? 180 : 120;
      p.stats.fuseTicks = p.statsBase.fuseTicks;
      room.world.addPlayer(p);
      players.push({ id: p.id, name: p.name, color: p.color, team: p.team });
    }

    // Gold Bomberman: apply carryover item to previous match winner, every round.
    if (room.settings.goldBomberman && room.goldCarryover && room.world) {
      const { winnerToken, itemType } = room.goldCarryover;
      const p = room.world.players.get(winnerToken);
      if (p) {
        p.isGold = true;
        applyItemPickup(room.world, p, itemType, { source: 'gold' });
        broadcast(room, { t: MSG.EVENT, e: { t: 'gold', winnerToken, item: itemType } });
      }
    }

    room.lastMatch = { scheme, theme, seed: roundSeed, players };

    if (room.replay) {
      room.replay.rounds.push({ seed: roundSeed, frames: [], result: null });
    }

    broadcast(room, {
      t: MSG.MATCH_START,
      code: room.code,
      scheme,
      theme,
      settings: room.settings,
      seed: roundSeed,
      players,
      roundIndex: room.match.roundIndex,
      wins: room.match.wins,
      targetWins: room.match.targetWins,
    });
  }

  function ensureGameLoop(room) {
    if (room.gameLoop) return;
    room.gameLoop = setInterval(() => {
      if (room.status !== 'playing' || !room.match) return;
      if (!room.world) {
        if (room.intermissionTicks > 0) room.intermissionTicks--;
        if (room.intermissionTicks === 0) startRound(room);
        return;
      }

      // Apply latest inputs.
      for (const tok of room.clientTokens) {
        const c = clientsByToken.get(tok);
        if (!c) continue;
        room.world.applyInput(tok, c.input ?? {});
      }

      // Record the server-applied inputs for replay (player order = MATCH_START.players).
      const currentRound = room.replay?.rounds?.[room.replay.rounds.length - 1];
      if (currentRound) {
        const frame = room.match.players.map((p) => packButtons(clientsByToken.get(p.id)?.input));
        currentRound.frames.push(frame);
      }

      room.world.step();

      // Free bomb slots when bombs detonate.
      for (const p of room.world.players.values()) {
        let count = 0;
        for (const b of room.world.bombs.values()) if (b.ownerId === p.id) count++;
        p.bombsPlaced = count;
      }

      if (room.world.tick % room.snapshotEveryTicks === 0) {
        broadcastSnapshot(room, room.world.getSnapshot());
      }

      const alive = [...room.world.players.values()].filter((p) => p.alive);
      const timeUp = room.world.roundTicksRemaining !== Infinity && room.world.roundTicksRemaining <= 0;
      const aliveTeams = new Set(alive.map((p) => p.team ?? 'None').filter((t) => t !== 'None'));

      let roundWinnerKey = null;
      if (room.settings.mode === 'Teams') {
        if (aliveTeams.size === 1) roundWinnerKey = aliveTeams.values().next().value;
      } else {
        if (alive.length === 1) roundWinnerKey = alive[0].id;
      }

      const shouldEndRound =
        timeUp ||
        roundWinnerKey !== null ||
        (room.settings.mode !== 'Teams' && alive.length <= 1) ||
        (room.settings.mode === 'Teams' && aliveTeams.size <= 1);
      if (!shouldEndRound) return;

      // Round result + scoring.
      if (currentRound) {
        currentRound.result = {
          endedAt: Date.now(),
          winnerKey: roundWinnerKey,
          aliveTokens: alive.map((p) => p.id),
        };
      }
      if (roundWinnerKey) {
        room.match.wins[roundWinnerKey] = (room.match.wins[roundWinnerKey] ?? 0) + 1;
      }

      broadcast(room, { t: MSG.EVENT, e: { t: 'round_end', winnerKey: roundWinnerKey, wins: room.match.wins } });

      const isMatchOver = roundWinnerKey && room.match.wins[roundWinnerKey] >= room.match.targetWins;
      if (!isMatchOver) {
        room.world = null;
        room.intermissionTicks = 3 * TICK_HZ;
        return;
      }

      // Match end.
      const matchWinnerKey = roundWinnerKey;
      if (room.settings.goldBomberman && room.settings.mode !== 'Teams' && typeof matchWinnerKey === 'string') {
        const itemType = goldRoulettePool[crypto.randomInt(0, goldRoulettePool.length)];
        room.goldCarryover = { winnerToken: matchWinnerKey, itemType };
      } else {
        room.goldCarryover = null;
      }

      if (room.ranked && room.settings.mode !== 'Teams' && room.match.players.length === 2 && ratings?.recordMatch) {
        const aToken = room.match.players[0].id;
        const bToken = room.match.players[1].id;
        ratings
          .recordMatch({ aToken, bToken, winnerToken: matchWinnerKey })
          .then((newRatings) => broadcast(room, { t: MSG.EVENT, e: { t: 'ratings', newRatings } }))
          .catch(() => {});
      }

      if (room.replay) {
        room.replay.matchResult = { endedAt: Date.now(), winnerKey: matchWinnerKey, wins: room.match.wins };
        const fp = path.join(store.dirs.replays, `${room.replay.id}.json`);
        store.writeJson(fp, room.replay).catch(() => {});
      }

      broadcast(room, { t: MSG.MATCH_END, code: room.code, winnerKey: matchWinnerKey, wins: room.match.wins });
      stopRoom(room);
      broadcast(room, lobbyState(room));
    }, 1000 / TICK_HZ);
  }

  function joinQuickPlay(client) {
    return joinQuickPlayWithOptions(client, { ranked: false });
  }

  function joinQuickPlayWithOptions(client, { ranked }) {
    const maxPlayers = ranked ? 2 : 10;
    const open = [...roomsByCode.values()].find(
      (r) => r.status === 'lobby' && r.quickPlay && r.ranked === ranked && r.clientTokens.size < maxPlayers,
    );
    if (open) {
      joinRoom(client, open);
      client.ready = true;
      broadcast(open, lobbyState(open));
      if (open.clientTokens.size >= (ranked ? 2 : 2)) startMatch(open);
      return;
    }
    const room = createRoom({ hostToken: client.reconnectToken, quickPlay: true, ranked });
    joinRoom(client, room);
    client.ready = true;
    broadcast(room, lobbyState(room));
  }

  function onMessage(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.t !== 'string') return;

    if (msg.t === MSG.HELLO) {
      if (typeof msg.name === 'string' && msg.name.trim()) client.name = msg.name.trim().slice(0, 24);
      if (msg.proto === 'binary') client.protocol = 'binary';
      ratings?.setName?.(client.reconnectToken, client.name);
      send(client, { t: MSG.WELCOME, clientId: client.id, reconnectToken: client.reconnectToken, server: makeServerHello() });

      const room = client.roomCode ? roomsByCode.get(client.roomCode) : null;
      if (room) {
        send(client, lobbyState(room));
        if (room.status === 'playing' && room.world) {
          const scheme = room.lastMatch?.scheme ?? getOfficialScheme(room.settings.schemeId);
          const theme = room.lastMatch?.theme ?? getTheme(room.settings.themeId);
          send(client, {
            t: MSG.MATCH_START,
            code: room.code,
            scheme,
            theme,
            settings: room.settings,
            seed: room.world.seed,
            players: room.lastMatch?.players ?? [],
            roundIndex: room.match?.roundIndex ?? null,
            wins: room.match?.wins ?? null,
            targetWins: room.match?.targetWins ?? null,
          });
          sendSnapshot(client, room.world.getSnapshot());
        }
      }
      return;
    }

    if (msg.t === MSG.SET_NAME) {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        client.name = msg.name.trim().slice(0, 24);
        ratings?.setName?.(client.reconnectToken, client.name);
      }
      const room = client.roomCode ? roomsByCode.get(client.roomCode) : null;
      if (room) {
        if (room.status === 'playing' && room.world) {
          const p = room.world.players.get(client.reconnectToken);
          if (p) p.name = client.name;
        }
        broadcast(room, lobbyState(room));
      }
      return;
    }

    if (msg.t === MSG.QUEUE_JOIN) {
      joinQuickPlayWithOptions(client, { ranked: !!msg.ranked });
      return;
    }

    if (msg.t === MSG.LOBBY_CREATE) {
      const room = createRoom({ hostToken: client.reconnectToken, quickPlay: false, ranked: false });
      joinRoom(client, room);
      send(client, lobbyState(room));
      return;
    }

    if (msg.t === MSG.LOBBY_JOIN) {
      if (typeof msg.code !== 'string') return;
      const room = roomsByCode.get(msg.code.toUpperCase());
      if (!room) {
        send(client, { t: MSG.ERROR, message: 'Lobby not found' });
        return;
      }
      if (room.status !== 'lobby') {
        send(client, { t: MSG.ERROR, message: 'Lobby already started' });
        return;
      }
      if (room.clientTokens.size >= 10) {
        send(client, { t: MSG.ERROR, message: 'Lobby full' });
        return;
      }
      joinRoom(client, room);
      return;
    }

    if (msg.t === MSG.LOBBY_LEAVE) {
      leaveRoom(client);
      return;
    }

    const room = client.roomCode ? roomsByCode.get(client.roomCode) : null;
    if (!room) return;

    if (msg.t === MSG.LOBBY_READY) {
      client.ready = !!msg.ready;
      broadcast(room, lobbyState(room));
      if (room.quickPlay && room.clientTokens.size >= 2) startMatch(room);
      return;
    }

    if (msg.t === MSG.LOBBY_CHAT) {
      const text = typeof msg.text === 'string' ? msg.text.slice(0, 200) : '';
      if (!text.trim()) return;
      broadcast(room, { t: MSG.EVENT, e: { t: 'chat', from: client.name, text } });
      return;
    }

    if (msg.t === MSG.LOBBY_SETTINGS) {
      if (client.reconnectToken !== room.hostToken) return;
      if (room.ranked) return;
      const patch = msg.patch ?? {};
      if (typeof patch.timerSeconds === 'number' || patch.timerSeconds === 'Infinite') {
        room.settings.timerSeconds = patch.timerSeconds;
      }
      if (typeof patch.enclosementDepth === 'string') {
        room.settings.enclosementDepth = patch.enclosementDepth;
      }
      if (typeof patch.schemeId === 'string') {
        room.settings.schemeId = patch.schemeId;
      }
      if (typeof patch.themeId === 'string') {
        room.settings.themeId = patch.themeId;
      }
      if (patch.variant === 'Classic' || patch.variant === 'Enhanced') {
        room.settings.variant = patch.variant;
      }
      if (typeof patch.goldBomberman === 'boolean') {
        room.settings.goldBomberman = patch.goldBomberman;
      }
      if (patch.mode === 'FFA' || patch.mode === 'Teams') {
        room.settings.mode = patch.mode;
      }
      if (Number.isInteger(patch.targetWins) && patch.targetWins >= 1 && patch.targetWins <= 20) {
        room.settings.targetWins = patch.targetWins;
      }
      broadcast(room, lobbyState(room));
      return;
    }

    if (msg.t === MSG.LOBBY_START) {
      if (client.reconnectToken !== room.hostToken) return;
      startMatch(room);
      return;
    }

    if (msg.t === MSG.INPUT) {
      if (room.status !== 'playing') return;
      // Keep latest input; client is responsible for edge detection.
      const buttons = msg.buttons ?? {};
      client.input = {
        up: !!buttons.up,
        down: !!buttons.down,
        left: !!buttons.left,
        right: !!buttons.right,
        dropPressed: !!buttons.dropPressed,
        secondaryPressed: !!buttons.secondaryPressed,
      };
      return;
    }

    if (msg.t === MSG.TAUNT) {
      // Rate limit: max 1 taunt per 2 seconds
      const now = nowMs();
      if (client.lastTauntAt && now - client.lastTauntAt < 2000) return;
      client.lastTauntAt = now;

      const idx = Number.isInteger(msg.idx) ? msg.idx : 0;
      const tauntText = TAUNTS[idx % TAUNTS.length] ?? TAUNTS[0];
      const player = room.world?.players?.get(client.reconnectToken);

      // Only allow taunts if player is alive (or host allows dead taunts)
      if (room.status === 'playing' && (!player?.alive)) return;

      broadcast(room, {
        t: MSG.EVENT,
        e: {
          t: 'taunt',
          from: client.name,
          fromId: client.reconnectToken,
          text: tauntText,
          idx,
        },
      });
      return;
    }
  }

  function tryReconnect({ socket, reconnectToken }) {
    const old = clientsByToken.get(reconnectToken);
    if (!old) return null;
    if (old.socket) return null; // already connected
    if (old.reconnectDisabled) return null;
    old.socket = socket;
    old.lastSeenAt = nowMs();
    old.disconnectedAt = null;
    return old;
  }

  function onSocketConnection(socket) {
    let client = null;

    socket.on('message', (payload) => {
      if (Buffer.isBuffer(payload)) return; // binary messages added later
      const parsed = safeParseJson(payload);
      if (!parsed.ok) return;

      const msg = parsed.value;
      if (!client && msg.t === MSG.HELLO && typeof msg.reconnectToken === 'string') {
        client = tryReconnect({ socket, reconnectToken: msg.reconnectToken }) ?? makeClient({ socket });
      }
      if (!client) client = makeClient({ socket });

      client.lastSeenAt = nowMs();
      onMessage(client, msg);
    });

    socket.on('close', () => {
      if (!client) return;
      client.socket = null;
      client.disconnectedAt = nowMs();
      const room = client.roomCode ? roomsByCode.get(client.roomCode) : null;
      if (!room) return;
      // In lobby we remove immediately; in-match we keep the avatar for gracePeriod.
      if (room.status === 'lobby') leaveRoom(client);
    });

    // In case the client sends nothing, allow creation after first message.
  }

  // Grace-period disconnect handling.
  setInterval(() => {
    const now = nowMs();
    for (const client of clientsByToken.values()) {
      if (!client.disconnectedAt) continue;
      if (now - client.disconnectedAt < gracePeriodSeconds * 1000) continue;
      const room = client.roomCode ? roomsByCode.get(client.roomCode) : null;
      if (!room) continue;
      if (room.status === 'playing' && room.world) {
        const p = room.world.players.get(client.reconnectToken);
        if (p?.alive) {
          p.alive = false;
          p.deathReason = 'disconnect';
          room.world.events.push({ t: 'player_dead', id: p.id, reason: 'disconnect' });
        }
        client.reconnectDisabled = true;
      } else {
        leaveRoom(client);
      }
    }
  }, 1000);

  return { onSocketConnection };
}
