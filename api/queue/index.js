// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  try {
    switch (req.method) {
      case 'POST':
        return await handlePost(req, res);
      case 'GET':
        return await handleGet(req, res); // MODIFIÉ
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
  } catch (err) {
    console.error('API /api/queue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function handlePost(req, res) {
  const { name, songTitle } = req.body;
  if (!name || !songTitle || typeof name !== 'string' || typeof songTitle !== 'string') {
    return res.status(400).json({ message: 'Nom et chanson (en tant que chaînes de caractères) requis.' });
  }
  const entry = {
    id: Date.now().toString(),
    name: name.trim(),
    songTitle: songTitle.trim()
  };
  await redis.rpush('karaoke_queue', JSON.stringify(entry));
  return res.status(201).json({ message: 'Ajouté à la file !', entry });
}

/**
 * Gère GET /api/queue
 * Renvoie les CHAÎNES BRUTES DE REDIS. Le parsing est déplacé vers admin.html.
 */
async function handleGet(req, res) {
  // Lire toutes les chaînes de la liste
  const entryStrings = await redis.lrange('karaoke_queue', 0, -1);
  
  // Renvoyer les chaînes brutes dans un tableau JSON
  // L'application cliente (admin.html) va gérer le parsing.
  return res.status(200).json(entryStrings);
}


async function handleDelete(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ message: 'ID manquant.' });

  const allEntries = await redis.lrange('karaoke_queue', 0, -1);
  let entryToRemove = null;
  
  for (const entryString of allEntries) {
    try {
      const parsed = JSON.parse(entryString);
      if (parsed && parsed.id != null && String(parsed.id) === String(id)) {
        entryToRemove = entryString;
        break;
      }
    } catch (e) {
      // Ignorer les chaînes non-JSON
    }
  }

  if (!entryToRemove) return res.status(404).json({ message: 'Entrée non trouvée.' });

  await redis.lrem('karaoke_queue', 1, entryToRemove);
  return res.status(200).json({ message: 'Entrée supprimée.' });
}