import { TICK_HZ } from '../constants.js';

export const DiseaseType = Object.freeze({
  Molasses: 'Molasses',
  Crack: 'Crack',
  ReverseControls: 'ReverseControls',
  Constipation: 'Constipation',
  Poops: 'Poops',
  ShortFlame: 'ShortFlame',
  ShortFuse: 'ShortFuse',
});

export const DiseaseSource = Object.freeze({
  Skull: 'Skull',
  Ebola: 'Ebola',
});

export const DEFAULT_DISEASE_TTL_TICKS = 20 * TICK_HZ;

export function rollDiseaseEffect(rng) {
  const pool = Object.values(DiseaseType);
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.max(0, Math.min(pool.length - 1, idx))];
}

export function addDisease(player, effect, { source, ttlTicks = DEFAULT_DISEASE_TTL_TICKS } = {}) {
  if (!player.diseases) player.diseases = [];
  if (player.diseases.length >= 3) return false;
  player.diseases.push({ type: effect, ttlTicks, source });
  return true;
}

export function tickDiseases(player) {
  if (!player.diseases?.length) return;
  for (const d of player.diseases) d.ttlTicks = Math.max(0, d.ttlTicks - 1);
  player.diseases = player.diseases.filter((d) => d.ttlTicks > 0);
}

export function transferOldestDisease(fromPlayer, toPlayer) {
  if (!fromPlayer.diseases?.length) return false;
  const d = fromPlayer.diseases.shift();
  if (!d) return false;
  if (!toPlayer.diseases) toPlayer.diseases = [];
  if (toPlayer.diseases.length >= 3) {
    // If target is full, keep it on the source.
    fromPlayer.diseases.unshift(d);
    return false;
  }
  toPlayer.diseases.push(d);
  return true;
}

export function cureOneDisease(player) {
  if (!player.diseases?.length) return false;
  player.diseases.shift();
  return true;
}

export function applyDiseaseEffects({ baseStats, diseases, ability }) {
  const effective = { ...baseStats };
  const flags = {
    reverseControls: false,
    constipation: false,
    poops: false,
    shortFlame: false,
    shortFuse: false,
  };

  for (const d of diseases ?? []) {
    switch (d.type) {
      case DiseaseType.Molasses:
        effective.speed = 1;
        break;
      case DiseaseType.Crack:
        effective.speed = 10;
        break;
      case DiseaseType.ReverseControls:
        flags.reverseControls = true;
        break;
      case DiseaseType.Constipation:
        flags.constipation = true;
        break;
      case DiseaseType.Poops:
        flags.poops = true;
        break;
      case DiseaseType.ShortFlame:
        flags.shortFlame = true;
        break;
      case DiseaseType.ShortFuse:
        flags.shortFuse = true;
        break;
      default:
        break;
    }
  }

  if (flags.shortFuse) {
    effective.fuseTicks = Math.min(effective.fuseTicks, 1 * TICK_HZ);
  }

  // Full Fire override.
  if (ability?.fullFire) {
    effective.flame = 10;
  } else if (flags.shortFlame) {
    effective.flame = 1;
  }

  return { effectiveStats: effective, flags };
}

