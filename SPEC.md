## Atomic Bomberman Online (ABO) — In‑Browser Multiplayer Game Specification

### 1. Purpose and product goals

**Goal:** Build a faithful, modernized, in‑browser reimplementation of *Atomic Bomberman* focused on **online multiplayer**, while preserving the game’s defining traits: **up to 10 players**, fast pacing, chaotic item interactions, “scheme” map system, taunts, and configurable match rules. ([Wikipedia][1])

**Modernization goals (non-negotiable):**

* Runs in modern browsers (desktop-first) with no installs.
* Supports online play via dedicated servers (low-latency real-time).
* Includes modern lobby/matchmaking UX, reconnection, anti-cheat posture, reporting/muting.
* Keeps the “Atomic” feel: fast fuse, fast movement, aggressive power-ups, taunts. ([Bomberman Wiki][2])

**Reference behaviors to preserve from the classic game (high-signal):**

* Match supports **up to 10 players**. ([Wikipedia][1])
* “Classic” vs “Enhanced” mode selectable. ([Wikipedia][1])
* Battle can be **free-for-all or 2-team** play. ([Random Hoo Haas][3])
* Configurable **play time**, plus “enclosement” blocks that close in late-match. ([Random Hoo Haas][3])
* “Gold Bomberman” roulette that grants the previous winner a starting item next match. ([Random Hoo Haas][3])
* Levels are built from **Scheme files** (layout + item rules) combined with a **Theme** (visual set). ([Random Hoo Haas][3])
* Item set (13 items) and key conflicts (e.g., Hand vs Spooge). ([Bomberman Wiki][4])
* Bomb fuse is **2 seconds** by default (Atomic-speed baseline). ([Steam Community][5])

---

### 2. Target platforms, constraints, and input

#### 2.1 Supported platforms (v1)

* **Desktop browsers:** latest Chrome, Firefox, Safari, Edge.
* **Rendering:** HTML5 Canvas 2D or WebGL2 (team choice). Canvas is acceptable for v1 if performance targets are met.
* **Networking:** WebSocket (WSS) to dedicated authoritative servers.

#### 2.2 Input devices

* **Keyboard:** supported (rebindable).
* **Gamepad:** supported via the browser Gamepad API.
* **Mobile:** not required for v1 (touch controls are a separate project due to precision demands).

#### 2.3 Player count

* Online match: **2–10 human players**.
* Optional bots to fill: allowed (server-side AI), but do not degrade netcode or determinism.

---

### 3. Core gameplay overview (what players do)

**Core loop:**

1. Enter queue or join lobby.
2. Pick bomber color/skin, set ready.
3. Match runs as a series of rounds.
4. In each round: place bombs, collect items, eliminate opponents, survive enclosement.
5. Round ends when win condition met (typically last alive / last team alive).
6. Match ends when score target met; optionally apply Gold Bomberman mechanic into next match. ([Random Hoo Haas][3])

**High-level “Atomic” identity:** fast movement + fast fuse + highly interactive items (kick/stop, punch, carry/throw, remote detonation, line-bombing). ([Bomberman Wiki][2])

---

### 4. Terminology and data primitives (shared language for the team)

* **Tile / Cell:** A grid square on the arena.
* **Hard Block:** Indestructible wall tile.
* **Soft Block:** Destructible wall tile; may conceal an item.
* **Floor:** Walkable tile.
* **Scheme:** The map “logic” package: layout + spawns + item rules/density/probabilities + starting items. (Atomic uses “scheme files” / `.sch`.) ([Wikipedia][1])
* **Theme (Level set):** Visual skin applied to a scheme (e.g., Green Acres, Haunted House). ([Bomberman Wiki][6])
* **Round:** One elimination instance on one arena.
* **Match:** A set of rounds until score target / win condition is reached.
* **Tick:** Fixed simulation step on the server.

---

### 5. Game rules and mechanics

#### 5.1 Arena geometry (baseline)

* Default arena size: **15 columns x 11 rows** (classic Bomberman standard).
* Max spawns: **10**.
* Camera: fixed top-down.

