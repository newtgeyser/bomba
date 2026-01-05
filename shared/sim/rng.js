export function makeRng(seed) {
  let t = seed >>> 0;
  return function next() {
    // Mulberry32
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, minInclusive, maxInclusive) {
  const r = rng();
  return minInclusive + Math.floor(r * (maxInclusive - minInclusive + 1));
}

