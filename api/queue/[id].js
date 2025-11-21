import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { id } = req.query; // L'ID vient de l'URL (ex: /api/queue/123456)

    try {
        const allEntries = await redis.lrange('karaoke_queue', 0, -1);
        let entryFound = null;

        for (const entryString of allEntries) {
            const entry = JSON.parse(entryString);
            if (entry.id.toString() === id) {
                entryFound = entryString;
                break;
            }
        }

        if (entryFound) {
            // LREM: Supprime UNE SEULE occurrence de la valeur
            await redis.lrem('karaoke_queue', 1, entryFound);
            res.status(200).json({ message: 'Entrée supprimée.' });
        } else {
            res.status(404).json({ message: 'Entrée non trouvée.' });
        }
    } catch (error) {
        console.error('Redis DELETE error:', error);
        res.status(500).json({ message: 'Server error' });
    }
}