#### 5.2 Collision and movement

**Movement model (recommended):**

* Players move smoothly but are constrained by tile collisions.
* Player position is continuous, but occupancy/collision is computed against grid-aligned obstacles and bombs.

**Implementation rules:**

* Player cannot pass through Hard Blocks or Soft Blocks.
* Player cannot enter a tile occupied by a bomb **unless** the “bomb pass” mechanic exists (Atomic does not list bomb-pass as a standard item; do not add it in v1).
* Cornering: allow “slide” behavior along obstacles (standard Bomberman feel).

**Speed stat:**

* Speed is a numeric stat modified by items (Speed Up / Speed Down) and diseases.
* Atomic baseline should feel “fast” even at default. ([Bomberman Wiki][2])

#### 5.3 Bomb placement

* Player drops a bomb on the **current tile**.
* Placement fails if:

  * tile is not floor,
  * tile already contains a bomb,
  * player has reached max simultaneously active bombs (bomb capacity).
* Bomb capacity starts at “BornWith” value from scheme; commonly 1 in default schemes.
* Bomb fuse default: **2.0 seconds** (Enhanced baseline). ([Steam Community][5])

#### 5.4 Bomb detonation and explosions

**Explosion shape:**

* Cross (“+”) expanding N tiles in each cardinal direction where N = current flame length.
* Stops when encountering Hard Block.
* Destroys Soft Blocks.
* A bomb caught by an explosion detonates immediately (chain reaction).
* Items on the ground may be destructible depending on scheme settings (Atomic editor supports this concept). ([Wikipedia][1])

**Explosion timing:**

* Explosion exists for a short duration (e.g., 300 ms) to allow collision with players and objects.
* Do not make explosions instantaneous-only; players should be able to “clip” into them if poorly timed (classic risk).

#### 5.5 Death and round elimination

* Player dies if their hurtbox intersects an explosion.
* On death:

  * Play death animation.
  * Drop behavior: optional (Atomic includes many animations; dropping power-ups on head-hit is referenced as a tactic; implement as configurable). ([Random Hoo Haas][3])
* Eliminated players become spectators for the remainder of the round.

#### 5.6 Round timer and enclosement (“closing walls”)

**Play Time options (must match Atomic feel):**

* 1, 1.5, 2, 3, 4, 5, 10 minutes, or Infinite. ([Random Hoo Haas][3])

**Enclosement trigger:**

* When timer reaches **1:00 remaining**, blocks begin filling the arena **from the outside inward**, starting at **top-left** and proceeding **clockwise**. ([Random Hoo Haas][3])

**Enclosement Depth settings (must exist):**

* None (disabled)
* A Little (leaves 11x7 arena)
* A Lot (leaves 7x3 arena)
* All The Way! (fills the entire arena) ([Random Hoo Haas][3])

**Enclosement algorithm (precise):**

* Define a perimeter “ring” order list of tiles for ring 0 (outermost), ring 1, etc.
* Start at ring 0, tile (0,0) → traverse perimeter clockwise.
* Place “closing block” on the next tile at a fixed interval (e.g., 250ms or 1 tick per placement; make it a rule parameter).
* A closing block behaves as a Hard Block for collision and explosions (recommended).
* If a player is on a tile when a closing block spawns:

  * v1 rule: player is killed (sudden death) OR displaced to nearest free tile (pick one and keep consistent; killing is simpler and consistent with “crush” mechanics in many Bomberman variants).

#### 5.7 Teams

* Support:

  * Free-for-all
  * **2 teams** (Red vs White) ([Random Hoo Haas][3])
* Friendly fire: configurable (default ON for “Atomic chaos” unless teams demand OFF).
* UI should clearly mark teammates (outline/marker).

---

### 6. Items and power-ups (Atomic’s 13-item set)

Atomic Bomberman’s item set is small but interaction-heavy. Implement **exactly these 13** for v1. ([Bomberman Wiki][4])

#### 6.1 Item list (required)

