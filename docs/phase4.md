# Phase 4 — Competitive Polish (Implemented)

This phase focuses on “play it repeatedly and competitively” features: ranked queue, replays, spectator UX improvements, and a binary snapshot protocol option.

## What’s implemented

### Match series (first-to-N)
- Matches are now **multi-round series**:
  - first to `targetWins` wins (default 5)
  - intermission between rounds (3s) with automatic respawn
- Implemented in `server/rooms.js` (server authoritative).

### Ranked queue + Elo
- Ranked quick play creates 2-player rooms and locks lobby settings for fairness.
- Elo ratings are persisted under `data/ratings/ratings.json`.
- Leaderboard API: `GET /api/ratings` (top 50).
- Client UI: `Leaderboard` screen.

### Replays
- Server records a replay per match (inputs applied by the server), stored in `data/replays/*.json`.
- Replay APIs:
  - `GET /api/replays` (metadata list)
  - `GET /api/replays/:id` (full replay)
- Client UI:
  - `Replays` screen to browse and play back matches deterministically.

### Spectator improvements
- In-game scoreboard panel lists players and alive status.
- After death, clicking a player “follows” them (visual highlight ring).
- Tab toggles the scoreboard visibility.

### Binary snapshot protocol
- Optional binary snapshots for lower bandwidth:
  - Toggle in the main menu (“Binary snapshots”) and reload to renegotiate.
  - Server sends binary snapshots to clients that requested them in `hello.proto`.
  - Codec: `shared/net/snapshot_bin.js` (+ test `shared/net/snapshot_bin.test.js`)
- JSON is still used for all other messages and as fallback.

## Known gaps / improvements
- Ranked is “local-dev grade” (no accounts, reconnect token identity, no season resets in UI).
- Replay playback rebuilds simulation on seeks (and currently rebuilds per frame for simplicity); can be optimized.
- No kill stats yet; scoring is purely round wins.
- Binary snapshots are v1 and not yet version-negotiated beyond a single magic byte.

