import { TileType } from '../scheme/schema.js';

export const EnclosementDepth = Object.freeze({
  None: 'None',
  ALittle: 'A Little',
  ALot: 'A Lot',
  AllTheWay: 'All The Way!',
});

export function maxRings(width, height) {
  return Math.ceil(Math.min(width, height) / 2);
}

export function ringsToFill(depth, width, height) {
  if (depth === EnclosementDepth.None) return 0;
  if (depth === EnclosementDepth.ALittle) return 2;
  if (depth === EnclosementDepth.ALot) return 4;
  if (depth === EnclosementDepth.AllTheWay) return maxRings(width, height);
  return 0;
}

export function makeEnclosementOrder(width, height, depth) {
  const rings = ringsToFill(depth, width, height);
  const coords = [];

  for (let r = 0; r < rings; r++) {
    const left = r;
    const top = r;
    const right = width - 1 - r;
    const bottom = height - 1 - r;
    if (left > right || top > bottom) break;

    // Top edge (left -> right)
    for (let x = left; x <= right; x++) coords.push([x, top]);
    // Right edge (top+1 -> bottom)
    for (let y = top + 1; y <= bottom; y++) coords.push([right, y]);
    // Bottom edge (right-1 -> left) if distinct
    if (bottom !== top) {
      for (let x = right - 1; x >= left; x--) coords.push([x, bottom]);
    }
    // Left edge (bottom-1 -> top+1) if distinct
    if (left !== right) {
      for (let y = bottom - 1; y >= top + 1; y--) coords.push([left, y]);
    }
  }

  return coords;
}

export function applyClosingBlock(world, x, y) {
  const idx = y * world.width + x;
  world.tiles[idx] = TileType.Hard;
  // Remove any floor item on that tile.
  world.items.delete(`${x},${y}`);
  // Remove any bomb on that tile.
  const bombId = world.bombsByTile.get(`${x},${y}`);
  if (bombId) world.removeBomb(bombId, { silent: true });
}

