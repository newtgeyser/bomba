import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemType, TileType } from '../scheme/schema.js';
import { validateScheme } from '../scheme/validate.js';
import { makePlayer, makeWorld } from './world.js';
import { EnclosementDepth } from './enclosement.js';

function makeTinyScheme() {
  const width = 7;
  const height = 7;
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
    id: 'tiny',
    name: 'Tiny',
    width,
    height,
    tiles,
    spawns: [
      { x: 1, y: 1, spawnIndex: 0, team: 'None' },
      { x: 5, y: 5, spawnIndex: 1, team: 'None' },
    ],
    itemRules: { densityPercent: 0, items, itemsDestructible: true, conflictPolicy: 'EjectOld' },
  };
  return validateScheme(scheme);
}

test('bomb explosion is blocked by hard and destroys soft', () => {
  const scheme = makeTinyScheme();
  // Put a soft block and a hard block in the blast line.
  scheme.tiles[1 * scheme.width + 3] = TileType.Soft;
  scheme.tiles[1 * scheme.width + 4] = TileType.Hard;

  const world = makeWorld({ scheme, seed: 1, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);

  const bomb = world.spawnBomb({ tx: 2, ty: 1, ownerId: 'p1', flame: 10, fuseTicks: 1, passableBy: new Set() });
  assert.ok(bomb);

  world.step(); // fuse -> 0 and detonates this tick

  // Soft should be destroyed.
  assert.equal(scheme.tiles[1 * scheme.width + 3], TileType.Soft);
  assert.equal(world.tiles[1 * scheme.width + 3], TileType.Floor);

  // Tiles behind hard must not be in any explosion.
  const allExplosionTiles = new Set(
    [...world.explosions.values()].flatMap((e) => e.tiles.map(([x, y]) => `${x},${y}`)),
  );
  assert.equal(allExplosionTiles.has('5,1'), false);
});

test('chain reaction detonates within the same tick', () => {
  const scheme = makeTinyScheme();
  const world = makeWorld({ scheme, seed: 2, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  world.addPlayer(p);

  const a = world.spawnBomb({ tx: 2, ty: 2, ownerId: 'p1', flame: 2, fuseTicks: 1, passableBy: new Set() });
  const b = world.spawnBomb({ tx: 3, ty: 2, ownerId: 'p1', flame: 2, fuseTicks: 999, passableBy: new Set() });
  assert.ok(a && b);

  world.step();
  assert.equal(world.bombs.size, 0);
  assert.ok(world.explosions.size >= 2);
});

test('bomb-pass lets owner escape but prevents re-entry', () => {
  const scheme = makeTinyScheme();
  const world = makeWorld({ scheme, seed: 3, settings: { roundSeconds: Infinity, enclosementDepth: EnclosementDepth.None } });
  const p = makePlayer({ id: 'p1', name: 'p1', color: '#fff', spawnTx: 1, spawnTy: 1, scheme });
  p.statsBase.fuseTicks = 10_000;
  p.stats.fuseTicks = 10_000;
  world.addPlayer(p);

  // Place bomb without moving.
  p.input = { dropPressed: true };
  world.step();
  assert.equal(world.bombs.size, 1);

  // Move right for a while; should not get stuck on own bomb.
  let lastX = p.x;
  for (let i = 0; i < 40; i++) {
    p.input = { right: true };
    world.step();
    assert.ok(p.x >= lastX);
    lastX = p.x;
  }
  const tileAfter = [Math.floor(p.x / 256), Math.floor(p.y / 256)];
  assert.ok(tileAfter[0] >= 2);
  assert.ok(p.x > 512 + 70); // safely clear of original tile + radius-ish

  // Try to go back left onto the bomb tile; should be blocked.
  for (let i = 0; i < 80; i++) {
    p.input = { left: true };
    world.step();
  }
  const tileBack = [Math.floor(p.x / 256), Math.floor(p.y / 256)];
  assert.ok(tileBack[0] >= 2);
});