1. **Bomb Up** (Extra Bomb) ([Bomberman Wiki][6])
2. **Fire Up** (Extended Flame) ([Bomberman Wiki][6])
3. **Full Fire** (Golden Boy / Goldflame) ([Bomberman Wiki][6])
4. **Speed Up** (Skate) ([Bomberman Wiki][6])
5. **Speed Down** (Brake) — roulette-only ([Bomberman Wiki][6])
6. **Kick** (Boot) ([Bomberman Wiki][6])
7. **Boxing Glove** (Punch) ([Bomberman Wiki][6])
8. **Power Glove** (Blue Hand / Grab) ([Bomberman Wiki][6])
9. **Remote Control** (Trigger) ([Bomberman Wiki][6])
10. **Rubber Bomb** (Jelly) ([Bomberman Wiki][6])
11. **Line Bomb** (Spooge) ([Bomberman Wiki][6])
12. **Skull** (Disease / Skullz; Ebola variant exists) ([Bomberman Wiki][6])
13. **Select Item** (Random) ([Bomberman Wiki][4])

#### 6.2 Item spawn rules

Items originate from:

* Destroyed Soft Blocks (primary).
* Scheme “override” placements (fixed counts / probabilities).
* Random tile item (Select Item) cycles items visually and yields one on pickup. ([Random Hoo Haas][3])

**Destructibility:**

* Scheme setting controls whether items can be destroyed by blasts. ([Wikipedia][1])

#### 6.3 Item caps (v1 defaults; make configurable in ruleset)

* Bomb count cap: 10 (classic max). ([Random Hoo Haas][3])
* Flame length cap: 10 (safe cap; Full Fire forces max).
* Speed cap: define 1..10 units (Atomic baseline high).

#### 6.4 Detailed behaviors (must be implemented precisely)

##### 6.4.1 Bomb Up

* Increases max simultaneously placed bombs by +1 (until cap).

##### 6.4.2 Fire Up

* Increases explosion length by +1 tile.

##### 6.4.3 Full Fire (Golden Boy)

* Sets explosion length to **max** immediately. ([Bomberman Wiki][6])
* Overrides **Short Flame** disease effect. ([Bomberman Wiki][7])

##### 6.4.4 Speed Up / Speed Down

* Speed Up: +1 speed unit. ([Random Hoo Haas][3])
* Speed Down (“Brake”): -1 speed unit; **roulette-only** in Atomic. ([Bomberman Wiki][6])

##### 6.4.5 Kick (Boot)

* If player walks into an **unobstructed bomb**, bomb is kicked and slides in that direction until it hits an obstacle. ([Random Hoo Haas][3])
* Player can **stop** a sliding bomb with the secondary action button. ([Random Hoo Haas][3])

**Edge cases:**

* Kicked bomb collides with:

  * Hard Block: stops on adjacent tile.
  * Soft Block: stops on adjacent tile (soft block remains).
  * Another bomb: stops adjacent (do not stack).
  * Player: optional; recommended = bomb passes through player tile collision-wise (classic feel), but explosion will still kill.

##### 6.4.6 Boxing Glove (Punch)

* Secondary action punches a bomb forward (projectile arc) over walls/players, landing on the first valid floor tile along the direction. ([Random Hoo Haas][3])
* **Conflict:** cannot coexist with Remote Control (Trigger Bomb). If player picks up Trigger Bomb while holding Boxing Glove, Boxing Glove is ejected. ([Random Hoo Haas][3])

##### 6.4.7 Power Glove (Hand / Grab)

* Lets player pick up a bomb and carry it; releasing throws it. Bomb is **not active** until it hits the ground. ([Random Hoo Haas][3])
* **Conflict:** cannot coexist with Spooge. If player picks up Spooge while holding Hand (or vice versa), one is ejected per Atomic rules. ([Random Hoo Haas][3])

##### 6.4.8 Remote Control (Trigger Bomb)

* Bombs placed while holding Trigger are “trigger bombs”.
* They do **not** explode on timer; they explode only if:

  * player presses secondary action (detonate), or
  * they’re hit by another explosion (chain reaction). ([Random Hoo Haas][3])
