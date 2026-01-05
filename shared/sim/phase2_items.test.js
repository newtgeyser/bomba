import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemType, TileType } from '../scheme/schema.js';
import { validateScheme } from '../scheme/validate.js';
import { makePlayer, makeWorld } from './world.js';
import { EnclosementDepth } from './enclosement.js';
import { addDisease, DiseaseType } from './diseases.js';
import { applyItemPickup } from './items.js';

function makeFlatScheme() {
  const width = 9;
  const height = 5;
  const tiles = new Array(width * height).fill(TileType.Floor);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border) tiles[y * width + x] = TileType.Hard;
    }
  }
  const items = {};
  for (const it of Object.values(ItemType)) {
    items[it] = { bornWith: 0, forbidInRandom: false, override: { mode: 'Default', value: 0 } };
  }
  const scheme = {
    id: 'flat',
    name: 'Flat',
    width,
    height,
    tiles,
    spawns: [
      { x: 1, y: 1, spawnIndex: 0, team: 'None' },
      { x: 7, y: 3, spawnIndex: 1, team: 'None' },
    ],
    itemRules: { densityPercent: 0, items, itemsDestructible: true, conflictPolicy: 'EjectOld' },
  };
  return validateScheme(scheme);
}

test('trigger bombs do not auto explode; secondary detonates in order', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 1, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);

  applyItemPickup(world, p, ItemType.RemoteControl);
  assert.equal(p.ability.trigger, true);
  p.statsBase.bombCap = 2;

  p.input = { dropPressed: true };
  world.step();
  assert.equal(world.bombs.size, 1);
  const [b1] = [...world.bombs.values()];
  assert.equal(b1.fuseTicks, Infinity);

  // Place a second trigger bomb.
  p.x = 3 * 256 + 128;
  p.y = 1 * 256 + 128;
  p.input = { dropPressed: true };
  world.step();
  assert.equal(world.bombs.size, 2);
  assert.equal(p.triggerBombs.length, 2);
  const first = p.triggerBombs[0];
  const second = p.triggerBombs[1];
  assert.notEqual(first, second);

  // Let time pass; bombs should not detonate.
  for (let i = 0; i < 180; i++) {
    p.input = {};
    world.step();
  }
  assert.equal(world.bombs.size, 2);

  // Detonate in order.
  p.input = { secondaryPressed: true };
  world.step();
  assert.equal(p.triggerBombs.includes(first), false);
  assert.equal(p.triggerBombs[0], second);
});

test('boxing glove is ejected when picking up trigger', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 2, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);

  applyItemPickup(world, p, ItemType.BoxingGlove);
  assert.equal(p.ability.boxing, true);

  applyItemPickup(world, p, ItemType.RemoteControl);
  assert.equal(p.ability.trigger, true);
  assert.equal(p.ability.boxing, false);

  const tileKey = `${Math.floor(p.x / 256)},${Math.floor(p.y / 256)}`;
  assert.equal(world.items.get(tileKey)?.type, ItemType.BoxingGlove);
});

test('punch moves a bomb over walls to a farther floor tile', () => {
  const scheme = makeFlatScheme();
  // Insert a wall between bomb and landing.
  scheme.tiles[1 * scheme.width + 4] = TileType.Hard;
  const world = makeWorld({ scheme, seed: 3, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);
  applyItemPickup(world, p, ItemType.BoxingGlove);

  const bomb = world.spawnBomb({ tx: 2, ty: 1, ownerId: p.id, flame: 2, fuseTicks: 50, passableBy: new Set() });
  assert.ok(bomb);
  p.facing = [1, 0];

  p.input = { secondaryPressed: true };
  world.step();
  // Should land at the farthest empty floor before border (x=7 is border hard).
  const moved = [...world.bombs.values()][0];
  assert.equal(moved.tx, 7);
  assert.equal(moved.ty, 1);
});

test('hand carry pauses fuse while carried and resumes on throw', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 4, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);
  applyItemPickup(world, p, ItemType.PowerGlove);

  const bomb = world.spawnBomb({ tx: 2, ty: 1, ownerId: p.id, flame: 2, fuseTicks: 20, passableBy: new Set() });
  assert.ok(bomb);
  p.facing = [1, 0];

  p.input = { dropPressed: true };
  world.step();
  assert.equal(world.bombs.size, 0);
  assert.ok(p.carryingBomb);
  const carriedFuse = p.carryingBomb.fuseTicks;

  for (let i = 0; i < 10; i++) {
    p.input = {};
    world.step();
  }
  assert.equal(p.carryingBomb.fuseTicks, carriedFuse);

  p.input = { secondaryPressed: true };
  world.step();
  assert.equal(p.carryingBomb, null);
  assert.equal(world.bombs.size, 1);
  const dropped = [...world.bombs.values()][0];
  assert.equal(dropped.fuseTicks, carriedFuse - 1); // decremented during this tick's bomb update
});

test('kicked jelly bombs bounce off obstacles', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 5, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);
  applyItemPickup(world, p, ItemType.Kick);
  applyItemPickup(world, p, ItemType.RubberBomb);

  // Put a hard block at x=3 so the bomb bounces.
  scheme.tiles[1 * scheme.width + 3] = TileType.Hard;
  world.tiles[1 * scheme.width + 3] = TileType.Hard;

  const bomb = world.spawnBomb({
    tx: 2,
    ty: 1,
    ownerId: p.id,
    flame: 2,
    fuseTicks: 999,
    flags: { jelly: true },
    passableBy: new Set(),
  });
  bomb.moving = { dx: 1, dy: 0, cooldown: 0, ownerId: p.id };

  world.step();
  assert.ok(bomb.moving);
  assert.equal(bomb.moving.dx, -1);
});

test('spooge double-tap places a line of bombs', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 6, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);
  applyItemPickup(world, p, ItemType.LineBomb);
  p.statsBase.bombCap = 4;
  p.stats.bombCap = 4;
  p.facing = [1, 0];

  p.input = { dropPressed: true };
  world.step();
  p.input = { dropPressed: true };
  world.step();

  assert.equal(world.bombs.size, 4);
});

test('short flame disease reduces radius unless full fire overrides', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 7, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);

  addDisease(p, DiseaseType.ShortFlame, { source: 'Skull', ttlTicks: 999 });
  p.input = {};
  world.step();
  assert.equal(p.stats.flame, 1);

  applyItemPickup(world, p, ItemType.FullFire);
  world.step();
  assert.equal(p.stats.flame, 10);
});

test('diseases transfer on player touch', () => {
  const scheme = makeFlatScheme();
  const world = makeWorld({ scheme, seed: 8, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const a = makePlayer({ id: 'a', name: 'a', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  const b = makePlayer({ id: 'b', name: 'b', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(a);
  world.addPlayer(b);

  addDisease(a, DiseaseType.Constipation, { source: 'Skull', ttlTicks: 999 });
  // Overlap positions.
  b.x = a.x;
  b.y = a.y;

  world.step();
  assert.equal(a.diseases.length, 0);
  assert.equal(b.diseases.length, 1);
});
