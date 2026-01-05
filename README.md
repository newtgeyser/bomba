# Atomic Bomberman Online (ABO) — Dev Build

An in-browser, server-authoritative, modernized reimplementation of *Atomic Bomberman*, based on `SPEC.md`.

This repo is dependency-free (no npm installs required) and uses:
- Node.js for HTTP + WebSocket server
- Canvas 2D for rendering
- A deterministic fixed-tick simulation shared between server and client

## Quick start

- Requirements: Node.js 20+
- Run: `npm run dev`
- Open: the printed URL (default `http://127.0.0.1:3000`)
- To test multiplayer: open a second browser window/tab and join the same lobby.

### Tests

- Run: `npm test`

## Controls

- Move: WASD / Arrow Keys
- Bomb / pick up (Hand): Space
- Secondary (Trigger / Punch / Throw / Stop kick): Enter
- Toggle scoreboard: Tab

## What’s included

- Online play (authoritative dedicated server model, WebSocket).
- Lobby + quick play + ranked quick play.
- Up to 10 players in a room (ranked is fixed to 2 players).
- Classic vs Enhanced fuse variant (3s vs 2s baseline).
- Timer + enclosement closing walls (top-left clockwise).
- Full 13-item Atomic set + key conflicts + Skull/Ebola disease system.
- Scheme + theme system:
  - Official scheme selection
  - Theme palette selection (renderer)
- In-browser scheme editor + publishing + map browser + reporting.
- Match series (first-to-N round wins).
- Replays (server-recorded inputs) + in-browser replay viewer.
- Optional binary snapshots (toggle in the menu; reload after changing).

## Data and persistence

Runtime data is stored in `data/` (created automatically):
- `data/schemes/` published community maps
- `data/reports/` reports
- `data/replays/` replays
- `data/ratings/` Elo ratings

## Docs

- `DESIGN.md` overall architecture and phase breakdown.
- `docs/phase1.md`, `docs/phase2.md`, `docs/phase3.md`, `docs/phase4.md` describe what was built per phase.

## Notes

- This is a “dev build” with simplified visuals and simplified bomb physics for some items (notably punch/throw travel).
- The server implements a minimal WebSocket stack sufficient for browsers (no external packages).

