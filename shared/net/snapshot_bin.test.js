import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshotBin, decodeSnapshotBin } from './snapshot_bin.js';
import { TileType, ItemType } from '../scheme/schema.js';

test('binary snapshot codec round-trips basic fields', () => {
  const snap = {
    tick: 123,
    width: 5,
    height: 4,
    roundTicksRemaining: 999,
    tiles: [
      TileType.Floor,
      TileType.Hard,
      TileType.Soft,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
      TileType.Floor,
    ],
    players: [
      { id: 'a', name: 'A', color: '#fff', x: 300, y: 400, alive: true, team: 'None', isGold: true, stats: { speed: 5, bombCap: 2, flame: 3 }, diseases: [] },
      { id: 'b', name: 'B', color: '#fff', x: 500, y: 600, alive: false, team: 'Red', isGold: false, stats: { speed: 6, bombCap: 1, flame: 1 }, diseases: ['X'] },
    ],
    bombs: [{ id: 'b1', tx: 2, ty: 2, fuseTicks: Infinity, flame: 4, flags: { trigger: true, jelly: false }, moving: { dx: 1, dy: 0 } }],
    explosions: [{ id: 'e1', ttl: 5, tiles: [[2, 2]] }],
    items: [{ x: 1, y: 1, type: ItemType.Kick }],
    events: [],
  };

  const encoded = encodeSnapshotBin(snap);
  const decoded = decodeSnapshotBin(encoded, { players: snap.players.map((p) => ({ id: p.id, name: p.name, color: p.color })) });

  assert.equal(decoded.tick, snap.tick);
  assert.equal(decoded.width, snap.width);
  assert.equal(decoded.height, snap.height);
  assert.equal(decoded.roundTicksRemaining, snap.roundTicksRemaining);
  assert.equal(decoded.tiles.length, snap.tiles.length);
  assert.equal(decoded.players.length, 2);
  assert.equal(decoded.players[0].id, 'a');
  assert.equal(decoded.players[0].isGold, true);
  assert.equal(decoded.players[1].team, 'Red');
  assert.equal(decoded.bombs.length, 1);
  assert.equal(decoded.bombs[0].fuseTicks, Infinity);
  assert.equal(decoded.items[0].type, ItemType.Kick);
});

