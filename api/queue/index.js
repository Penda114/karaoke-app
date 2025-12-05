// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
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


export default async function handler(req, res) {
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
    return res.status(500).json({ message: 'Server error' });
  }
}

// Les fonctions POST et GET restent inchangées (elles sont stables)

async function handlePost(req, res, body) {
  const { name, songTitle } = body;

  if (!name || !songTitle || typeof name !== 'string' || typeof songTitle !== 'string') {
    return res.status(400).json({ message: 'Nom et chanson (en tant que chaînes de caractères) requis.' });
  }

  // ✅ 1. Vérifier la taille actuelle de la file
  const queueLength = await redis.llen('karaoke_queue');

  if (queueLength >= 35) {
    return res.status(403).json({ 
      message: 'La file est pleine (20 chansons maximum).' 
    });
  }

  // ✅ 2. Ajouter normalement si la limite n'est pas atteinte
  const entry = {
    id: Date.now().toString(),
    name: name.trim(),
    songTitle: songTitle.trim()
  };

  await redis.rpush('karaoke_queue', JSON.stringify(entry));

  return res.status(201).json({ message: 'Ajouté à la file !', entry });
}

async function handleGet(req, res) {
  const entryStrings = await redis.lrange('karaoke_queue', 0, -1);
  return res.status(200).json(entryStrings);
}

/**
 * Gère DELETE /api/queue
 * Supprime une chanson spécifique par son ID, avec débogage détaillé.
 */
async function handleDelete(req, res, body) {
  const { id } = body;
  console.log(`[DELETE] Tentative de suppression. ID reçu: ${id}`); // DEBUG: ID reçu
  
  if (!id) {
    console.error("[DELETE] Échec: ID manquant dans le corps de la requête.");
    return res.status(400).json({ message: 'ID manquant.' });
  }

  // 1. Lire toutes les entrées
  const allEntries = await redis.lrange('karaoke_queue', 0, -1);
  console.log(`[DELETE] Entrées lues de Redis: ${allEntries.length} éléments.`); // DEBUG: Nombre d'entrées
  
  let entryToRemove = null;

  // 2. Chercher la chaîne JSON exacte qui contient cet ID
  for (const entryString of allEntries) {
    try {
      const parsed = JSON.parse(entryString);
      
      const parsedId = String(parsed.id); 
      
      if (parsed && parsed.id != null && parsedId === String(id)) {
        entryToRemove = entryString;
        console.log(`[DELETE] ✅ Match trouvé pour l'ID ${id}.`); // DEBUG: Match trouvé
        console.log(`[DELETE] Chaîne complète: ${entryToRemove.substring(0, 80)}...`); 
        break;
      }
      
      // Log utile si la liste est très longue et que le match ne se fait pas
      // console.log(`[DELETE] Vérification: ID dans Redis: ${parsedId}, ID recherché: ${id}`); 

    } catch (e) {
      // Ignorer les chaînes non-JSON
      console.warn(`[DELETE] Ignoré: Chaîne non-JSON trouvée: ${entryString.substring(0, 50)}...`);
    }
  }

  // 3. Si on l'a trouvée, la supprimer
  if (!entryToRemove) {
    console.error(`[DELETE] ❌ Échec: Aucune chaîne correspondante trouvée pour l'ID ${id}.`); // DEBUG: Échec
    return res.status(404).json({ message: 'Entrée non trouvée ou déjà supprimée.' });
  }

  // Suppression
  const result = await redis.lrem('karaoke_queue', 1, entryToRemove);
  
  if (result === 1) {
    console.log(`[DELETE] ✔️ Succès: 1 élément supprimé (ID: ${id}).`); // DEBUG: Succès
    return res.status(200).json({ message: 'Entrée supprimée !' });
  } else {
    console.error(`[DELETE] ⚠️ Attention: Échec LREM. LREM a retourné ${result}.`); // DEBUG: Problème LREM
    return res.status(404).json({ message: 'Échec de la suppression par Redis (élément disparu?).' });
  }
}