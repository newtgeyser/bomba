# Phase 1 — Online Core (Implemented)

This phase delivers a playable, server-authoritative core loop with basic lobby + quick play, core bomb rules, timer + enclosement, and a minimal item subset.

## What’s implemented

### Server
- Single-process Node server:
  - HTTP static hosting for `client/` and `shared/`
  - WebSocket endpoint `/ws` (self-contained RFC6455 subset implementation)
- Lobby system:
  - Create lobby + join by code
  - Quick Play (auto-joins an open quick-play lobby or creates one)
  - Ready / host start
  - Simple chat events
- Match runner:
  - Fixed tick loop at 60Hz
  - Server-authoritative simulation and snapshots
  - Basic reconnect support (token-based; see “Known gaps”)

### Client
- Simple SPA-style UI:
  - Main menu (Quick Play / Create / Join)
  - Lobby (player list, settings, chat)
  - In-game view (Canvas renderer + HUD)
- Keyboard controls:
  - Move: WASD / Arrow Keys
  - Drop bomb: Space
  - Secondary: Enter (currently stops owned moving bombs)

### Gameplay
- Movement with collision and sliding.
- Bomb placement constraints (tile must be floor, no existing bomb, capacity).
- Bomb fuse (2s baseline), explosion cross with flame length, soft block destruction, hard block blocking.
- Chain reactions (same-tick detonation).
- Explosion lifetime (not instant).
- Enclosement:
  - Triggers at 1:00 remaining
  - Starts top-left and proceeds clockwise ring-by-ring
  - Depth options wired (None / A Little / A Lot / All The Way!)
  - Crush rule: players die if a closing block spawns on them
- Items (subset):
  - BombUp, FireUp, SpeedUp, Kick
  - Items spawn from destroyed soft blocks at scheme density
  - Kick causes bombs to slide; secondary stops your moving bomb

### Tests
- `shared/sim/world.test.js` covers:
  - hard-block explosion blocking
  - soft block destruction
  - same-tick chain reaction
- `shared/sim/enclosement.test.js` covers:
  - depth ring mapping
  - top-left clockwise ordering

## Known gaps / improvements for next phase
- Reconnection UX: client doesn’t yet auto-reconnect, and server grace-period handling is minimal.
- No client-side prediction/reconciliation yet; rendering is snapshot-driven.
- No teams, no Classic/Enhanced mode switch, no score/round series.
- Item set incomplete (Phase 2).
- Scheme/theme selection is fixed to a built-in default scheme.
- Server currently uses JSON messages only (binary snapshots in Phase 4).

## How to run (local)
- `npm install` is not required (no dependencies).
- Start: `npm run dev`
- Open the printed URL in two browser windows to test multiplayer.

