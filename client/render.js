import { SUBTILE, TICK_HZ, ENCLOSEMENT_START_SECONDS } from '../shared/constants.js';
import { TileType, ItemType } from '../shared/scheme/schema.js';

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// Item type to short label for rendering
const ITEM_LABELS = {
  [ItemType.BombUp]: 'B+',
  [ItemType.FireUp]: 'F+',
  [ItemType.FullFire]: 'FF',
  [ItemType.SpeedUp]: 'S+',
  [ItemType.SpeedDown]: 'S-',
  [ItemType.Kick]: 'K',
  [ItemType.BoxingGlove]: 'P',
  [ItemType.PowerGlove]: 'H',
  [ItemType.RemoteControl]: 'T',
  [ItemType.RubberBomb]: 'J',
  [ItemType.LineBomb]: 'L',
  [ItemType.Skull]: '☠',
  [ItemType.SelectItem]: '?',
};

const ITEM_COLORS = {
  [ItemType.BombUp]: '#ff6b6b',
  [ItemType.FireUp]: '#ffa500',
  [ItemType.FullFire]: '#ffd700',
  [ItemType.SpeedUp]: '#4ecdc4',
  [ItemType.SpeedDown]: '#95a5a6',
  [ItemType.Kick]: '#9b59b6',
  [ItemType.BoxingGlove]: '#e74c3c',
  [ItemType.PowerGlove]: '#3498db',
  [ItemType.RemoteControl]: '#2ecc71',
  [ItemType.RubberBomb]: '#e91e63',
  [ItemType.LineBomb]: '#00bcd4',
  [ItemType.Skull]: '#1a1a2e',
  [ItemType.SelectItem]: '#fff',
};

const TEAM_COLORS = {
  Red: 'rgba(231, 76, 60, 0.7)',
  White: 'rgba(236, 240, 241, 0.7)',
};

function makeSpriteSheet({ url, cols, rows }) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  const sheet = {
    img,
    cols,
    rows,
    ready: false,
    frameW: 0,
    frameH: 0,
    trimByRow: null, // { minX, minY, maxX, maxY }[] per row (in frame-local coords; union of frames)
    frameBoxes: null, // { minX, minY, maxX, maxY, sw, sh }[][] per [row][col]
  };
  img.onload = () => {
    sheet.ready = true;
    const frameWExact = img.width / cols;
    const frameHExact = img.height / rows;
    const frameWInt = Math.round(frameWExact);
    const frameHInt = Math.round(frameHExact);
    // Only attempt pixel-accurate trimming when the sheet divides cleanly into integer frames.
    sheet.frameW = Math.abs(frameWExact - frameWInt) < 1e-6 ? frameWInt : frameWExact;
    sheet.frameH = Math.abs(frameHExact - frameHInt) < 1e-6 ? frameHInt : frameHExact;

    // Precompute a tight trim box per row based on alpha to reduce whitespace and improve scaling.
    // This makes "oversized" generated sheets more workable without manual cropping.
    try {
      if (!Number.isInteger(sheet.frameW) || !Number.isInteger(sheet.frameH)) return;
      const canvas = document.createElement('canvas');
      canvas.width = sheet.frameW;
      canvas.height = sheet.frameH;
      const cctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!cctx) return;

      const trimByRow = [];
      const frameBoxes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
      for (let row = 0; row < rows; row++) {
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;

        for (let col = 0; col < cols; col++) {
          cctx.clearRect(0, 0, canvas.width, canvas.height);
          cctx.drawImage(
            img,
            col * canvas.width,
            row * canvas.height,
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const data = cctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let fMinX = canvas.width;
          let fMinY = canvas.height;
          let fMaxX = -1;
          let fMaxY = -1;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const a = data[(y * canvas.width + x) * 4 + 3];
              if (a < 8) continue;
              if (x < fMinX) fMinX = x;
              if (y < fMinY) fMinY = y;
              if (x > fMaxX) fMaxX = x;
              if (y > fMaxY) fMaxY = y;
            }
          }

          if (fMaxX === -1) {
            frameBoxes[row][col] = { minX: 0, minY: 0, maxX: canvas.width - 1, maxY: canvas.height - 1, sw: canvas.width, sh: canvas.height };
          } else {
            const margin = 1;
            const box = {
              minX: Math.max(0, fMinX - margin),
              minY: Math.max(0, fMinY - margin),
              maxX: Math.min(canvas.width - 1, fMaxX + margin),
              maxY: Math.min(canvas.height - 1, fMaxY + margin),
            };
            frameBoxes[row][col] = { ...box, sw: box.maxX - box.minX + 1, sh: box.maxY - box.minY + 1 };
          }

          const fb = frameBoxes[row][col];
          if (fb.minX < minX) minX = fb.minX;
          if (fb.minY < minY) minY = fb.minY;
          if (fb.maxX > maxX) maxX = fb.maxX;
          if (fb.maxY > maxY) maxY = fb.maxY;
        }

        if (maxX === -1) {
          // Fully transparent row (shouldn't happen); fall back to full frame.
          trimByRow.push({ minX: 0, minY: 0, maxX: canvas.width - 1, maxY: canvas.height - 1 });
        } else {
          // The per-frame boxes already include a small margin; just union them here.
          trimByRow.push({
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY,
          });
        }
      }
      sheet.trimByRow = trimByRow;
      sheet.frameBoxes = frameBoxes;
    } catch {
      // Ignore trim failures; drawing will fall back to full frame.
      sheet.trimByRow = null;
      sheet.frameBoxes = null;
    }
  };
  img.onerror = () => {
    sheet.ready = false;
  };
  return sheet;
}

