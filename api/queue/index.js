// pages/api/queue/index.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function readableNameFrom(val, idx = 0) {
  if (val == null) return '(inconnu)';
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return '(inconnu)';
    // cas courant provenant d'un String(object)
    if (s === '[object Object]') return '(inconnu)';
    return s;
  }
  if (typeof val === 'object') {
    if (val.displayName) return String(val.displayName);
    if (typeof val.name === 'string' && val.name.trim()) return val.name;
    if (val.first || val.last) return [val.first || '', val.last || ''].join(' ').trim() || '(inconnu)';
    if (val.givenName) return String(val.givenName);
    // fallback : JSON court
    try {
      const js = JSON.stringify(val);
      return js.length > 80 ? js.slice(0, 80) + '…' : js;
    } catch {
      return '(inconnu)';
    }
  }
  return String(val);
}

function readableSongFrom(val) {
  if (val == null) return '(chanson inconnue)';
  if (typeof val === 'string') {
    if (!val.trim()) return '(chanson inconnue)';
    if (val === '[object Object]') return '(chanson inconnue)';
    return val;
  }
  if (typeof val === 'object') {
    if (typeof val.title === 'string' && val.title.trim()) {
      return val.title + (val.artist ? ' — ' + val.artist : '');
    }
    if (typeof val.name === 'string') return val.name;
    try {
      const js = JSON.stringify(val);
      return js.length > 100 ? js.slice(0, 100) + '…' : js;
    } catch {
      return '(chanson inconnue)';
    }
  }
  return String(val);
}

export default async function handler(req, res) {
  // parser safe du body (au cas où)
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch {
      // garder tel quel
    }
  }

  try {
    if (req.method === 'GET') {
      const list = await redis.lrange('karaoke_queue', 0, -1);

      // build normalized array with string name and songTitle
      const normalized = [];
      for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        try {
          const parsed = JSON.parse(raw);
          // parsed may contain name as object or string
          const id = parsed.id != null ? String(parsed.id) : String(Date.now()) + '-' + i;
          const name = readableNameFrom(parsed.name, i);
          const songTitle = readableSongFrom(parsed.songTitle ?? parsed.song ?? parsed.track);
          normalized.push({ id, name, songTitle, ...parsed });
        } catch {
          // raw was not JSON -> treat raw string as name
          const id = String(Date.now()) + '-' + i;
          const name = (typeof raw === 'string' && raw.trim() === '[object Object]') ? '(inconnu)' : String(raw);
          const songTitle = '(chanson inconnue)';
          normalized.push({ id, name, songTitle });
        }
      }

      // rewrite normalized list back to redis so future GETs are clean (id,name,songTitle strings)
      if (normalized.length > 0) {
        // Replace atomically: delete then push in same order
        await redis.del('karaoke_queue');
        for (const obj of normalized) {
          // ensure we store a clean object with string fields
          const stored = {
            id: String(obj.id),
            name: String(obj.name),
            songTitle: String(obj.songTitle),
            // keep other fields if present
            ...obj
          };
          await redis.rpush('karaoke_queue', JSON.stringify(stored));
        }
      }

      return res.status(200).json(normalized);
    }

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
          if (String(entryString) === String(id)) {
            entryToRemove = entryString;
            break;
          }
        }
      }

      if (!entryToRemove) return res.status(404).json({ message: 'Entrée non trouvée.' });

      await redis.lrem('karaoke_queue', 1, entryToRemove);
      return res.status(200).json({ message: 'Entrée supprimée.' });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  } catch (err) {
    console.error('API /api/queue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