* Detonation order: detonates in placement order. ([Random Hoo Haas][3])
* **Conflict behavior:** picking up Jelly ejects Trigger (and picking up Trigger ejects Jelly). ([Random Hoo Haas][3])
* **Conflict behavior:** picking up Trigger ejects Boxing Glove. ([Random Hoo Haas][3])

##### 6.4.9 Rubber Bomb (Jelly)

* Modifies bombs to behave as “bouncy”:

  * If kicked, they bounce back when hitting an obstacle.
  * If thrown, they bounce/ricochet erratically. ([Random Hoo Haas][3])
* **Conflict:** cannot coexist with Trigger Bomb (mutual ejection). ([Random Hoo Haas][3])

##### 6.4.10 Line Bomb (Spooge)

* On “double tap” of drop-bomb, sends **all bombs in front** of the bomber into empty spaces ahead in a straight line, filling as far as space allows (up to the number of bombs the player has available). ([Random Hoo Haas][3])
* **Conflict:** cannot coexist with Hand. ([Random Hoo Haas][3])

##### 6.4.11 Select Item (Random)

* Appears as a cycling icon; on pickup grants a random item.
* Scheme can forbid items from appearing inside Random. ([Bomberman Wiki][6])

##### 6.4.12 Skull (Disease / Skullz) + Ebola (Super Bad Disease)

* Skull applies a negative status effect (disease).
* Ebola applies **up to three** disease effects simultaneously. ([Random Hoo Haas][3])
* Diseased player can transfer disease by touching others (Atomic supports “tagging” behavior). ([Random Hoo Haas][3])
* Scheme option: whether Skull can be destroyed; otherwise it can relocate/spawn randomly (implement as a rules toggle). ([Bomberman Wiki][7])

---

### 7. Disease system (Skull/Ebola) — concrete implementation

This is where junior teams usually ship bugs. Define it as a strict mini-system.

#### 7.1 Disease state model

Each player has:

* `diseases: DiseaseEffect[]` (0..3 in Atomic due to Ebola) ([Random Hoo Haas][3])
* `diseaseTTLFrames[]` per effect (optional; Atomic can last long; choose a consistent duration, e.g., 20s)
* `diseaseSource` (Skull vs Ebola)

#### 7.2 Disease effect list (v1 required)

Implement at least:

1. **Molasses (Slow Pace):** speed set to minimum.
2. **Crack (Rapid Pace):** speed set very high (near cap).
3. **Reverse Controls:** invert direction inputs.
4. **Constipation:** cannot place bombs.
5. **Poops:** auto-drop bombs when possible; additionally interacts with “bomb button items” as follows: if player has Spooge or Hand, force rapid usage; disable Boxing Glove during the effect. ([Bomberman Wiki][7])
6. **Short Flame:** blast radius reduced to 1 unless Full Fire overrides. ([Bomberman Wiki][7])
7. **Short Fuse:** bombs explode after 1 second (or trigger faster chain timing). ([Bomberman Wiki][7])

You may add more (e.g., “Swap”, “Low Power”) later, but the above must exist because they are directly referenced as Atomic-specific differences and tactics. ([Bomberman Wiki][7])

#### 7.3 Cure/transfer rules

* **Transfer:** On player-to-player touch, transfer one active disease effect (deterministic selection rule: oldest effect). ([Bomberman Wiki][7])
* **Cure:** Picking up a “healthy power item” has a chance to remove one disease effect (or always removes one). Atomic references “vaccinating yourself” by picking up healthy power items. ([Random Hoo Haas][3])

Make cure probability a match rule:

* default: 100% remove 1 disease per good pickup (simplest, readable).

---

### 8. Match structure, win conditions, scoring

#### 8.1 Round win conditions

* FFA: last alive wins.
* Teams: last team with survivors wins.

#### 8.2 Match win conditions (configurable)

Provide at least:

* **First to N round wins** (default N=5).
* **Timed + score** (optional).
* Optional community-remembered mode: **first to K total kills** (configurable K=10/20/50/100) as an additional rule variant. (This is not required for authenticity but is low-cost and increases replayability.) ([bombermanboard.com][8])

