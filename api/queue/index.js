// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_QUEUE_SIZE = 35;

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.error(
    '[queue] Variables d\'environnement manquantes : ' +
      'UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN doivent être définies.'
  );
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

// Fonction utilitaire pour parser le corps de la requête (requis pour Vercel/Node)
async function parseBody(req) {
    if (req.method === 'GET') return {};
    if (req.body) return req.body;
    
    try {
        const bodyBuffer = await new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                resolve(body);
            });
            req.on('error', reject);
        });
        return JSON.parse(bodyBuffer);
    } catch (e) {
        return {};
    }
}

/**
 * Normalise une entrée lue depuis Redis : @upstash/redis renvoie déjà des
 * objets (auto-désérialisation), mais on gère aussi le cas où c'est encore
 * une chaîne JSON (données existantes ou autres clients).
 */
export function normalizeEntry(e) {
  if (typeof e === 'string') {
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
  }
  return e;
}

/** Renvoie l'index de l'entrée dont l'id correspond, ou -1. */
export function findEntryIndex(allEntries, id) {
  return allEntries.findIndex((e) => {
    const entry = normalizeEntry(e);
    return entry && entry.id != null && String(entry.id) === String(id);
  });
}

/**
 * Crée le handler HTTP de l'API /api/queue.
 * `redis` est injectable (utile pour les tests) ; `opts.isConfigured`
 * indique si la configuration Redis est présente (par défaut : variables d'env).
 */
export function createHandler(redis, opts = {}) {
  const isConfigured =
    opts.isConfigured || (() => Boolean(redisUrl && redisToken));

  async function handlePost(req, res, body) {
    const { name, songTitle } = body;

    if (!name || !songTitle || typeof name !== 'string' || typeof songTitle !== 'string') {
      return res.status(400).json({ message: 'Nom et chanson (en tant que chaînes de caractères) requis.' });
    }

    // 1. Vérifier la taille actuelle de la file
    const queueLength = await redis.llen('karaoke_queue');

    if (queueLength >= MAX_QUEUE_SIZE) {
      return res.status(403).json({
        message: `La file est pleine (${MAX_QUEUE_SIZE} chansons maximum).`
      });
    }

    // 2. Ajouter l'entrée. @upstash/redis sérialise automatiquement les objets :
    //    on stocke l'objet directement (pas de JSON.stringify) pour éviter
    //    un double-encodage.
    const entry = {
      id: Date.now().toString(),
      name: name.trim(),
      songTitle: songTitle.trim()
    };

    await redis.rpush('karaoke_queue', entry);

    return res.status(201).json({ message: 'Ajouté à la file !', entry });
  }

  async function handleGet(req, res) {
    const entries = await redis.lrange('karaoke_queue', 0, -1);
    return res.status(200).json(entries);
  }

  async function handleDelete(req, res, body) {
    const { id } = body;
    console.log(`[DELETE] Tentative de suppression. ID reçu: ${id}`);

    if (!id) {
      console.error("[DELETE] Échec: ID manquant dans le corps de la requête.");
      return res.status(400).json({ message: 'ID manquant.' });
    }

    // 1. Lire toutes les entrées (objets ou chaînes selon l'historique)
    const allEntries = await redis.lrange('karaoke_queue', 0, -1);
    console.log(`[DELETE] Entrées lues de Redis: ${allEntries.length} éléments.`);

    const index = findEntryIndex(allEntries, id);

    if (index === -1) {
      console.error(`[DELETE] ❌ Aucune entrée trouvée pour l'ID ${id}.`);
      return res.status(404).json({ message: 'Entrée non trouvée ou déjà supprimée.' });
    }

    console.log(`[DELETE] ✅ Match trouvé pour l'ID ${id}.`);

    // 2. Reconstruction de la liste sans l'entrée supprimée.
    //    lrem exigerait la chaîne EXACTE stockée ; on rebuild pour être robuste
    //    quelle que soit la forme renvoyée par le client Redis.
    const remaining = allEntries
      .filter((_, i) => i !== index)
      .map((e) => normalizeEntry(e));

    await redis.del('karaoke_queue');
    if (remaining.length > 0) {
      await redis.rpush('karaoke_queue', ...remaining);
    }

    console.log(`[DELETE] ✔️ Succès: entrée supprimée (ID: ${id}).`);
    return res.status(200).json({ message: 'Entrée supprimée !' });
  }

  return async function handler(req, res) {
    // Garde-fou : évite un timeout Upstash de ~5s et renvoie un message clair
    // si la configuration Redis est absente, au lieu d'un 500 générique.
    if (!isConfigured()) {
      return res.status(503).json({
        message: 'Redis non configuré : définissez UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN.',
      });
    }

    const body = await parseBody(req);

    try {
      switch (req.method) {
        case 'POST':
          return await handlePost(req, res, body);
        case 'GET':
          return await handleGet(req, res);
        case 'DELETE':
          return await handleDelete(req, res, body);
        default:
          res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
          return res.status(405).json({ message: 'Method Not Allowed' });
      }
    } catch (err) {
      console.error('API /api/queue error global:', err);
      return res.status(500).json({ message: 'Server error', error: err.message });
    }
  };
}

export default createHandler(redis);