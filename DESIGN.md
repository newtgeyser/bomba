# Atomic Bomberman Online (ABO) — Design Document

This repo implements a modernized, in-browser, online multiplayer reimagining of *Atomic Bomberman* based on `SPEC.md`.

Goals for v1 in this repo:
- Fully local-dev runnable (single Node process hosting static client + authoritative game server).
- Deterministic, server-authoritative simulation with fixed ticks.
- “Atomic feel” mechanics (fast fuse, fast movement, chaotic items, enclosement).
- A simple but extensible architecture that can be split into services later.

Non-goals for this repo (but left “future hooks”):
- Production matchmaking infrastructure, autoscaling, multi-region deployment.
- Complex account/persistence; we ship a file-backed local store.
- Asset-heavy audio/visual polish; we ship simple vector/canvas art and text taunts.

---

## Architecture overview

### Runtime components

1. **Client (browser)**
   - Renders arena + entities via Canvas 2D.
   - Captures inputs and sends them to the server (WebSocket).
   - Interpolates between server snapshots; optional local prediction for the local player.
   - Hosts UI “screens”: Main Menu, Lobby, Game, Map Editor, Map Browser, Replay Viewer.

2. **Server (Node.js)**
   - Serves static assets (`/client/*`, `/shared/*`) over HTTP.
   - Hosts a **WebSocket** endpoint (`/ws`) for lobby + gameplay traffic.
   - Runs **authoritative simulation** at fixed tick (default 60 Hz).
   - Provides “persistence” via local JSON files for:
     - published schemes
     - reports
     - ratings
     - replays

3. **Shared (isomorphic JS)**
   - Pure logic modules shared by server and client:
     - scheme data model + validation
     - deterministic RNG
     - simulation primitives (bombs, explosions, items, diseases, enclosement)
     - network message schemas (and binary codec)

### Why no external dependencies
This codebase intentionally avoids third-party packages to keep the repo self-contained and runnable without network access. That implies:
- A minimal WebSocket server implementation (RFC 6455 subset sufficient for browsers).
- `node:test` for tests.

---

## Core simulation model

### Tick and time
- Fixed tick simulation: `TICK_HZ = 60`.
- All time-based mechanics are **integer ticks** (fuse, explosion lifetime, disease TTL, enclosement cadence).

### Determinism
- Server seeds a deterministic PRNG per match (seed stored in replay header).
- All RNG-driven decisions occur only on the server:
  - item reveals
  - Select Item result
  - disease roll
  - Gold Bomberman roulette

### Spatial model
- Arena is a tile grid (default 15x11).
- Player positions are fixed-point integers in “subtiles” for smooth movement.
- Collision uses a circular player hurtbox and tile/bomb occupancy checks.
- Bomb placement uses the player’s current tile.

### Entities
- `Player`: id, name, team, alive, stats (speed/bombs/flame), inventory flags, diseases, input state.
- `Bomb`: tile position, owner, fuse ticks, flame length, movement state (sliding/thrown/bouncy), “trigger” mode, “armed” vs carried.
- `Explosion`: list of affected tiles with lifetime ticks.
- `ItemDrop`: tile position, item type, (optional) Select Item cycle state.
- `ClosingBlock`: hard-block-like tile placed by enclosement.

### Rounds and matches
- A **match** is a series of **rounds**.
- Round ends when win condition met (FFA last alive / teams last team alive).
- Match ends when target reached (default: first to N round wins).
- “Gold Bomberman” is applied at match boundaries.

---

## Networking model

### Transport
- Browser `WebSocket` to Node server endpoint `/ws`.
- Messages are either:
  - **JSON** (default, easiest to debug), or
  - **Binary** (phase 4 optimization for snapshots).

### Latency strategy
- Server uses `inputDelayTicks` (default 4) and processes inputs at `tick + inputDelayTicks`.
- Client timestamps inputs with the local tick estimate.
- Client renders at “serverTick - interpolationBackTicks” for smoothness.

### Authoritative rules
Server validates:
- speed caps and disease overrides
- bomb capacity and placement rules
- illegal traversal (tile collision)
- trigger detonation order
- rate limits: chat/taunts

### Reconnection
- On connect, client supplies `reconnectToken` if available.
- Server holds disconnected players for `gracePeriodSeconds` (default 10).
- Reconnected player resumes; otherwise is eliminated/removed.

---

## Data: schemes and themes

### Schemes
- Stored as JSON files in `data/schemes/`.
- Validated on load/save.
- The server distributes scheme content to clients in lobby -> match start.

### Themes
- Lightweight in v1: palette + tile styling parameters used by the renderer.
- Theme selection is part of lobby settings; scheme + theme compose into the arena.

---

## UX and screens (v1)

- **Main Menu**: Quick Play, Create Lobby, Join Lobby, Map Editor, Map Browser, Settings.
- **Lobby**: player list, chat, ready toggles, host settings, start.
- **In Game**: HUD + scoreboard overlay; spectating after death.
- **Map Editor**: edit tiles/spawns/item rules; save local + publish.
- **Map Browser**: browse published maps; report.
- **Replay Viewer**: list/load saved replays; play/pause/seek by tick.

---

## Phases (implementation plan)

### Phase 1 — Online core (must ship)
Deliverable: playable online core loop with basic items and enclosement.
- Server: rooms/lobbies, authoritative simulation, snapshots, reconnection.
- Client: lobby UI, game view + HUD.
- Gameplay: movement, bombs/explosions, timer, enclosement.
- Items: Bomb Up, Fire Up, Speed Up, Kick.
- Tests: bomb rules + kick/stop + enclosement ring order + multiplayer snapshot sanity.

### Phase 2 — Atomic identity
Deliverable: full Atomic item interactions + schemes/themes + Gold Bomberman.
- Items: Trigger, Hand, Boxing Glove, Jelly, Spooge, Random, Skull/Ebola, Full Fire, Speed Down (roulette-only).
- Disease mini-system with transfer/cure rules.
- Conflict resolution per spec.
- Schemes: load/choose scheme JSON; theme selection in lobby.
- Gold Bomberman roulette and carryover.
- Tests: all item conflicts, diseases, detonation order, carry/throw, bounce, spooge.

### Phase 3 — Editor + community
Deliverable: in-browser editor + basic sharing.
- Editor: tiles, spawns, teams, item density/rules; validation; save.
- Publishing: server stores scheme + metadata (official/community/unlisted).
- Map browser: list/filter; reporting endpoint.
- Tests: scheme validation rules; publish/report file store.

### Phase 4 — Competitive polish
Deliverable: replay + ranked queue + protocol optimization.
- Ranked queue: rating (simple Elo), season reset hooks.
- Replays: server records match seed + per-tick inputs; client can replay offline.
- Spectator UX: follow a living player; scoreboard improvements.
- Binary snapshots: optional negotiated protocol; keep JSON fallback.
- Tests: replay determinism on sample inputs; binary codec round-trip.

---

## Directory layout

- `client/` browser app (static files)
- `server/` node server (HTTP + WebSocket + match runner)
- `shared/` isomorphic modules (simulation, codecs, scheme model)
- `data/` local persistence (schemes, reports, ratings, replays) — created at runtime
- `docs/` post-phase notes
- `test/` integration tests (in addition to unit tests under `shared/`)