#### 8.3 Gold Bomberman option

If enabled:

* The winner of the **previous match** gets a roulette before the next match and starts **every round** of the following match with the won item; winner displays gold sparkles. ([Random Hoo Haas][3])
* Roulette pool includes Speed Down (Brake), which otherwise does not spawn. ([Bomberman Wiki][6])

**Implementation details:**

* Roulette happens in pre-match lobby countdown.
* Server picks roulette result (authoritative) and broadcasts.

---

### 9. Schemes, themes, and the in-browser editor

Atomic’s customization system is a defining feature and must exist online.

#### 9.1 Scheme + Theme composition

* Player selects:

  * a **Scheme** (layout + logic)
  * a **Theme** (visual tileset)
* Themes (v1 target list, as known in Atomic):

  * Green Acres, Hockey Rink, Ancient Egypt, Coal Mine, Beach, Aliens, Haunted House, Under the Ocean, Deep Forest Green, Inner City Trash, etc. ([Bomberman Wiki][6])

(For v1 you can ship fewer themes, but the system must support them cleanly.)

#### 9.2 Scheme file format (ABO JSON)

Replace `.sch` with JSON while preserving semantics.

**`Scheme` object (minimum):**

* `id: string`
* `name: string`
* `width: number` (default 15)
* `height: number` (default 11)
* `tiles: TileType[width*height]` where TileType ∈ {Floor, Hard, Soft}
* `spawns: Spawn[<=10]`:

  * `x,y`
  * `spawnIndex` 0..9
  * `team` ∈ {None, Red, White}
* `itemRules`:

  * `densityPercent: number` (0..100) — percent of soft blocks that contain an item ([Random Hoo Haas][3])
  * `items: Record<ItemType, ItemRule>` where ItemRule includes:

    * `bornWith: number` ([Random Hoo Haas][3])
    * `forbidInRandom: boolean` ([Random Hoo Haas][3])
    * `override: { mode: "Default"|"FixedCount"|"ChanceIn10"; value: number }` ([Random Hoo Haas][3])
  * `itemsDestructible: boolean`
  * `conflictPolicy: "EjectOld"|"EjectNew"|"DisallowPickup"` (default per-item, see below)
* `rulesPreset` (optional convenience):

  * recommended fuse, timer, enclosement, etc.

#### 9.3 In-browser scheme editor (must-have)

Atomic’s editor manipulates blocks, spawns, density, and item settings. ([Wikipedia][1])

**Editor capabilities (v1):**

* Place tiles: Hard / Soft / Floor.
* Move spawn points (10).
* Toggle team assignment per spawn (Red/White).
* Set item density.
* Configure item rules (BornWith/Forbid/Override).
* Save scheme to:

  * local storage (drafts)
  * server (published maps)
  * shareable link (read-only)

**Validation rules:**

* At least 2 spawns.
* No spawn on Hard/Soft tile.
* Ensure initial spawns are not fully boxed in by Hard blocks (warn).

#### 9.4 Map sharing and moderation

Because this is online:

* Public map browser requires:

  * report button
  * basic filtering: “Official”, “Community”, “Friends-only”, “Unlisted”
* Private lobbies can load unlisted maps without moderation overhead.

---

### 10. User experience specification (screens + interactions)

#### 10.1 Entry flow

1. **Landing**

   * “Play as Guest” (immediate)
   * “Sign in” (optional, for persistence)
2. **Main Menu**

   * Quick Play
   * Create Lobby
   * Join Lobby (code)
   * Map Editor
   * Settings
   * Profile/Stats

#### 10.2 Lobby (custom games)

Lobby shows:

* Player list (up to 10):

  * display name
  * ping
  * ready status
  * selected bomber color
  * team assignment (if teams enabled)
* Chat pane (text)
* Taunt test button (local-only in lobby; do not spam others)
* Match settings panel (host-controlled):

  * Mode: FFA / Teams
  * Classic / Enhanced ([Wikipedia][1])
  * Timer: list including Infinite ([Random Hoo Haas][3])
  * Enclosement depth ([Random Hoo Haas][3])
  * Gold Bomberman: on/off ([Random Hoo Haas][3])
  * Scheme + Theme ([Bomberman Wiki][6])
  * Item density (from scheme default; optionally overridden)
  * Score target (round wins / kill target)

