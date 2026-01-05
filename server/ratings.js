import crypto from 'node:crypto';
import path from 'node:path';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function eloExpected(ra, rb) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

export async function createRatingsStore(store) {
  const fp = path.join(store.dirs.ratings, 'ratings.json');
  let db = { players: {} };
  if (await store.exists(fp)) {
    try {
      db = await store.readJson(fp);
    } catch {
      db = { players: {} };
    }
  }
  if (!db.players) db.players = {};

  async function save() {
    await store.writeJson(fp, db);
  }

  function ensure(token) {
    if (!db.players[token]) db.players[token] = { rating: 1200, name: null, updatedAt: 0 };
    return db.players[token];
  }

  return {
    getRating(token) {
      return ensure(token).rating;
    },
    setName(token, name) {
      const p = ensure(token);
      p.name = name ?? p.name;
      p.updatedAt = Date.now();
    },
    async recordMatch({ aToken, bToken, winnerToken }) {
      const a = ensure(aToken);
      const b = ensure(bToken);
      const ea = eloExpected(a.rating, b.rating);
      const eb = eloExpected(b.rating, a.rating);
      const k = 32;
      const sa = winnerToken === aToken ? 1 : 0;
      const sb = winnerToken === bToken ? 1 : 0;
      a.rating = Math.round(clamp(a.rating + k * (sa - ea), 200, 3000));
      b.rating = Math.round(clamp(b.rating + k * (sb - eb), 200, 3000));
      await save();
      return { a: a.rating, b: b.rating };
    },
    leaderboard(limit = 50) {
      const entries = Object.entries(db.players).map(([token, v]) => ({ token, ...v }));
      entries.sort((x, y) => y.rating - x.rating);
      return entries.slice(0, limit);
    },
    async resetSeason() {
      // Not used in v1; placeholder for Phase 4.
      const salt = crypto.randomBytes(8).toString('hex');
      db.season = { startedAt: Date.now(), salt };
      await save();
    },
  };
}

