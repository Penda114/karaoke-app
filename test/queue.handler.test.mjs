import assert from 'node:assert';
import { createHandler, normalizeEntry, findEntryIndex } from '../api/queue/index.js';

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// ---- Helpers purs ----
assert.strictEqual(findEntryIndex([{ id: '1' }, { id: '2' }], '2'), 1, 'objet: index 2');
assert.strictEqual(findEntryIndex([JSON.stringify({ id: '1' })], '1'), 0, 'chaîne: index 0');
assert.strictEqual(findEntryIndex([{ id: '1' }], '9'), -1, 'absent: -1');
console.log('OK  -> findEntryIndex gère objets et chaînes');

// Faux Redis simulant @upstash/redis : stocke des objets, lrange renvoie des objets.
function makeFakeRedis(initial = []) {
  let list = initial.map(normalizeEntry);
  return {
    async llen() { return list.length; },
    async rpush(_k, ...v) { list.push(...v.map(normalizeEntry)); return list.length; },
    async lrange(_k, s, e) { return list.slice(s, e === -1 ? undefined : e + 1); },
    async del() { const n = list.length; list = []; return n; },
    _get: () => list,
  };
}

// ---- POST stocke un objet ----
{
  const redis = makeFakeRedis();
  const handler = createHandler(redis, { isConfigured: () => true });
  const res = makeRes();
  await handler({ method: 'POST', body: { name: 'Alice', songTitle: 'Chanson' } }, res);
  assert.strictEqual(res.statusCode, 201, `POST: attendu 201, reçu ${res.statusCode}`);
  assert.strictEqual(redis._get().length, 1);
  assert.strictEqual(redis._get()[0].name, 'Alice');
  console.log('OK  -> POST ajoute une entrée (objet)');
}

// ---- DELETE retire la bonne entrée (entrées en objets) ----
{
  const redis = makeFakeRedis([
    { id: 'a', name: 'A', songTitle: 'S' },
    { id: 'b', name: 'B', songTitle: 'T' },
  ]);
  const handler = createHandler(redis, { isConfigured: () => true });
  const res = makeRes();
  await handler({ method: 'DELETE', body: { id: 'a' } }, res);
  assert.strictEqual(res.statusCode, 200, `DELETE: attendu 200, reçu ${res.statusCode}`);
  assert.deepStrictEqual(redis._get().map((e) => e.id), ['b']);
  console.log('OK  -> DELETE retire la bonne entrée (objets)');
}

// ---- DELETE fonctionne aussi avec des entrées stockées en chaînes ----
{
  const redis = makeFakeRedis([JSON.stringify({ id: 'a' }), JSON.stringify({ id: 'b' })]);
  const handler = createHandler(redis, { isConfigured: () => true });
  const res = makeRes();
  await handler({ method: 'DELETE', body: { id: 'b' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(redis._get().map((e) => normalizeEntry(e).id), ['a']);
  console.log('OK  -> DELETE retire la bonne entrée (chaînes)');
}

// ---- DELETE id inconnu -> 404 ----
{
  const redis = makeFakeRedis([{ id: 'a' }]);
  const handler = createHandler(redis, { isConfigured: () => true });
  const res = makeRes();
  await handler({ method: 'DELETE', body: { id: 'z' } }, res);
  assert.strictEqual(res.statusCode, 404, `DELETE inconnu: attendu 404, reçu ${res.statusCode}`);
  console.log('OK  -> DELETE id inconnu -> 404');
}

// ---- DELETE sans id -> 400 ----
{
  const redis = makeFakeRedis([{ id: 'a' }]);
  const handler = createHandler(redis, { isConfigured: () => true });
  const res = makeRes();
  await handler({ method: 'DELETE', body: {} }, res);
  assert.strictEqual(res.statusCode, 400);
  console.log('OK  -> DELETE sans id -> 400');
}

console.log('\nTous les tests DELETE/POST/normalisation sont passés.');