Lobby interactions:

* Host can kick/ban from lobby (ban is session-only).
* Players can ready/unready.
* Match starts when host starts and all required players are ready (configurable auto-start).

#### 10.3 Quick Play (matchmaking)

* “Queue” with region selection (Auto/NA/EU/AS).
* Optional: party queue (2–10 players party size; party joins same match).

#### 10.4 In-game HUD

Must show:

* Timer
* Round score / match score
* Your active items/status indicators:

  * bomb capacity
  * flame length
  * speed tier
  * special ability currently active (Kick/Glove/Hand/Trigger/Jelly/Spooge)
  * disease icons + count
* Minimal scoreboard overlay

#### 10.5 Spectator view (after death)

* Free camera is not needed; keep fixed camera.
* Show “You are out” and allow:

  * text chat (optional)
  * taunts disabled by default (prevent dead spam), but can be enabled by host.

#### 10.6 Post-round and post-match

* Round summary:

  * winner
  * kills per player
  * notable events (optional)
* Match results:

  * win/loss
  * XP/stats if signed in
  * Rematch button (same lobby)
  * New lobby / exit

---

### 11. Controls and bindings

Atomic used:

* Move: arrows
* Drop bomb / pick up / throw: Space
* Secondary: Enter (detonate trigger bombs, punch, stop kicked bomb)
* Pause: Esc ([Random Hoo Haas][3])

**ABO default bindings (recommended):**

* Move: WASD / Arrow keys (both)
* Drop Bomb: Space
* Secondary Action (context-sensitive): Enter / Shift
* Taunt wheel: T (opens quick taunt picker) + number keys 1–8
* Chat: Enter

**Context-sensitive Secondary Action priority order (deterministic):**

1. If carrying bomb (Hand): throw.
2. Else if Trigger active and any trigger bombs exist: detonate next.
3. Else if Boxing Glove active and facing a bomb: punch.
4. Else if Kick active and there is a kicked bomb in motion you own: stop it.
5. Else: no-op.

---

### 12. Online multiplayer architecture (authoritative and junior-friendly)

#### 12.1 Topology

* **Dedicated authoritative game servers** (recommended; anti-cheat baseline).
* Services:

  1. **Matchmaking service** (HTTP): queueing, lobby discovery, region assignment.
  2. **Game server** (WebSocket): runs simulation, validates inputs, broadcasts state/events.
  3. **Persistence service** (HTTP/DB): accounts, stats, saved schemes, moderation.

#### 12.2 Simulation model

* Server runs fixed-tick simulation (e.g., **60 ticks/sec**).
* All time-based mechanics (fuse, disease TTL, enclosement) are **tick/frame-based integers**, not floating-point seconds.
* Server is the only authority for:

  * RNG (item placements, Random item outcome, disease roll, roulette)
  * collision outcomes
  * deaths and scoring

Clients are presentation + input.

#### 12.3 Networking model

Use a hybrid:

* **Client → Server:** input commands only.
* **Server → Clients:** event stream + periodic snapshots.

**Why:** Atomic has chaotic interactions (kicks, throws, chain explosions). Server authority prevents client-side cheating and divergent outcomes.

#### 12.4 Message types (minimum set)

**Client → Server**

* `JoinMatch { matchId, playerToken, chosenColor, clientVersion }`
* `Input { seq, tick, moveX, moveY, dropBombPressed, secondaryPressed, tauntId? }`
* `Chat { text }`
* `Ping { clientTime }`

**Server → Client**

