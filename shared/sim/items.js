import { ItemType } from '../scheme/schema.js';
import { addDisease, cureOneDisease, DiseaseSource, rollDiseaseEffect } from './diseases.js';

export function isGoodPickup(itemType) {
  return itemType !== ItemType.Skull;
}

export function isAbilityItem(itemType) {
  return (
    itemType === ItemType.Kick ||
    itemType === ItemType.BoxingGlove ||
    itemType === ItemType.PowerGlove ||
    itemType === ItemType.RemoteControl ||
    itemType === ItemType.RubberBomb ||
    itemType === ItemType.LineBomb
  );
}

function dropEjectedItem(world, player, itemType) {
  const [tx, ty] = world.playerTile(player);
  world.spawnItem({ tx, ty, type: itemType });
  world.events.push({ t: 'item_ejected', playerId: player.id, item: itemType, tx, ty });
}

export function applyItemPickup(world, player, itemType, { source = 'map' } = {}) {
  // Cure rule (default 100%): any "good" pickup cures 1 disease effect.
  if (isGoodPickup(itemType)) cureOneDisease(player);

  if (itemType === ItemType.SelectItem) {
    const rolled = world.rollSelectItem();
    if (rolled) applyItemPickup(world, player, rolled, { source: 'random' });
    return;
  }

  if (itemType === ItemType.Skull) {
    // Ebola chance (10%).
    const isEbola = world.rng() < 0.1;
    const count = isEbola ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const eff = rollDiseaseEffect(world.rng);
      addDisease(player, eff, { source: isEbola ? DiseaseSource.Ebola : DiseaseSource.Skull });
    }
    world.events.push({ t: 'disease_applied', playerId: player.id, source: isEbola ? 'Ebola' : 'Skull' });
    return;
  }

  if (itemType === ItemType.BombUp) {
    player.statsBase.bombCap = Math.min(10, player.statsBase.bombCap + 1);
    return;
  }
  if (itemType === ItemType.FireUp) {
    player.statsBase.flame = Math.min(10, player.statsBase.flame + 1);
    return;
  }
  if (itemType === ItemType.FullFire) {
    player.ability.fullFire = true;
    player.statsBase.flame = 10;
    return;
  }
  if (itemType === ItemType.SpeedUp) {
    player.statsBase.speed = Math.min(10, player.statsBase.speed + 1);
    return;
  }
  if (itemType === ItemType.SpeedDown) {
    player.statsBase.speed = Math.max(1, player.statsBase.speed - 1);
    return;
  }

  if (itemType === ItemType.Kick) {
    player.ability.kick = true;
    return;
  }

  // Special ability items with conflicts.
  if (itemType === ItemType.BoxingGlove) {
    if (player.ability.trigger) {
      // Trigger beats glove; picking glove while trigger => glove is rejected.
      dropEjectedItem(world, player, itemType);
      return;
    }
    player.ability.boxing = true;
    return;
  }

  if (itemType === ItemType.PowerGlove) {
    if (player.ability.spooge) {
      player.ability.spooge = false;
      dropEjectedItem(world, player, ItemType.LineBomb);
    }
    player.ability.hand = true;
    return;
  }

  if (itemType === ItemType.RemoteControl) {
    if (player.ability.jelly) {
      player.ability.jelly = false;
      dropEjectedItem(world, player, ItemType.RubberBomb);
    }
    if (player.ability.boxing) {
      player.ability.boxing = false;
      dropEjectedItem(world, player, ItemType.BoxingGlove);
    }
    player.ability.trigger = true;
    return;
  }

  if (itemType === ItemType.RubberBomb) {
    if (player.ability.trigger) {
      player.ability.trigger = false;
      dropEjectedItem(world, player, ItemType.RemoteControl);
    }
    player.ability.jelly = true;
    return;
  }

  if (itemType === ItemType.LineBomb) {
    if (player.ability.hand) {
      player.ability.hand = false;
      dropEjectedItem(world, player, ItemType.PowerGlove);
    }
    player.ability.spooge = true;
    return;
  }

  // Unknown item: ignore.
  world.events.push({ t: 'item_ignored', playerId: player.id, item: itemType, source });
}

