import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    try {
        // ------------------- GET -------------------
        if (req.method === 'GET') {
            const queue = await redis.lrange('karaoke_queue', 0, -1);
            return res.status(200).json(queue);
        }

        // ------------------- POST -------------------
        if (req.method === 'POST') {
            const { name, songTitle } = req.body;

            if (!name || !songTitle) {
                return res.status(400).json({ message: "Nom et chanson requis." });
            }

            const entry = {
                id: Date.now().toString(),
                name,
                songTitle
            };

            await redis.rpush('karaoke_queue', JSON.stringify(entry));

            return res.status(201).json({ message: "Ajouté à la file !", entry });
        }

        // ------------------- DELETE -------------------
        if (req.method === 'DELETE') {
            const { id } = req.body ?? {};

            if (!id) {
                return res.status(400).json({ message: "ID manquant." });
            }

            const allEntries = await redis.lrange('karaoke_queue', 0, -1);

            let entryFound = null;

            for (const entryString of allEntries) {
                try {
                    const entry = JSON.parse(entryString);
                    if (entry.id == id) {
                        entryFound = entryString;
                        break;
                    }
                } catch {
                    if (entryString === id) {
                        entryFound = entryString;
                        break;
                    }
                }
            }

            if (!entryFound) {
                return res.status(404).json({ message: "Entrée non trouvée." });
            }

            await redis.lrem('karaoke_queue', 1, entryFound);

            return res.status(200).json({ message: "Entrée supprimée.", id });
        }

        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ message: "Méthode non autorisée." });

    } catch (error) {
        console.error("Redis API error:", error);
        return res.status(500).json({ message: "Erreur serveur." });
    }
}