* `Welcome { playerId, matchSeed, tickRate, rules }`
* `Snapshot { tick, players[], bombs[], itemsOnGround[], tilesDelta[] }`
* `Event { tick, type, payload }` where `type` includes:

  * `BombPlaced`, `BombKicked`, `BombStopped`, `BombPickedUp`, `BombThrown`
  * `BombExploded`, `ExplosionSpawned`, `SoftBlockDestroyed`
  * `ItemRevealed`, `ItemPickedUp`, `ItemDestroyed`, `ItemEjected`
  * `DiseaseApplied`, `DiseaseTransferred`, `DiseaseCured`
  * `PlayerDied`, `RoundEnded`, `MatchEnded`
  * `EnclosementBlockPlaced`
  * `RouletteResult`
* `Pong { clientTime, serverTime }`
* `Error { code, message }`

**Transport format:**

* v1: JSON is acceptable for speed of development.
* v1.1+: move to binary (MessagePack / Protobuf) if bandwidth becomes a problem.

#### 12.5 Latency handling (must-have)

Atomic is fast; online must remain playable at ~80–120ms RTT.

Implement:

* **Client-side prediction** for movement only (optional but strongly recommended).
* **Server reconciliation:** client corrects to server snapshots.
* **Input buffering:** server processes input at `tick + inputDelayTicks` (configurable; default 3–6 ticks) to reduce jitter unfairness.

#### 12.6 Reconnection

* If a client disconnects:

  * Keep player in match for `gracePeriodSeconds` (default 10).
  * Player stands still (no AI takeover) and is killable.
* If reconnect in time, resume.
* If not, treat as eliminated (or replaced by bot if host allows).

#### 12.7 Anti-cheat posture (practical)

* Server validates:

  * max speed given effects
  * bomb placement rate and capacity
  * illegal tile traversal
  * illegal detonation order
* Rate limit chat/taunts.
* Version lock: client must match server build version.

---

### 13. Taunts, audio, and moderation

Atomic emphasized voice taunts and customization. ([Random Hoo Haas][9])

#### 13.1 Built-in taunts (v1 required)

* Provide a curated set of short voice lines (or text callouts if audio assets are not available).
* Players can trigger taunts during match (rate-limited: e.g., 1 every 2 seconds).
* Every player has:

  * Mute taunts (per player)
  * Mute all non-team (if teams)

#### 13.2 Custom taunts (v2 feature; spec now so architecture supports it)

Because user-generated audio creates moderation risk, do not enable for public matchmaking initially.

**Allowed in:**

* Private lobbies where host enables “Allow custom taunts”.

**Technical constraints:**

* Upload limited to ≤2s, ≤256KB, formats: OGG/MP3.
* Server transcodes to OGG and normalizes volume.
* Stored as unlisted assets tied to lobby/session or account.

---

### 14. Persistence, profiles, stats

#### 14.1 Identity

* Guest: random name + ephemeral ID.
* Signed-in: persistent ID, stats, saved schemes.

#### 14.2 Stats (minimum)

* Matches played/won
* Kills
* Deaths
* Average placement
* Favorite item pickups
* Disconnect rate (internal metric)

#### 14.3 Saved content

* Schemes: drafts + published
* Settings: keybinds, audio, video, accessibility

---

### 15. Accessibility and usability requirements

* Full rebindable controls.
* Colorblind-friendly indicators (teammate markers not purely color).
* Option: reduce screen shake.
* Option: disable flashing effects.
* Chat filtering toggle (basic profanity filter; do not over-engineer).

---

### 16. Non-functional requirements (performance, reliability)

#### 16.1 Performance targets

* Client:

  * 60 FPS on a typical laptop.
  * <150MB memory.
* Server:

  * Supports 10-player room at 60 ticks with headroom.
  * Snapshot bandwidth target: <20 KB/s per client (optimize if exceeded).

#### 16.2 Reliability

* Matchmaking SLA: quick play match start <30 seconds at peak (assuming population exists).
* Server crash safety: if game server dies, match ends with “No contest” and does not record ranked outcome.

---

### 17. QA plan and acceptance tests (junior-team executable)

You should build automated tests around these “Atomic-critical” scenarios:

#### 17.1 Bomb mechanics

* Chain reaction across multiple bombs detonates in correct tick order.
* Explosion blocked by Hard Block; destroys Soft Block.
* Player dies if occupying explosion tiles during explosion lifetime.

