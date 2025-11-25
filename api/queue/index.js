import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {

    // Assurer que req.body est bien parsé
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            return res.status(400).json({ message: 'Corps JSON invalide.' });
        }
    }

    // GET : récupérer la file
    if (req.method === 'GET') {
        try {
            const queue = await redis.lrange('karaoke_queue', 0, -1);
            const parsed = queue.map(item => {
                try {
                    return JSON.parse(item);
                } catch {
                    return { raw: item }; // valeur brute → jamais normal
                }
            });
            return res.status(200).json(parsed);
        } catch (error) {
            console.error('Redis GET error:', error);
            return res.status(500).json({ message: 'Server error' });
        }
    }

    // POST : ajouter une entrée
    if (req.method === 'POST') {
        try {
            const { name, songTitle } = body;

            if (!name || !songTitle) {
                return res.status(400).json({ message: 'Nom et chanson requis.' });
            }

            const entry = {
                id: Date.now().toString(),
                name,
                songTitle
            };

            await redis.rpush('karaoke_queue', JSON.stringify(entry));

            return res.status(201).json({ message: "Ajouté à la file !", entry });

        } catch (error) {
            console.error('Redis POST error:', error);
            return res.status(500).json({ message: 'Server error' });
        }
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
}
