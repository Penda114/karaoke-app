import assert from 'node:assert';

// Teste le garde-fou : sans variables d'environnement Redis, le handler
// doit renvoyer immédiatement un 503 clair (et ne pas tenter de requête Upstash).
// On importe dynamiquement APRÈS avoir nettoyé l'env pour que le module
// lise bien des valeurs absentes.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { default: handler } = await import('../api/queue/index.js');

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

// 1. GET sans config Redis -> 503 clair
{
  const req = { method: 'GET' };
  const res = makeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 503, `GET sans config: attendu 503, reçu ${res.statusCode}`);
  assert.ok(res.body.message.includes('Redis non configuré'), 'message de garde attendu');
  console.log('OK  -> GET sans config Redis renvoie 503 avec message clair');
}

// 2. POST sans config Redis -> 503 clair (pas de timeout Upstash)
{
  const req = { method: 'POST', body: { name: 'A', songTitle: 'B' } };
  const res = makeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 503, `POST sans config: attendu 503, reçu ${res.statusCode}`);
  console.log('OK  -> POST sans config Redis renvoie 503 (pas de requête Upstash)');
}

console.log('\nTous les tests du garde-fou sont passés.');
