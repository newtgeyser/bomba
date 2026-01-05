import { makeDefaultScheme, TileType, Team } from './schema.js';

function makeSparseScheme() {
  const base = makeDefaultScheme();
  base.id = 'sparse';
  base.name = 'Sparse';
  // Convert some soft to floor in a deterministic stripe pattern.
  for (let y = 1; y < base.height - 1; y++) {
    for (let x = 1; x < base.width - 1; x++) {
      const idx = y * base.width + x;
      if (base.tiles[idx] !== TileType.Soft) continue;
      if ((x + y) % 3 === 0) base.tiles[idx] = TileType.Floor;
    }
  }
  return base;
}

function makeTeamsScheme() {
  const base = makeDefaultScheme();
  base.id = 'teams';
  base.name = 'Teams (Red vs White)';
  base.spawns = base.spawns.map((s) => ({
    ...s,
    team: s.spawnIndex % 2 === 0 ? Team.Red : Team.White,
  }));
  return base;
}

export const OFFICIAL_SCHEMES = Object.freeze([makeDefaultScheme(), makeSparseScheme(), makeTeamsScheme()]);

export function getOfficialScheme(id) {
  return OFFICIAL_SCHEMES.find((s) => s.id === id) ?? OFFICIAL_SCHEMES[0];
}

