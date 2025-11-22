import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // L'ID passé dans l'URL. 
    // Il peut être un ID numérique ("12345") 
    // ou une chaîne brute encodée (ex: "David%20Test")
    const idToDelete = decodeURIComponent(req.query.id);

    try {
        const allEntries = await redis.lrange('karaoke_queue', 0, -1);
        let entryFound = null;

        for (const entryString of allEntries) {
            // Tentative 1: Est-ce une entrée JSON valide ?
            try {
                const entry = JSON.parse(entryString);
                if (entry.id.toString() === idToDelete) {
                    entryFound = entryString;
                    break;
                }
            } catch (e) {
                // Tentative 2: Ce n'était pas du JSON. 
                // Est-ce que la chaîne brute correspond ?
                if (entryString === idToDelete) {
                    entryFound = entryString;
                    break;
                }
            }
        }

        if (entryFound) {
            // Supprime UNE SEULE occurrence de la valeur trouvée
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