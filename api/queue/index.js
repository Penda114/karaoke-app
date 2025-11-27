// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  try {
    switch (req.method) {
      // --- AJOUTER À LA FILE D'ATTENTE ---
      case 'POST':
        return await handlePost(req, res);

      // --- LIRE LA FILE D'ATTENTE ---
      case 'GET':
        return await handleGet(req, res);

      // --- SUPPRIMER DE LA FILE D'ATTENTE ---
      case 'DELETE':
        return await handleDelete(req, res);

      // --- MÉTHODE NON AUTORISÉE ---
      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
  } catch (err) {
    console.error('API /api/queue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Gère POST /api/queue
 * Ajoute une nouvelle chanson à la fin de la liste.
 */
async function handlePost(req, res) {
  const { name, songTitle } = req.body;

  // 1. Validation simple
  if (!name || !songTitle || typeof name !== 'string' || typeof songTitle !== 'string') {
    return res.status(400).json({ message: 'Nom et chanson (en tant que chaînes de caractères) requis.' });
  }

  // 2. Créer une entrée propre et standardisée
  const entry = {
    id: Date.now().toString(), // ID unique basé sur le timestamp
    name: name.trim(),
    songTitle: songTitle.trim()
  };

  // 3. Sauvegarder la *chaîne JSON* dans Redis
  await redis.rpush('karaoke_queue', JSON.stringify(entry));
  return res.status(201).json({ message: 'Ajouté à la file !', entry });
}

/**
 * Gère GET /api/queue
 * Lit la file d'attente complète. NE MODIFIE PAS LES DONNÉES.
 */
async function handleGet(req, res) {
  // 1. Lire toutes les chaînes de la liste
  const entryStrings = await redis.lrange('karaoke_queue', 0, -1);

  // 2. Parser chaque chaîne en objet
  const queue = entryStrings.map((entryString, i) => {
    try {
      const parsed = JSON.parse(entryString);
      // S'assurer que c'est un objet valide
      if (typeof parsed === 'object' && parsed !== null && parsed.id) {
        return parsed;
      }
      // Si les données sont bizarres mais parsables (ex: "hello" ou 123)
      return {
        id: `invalid-entry-${i}`,
        name: 'Donnée Invalide',
        songTitle: String(entryString).slice(0, 100)
      };
    } catch (e) {
      // Si ce n'est PAS du JSON (vieilles données corrompues)
      return {
        id: `raw-string-${i}`,
        name: 'Donnée Brute Corrompue',
        songTitle: String(entryString).slice(0, 100)
      };
    }
  });

  // 3. Renvoyer la liste parsée
  // **REMARQUE : Nous ne réécrivons PLUS JAMAIS les données dans Redis ici.**
  // C'est ce qui causait votre bug.
  return res.status(200).json(queue);
}

/**
 * Gère DELETE /api/queue
 * Supprime une chanson spécifique par son ID.
 */
async function handleDelete(req, res) {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ message: 'ID manquant.' });
  }

  // 1. Lire toutes les entrées pour trouver celle à supprimer
  const allEntries = await redis.lrange('karaoke_queue', 0, -1);
  let entryToRemove = null;

  // 2. Chercher la *chaîne* exacte qui contient cet ID
  // (car LREM supprime par la valeur de la chaîne, pas par un champ d'objet)
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
    return res.status(404).json({ message: 'Entrée non trouvée.' });
  }

  // LREM va supprimer 1 seule occurrence de la chaîne `entryToRemove`
  await redis.lrem('karaoke_queue', 1, entryToRemove);
  return res.status(200).json({ message: 'Entrée supprimée.' });
}