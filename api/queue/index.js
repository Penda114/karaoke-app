// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Normalise une entrée brute (string ou JSON string) en objet { id, name, songTitle }
 * Si l'entrée est déjà un objet JSON stringifié, on la parse et on garantit les champs.
 */
function normalizeEntryString(entryString, fallbackIndex) {
  try {
    const parsed = JSON.parse(entryString);
    // Si c'est déjà un objet, s'assurer des champs
    return {
      id: parsed.id != null ? String(parsed.id) : String(Date.now()) + "-" + fallbackIndex,
      name: parsed.name ?? "(inconnu)",
      songTitle: parsed.songTitle ?? "(inconnu)",
      ...parsed
    };
  } catch {
    // entrée purement brute (ex: "Ced")
    const nameStr = String(entryString);
    return {
      id: String(Date.now()) + "-" + fallbackIndex,
      name: nameStr,
      songTitle: "(inconnu)"
    };
  }
}

export default async function handler(req, res) {
  // Safe parse du body si Next/Edge envoie en string
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch {
      // si c'est un simple string (non JSON), on le gardera tel quel et la validation s'en chargera
      body = body;
    }
  }

  try {
    // -------- GET ----------
    if (req.method === 'GET') {
      const list = await redis.lrange('karaoke_queue', 0, -1); // array de strings
      // Normaliser toutes les entrées et noter si migration nécessaire
      const normalized = [];
      let needMigration = false;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        try {
          const parsed = JSON.parse(item);
          // Si parsed est bien un objet et a songTitle, on garde tel quel (mais uniformise id->string)
          if (parsed && typeof parsed === 'object') {
            const safe = {
              id: parsed.id != null ? String(parsed.id) : String(Date.now()) + "-" + i,
              name: parsed.name ?? "(inconnu)",
              songTitle: parsed.songTitle ?? "(inconnu)",
              ...parsed
            };
            normalized.push(safe);
            // if original is not exactly JSON.stringify(safe) we'd prefer to rewrite during migration,
            // but only set migration flag if original lacked songTitle or id
            if (parsed.songTitle == null || parsed.id == null) needMigration = true;
          } else {
            // weird type -> normalize
            normalized.push(normalizeEntryString(item, i));
            needMigration = true;
          }
        } catch {
          // raw string -> normalize and mark migration needed
          normalized.push(normalizeEntryString(item, i));
          needMigration = true;
        }
      }

      // Si nécessaire, remplacer la liste sur Redis par la version normalisée
      if (needMigration && normalized.length > 0) {
        // Remplacer atomiquement : supprimer puis push
        await redis.del('karaoke_queue');
        // push in same order
        for (const obj of normalized) {
          await redis.rpush('karaoke_queue', JSON.stringify(obj));
        }
      }

      // Renvoi des objets normalisés (toujours des objets)
      return res.status(200).json(normalized);
    }

    // -------- POST ----------
    if (req.method === 'POST') {
      const { name, songTitle } = body ?? {};

      if (!name || !songTitle) {
        return res.status(400).json({ message: 'Nom et chanson requis.' });
      }

      const entry = {
        id: Date.now().toString(),
        name: String(name),
        songTitle: String(songTitle)
      };

      await redis.rpush('karaoke_queue', JSON.stringify(entry));
      return res.status(201).json({ message: 'Ajouté à la file !', entry });
    }

    // -------- DELETE ----------
    if (req.method === 'DELETE') {
      const { id } = body ?? {};
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
        } catch {
          // raw string equality
          if (String(entryString) === String(id)) {
            entryToRemove = entryString;
            break;
          }
        }
      }

      if (!entryToRemove) {
        return res.status(404).json({ message: 'Entrée non trouvée.' });
      }

      await redis.lrem('karaoke_queue', 1, entryToRemove);
      return res.status(200).json({ message: 'Entrée supprimée.' });
    }

    // Méthode non autorisée
    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ message: 'Method Not Allowed' });

  } catch (error) {
    console.error('API /api/queue error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
}
