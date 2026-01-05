import { TileType, ItemType } from '../scheme/schema.js';

const TILE_TO_CODE = new Map([
  [TileType.Floor, 0],
  [TileType.Hard, 1],
  [TileType.Soft, 2],
]);
const CODE_TO_TILE = [TileType.Floor, TileType.Hard, TileType.Soft];

export const ITEM_CODE_LIST = [
  ItemType.BombUp,
  ItemType.FireUp,
  ItemType.FullFire,
  ItemType.SpeedUp,
  ItemType.SpeedDown,
  ItemType.Kick,
  ItemType.BoxingGlove,
  ItemType.PowerGlove,
  ItemType.RemoteControl,
  ItemType.RubberBomb,
  ItemType.LineBomb,
  ItemType.Skull,
  ItemType.SelectItem,
];
const ITEM_TO_CODE = new Map(ITEM_CODE_LIST.map((t, i) => [t, i]));

function pushU8(out, n) {
  out.push(n & 0xff);
}
function pushU16(out, n) {
  out.push(n & 0xff, (n >>> 8) & 0xff);
}
function pushU32(out, n) {
  out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}
function readU8(buf, o) {
  return [buf[o], o + 1];
}
function readU16(buf, o) {
  return [buf[o] | (buf[o + 1] << 8), o + 2];
}
function readU32(buf, o) {
  return [buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24), o + 4];
}
function readI8(buf, o) {
  const v = buf[o] << 24 >> 24;
  return [v, o + 1];
}

// Snapshot binary format v1:
// 'S' (0x53), tick u32, w u8, h u8, roundTicksRemaining u32 (0xffffffff = Infinity),
// tiles (w*h u8),
// playersCount u8, then per-player: x u16, y u16, alive u8, team u8, flags u8, speed u8, bombCap u8, flame u8, diseasesCount u8
// bombsCount u8, then per-bomb: tx u8, ty u8, fuse u16 (0xffff=Infinity), flame u8, flags u8, moveDx i8, moveDy i8
// explosionsCount u8, then per-explosion: ttl u8, tilesCount u8, then tilesCount*(x u8, y u8)
// itemsCount u8, then per-item: x u8, y u8, type u8

export function encodeSnapshotBin(snap) {
  const out = [];
  pushU8(out, 0x53);
  pushU32(out, snap.tick >>> 0);
  pushU8(out, snap.width);
  pushU8(out, snap.height);
  pushU32(out, snap.roundTicksRemaining === Infinity ? 0xffffffff : snap.roundTicksRemaining >>> 0);

  for (const t of snap.tiles) pushU8(out, TILE_TO_CODE.get(t) ?? 0);

  pushU8(out, snap.players.length);
  for (const p of snap.players) {
    pushU16(out, p.x);
    pushU16(out, p.y);
    pushU8(out, p.alive ? 1 : 0);
    pushU8(out, p.team === 'Red' ? 1 : p.team === 'White' ? 2 : 0);
    pushU8(out, p.isGold ? 1 : 0);
    pushU8(out, p.stats?.speed ?? 5);
    pushU8(out, p.stats?.bombCap ?? 1);
    pushU8(out, p.stats?.flame ?? 1);
    pushU8(out, (p.diseases?.length ?? 0) & 0xff);
  }

  pushU8(out, snap.bombs.length);
  for (const b of snap.bombs) {
    pushU8(out, b.tx);
    pushU8(out, b.ty);
    const fuse = b.fuseTicks === Infinity ? 0xffff : Math.max(0, Math.min(0xfffe, b.fuseTicks));
    pushU16(out, fuse);
    pushU8(out, b.flame);
    const flags = (b.flags?.trigger ? 1 : 0) | (b.flags?.jelly ? 2 : 0);
    pushU8(out, flags);
    pushU8(out, (b.moving?.dx ?? 0) & 0xff);
    pushU8(out, (b.moving?.dy ?? 0) & 0xff);
  }

  pushU8(out, snap.explosions.length);
  for (const ex of snap.explosions) {
    pushU8(out, ex.ttl);
    pushU8(out, ex.tiles.length);
    for (const [x, y] of ex.tiles) {
      pushU8(out, x);
      pushU8(out, y);
    }
  }

  pushU8(out, snap.items.length);
  for (const it of snap.items) {
    pushU8(out, it.x);
    pushU8(out, it.y);
    pushU8(out, ITEM_TO_CODE.get(it.type) ?? 0);
  }

  return Uint8Array.from(out);
}

