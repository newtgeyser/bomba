import { ARENA_DEFAULT_H, ARENA_DEFAULT_W, MAX_PLAYERS } from '../constants.js';

export const TileType = Object.freeze({
  Floor: 'Floor',
  Hard: 'Hard',
  Soft: 'Soft',
});

export const Team = Object.freeze({
  None: 'None',
  Red: 'Red',
  White: 'White',
});

export const ItemType = Object.freeze({
  BombUp: 'BombUp',
  FireUp: 'FireUp',
  FullFire: 'FullFire',
  SpeedUp: 'SpeedUp',
  SpeedDown: 'SpeedDown',
  Kick: 'Kick',
  BoxingGlove: 'BoxingGlove',
  PowerGlove: 'PowerGlove',
  RemoteControl: 'RemoteControl',
  RubberBomb: 'RubberBomb',
  LineBomb: 'LineBomb',
  Skull: 'Skull',
  SelectItem: 'SelectItem',
});

export function makeDefaultScheme() {
  const width = ARENA_DEFAULT_W;
  const height = ARENA_DEFAULT_H;
  const tiles = new Array(width * height).fill(TileType.Floor);

  // Classic-ish Bomberman hard blocks pattern.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border) tiles[idx] = TileType.Hard;
      else if (x % 2 === 0 && y % 2 === 0) tiles[idx] = TileType.Hard;
      else tiles[idx] = TileType.Soft;
    }
  }

  const spawns = [];
  const spawnCoords = [
    [1, 1],
    [width - 2, 1],
    [1, height - 2],
    [width - 2, height - 2],
    [1, Math.floor(height / 2)],
    [width - 2, Math.floor(height / 2)],
    [Math.floor(width / 2), 1],
    [Math.floor(width / 2), height - 2],
    [3, 1],
    [width - 4, height - 2],
  ];
  for (let i = 0; i < Math.min(MAX_PLAYERS, spawnCoords.length); i++) {
    const [x, y] = spawnCoords[i];
    spawns.push({ x, y, spawnIndex: i, team: Team.None });
    // Clear a small safety zone around spawns.
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx <= 0 || sy <= 0 || sx >= width - 1 || sy >= height - 1) continue;
        const idx = sy * width + sx;
        if (tiles[idx] !== TileType.Hard) tiles[idx] = TileType.Floor;
      }
    }
  }

  const items = {};
  for (const key of Object.values(ItemType)) {
    items[key] = {
      bornWith: 0,
      forbidInRandom: false,
      override: { mode: 'Default', value: 0 },
    };
  }
  items.BombUp.bornWith = 1;
  items.FireUp.bornWith = 1;

  return {
    id: 'default',
    name: 'Default',
    width,
    height,
    tiles,
    spawns,
    itemRules: {
      densityPercent: 35,
      items,
      itemsDestructible: true,
      conflictPolicy: 'EjectOld',
    },
    rulesPreset: {
      fuseSeconds: 2.0,
      roundSeconds: 180,
      enclosementDepth: 'A Little',
    },
  };
}
