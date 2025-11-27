// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Fonction utilitaire pour parser le corps de la requête, car Vercel/Node ne le fait pas toujours
// automatiquement pour les requêtes non-GET.
async function parseBody(req) {
    if (req.method === 'GET') return {};
    if (req.body) return req.body;
    
    // Si req.body est vide ou manquant, nous tentons de le lire à partir du flux
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


export default async function handler(req, res) {
  const body = await parseBody(req);
  
  try {
    switch (req.method) {
      case 'POST':
        return await handlePost(req, res, body);
      case 'GET':
        return await handleGet(req, res);
      case 'DELETE':
        return await handleDelete(req, res, body); // body est passé ici
      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
  } catch (err) {
    console.error('API /api/queue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Les fonctions POST et DELETE reçoivent maintenant le 'body' parsé
async function handlePost(req, res, body) {
  const { name, songTitle } = body;
  
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

async function handleGet(req, res) {
  // Lit les chaînes brutes de Redis
  const entryStrings = await redis.lrange('karaoke_queue', 0, -1);
  
  // Renvoie les chaînes brutes (le front fera le parsing)
  return res.status(200).json(entryStrings);
}

/**
 * Gère DELETE /api/queue
 * Supprime une chanson spécifique par son ID.
 */
async function handleDelete(req, res, body) {
  const { id } = body; // L'ID est extrait du body parsé
  
  if (!id) {
    return res.status(400).json({ message: 'ID manquant.' });
  }

  // 1. Lire toutes les entrées
  const allEntries = await redis.lrange('karaoke_queue', 0, -1);
  let entryToRemove = null;

  // 2. Chercher la chaîne JSON exacte qui contient cet ID
  for (const entryString of allEntries) {
    try {
      const parsed = JSON.parse(entryString);
      // Comparaison en chaîne pour être sûr
      if (parsed && parsed.id != null && String(parsed.id) === String(id)) {
        entryToRemove = entryString;
        break;
      }
    } catch (e) {
      // Ignorer les chaînes non-JSON
    }
  }

  // 3. Si on l'a trouvée, la supprimer
  if (!entryToRemove) {
    // Ce 404 est retourné si l'ID est valide mais que l'entrée n'est pas trouvée dans la liste
    return res.status(404).json({ message: 'Entrée non trouvée ou déjà supprimée.' });
  }

  // LREM va supprimer 1 seule occurrence de la chaîne exacte
  await redis.lrem('karaoke_queue', 1, entryToRemove);
  
  console.log(`Suppression réussie de l'élément avec ID: ${id}`);
  return res.status(200).json({ message: 'Entrée supprimée !' });
}