#### 17.2 Kick/Stop

* Kick sends bomb sliding until obstacle.
* Stop halts a moving bomb immediately on secondary action. ([Random Hoo Haas][3])

#### 17.3 Boxing Glove (Punch)

* Punch sends bomb over wall and lands correctly.
* Trigger pickup ejects glove correctly. ([Random Hoo Haas][3])

#### 17.4 Hand (Carry/Throw)

* Pick up bomb; bomb does not tick while carried; activates on landing. ([Random Hoo Haas][3])
* Spooge/Hand conflict eject rule enforced. ([Random Hoo Haas][3])

#### 17.5 Trigger bombs

* Trigger bombs do not auto explode; explode only on trigger or chain. ([Random Hoo Haas][3])
* Detonation order is consistent.

#### 17.6 Jelly bombs

* Kicked jelly bomb bounces off obstacles.
* Jelly/Trigger mutual exclusion enforced. ([Random Hoo Haas][3])

#### 17.7 Spooge

* Double-tap sends all bombs forward into empty spaces as far as possible. ([Random Hoo Haas][3])

#### 17.8 Diseases

* Skull applies 1 disease; Ebola applies up to 3. ([Bomberman Wiki][7])
* Poops effect disables Boxing Glove and forces bomb behavior per rules. ([Bomberman Wiki][7])
* Short Flame reduces radius unless Full Fire overrides. ([Bomberman Wiki][7])

#### 17.9 Enclosement

* At 1:00 remaining, blocks begin filling from top-left clockwise. ([Random Hoo Haas][3])
* Depth setting respected (None / A Little / A Lot / All The Way). ([Random Hoo Haas][3])

#### 17.10 Multiplayer correctness

* Two clients with 120ms RTT remain synchronized (no divergent win results).
* Reconnect within grace period restores player state.
* Disconnect beyond grace eliminates player.

---

### 18. Suggested implementation phases (so juniors don’t drown)

**Phase 1 — Online core (must ship)**

* Dedicated server authoritative simulation
* Lobby + quick play
* 2–10 players
* Core bombs/explosions
* Timer + enclosement
* Minimal item subset: BombUp/FireUp/SpeedUp/Kick

**Phase 2 — Atomic identity**

* Add Trigger, Hand, Boxing Glove, Jelly, Spooge, Random, Skull/Ebola
* Gold Bomberman roulette ([Random Hoo Haas][3])
* Scheme/theme selection

**Phase 3 — Editor + community**

* In-browser scheme editor
* Map sharing + browsing + reporting

**Phase 4 — Competitive polish**

* Ranked queue
* Replays
* Spectator improvements
* Binary protocol optimization

[1]: https://en.wikipedia.org/wiki/Atomic_Bomberman?utm_source=chatgpt.com "Atomic Bomberman"
[2]: https://bomberman.fandom.com/wiki/Atomic_Bomberman?utm_source=chatgpt.com "Atomic Bomberman"
[3]: https://randomhoohaas.flyingomelette.com/bomb/pc-atom/game.html "ATOMIC BOMBERMAN (gameplay) .:. Ragey's Totally Bombastic Bomberman Shrine Place"
[4]: https://bomberman.fandom.com/wiki/Category%3AAtomic_Bomberman_Items "Category:Atomic Bomberman Items | Bomberman Wiki | Fandom"
[5]: https://steamcommunity.com/app/467810/discussions/0/1480982971157925322/?l=latam&utm_source=chatgpt.com "Atomic Successor :: Splody Discusiones generales"
[6]: https://bomberman.fandom.com/wiki/Atomic_Bomberman "Atomic Bomberman | Bomberman Wiki | Fandom"
[7]: https://bomberman.fandom.com/wiki/Skull "Skull | Bomberman Wiki | Fandom"
[8]: https://www.bombermanboard.com/viewtopic.php?start=860&t=1925&utm_source=chatgpt.com "Power Bomberman 0.7.8b - Page 44"
[9]: https://randomhoohaas.flyingomelette.com/bomb/pc-atom/site/atomic2.htm "Atomic Bomberman"

