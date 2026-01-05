import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createDataStore } from './store.js';
import { handleApi } from './api.js';
import { makeDefaultScheme } from '../shared/scheme/schema.js';

function makeReq({ method, url, body }) {
  const payload = body ? JSON.stringify(body) : '';
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = url;
  return req;
}

function makeRes() {
  const chunks = [];
  return {
    statusCode: 0,
    headers: {},
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers ?? {};
    },
    end(data) {
      if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
      this.body = Buffer.concat(chunks).toString('utf8');
    },
  };
}

test('api: publish, list, fetch, report', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tmpRoot = path.join(repoRoot, 'data_test_tmp');
  await fs.rm(tmpRoot, { recursive: true, force: true });
  const store = await createDataStore(tmpRoot);

  const scheme = makeDefaultScheme();
  scheme.name = 'Published Test Map';

  // Publish
  {
    const req = makeReq({ method: 'POST', url: '/api/schemes', body: { scheme, visibility: 'Community', author: 'Tester' } });
    const res = makeRes();
    const handled = await handleApi({ req, res, store });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
    assert.ok(json.id);
    assert.ok(json.editToken);
  }

  // List
  let publishedId;
  {
    const req = makeReq({ method: 'GET', url: '/api/schemes' });
    const res = makeRes();
    await handleApi({ req, res, store });
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.official));
    assert.ok(Array.isArray(json.published));
    assert.equal(json.published.length, 1);
    publishedId = json.published[0].id;
  }

  // Fetch scheme by id
  {
    const req = makeReq({ method: 'GET', url: `/api/schemes/${publishedId}` });
    const res = makeRes();
    await handleApi({ req, res, store });
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
    assert.equal(json.scheme.id, publishedId);
    assert.equal(json.scheme.name, 'Published Test Map');
  }

  // Report scheme
  {
    const req = makeReq({
      method: 'POST',
      url: '/api/reports',
      body: { schemeId: publishedId, reason: 'Test report', message: 'Test details' },
    });
    const res = makeRes();
    await handleApi({ req, res, store });
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
    assert.ok(json.id);
  }

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

