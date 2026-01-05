import { ItemType, Team, TileType } from './schema.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function validateScheme(scheme) {
  assert(scheme && typeof scheme === 'object', 'Scheme must be an object');
  assert(typeof scheme.id === 'string' && scheme.id.length > 0, 'Scheme.id required');
  assert(typeof scheme.name === 'string' && scheme.name.length > 0, 'Scheme.name required');
  assert(Number.isInteger(scheme.width) && scheme.width > 0, 'Scheme.width invalid');
  assert(Number.isInteger(scheme.height) && scheme.height > 0, 'Scheme.height invalid');

  const size = scheme.width * scheme.height;
  assert(Array.isArray(scheme.tiles) && scheme.tiles.length === size, 'Scheme.tiles size mismatch');
  for (const t of scheme.tiles) {
    assert(t === TileType.Floor || t === TileType.Hard || t === TileType.Soft, `Invalid tile type: ${t}`);
  }

  assert(Array.isArray(scheme.spawns) && scheme.spawns.length >= 2, 'At least 2 spawns required');
  for (const s of scheme.spawns) {
    assert(Number.isInteger(s.x) && Number.isInteger(s.y), 'Spawn x/y must be ints');
    assert(s.x >= 0 && s.x < scheme.width && s.y >= 0 && s.y < scheme.height, 'Spawn out of bounds');
    assert(Number.isInteger(s.spawnIndex) && s.spawnIndex >= 0, 'Spawn.spawnIndex invalid');
    assert(Object.values(Team).includes(s.team), 'Spawn.team invalid');
    const tile = scheme.tiles[s.y * scheme.width + s.x];
    assert(tile === TileType.Floor, 'Spawn must be on Floor');
  }

  assert(scheme.itemRules && typeof scheme.itemRules === 'object', 'Scheme.itemRules required');
  assert(
    Number.isFinite(scheme.itemRules.densityPercent) &&
      scheme.itemRules.densityPercent >= 0 &&
      scheme.itemRules.densityPercent <= 100,
    'itemRules.densityPercent invalid',
  );
  assert(typeof scheme.itemRules.itemsDestructible === 'boolean', 'itemRules.itemsDestructible invalid');
  assert(
    scheme.itemRules.conflictPolicy === 'EjectOld' ||
      scheme.itemRules.conflictPolicy === 'EjectNew' ||
      scheme.itemRules.conflictPolicy === 'DisallowPickup',
    'itemRules.conflictPolicy invalid',
  );

  const items = scheme.itemRules.items ?? {};
  for (const it of Object.values(ItemType)) {
    const rule = items[it];
    assert(rule && typeof rule === 'object', `Missing item rule for ${it}`);
    assert(Number.isInteger(rule.bornWith) && rule.bornWith >= 0, `items.${it}.bornWith invalid`);
    assert(typeof rule.forbidInRandom === 'boolean', `items.${it}.forbidInRandom invalid`);
    const o = rule.override;
    assert(o && typeof o === 'object', `items.${it}.override invalid`);
    assert(o.mode === 'Default' || o.mode === 'FixedCount' || o.mode === 'ChanceIn10', `items.${it}.override.mode invalid`);
    assert(Number.isInteger(o.value) && o.value >= 0, `items.${it}.override.value invalid`);
  }

  return scheme;
}

