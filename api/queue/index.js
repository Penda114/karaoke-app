import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  try {
    // ---------- GET ----------
    if (req.method === 'GET') {
      const list = await redis.lrange('karaoke_queue', 0, -1);
      // renvoyer des objets déjà parsés quand possible
      const parsed = list.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return { raw: true, value: item };
        }
      });
      return res.status(200).json(parsed);
    }

    // ---------- POST ----------
    if (req.method === 'POST') {
      const { name, songTitle } = req.body ?? {};
      if (!name || !songTitle) return res.status(400).json({ message: 'Nom et chanson requis.' });

      // id en string pour éviter confusions
      const entry = { id: Date.now().toString(), name, songTitle };
      await redis.rpush('karaoke_queue', JSON.stringify(entry));
      return res.status(201).json({ message: 'Ajouté à la file !', entry });
    }

    // ---------- DELETE ----------
    if (req.method === 'DELETE') {
      const { id } = req.body ?? {};
      if (!id) return res.status(400).json({ message: 'ID manquant.' });

      const allEntries = await redis.lrange('karaoke_queue', 0, -1);

      let entryToRemove = null;

      for (const entryString of allEntries) {
        try {
          const entry = JSON.parse(entryString);
          // comparaison souple (string/number)
          if (entry.id != null && String(entry.id) === String(id)) {
            entryToRemove = entryString;
            break;
          }
        } catch {
          // entrée brute stockée => comparer la valeur brute
          if (entryString === id || (String(entryString) === String(id))) {
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

    res.setHeader('Allow', ['GET','POST','DELETE']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  } catch (err) {
    console.error('API /api/queue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
