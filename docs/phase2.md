# Phase 2 — Atomic Identity (Implemented)

This phase adds the item interactions and mini-systems that make Atomic feel like Atomic, plus scheme/theme selection and Gold Bomberman roulette.

## What’s implemented

### Items (full 13-item set)
Implemented in `shared/sim/items.js` and exercised via `shared/sim/world.js`:
- Stat items: BombUp, FireUp, FullFire, SpeedUp, SpeedDown (roulette-only).
- Ability items: Kick, BoxingGlove (Punch), PowerGlove (Hand), RemoteControl (Trigger), RubberBomb (Jelly), LineBomb (Spooge).
- Random: SelectItem (grants a random item respecting `forbidInRandom`).
- Disease: Skull with an Ebola chance (applies up to 3 disease effects).

### Conflict rules
Implemented per Atomic rules (drops the ejected item on the ground where possible):
- Trigger vs Jelly: mutual exclusion.
- Trigger ejects BoxingGlove.
- Hand vs Spooge: mutual exclusion.

### Disease system
Implemented in `shared/sim/diseases.js`:
- Disease effects: Molasses, Crack, ReverseControls, Constipation, Poops, ShortFlame, ShortFuse.
- Ebola applies up to three effects (capped at 3 active).
- Transfer-by-touch: oldest effect transfers to a healthy player on contact.
- Cure-by-good-pickup: any non-Skull item cures 1 disease effect (default 100%).

### Bomb-action items
- Trigger bombs don’t auto-explode and detonate in placement order on secondary action.
- Hand can pick up adjacent bombs (Space) and throw them (Enter); fuse pauses while carried.
- BoxingGlove punches an adjacent bomb (Enter) and moves it over walls to a far empty floor tile.
- Jelly bombs bounce when sliding into an obstacle.
- Spooge double-tap bomb button to place a line of bombs forward.

### Scheme + theme selection
- Lobby now supports choosing an official scheme and a theme.
- Themes currently affect palette/colors in the Canvas renderer.

### Gold Bomberman roulette
- When enabled, the winner of the previous match gets a server-picked roulette item (pool includes SpeedDown).
- Winner is visually marked with a gold ring.

### Tests
Added `shared/sim/phase2_items.test.js` covering:
- Trigger bombs + detonation order
- Trigger/Glove conflict ejection
- Punch landing behavior
- Hand carry fuse pause + resume
- Jelly bounce behavior
- Spooge double-tap line placement
- ShortFlame vs FullFire override
- Disease transfer on touch

## Known gaps / improvements for next phase
- Item physics are simplified (punch/throw is instantaneous landing; Jelly “erratic ricochet” is not fully modeled).
- Match is still “single-round then back to lobby”; scoring/round series (first-to-N) is not implemented yet.
- Team play exists as a lobby toggle, but team UX (markers, scoreboard) is minimal.
- Scheme item distribution supports overrides at a basic level; a closer emulation of Atomic scheme probabilities is still needed.

