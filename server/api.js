import crypto from 'node:crypto';
import path from 'node:path';
import { OFFICIAL_SCHEMES } from '../shared/scheme/library.js';
import { validateScheme } from '../shared/scheme/validate.js';

async function readBodyJson(req, limitBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > limitBytes) throw new Error('Body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  res.writeHead(404);
  res.end('Not Found');
}

function badRequest(res, message) {
  json(res, 400, { ok: false, error: message });
}

function ok(res, data) {
  json(res, 200, { ok: true, ...data });
}

function schemeFile(store, id) {
  return path.join(store.dirs.schemes, `${id}.json`);
}

function genId() {
  return `m_${crypto.randomBytes(6).toString('hex')}`;
}

function genEditToken() {
  return `edit_${crypto.randomBytes(12).toString('hex')}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function handleApi({ req, res, store }) {
  if (!req.url) return false;
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/api/')) return false;

  if (req.method === 'GET' && url.pathname === '/api/health') {
    ok(res, { health: 'ok' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/ratings') {
    // Ratings are stored file-backed; keep API simple.
    const fp = path.join(store.dirs.ratings, 'ratings.json');
    if (!(await store.exists(fp))) {
      ok(res, { leaderboard: [] });
      return true;
    }
    try {
      const db = await store.readJson(fp);
      const entries = Object.entries(db.players ?? {}).map(([token, v]) => ({ token, ...v }));
      entries.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      ok(res, { leaderboard: entries.slice(0, 50) });
      return true;
    } catch {
      ok(res, { leaderboard: [] });
      return true;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/replays') {
    const files = await store.listJsonFiles(store.dirs.replays);
    const list = [];
    for (const name of files) {
      const id = name.replace(/\.json$/, '');
      try {
        const doc = await store.readJson(path.join(store.dirs.replays, name));
        list.push({
          id,
          createdAt: doc.createdAt ?? 0,
          ranked: !!doc.ranked,
          schemeName: doc.scheme?.name ?? doc.scheme?.id ?? 'Unknown',
          players: (doc.players ?? []).map((p) => ({ id: p.id, name: p.name, color: p.color })),
          result: doc.matchResult ?? null,
        });
      } catch {
        // ignore
      }
    }
    list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    ok(res, { replays: list });
    return true;
  }

  const replayMatch = url.pathname.match(/^\/api\/replays\/([^/]+)$/);
  if (req.method === 'GET' && replayMatch) {
    const id = decodeURIComponent(replayMatch[1]);
    const fp = path.join(store.dirs.replays, `${id}.json`);
    if (!(await store.exists(fp))) {
      notFound(res);
      return true;
    }
    const doc = await store.readJson(fp);
    ok(res, { replay: doc });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/schemes') {
    const published = [];
    const files = await store.listJsonFiles(store.dirs.schemes);
    for (const name of files) {
      const id = name.replace(/\.json$/, '');
      try {
        const doc = await store.readJson(schemeFile(store, id));
        const meta = doc?.meta ?? {};
        published.push({
          id,
          name: doc?.scheme?.name ?? id,
          visibility: meta.visibility ?? 'Community',
          author: meta.author ?? 'Unknown',
          createdAt: meta.createdAt ?? 0,
          updatedAt: meta.updatedAt ?? meta.createdAt ?? 0,
        });
      } catch {
        // ignore broken file
      }
    }

    const official = OFFICIAL_SCHEMES.map((s) => ({
      id: s.id,
      name: s.name,
      visibility: 'Official',
      author: 'ABO',
      createdAt: 0,
      updatedAt: 0,
    }));

    ok(res, { official, published });
    return true;
  }

  const schemeMatch = url.pathname.match(/^\/api\/schemes\/([^/]+)$/);
  if (req.method === 'GET' && schemeMatch) {
    const id = decodeURIComponent(schemeMatch[1]);
    const official = OFFICIAL_SCHEMES.find((s) => s.id === id);
    if (official) {
      ok(res, { scheme: official, meta: { visibility: 'Official', author: 'ABO' } });
      return true;
    }
    const fp = schemeFile(store, id);
    if (!(await store.exists(fp))) {
      notFound(res);
      return true;
    }
    const doc = await store.readJson(fp);
    ok(res, { scheme: doc.scheme, meta: doc.meta });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/schemes') {
    let body;
    try {
      body = await readBodyJson(req);
    } catch {
      badRequest(res, 'Invalid JSON body');
      return true;
    }

    const visibility = body.visibility === 'Unlisted' ? 'Unlisted' : 'Community';
    const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 24) : 'Guest';
    const scheme = body.scheme;
    if (!scheme) {
      badRequest(res, 'Missing scheme');
      return true;
    }

    let validated;
    try {
      validated = validateScheme(scheme);
    } catch (e) {
      badRequest(res, e?.message ?? 'Invalid scheme');
      return true;
    }

    // Disallow overwriting official IDs.
    if (OFFICIAL_SCHEMES.some((s) => s.id === validated.id)) {
      validated.id = '';
    }

    const requestedId = typeof body.id === 'string' ? body.id : '';
    let id = requestedId || validated.id;
    let isUpdate = false;
    let editToken = typeof body.editToken === 'string' ? body.editToken : null;
    if (!id || id === 'default') id = genId();

    const fp = schemeFile(store, id);
    if (await store.exists(fp)) {
      const existing = await store.readJson(fp);
      const expectedHash = existing?.editTokenHash ?? null;
      if (!expectedHash) {
        badRequest(res, 'Map is not editable');
        return true;
      }
      if (!editToken || sha256(editToken) !== expectedHash) {
        badRequest(res, 'Invalid edit token');
        return true;
      }
      isUpdate = true;
    } else {
      editToken = genEditToken();
    }

    validated.id = id;
    const now = Date.now();
    const doc = {
      scheme: validated,
      meta: {
        visibility,
        author,
        createdAt: isUpdate ? undefined : now,
        updatedAt: now,
      },
      editTokenHash: sha256(editToken),
    };
    if (!doc.meta.createdAt) {
      // preserve existing createdAt if updating
      try {
        const existing = await store.readJson(fp);
        doc.meta.createdAt = existing?.meta?.createdAt ?? now;
      } catch {
        doc.meta.createdAt = now;
      }
    }

    await store.writeJson(fp, doc);
    ok(res, { id, editToken, scheme: validated, meta: doc.meta });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/reports') {
    let body;
    try {
      body = await readBodyJson(req, 200_000);
    } catch {
      badRequest(res, 'Invalid JSON body');
      return true;
    }
    const schemeId = typeof body.schemeId === 'string' ? body.schemeId : null;
    if (!schemeId) {
      badRequest(res, 'Missing schemeId');
      return true;
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 80) : 'Report';
    const message = typeof body.message === 'string' ? body.message.slice(0, 500) : '';

    const id = `r_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const fp = path.join(store.dirs.reports, `${id}.json`);
    await store.writeJson(fp, { id, schemeId, reason, message, createdAt: Date.now() });
    ok(res, { id });
    return true;
  }

  // Future: ratings, replays, etc.
  notFound(res);
  return true;
}