// Current bomberman sheet: 8 columns, 4 rows (idle, move down, move up, move right).
const BOMBERMAN_BLUE = makeSpriteSheet({ url: '/assets/bomberman_blue.png', cols: 8, rows: 4 });
const bomberAnim = new Map(); // playerId -> { lastTick, lastX, lastY, dir, movingUntilMs }

function directionFromDelta(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

function getBomberAnimState(p, snapTick) {
  const now = performance.now();
  const st = bomberAnim.get(p.id) ?? { lastTick: null, lastX: p.x, lastY: p.y, dir: 'down', movingUntilMs: 0 };

  if (st.lastTick !== snapTick) {
    const dx = p.x - st.lastX;
    const dy = p.y - st.lastY;
    if (dx !== 0 || dy !== 0) {
      st.dir = directionFromDelta(dx, dy);
      // Keep walking animation alive between snapshots.
      st.movingUntilMs = now + 200;
    }
    st.lastTick = snapTick;
    st.lastX = p.x;
    st.lastY = p.y;
  }

  bomberAnim.set(p.id, st);
  return { dir: st.dir, moving: now < st.movingUntilMs };
}

function drawSpriteFrame(ctx, sheet, frameIndex, rowIndex, dx, dy, dw, dh, { flipX, frameOverride }) {
  const trim = sheet.trimByRow?.[rowIndex] ?? null;
  const frameW = sheet.frameW;
  const frameH = sheet.frameH;
  const sx0 = frameIndex * frameW;
  const sy0 = rowIndex * frameH;

  const crop = frameOverride ?? (trim
    ? { minX: trim.minX, minY: trim.minY, sw: trim.maxX - trim.minX + 1, sh: trim.maxY - trim.minY + 1 }
    : { minX: 0, minY: 0, sw: frameW, sh: frameH });

  const sx = sx0 + crop.minX;
  const sy = sy0 + crop.minY;
  const sw = crop.sw;
  const sh = crop.sh;

  if (!flipX) {
    ctx.drawImage(sheet.img, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }

  ctx.save();
  ctx.translate(dx + dw, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet.img, sx, sy, sw, sh, 0, 0, dw, dh);
  ctx.restore();
}

export function drawFrame(ctx, w, h, snap, theme, followId, myId) {
  ctx.clearRect(0, 0, w, h);

  const tileW = w / snap.width;
  const tileH = h / snap.height;
  const palette = theme?.palette ?? null;
  const remaining = snap.roundTicksRemaining === Infinity ? null : Math.ceil(snap.roundTicksRemaining / TICK_HZ);

  // Check if enclosement is imminent (within 10 seconds of starting)
  const enclosementWarning = remaining !== null && remaining <= ENCLOSEMENT_START_SECONDS + 10 && remaining > ENCLOSEMENT_START_SECONDS;
  const enclosementActive = remaining !== null && remaining <= ENCLOSEMENT_START_SECONDS;

  // Draw tiles
  for (let y = 0; y < snap.height; y++) {
    for (let x = 0; x < snap.width; x++) {
      const t = snap.tiles[y * snap.width + x];
      ctx.fillStyle =
        t === TileType.Hard
          ? palette?.hard ?? '#2b3555'
          : t === TileType.Soft
            ? palette?.soft ?? '#3b2f2a'
            : palette?.floor ?? '#0d1426';
      ctx.fillRect(x * tileW, y * tileH, tileW, tileH);
    }
  }

  // Draw enclosement warning border
  if (enclosementWarning) {
    const alpha = 0.3 + 0.3 * Math.sin(Date.now() / 200);
    ctx.strokeStyle = `rgba(255, 100, 50, ${alpha})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.lineWidth = 1;
  } else if (enclosementActive) {
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.6)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.lineWidth = 1;
  }

  // Items with type indicators
  for (const it of snap.items) {
    const cx = it.x * tileW + tileW * 0.5;
    const cy = it.y * tileH + tileH * 0.5;
    const size = Math.min(tileW, tileH) * 0.4;

    // Background
    ctx.fillStyle = ITEM_COLORS[it.type] ?? palette?.item ?? '#4f8cff';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx - size, cy - size, size * 2, size * 2, 4);
    } else {
      ctx.rect(cx - size, cy - size, size * 2, size * 2);
    }
    ctx.fill();

    // Label
    const label = ITEM_LABELS[it.type] ?? '?';
    ctx.fillStyle = it.type === ItemType.Skull ? '#fff' : '#000';
    ctx.font = `bold ${Math.round(size * 1.1)}px ui-sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
  }

  // Bombs with visual indicators for special types
  for (const b of snap.bombs) {
    const cx = (b.tx + 0.5) * tileW;
    const cy = (b.ty + 0.5) * tileH;
    const radius = Math.min(tileW, tileH) * 0.33;

    // Jelly bombs have a different color
    if (b.flags?.jelly) {
      ctx.fillStyle = '#e91e63';
    } else if (b.flags?.trigger) {
      ctx.fillStyle = '#2ecc71';
    } else {
      ctx.fillStyle = palette?.bomb ?? '#111';
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Fuse indicator (shrinking ring)
    if (b.fuseTicks !== Infinity && b.fuseTicks > 0) {
      const fuseRatio = Math.min(1, b.fuseTicks / 120); // Assuming 2s fuse
      ctx.strokeStyle = `rgba(255, ${Math.round(255 * fuseRatio)}, 0, 0.8)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fuseRatio);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Moving indicator
    if (b.moving) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - b.moving.dx * radius * 0.8, cy - b.moving.dy * radius * 0.8);
      ctx.lineTo(cx + b.moving.dx * radius * 1.2, cy + b.moving.dy * radius * 1.2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // Explosions
  for (const ex of snap.explosions) {
    for (const [x, y] of ex.tiles) {
      ctx.fillStyle = palette?.explosion ?? 'rgba(255, 160, 40, 0.65)';
      ctx.fillRect(x * tileW, y * tileH, tileW, tileH);
    }
  }

  // Players
  for (const p of snap.players) {
    const px = p.x / SUBTILE * tileW;
    const py = p.y / SUBTILE * tileH;
    const radius = Math.min(tileW, tileH) * 0.32;

    // Shadow / identity halo behind the sprite.
    const [r, g, b] = hexToRgb(p.color ?? '#fff');
    ctx.fillStyle = p.alive ? `rgba(${r}, ${g}, ${b}, 0.18)` : 'rgba(160,160,160,0.12)';
    ctx.beginPath();
    ctx.ellipse(px, py + radius * 0.55, radius * 0.95, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // Team indicator (colored ring)
    if (p.team && p.team !== 'None' && TEAM_COLORS[p.team]) {
      ctx.strokeStyle = TEAM_COLORS[p.team];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Gold Bomberman ring
    if (p.isGold) {
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Follow indicator
    if (followId && p.id === followId) {
      ctx.strokeStyle = 'rgba(79, 140, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, radius + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Bomberman sprite (fallback to a simple circle if sprite not ready).
    if (BOMBERMAN_BLUE.ready) {
      const { dir, moving } = getBomberAnimState(p, snap.tick);
      const now = performance.now();
      const idleMsPerFrame = 170;
      const walkMsPerFrame = 80;
      const frameIndex = Math.floor(now / (moving ? walkMsPerFrame : idleMsPerFrame)) % BOMBERMAN_BLUE.cols;

      // Sheet layout (your current 4 rows):
      // 0 = idle (front/down), 1 = walk down, 2 = walk up, 3 = walk right.
      // Since we only have one dedicated idle row, we idle using the first frame of the relevant walk row
      // to avoid snapping back to front-facing when you stop moving.
      let rowIndex = 0;
      let idleFromWalk = false;
      let flipX = false;
    if (dir === 'up') {
        rowIndex = 2;
        idleFromWalk = !moving;
      } else if (dir === 'right') {
        rowIndex = 3;
        idleFromWalk = !moving;
      } else if (dir === 'left') {
        rowIndex = 3;
        flipX = true;
        idleFromWalk = !moving;
      } else {
        // down
        rowIndex = moving ? 1 : 0;
      }

      // Adapt to the sheet's actual frame size with a stable visual footprint.
      // We prefer integer scaling (crisper pixel art) but allow fractional for very large frames.
      const desiredH = Math.min(tileW, tileH) * 1.05;
      const rowBox = BOMBERMAN_BLUE.trimByRow?.[rowIndex] ?? null;
      const contentH = rowBox ? rowBox.maxY - rowBox.minY + 1 : BOMBERMAN_BLUE.frameH;
      const contentW = rowBox ? rowBox.maxX - rowBox.minX + 1 : BOMBERMAN_BLUE.frameW;
      const rawScale = desiredH / contentH;
      const intScale = Math.max(1, Math.round(rawScale));
      const useIntScale = rawScale >= 1 && Math.abs(rawScale - intScale) < 0.12;
      const scale = useIntScale ? intScale : rawScale;

      const dw = contentW * scale;
      const dh = contentH * scale;

      // Anchor: bottom-center sits slightly below the player center for a grounded look.
      const baseY = py + radius * 0.55;
      const dx = px - dw / 2;
      const dy = baseY - dh;

      const prevSmooth = ctx.imageSmoothingEnabled;
      const prevQuality = ctx.imageSmoothingQuality;
      ctx.imageSmoothingEnabled = !useIntScale;
      ctx.imageSmoothingQuality = 'low';

      // Dead players: fade out.
      if (!p.alive) ctx.globalAlpha = 0.45;
      const colIndex = idleFromWalk ? 0 : frameIndex;
      const frameBox = BOMBERMAN_BLUE.frameBoxes?.[rowIndex]?.[colIndex] ?? null;
      if (!rowBox || !frameBox) {
        drawSpriteFrame(ctx, BOMBERMAN_BLUE, colIndex, rowIndex, dx, dy, dw, dh, { flipX });
      } else {
        const offsetX = frameBox.minX - rowBox.minX;
        const offsetY = frameBox.minY - rowBox.minY;
        const xWithin = flipX ? (contentW - (offsetX + frameBox.sw)) : offsetX;

        let fx = dx + xWithin * scale;
        let fy = dy + offsetY * scale;
        let fw = frameBox.sw * scale;
        let fh = frameBox.sh * scale;
        if (useIntScale) {
          fx = Math.round(fx);
          fy = Math.round(fy);
          fw = Math.round(fw);
          fh = Math.round(fh);
        }
        drawSpriteFrame(ctx, BOMBERMAN_BLUE, colIndex, rowIndex, fx, fy, fw, fh, {
          flipX,
          frameOverride: { minX: frameBox.minX, minY: frameBox.minY, sw: frameBox.sw, sh: frameBox.sh },
        });
      }
      ctx.globalAlpha = 1;

      ctx.imageSmoothingEnabled = prevSmooth;
      ctx.imageSmoothingQuality = prevQuality;
    } else {
      ctx.fillStyle = p.alive ? `rgb(${r} ${g} ${b})` : 'rgba(160,160,160,0.4)';
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player name above
    if (p.alive) {
      ctx.fillStyle = '#e7eaf2';
      ctx.font = '11px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const displayName = p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name;
      ctx.fillText(displayName, px, py - radius - 8);
    }

    // Disease indicator (small skull icons)
    if (p.alive && p.diseases?.length > 0) {
      ctx.fillStyle = '#9b59b6';
      ctx.font = '10px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☠'.repeat(Math.min(3, p.diseases.length)), px, py + radius + 12);
    }

    // Carrying bomb indicator
    if (p.alive && p.carrying) {
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(px + radius * 0.7, py - radius * 0.7, radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // HUD - Timer
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const timerText = remaining === null ? '∞' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  // Timer background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(5, 5, 60, 24);

  // Timer color changes based on time
  if (enclosementActive) {
    ctx.fillStyle = '#ff6b6b';
  } else if (enclosementWarning) {
    ctx.fillStyle = '#ffa500';
  } else {
    ctx.fillStyle = '#e7eaf2';
  }
  ctx.font = 'bold 16px ui-sans-serif';
  ctx.fillText(timerText, 10, 9);

  // Enclosement warning text
  if (enclosementWarning) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(w / 2 - 80, 5, 160, 20);
    ctx.fillStyle = '#ffa500';
    ctx.font = 'bold 12px ui-sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ ENCLOSEMENT SOON ⚠', w / 2, 9);
    ctx.textAlign = 'left';
  } else if (enclosementActive) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(w / 2 - 70, 5, 140, 20);
    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 12px ui-sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ WALLS CLOSING ⚠', w / 2, 9);
    ctx.textAlign = 'left';
  }
}

// Draw player stats HUD (called separately from main game view)
export function drawPlayerHUD(ctx, x, y, player) {
  if (!player) return;

  const stats = player.stats ?? player.statsBase ?? {};
  const ability = player.ability ?? {};

  ctx.fillStyle = '#e7eaf2';
  ctx.font = '12px ui-sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  let yOff = y;
  const lineHeight = 16;

  // Stats
  ctx.fillText(`Bombs: ${stats.bombCap ?? 1}`, x, yOff); yOff += lineHeight;
  ctx.fillText(`Flame: ${stats.flame ?? 1}${ability.fullFire ? ' (MAX)' : ''}`, x, yOff); yOff += lineHeight;
  ctx.fillText(`Speed: ${stats.speed ?? 5}`, x, yOff); yOff += lineHeight;

  // Abilities
  const abilities = [];
  if (ability.kick) abilities.push('Kick');
  if (ability.boxing) abilities.push('Punch');
  if (ability.hand) abilities.push('Hand');
  if (ability.trigger) abilities.push('Trigger');
  if (ability.jelly) abilities.push('Jelly');
  if (ability.spooge) abilities.push('Spooge');

  if (abilities.length > 0) {
    ctx.fillText(`Abilities: ${abilities.join(', ')}`, x, yOff); yOff += lineHeight;
  }

  // Diseases
  const diseases = player.diseases ?? [];
  if (diseases.length > 0) {
    ctx.fillStyle = '#9b59b6';
    ctx.fillText(`Diseases: ${diseases.join(', ')}`, x, yOff);
  }
}