export function decodeSnapshotBin(buf, ctx) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let o = 0;
  let v;

  [v, o] = readU8(u8, o);
  if (v !== 0x53) throw new Error('Not a snapshot');
  let tick;
  [tick, o] = readU32(u8, o);
  let width;
  [width, o] = readU8(u8, o);
  let height;
  [height, o] = readU8(u8, o);
  let rtr;
  [rtr, o] = readU32(u8, o);
  const roundTicksRemaining = rtr === 0xffffffff ? Infinity : rtr >>> 0;

  const tilesLen = width * height;
  const tiles = new Array(tilesLen);
  for (let i = 0; i < tilesLen; i++) {
    [v, o] = readU8(u8, o);
    tiles[i] = CODE_TO_TILE[v] ?? TileType.Floor;
  }

  let playersCount;
  [playersCount, o] = readU8(u8, o);
  const players = [];
  for (let i = 0; i < playersCount; i++) {
    let x, y, alive, team, flags, speed, bombCap, flame, diseaseCount;
    [x, o] = readU16(u8, o);
    [y, o] = readU16(u8, o);
    [alive, o] = readU8(u8, o);
    [team, o] = readU8(u8, o);
    [flags, o] = readU8(u8, o);
    [speed, o] = readU8(u8, o);
    [bombCap, o] = readU8(u8, o);
    [flame, o] = readU8(u8, o);
    [diseaseCount, o] = readU8(u8, o);

    const meta = ctx?.players?.[i] ?? {};
    players.push({
      id: meta.id ?? `p${i}`,
      name: meta.name ?? `P${i}`,
      color: meta.color ?? '#ffffff',
      x,
      y,
      alive: alive === 1,
      team: team === 1 ? 'Red' : team === 2 ? 'White' : 'None',
      isGold: (flags & 1) !== 0,
      stats: { speed, bombCap, flame, fuseTicks: 0 },
      diseases: Array.from({ length: diseaseCount }, () => 'Unknown'),
      carrying: false,
    });
  }

  let bombsCount;
  [bombsCount, o] = readU8(u8, o);
  const bombs = [];
  for (let i = 0; i < bombsCount; i++) {
    let tx, ty, fuse, flame, flags, mdx, mdy;
    [tx, o] = readU8(u8, o);
    [ty, o] = readU8(u8, o);
    [fuse, o] = readU16(u8, o);
    [flame, o] = readU8(u8, o);
    [flags, o] = readU8(u8, o);
    [mdx, o] = readI8(u8, o);
    [mdy, o] = readI8(u8, o);
    bombs.push({
      id: `b${i}`,
      tx,
      ty,
      fuseTicks: fuse === 0xffff ? Infinity : fuse,
      flame,
      flags: { trigger: (flags & 1) !== 0, jelly: (flags & 2) !== 0 },
      moving: mdx || mdy ? { dx: mdx, dy: mdy } : null,
    });
  }

  let exCount;
  [exCount, o] = readU8(u8, o);
  const explosions = [];
  for (let i = 0; i < exCount; i++) {
    let ttl, tilesCount;
    [ttl, o] = readU8(u8, o);
    [tilesCount, o] = readU8(u8, o);
    const exTiles = [];
    for (let k = 0; k < tilesCount; k++) {
      let x, y;
      [x, o] = readU8(u8, o);
      [y, o] = readU8(u8, o);
      exTiles.push([x, y]);
    }
    explosions.push({ id: `e${i}`, ttl, tiles: exTiles });
  }

  let itemsCount;
  [itemsCount, o] = readU8(u8, o);
  const items = [];
  for (let i = 0; i < itemsCount; i++) {
    let x, y, code;
    [x, o] = readU8(u8, o);
    [y, o] = readU8(u8, o);
    [code, o] = readU8(u8, o);
    items.push({ x, y, type: ITEM_CODE_LIST[code] ?? ITEM_CODE_LIST[0] });
  }

  return { tick, width, height, tiles, players, bombs, explosions, items, roundTicksRemaining, events: [] };
}

