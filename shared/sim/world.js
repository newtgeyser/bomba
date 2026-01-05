import {
  ENCLOSEMENT_INTERVAL_TICKS,
  ENCLOSEMENT_START_SECONDS,
  EXPLOSION_TTL_TICKS,
  MAX_PLAYERS,
  SUBTILE,
  TICK_HZ,
} from '../constants.js';
import { ItemType, TileType } from '../scheme/schema.js';
import { validateScheme } from '../scheme/validate.js';
import { applyClosingBlock, makeEnclosementOrder } from './enclosement.js';
import { makeRng, randInt } from './rng.js';
import { applyDiseaseEffects, tickDiseases, transferOldestDisease } from './diseases.js';
import { applyItemPickup } from './items.js';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function key(x, y) {
  return `${x},${y}`;
}

function sign(n) {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

function normalize2(x, y) {
  const len = Math.hypot(x, y);
  if (len === 0) return [0, 0];
  return [x / len, y / len];
}

export function makeWorld({ scheme, seed, settings }) {
  validateScheme(scheme);
  const rng = makeRng(seed);

  const PLAYER_RADIUS = Math.round(0.33 * SUBTILE);

  const world = {
    width: scheme.width,
    height: scheme.height,
    tiles: scheme.tiles.slice(),
    tick: 0,

    seed,
    rng,

    players: new Map(), // id -> player
    bombs: new Map(), // id -> bomb
    bombsByTile: new Map(), // "x,y" -> bombId
    explosions: new Map(), // id -> explosion
    items: new Map(), // "x,y" -> itemDrop
    hiddenItems: new Map(), // "x,y" -> ItemType (for soft blocks)

    // Round state
    roundSeconds: settings.roundSeconds,
    roundTicksRemaining: settings.roundSeconds === Infinity ? Infinity : settings.roundSeconds * TICK_HZ,
    enclosementDepth: settings.enclosementDepth,
    enclosementActive: false,
    enclosementOrder: [],
    enclosementIndex: 0,
    enclosementCooldown: 0,

    nextEntityId: 1,

    // Methods assigned below
    addPlayer: null,
    removePlayer: null,
    step: null,
    getSnapshot: null,
    applyInput: null,
    removeBomb: null,
    spawnBomb: null,
    detonateBomb: null,
    spawnItem: null,
    rollSelectItem: null,
    playerTile: null,
  };

  world.addPlayer = (player) => {
    if (world.players.size >= MAX_PLAYERS) throw new Error('Room full');
    world.players.set(player.id, player);
  };

  world.removePlayer = (playerId) => {
    world.players.delete(playerId);
  };

  world.applyInput = (playerId, input) => {
    const p = world.players.get(playerId);
    if (!p) return;
    p.input = input;
  };

  world.removeBomb = (bombId, { silent } = { silent: false }) => {
    const bomb = world.bombs.get(bombId);
    if (!bomb) return;
    const owner = world.players.get(bomb.ownerId);
    if (owner?.triggerBombs?.length) {
      owner.triggerBombs = owner.triggerBombs.filter((id) => id !== bombId);
    }
    world.bombs.delete(bombId);
    world.bombsByTile.delete(key(bomb.tx, bomb.ty));
    if (!silent) world.events.push({ t: 'bomb_removed', id: bombId });
  };

  world.events = [];

  world.playerTile = (p) => playerTile(p);

  world.spawnItem = ({ tx, ty, type }) => {
    if (isBlockingTile(tx, ty)) return false;
    if (world.items.has(key(tx, ty))) return false;
    world.items.set(key(tx, ty), { type });
    return true;
  };

  function tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return TileType.Hard;
    return world.tiles[ty * world.width + tx];
  }

  function isBlockingTile(tx, ty) {
    const t = tileAt(tx, ty);
    return t === TileType.Hard || t === TileType.Soft;
  }

  function isBlockedForPlayer(p, tx, ty) {
    if (isBlockingTile(tx, ty)) return true;
    const bombId = world.bombsByTile.get(key(tx, ty));
    if (!bombId) return false;
    const bomb = world.bombs.get(bombId);
    if (!bomb) return false;
    if (bomb.passableBy.has(p.id)) return false;
    return true;
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(world.rng, 0, i);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  const MAP_SPAWNABLE_ITEMS = [
    ItemType.BombUp,
    ItemType.FireUp,
    ItemType.FullFire,
    ItemType.SpeedUp,
    ItemType.Kick,
    ItemType.BoxingGlove,
    ItemType.PowerGlove,
    ItemType.RemoteControl,
    ItemType.RubberBomb,
    ItemType.LineBomb,
    ItemType.Skull,
    ItemType.SelectItem,
  ];

  const RANDOM_ALLOWED_ITEMS = MAP_SPAWNABLE_ITEMS.filter((it) => {
    if (it === ItemType.SpeedDown) return false;
    if (it === ItemType.SelectItem) return false;
    const rule = scheme.itemRules.items[it];
    return !rule?.forbidInRandom;
  });

  world.rollSelectItem = () => {
    if (RANDOM_ALLOWED_ITEMS.length === 0) return null;
    const idx = randInt(world.rng, 0, RANDOM_ALLOWED_ITEMS.length - 1);
    return RANDOM_ALLOWED_ITEMS[idx];
  };

  function initHiddenItems() {
    const density = scheme.itemRules.densityPercent / 100;
    const soft = [];
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (world.tiles[y * world.width + x] === TileType.Soft) soft.push([x, y]);
      }
    }

    const itemTiles = soft.filter(() => world.rng() < density);
    shuffleInPlace(itemTiles);

    // FixedCount allocations.
    const fixed = [];
    for (const it of MAP_SPAWNABLE_ITEMS) {
      const r = scheme.itemRules.items[it]?.override;
      if (r?.mode === 'FixedCount' && r.value > 0) fixed.push({ it, count: r.value });
    }
    for (const f of fixed) {
      for (let i = 0; i < f.count && itemTiles.length; i++) {
        const [x, y] = itemTiles.pop();
        world.hiddenItems.set(key(x, y), f.it);
      }
    }

    // Weighted random for remaining tiles.
    const weighted = [];
    for (const it of MAP_SPAWNABLE_ITEMS) {
      const r = scheme.itemRules.items[it]?.override;
      let w = 1;
      if (r?.mode === 'ChanceIn10') w = clamp(r.value / 10, 0, 1);
      if (r?.mode === 'FixedCount') w = 0;
      if (w <= 0) continue;
      weighted.push({ it, w });
    }
    const total = weighted.reduce((s, e) => s + e.w, 0);
    const pickWeighted = () => {
      if (total <= 0) return ItemType.BombUp;
      const r = world.rng() * total;
      let acc = 0;
      for (const e of weighted) {
        acc += e.w;
        if (r <= acc) return e.it;
      }
      return weighted[weighted.length - 1]?.it ?? ItemType.BombUp;
    };

    for (const [x, y] of itemTiles) {
      world.hiddenItems.set(key(x, y), pickWeighted());
    }
  }

  function playerTile(p) {
    return [Math.floor(p.x / SUBTILE), Math.floor(p.y / SUBTILE)];
  }

  function playerOverlapsTile(p, tx, ty) {
    const r = PLAYER_RADIUS;
    const samples = [
      [p.x - r, p.y - r],
      [p.x + r, p.y - r],
      [p.x - r, p.y + r],
      [p.x + r, p.y + r],
    ];
    for (const [sx, sy] of samples) {
      const stx = Math.floor(sx / SUBTILE);
      const sty = Math.floor(sy / SUBTILE);
      if (stx === tx && sty === ty) return true;
    }
    return false;
  }

  function killPlayer(p, reason) {
    if (!p.alive) return;
    p.alive = false;
    p.deathReason = reason;
    world.events.push({ t: 'player_dead', id: p.id, reason });
  }

  initHiddenItems();

  function getFacingDir(p) {
    const fx = sign(p.facing?.[0] ?? 1);
    const fy = sign(p.facing?.[1] ?? 0);
    if (fx !== 0) return [fx, 0];
    if (fy !== 0) return [0, fy];
    return [1, 0];
  }

  function findFarthestLandingTile(fromTx, fromTy, dirX, dirY) {
    let candidate = null;
    const maxSteps = world.width + world.height;
    for (let i = 1; i <= maxSteps; i++) {
      const tx = fromTx + dirX * i;
      const ty = fromTy + dirY * i;
      if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) break;
      if (tileAt(tx, ty) !== TileType.Floor) continue;
      if (world.bombsByTile.has(key(tx, ty))) continue;
      candidate = [tx, ty];
    }
    return candidate;
  }

  function tryPunchBomb(p, { poopsDisabled } = {}) {
    if (!p.ability.boxing) return false;
    if (poopsDisabled) return false;
    const [dx, dy] = getFacingDir(p);
    const [tx, ty] = playerTile(p);
    const bx = tx + dx;
    const by = ty + dy;
    const bombId = world.bombsByTile.get(key(bx, by));
    if (!bombId) return false;
    const bomb = world.bombs.get(bombId);
    if (!bomb || bomb.moving) return false;
    const landing = findFarthestLandingTile(bx, by, dx, dy);
    if (!landing) return false;
    const [lx, ly] = landing;
    world.bombsByTile.delete(key(bomb.tx, bomb.ty));
    bomb.tx = lx;
    bomb.ty = ly;
    world.bombsByTile.set(key(bomb.tx, bomb.ty), bomb.id);
    world.events.push({ t: 'bomb_punched', id: bomb.id, ownerId: p.id, tx: lx, ty: ly, dx, dy });
    return true;
  }

  function tryPickUpBomb(p) {
    if (!p.ability.hand) return false;
    if (p.carryingBomb) return false;
    const [dx, dy] = getFacingDir(p);
    const [tx, ty] = playerTile(p);
    const bx = tx + dx;
    const by = ty + dy;
    const bombId = world.bombsByTile.get(key(bx, by));
    if (!bombId) return false;
    const bomb = world.bombs.get(bombId);
    if (!bomb || bomb.moving) return false;

    world.removeBomb(bombId, { silent: true });
    p.carryingBomb = {
      ...bomb,
      tx: null,
      ty: null,
      moving: null,
      passableBy: new Set(),
    };
    world.events.push({ t: 'bomb_picked_up', playerId: p.id, bombId });
    return true;
  }

  function throwCarriedBomb(p) {
    const bomb = p.carryingBomb;
    if (!bomb) return false;
    const [dx, dy] = getFacingDir(p);
    const [tx, ty] = playerTile(p);
    const landing = findFarthestLandingTile(tx, ty, dx, dy);
    if (!landing) return false;
    const [lx, ly] = landing;

    const fuseTicks = bomb.flags?.trigger ? Infinity : bomb.fuseTicks;
    const spawned = world.spawnBomb({
      tx: lx,
      ty: ly,
      ownerId: p.id,
      flame: bomb.flame,
      fuseTicks,
      flags: bomb.flags,
      passableBy: new Set(),
    });
    if (!spawned) return false;
    p.carryingBomb = null;
    world.events.push({ t: 'bomb_thrown', playerId: p.id, bombId: spawned.id, tx: lx, ty: ly, dx, dy });
    return true;
  }

  function lineBomb(p) {
    if (!p.ability.spooge) return false;
    const [dx, dy] = getFacingDir(p);
    const [tx, ty] = playerTile(p);
    let cx = tx + dx;
    let cy = ty + dy;
    const available = Math.max(0, p.stats.bombCap - p.bombsPlaced);
    let placed = 0;
    while (placed < available) {
      if (cx < 0 || cy < 0 || cx >= world.width || cy >= world.height) break;
      if (tileAt(cx, cy) !== TileType.Floor) {
        cx += dx;
        cy += dy;
        continue;
      }
      if (world.bombsByTile.has(key(cx, cy))) {
        cx += dx;
        cy += dy;
        continue;
      }
      const bomb = world.spawnBomb({
        tx: cx,
        ty: cy,
        ownerId: p.id,
        flame: p.stats.flame,
        fuseTicks: p.ability.trigger ? Infinity : p.stats.fuseTicks,
        flags: { trigger: p.ability.trigger, jelly: p.ability.jelly },
        passableBy: new Set(),
      });
      if (bomb) placed++;
      cx += dx;
      cy += dy;
    }
    if (placed > 0) {
      p.bombsPlaced += placed;
      world.events.push({ t: 'spooge', playerId: p.id, placed });
      return true;
    }
    return false;
  }

  function handleDropPressed(p, { constipation, poops } = {}) {
    if (constipation) return;
    if (p.ability.hand && tryPickUpBomb(p)) return;

    if (p.ability.spooge) {
      const window = 12; // ~200ms at 60Hz
      const last = p.lastDropTick ?? -9999;
      p.lastDropTick = world.tick;
      if (world.tick - last <= window) {
        if (lineBomb(p)) return;
      }
    }

    placeBomb(p);
    if (poops) placeBomb(p);
  }

  function handleSecondaryPressed(p, { poopsDisabledGlove } = {}) {
    if (p.carryingBomb) return throwCarriedBomb(p);
    if (p.ability.trigger && p.triggerBombs?.length) {
      const next = p.triggerBombs[0];
      world.detonateBomb(next);
      return true;
    }
    if (tryPunchBomb(p, { poopsDisabled: poopsDisabledGlove })) return true;
    if (stopOwnedMovingBomb(p)) return true;
    return false;
  }

  function placeBomb(p) {
    if (!p.alive) return;
    if (p.bombsPlaced >= p.stats.bombCap) return;
    const [tx, ty] = playerTile(p);
    if (isBlockingTile(tx, ty)) return;
    if (world.bombsByTile.has(key(tx, ty))) return;

    const fuseTicks = p.ability.trigger ? Infinity : p.stats.fuseTicks;
    const bomb = world.spawnBomb({
      tx,
      ty,
      ownerId: p.id,
      flame: p.stats.flame,
      fuseTicks,
      flags: { trigger: p.ability.trigger, jelly: p.ability.jelly },
      passableBy: new Set([p.id]),
    });
    if (bomb) p.bombsPlaced++;
  }

  world.spawnBomb = ({ tx, ty, ownerId, flame, fuseTicks, passableBy, flags }) => {
    if (isBlockingTile(tx, ty)) return null;
    if (world.bombsByTile.has(key(tx, ty))) return null;
    const id = `b${world.nextEntityId++}`;
    const bomb = {
      id,
      tx,
      ty,
      ownerId,
      flame,
      fuseTicks,
      moving: null, // { dx, dy, cooldown, ownerId }
      passableBy: passableBy ?? new Set(),
      flags: flags ?? {},
    };
    world.bombs.set(id, bomb);
    world.bombsByTile.set(key(tx, ty), id);
    world.events.push({ t: 'bomb_placed', id, tx, ty, ownerId });

    const owner = world.players.get(ownerId);
    if (owner && bomb.flags.trigger) {
      if (!owner.triggerBombs) owner.triggerBombs = [];
      owner.triggerBombs.push(id);
    }
    return bomb;
  };

  world.detonateBomb = (bombId) => {
    detonationQueue.push({ id: bombId, chain: false });
    // Best-effort immediate processing so callers (tests/trigger) see effects now.
    while (detonationQueue.length) {
      const next = detonationQueue.shift();
      if (!next) break;
      if (!world.bombs.has(next.id)) continue;
      detonateBombById(next.id, { chain: next.chain });
    }
  };

  function revealHiddenItem(tx, ty) {
    const it = world.hiddenItems.get(key(tx, ty));
    if (!it) return;
    world.hiddenItems.delete(key(tx, ty));
    world.spawnItem({ tx, ty, type: it });
  }

  function detonateBombById(bombId, { chain } = { chain: false }) {
    const bomb = world.bombs.get(bombId);
    if (!bomb) return;
    world.removeBomb(bomb.id);
    const id = `e${world.nextEntityId++}`;
    const tiles = [];
    tiles.push([bomb.tx, bomb.ty]);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      for (let i = 1; i <= bomb.flame; i++) {
        const tx = bomb.tx + dx * i;
        const ty = bomb.ty + dy * i;
        const t = tileAt(tx, ty);
        if (t === TileType.Hard) break;
        tiles.push([tx, ty]);
        if (t === TileType.Soft) break;
      }
    }

    const explosion = {
      id,
      tiles,
      ttl: EXPLOSION_TTL_TICKS,
    };
    world.explosions.set(id, explosion);
    world.events.push({ t: 'explosion', id, tiles, chain });

    // Apply immediate tile effects: destroy soft, chain bombs.
    for (const [tx, ty] of tiles) {
      const idx = ty * world.width + tx;
      if (world.tiles[idx] === TileType.Soft) {
        world.tiles[idx] = TileType.Floor;
        revealHiddenItem(tx, ty);
      } else if (scheme.itemRules.itemsDestructible) {
        world.items.delete(key(tx, ty));
      }
      const otherBombId = world.bombsByTile.get(key(tx, ty));
      if (otherBombId) {
        detonationQueue.push({ id: otherBombId, chain: true });
      }
    }
  }

  function pickupItem(p) {
    const [tx, ty] = playerTile(p);
    const drop = world.items.get(key(tx, ty));
    if (!drop) return;
    world.items.delete(key(tx, ty));
    applyItemPickup(world, p, drop.type);
    world.events.push({ t: 'item_pickup', playerId: p.id, item: drop.type });
  }

  function tryKickBomb(p, dirX, dirY) {
    if (!p.ability.kick) return false;
    const [tx, ty] = playerTile(p);
    const frontX = tx + dirX;
    const frontY = ty + dirY;
    const bombId = world.bombsByTile.get(key(frontX, frontY));
    if (!bombId) return false;
    const bomb = world.bombs.get(bombId);
    if (!bomb || bomb.moving) return false;

    const nextX = frontX + dirX;
    const nextY = frontY + dirY;
    if (isBlockingTile(nextX, nextY) || world.bombsByTile.has(key(nextX, nextY))) return false;

    bomb.moving = { dx: dirX, dy: dirY, cooldown: 0, ownerId: p.id };
    world.events.push({ t: 'bomb_kicked', id: bomb.id, dx: dirX, dy: dirY, ownerId: p.id });
    return true;
  }

  function stopOwnedMovingBomb(p) {
    for (const bomb of world.bombs.values()) {
      if (!bomb.moving) continue;
      if (bomb.moving.ownerId !== p.id) continue;
      bomb.moving = null;
      world.events.push({ t: 'bomb_stopped', id: bomb.id, ownerId: p.id });
      return true;
    }
    return false;
  }

  const detonationQueue = [];

  function updateBombs() {
    const bombs = [...world.bombs.values()];
    for (const bomb of bombs) {
      // Owner bomb-pass only until fully leaving (hurtbox no longer overlaps).
      for (const pid of [...bomb.passableBy]) {
        const p = world.players.get(pid);
        if (!p?.alive) {
          bomb.passableBy.delete(pid);
          continue;
        }
        if (!playerOverlapsTile(p, bomb.tx, bomb.ty)) bomb.passableBy.delete(pid);
      }

      if (bomb.fuseTicks !== Infinity) bomb.fuseTicks = Math.max(0, bomb.fuseTicks - 1);

      if (bomb.moving) {
        bomb.moving.cooldown = Math.max(0, bomb.moving.cooldown - 1);
        if (bomb.moving.cooldown === 0) {
          const nx = bomb.tx + bomb.moving.dx;
          const ny = bomb.ty + bomb.moving.dy;
          const blocked = isBlockingTile(nx, ny) || world.bombsByTile.has(key(nx, ny));
          if (blocked) {
            if (bomb.flags?.jelly) {
              // Bounce: reverse direction if possible.
              const rdx = -bomb.moving.dx;
              const rdy = -bomb.moving.dy;
              const bx = bomb.tx + rdx;
              const by = bomb.ty + rdy;
              const canBounce = !(isBlockingTile(bx, by) || world.bombsByTile.has(key(bx, by)));
              if (canBounce) {
                bomb.moving.dx = rdx;
                bomb.moving.dy = rdy;
                bomb.moving.cooldown = 2;
              } else {
                bomb.moving = null;
              }
            } else {
              bomb.moving = null;
            }
          } else {
            world.bombsByTile.delete(key(bomb.tx, bomb.ty));
            bomb.tx = nx;
            bomb.ty = ny;
            world.bombsByTile.set(key(bomb.tx, bomb.ty), bomb.id);
            bomb.moving.cooldown = 2; // ~30 tiles/sec worst-case; tuned later
          }
        }
      }

      if (bomb.fuseTicks === 0) detonationQueue.push({ id: bomb.id, chain: true });
    }

    // Process detonations (including same-tick chain reactions).
    while (detonationQueue.length) {
      const next = detonationQueue.shift();
      if (!next) break;
      if (!world.bombs.has(next.id)) continue;
      detonateBombById(next.id, { chain: next.chain });
    }
  }

  function updateExplosions() {
    for (const ex of world.explosions.values()) {
      ex.ttl -= 1;
      if (ex.ttl <= 0) world.explosions.delete(ex.id);
    }
  }

  function applyExplosionsToPlayers() {
    if (world.explosions.size === 0) return;
    const hot = new Set();
    for (const ex of world.explosions.values()) {
      for (const [tx, ty] of ex.tiles) hot.add(key(tx, ty));
    }
    for (const p of world.players.values()) {
      if (!p.alive) continue;
      const [tx, ty] = playerTile(p);
      if (hot.has(key(tx, ty))) killPlayer(p, 'explosion');
    }
  }

  function updateEnclosement() {
    if (world.roundTicksRemaining === Infinity) return;
    const secondsRemaining = Math.ceil(world.roundTicksRemaining / TICK_HZ);
    if (!world.enclosementActive && secondsRemaining <= ENCLOSEMENT_START_SECONDS) {
      world.enclosementActive = true;
      world.enclosementOrder = makeEnclosementOrder(world.width, world.height, world.enclosementDepth);
      world.enclosementIndex = 0;
      world.enclosementCooldown = 0;
      world.events.push({ t: 'enclosement_start' });
    }
    if (!world.enclosementActive) return;

    world.enclosementCooldown = Math.max(0, world.enclosementCooldown - 1);
    if (world.enclosementCooldown > 0) return;
    const c = world.enclosementOrder[world.enclosementIndex];
    if (!c) return;

    const [x, y] = c;
    // Crush any player on the tile.
    for (const p of world.players.values()) {
      if (!p.alive) continue;
      const [ptx, pty] = playerTile(p);
      if (ptx === x && pty === y) killPlayer(p, 'enclosement');
    }
    applyClosingBlock(world, x, y);
    world.events.push({ t: 'closing_block', x, y });
    world.enclosementIndex++;
    world.enclosementCooldown = ENCLOSEMENT_INTERVAL_TICKS;
  }

  function movePlayer(p) {
    if (!p.alive) return;
    const inp = p.input ?? {};

    tickDiseases(p);
    const { effectiveStats, flags } = applyDiseaseEffects({
      baseStats: p.statsBase,
      diseases: p.diseases,
      ability: p.ability,
    });
    p.stats = effectiveStats;
    p.diseaseFlags = flags;

    let rawX = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let rawY = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (flags.reverseControls) {
      rawX *= -1;
      rawY *= -1;
    }
    let [dx, dy] = normalize2(rawX, rawY);

    if (dx !== 0 || dy !== 0) {
      // Prefer cardinal facing for item actions.
      if (Math.abs(rawX) >= Math.abs(rawY)) p.facing = [sign(rawX), 0];
      else p.facing = [0, sign(rawY)];
      if (p.facing[0] === 0 && p.facing[1] === 0) p.facing = [1, 0];
    }

    // Approx: 1 speed unit = 0.08 tiles/tick.
    const tilesPerTick = 0.05 + p.stats.speed * 0.01;
    const step = Math.round(tilesPerTick * SUBTILE);
    const targetX = p.x + Math.round(dx * step);
    const targetY = p.y + Math.round(dy * step);

    // Collision sampling at a radius.
    const r = PLAYER_RADIUS;
    const tryMove = (nx, ny) => {
      const samples = [
        [nx - r, ny - r],
        [nx + r, ny - r],
        [nx - r, ny + r],
        [nx + r, ny + r],
      ];
      for (const [sx, sy] of samples) {
        const tx = Math.floor(sx / SUBTILE);
        const ty = Math.floor(sy / SUBTILE);
        if (isBlockedForPlayer(p, tx, ty)) return false;
      }
      p.x = nx;
      p.y = ny;
      return true;
    };

    // Slide: try full, then axis-only.
    if (!tryMove(targetX, targetY)) {
      tryMove(targetX, p.y);
      tryMove(p.x, targetY);
    }

    pickupItem(p);

    if (inp.dropPressed) handleDropPressed(p, { constipation: flags.constipation, poops: flags.poops });

    if (inp.secondaryPressed) {
      handleSecondaryPressed(p, { poopsDisabledGlove: flags.poops });
    }

    // Poops: auto-drop bombs when possible.
    if (flags.poops && !flags.constipation && !inp.dropPressed) {
      placeBomb(p);
    }
    // Poops: if carrying a bomb, throw it.
    if (flags.poops && p.carryingBomb && !inp.secondaryPressed) {
      throwCarriedBomb(p);
    }
  }

  world.step = () => {
    world.events = [];
    world.tick++;

    if (world.roundTicksRemaining !== Infinity) {
      world.roundTicksRemaining = Math.max(0, world.roundTicksRemaining - 1);
    }

    updateEnclosement();

    for (const p of world.players.values()) movePlayer(p);

    // Disease transfer by touch (tagging).
    {
      const alive = [...world.players.values()].filter((p) => p.alive);
      const r = Math.round(0.33 * SUBTILE);
      const touchDist2 = (2 * r) ** 2;
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy > touchDist2) continue;
          const aDiseased = (a.diseases?.length ?? 0) > 0;
          const bDiseased = (b.diseases?.length ?? 0) > 0;
          if (aDiseased && !bDiseased) {
            if (transferOldestDisease(a, b)) world.events.push({ t: 'disease_transfer', from: a.id, to: b.id });
          } else if (bDiseased && !aDiseased) {
            if (transferOldestDisease(b, a)) world.events.push({ t: 'disease_transfer', from: b.id, to: a.id });
          }
        }
      }
    }

    updateBombs();
    updateExplosions();
    applyExplosionsToPlayers();

    // Kick detection after movement: if player is trying to move into a bomb tile.
    for (const p of world.players.values()) {
      if (!p.alive) continue;
      const inp = p.input ?? {};
      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (p.diseaseFlags?.reverseControls) {
        dx *= -1;
        dy *= -1;
      }
      if (dx === 0 && dy === 0) continue;
      const dirX = Math.abs(dx) >= Math.abs(dy) ? sign(dx) : 0;
      const dirY = Math.abs(dy) > Math.abs(dx) ? sign(dy) : 0;
      if (dirX === 0 && dirY === 0) continue;
      tryKickBomb(p, dirX, dirY);
    }
  };

  world.getSnapshot = () => {
    const players = [];
    for (const p of world.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        alive: p.alive,
        color: p.color,
        team: p.team ?? 'None',
        stats: p.stats,
        statsBase: p.statsBase,
        ability: p.ability,
        diseases: (p.diseases ?? []).map((d) => d.type),
        carrying: !!p.carryingBomb,
        isGold: !!p.isGold,
      });
    }
    const bombs = [];
    for (const b of world.bombs.values()) {
      bombs.push({
        id: b.id,
        tx: b.tx,
        ty: b.ty,
        fuseTicks: b.fuseTicks,
        flame: b.flame,
        moving: b.moving ? { dx: b.moving.dx, dy: b.moving.dy } : null,
        flags: b.flags ?? {},
      });
    }
    const explosions = [];
    for (const e of world.explosions.values()) explosions.push({ id: e.id, tiles: e.tiles, ttl: e.ttl });
    const items = [];
    for (const [k2, it] of world.items) {
      const [x, y] = k2.split(',').map((n) => Number.parseInt(n, 10));
      items.push({ x, y, type: it.type });
    }

    return {
      tick: world.tick,
      width: world.width,
      height: world.height,
      tiles: world.tiles,
      players,
      bombs,
      explosions,
      items,
      roundTicksRemaining: world.roundTicksRemaining,
      events: world.events,
    };
  };

  return world;
}

export function makePlayer({ id, name, color, spawnTx, spawnTy, scheme }) {
  const born = scheme.itemRules.items;
  const bombCap = clamp(1 + (born.BombUp?.bornWith ?? 0), 1, 10);
  const flame = clamp(1 + (born.FireUp?.bornWith ?? 0), 1, 10);
  return {
    id,
    name,
    color,
    team: 'None',
    isGold: false,
    alive: true,
    x: spawnTx * SUBTILE + SUBTILE / 2,
    y: spawnTy * SUBTILE + SUBTILE / 2,
    facing: [1, 0],
    input: null,
    bombsPlaced: 0,
    statsBase: {
      speed: 5,
      bombCap,
      flame,
      fuseTicks: 120,
    },
    stats: {
      speed: 5,
      bombCap,
      flame,
      fuseTicks: 120,
    },
    ability: {
      kick: false,
      boxing: false,
      hand: false,
      trigger: false,
      jelly: false,
      spooge: false,
      fullFire: false,
    },
    triggerBombs: [],
    diseases: [],
    diseaseFlags: null,
    carryingBomb: null,
    lastDropTick: null,
  };
}
