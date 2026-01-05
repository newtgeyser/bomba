# Phase 3 — Editor + Community (Implemented)

This phase adds an in-browser scheme editor, map publishing, a map browser, and a basic reporting flow suitable for a dedicated-server environment.

## What’s implemented

### Server-side map API (file-backed)
Implemented in `server/api.js`:
- `GET /api/schemes` returns:
  - `official`: built-in schemes shipped with the client
  - `published`: maps published to the local server (`data/schemes/*.json`)
- `GET /api/schemes/:id` fetches a single scheme (official or published).
- `POST /api/schemes` publishes a scheme:
  - validates against `shared/scheme/validate.js`
  - assigns a server ID (`m_...`) unless updating an existing published map
  - returns an `editToken` for future updates (lightweight “ownership”)
- `POST /api/reports` stores a report record in `data/reports/*.json`

### Map Browser (client)
Implemented in `client/view_maps.js`:
- Lists official and published schemes.
- Opens a scheme in the editor.
- Copies a shareable read-only link (`/#map=<id>`).
- Reports a published scheme via `/api/reports`.

### Map Editor (client)
Implemented in `client/view_editor.js`:
- Paint tiles: Floor / Soft / Hard.
- Move spawns (0–9) by selecting a spawn index and clicking on the canvas.
- Assign spawn teams (None/Red/White).
- Edit item rules:
  - densityPercent
  - per-item BornWith / ForbidInRandom / Override (Default/FixedCount/ChanceIn10)
- Validation + warnings:
  - hard validation uses `validateScheme()`
  - warns if a spawn appears boxed in by hard blocks
- Drafts:
  - save/load drafts in `localStorage` (`aboDrafts`)
- Publishing:
  - publishes to the server and receives an `editToken`
  - subsequent publishes update the same map (when `editToken` is present)
- Read-only mode for shared links and official maps.

### Tests
Added `server/api.test.js` validating publish/list/fetch/report behavior without binding network ports.

## Known gaps / improvements for next phase
- No moderation tooling beyond report storage (no admin UI, no rate limits).
- No “friends-only” visibility or authentication beyond an edit token.
- Editor UX is intentionally minimal (no flood fill, selection marquee, undo/redo, resize).
- Match scoring/series is still not implemented (needed for a complete “match” experience).

