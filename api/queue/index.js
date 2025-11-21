import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    if (req.method === 'GET') {
        // Obtenir la file d'attente (c'est une liste Redis)
        try {
            const queue = await redis.lrange('karaoke_queue', 0, -1);
            res.status(200).json(queue);
        } catch (error) {
            console.error('Redis GET error:', error);
            res.status(500).json({ message: 'Server error' });
        }
    } else if (req.method === 'POST') {
        // Ajouter à la file
        try {
            const { name, songTitle } = req.body;
            if (!name || !songTitle) {
                return res.status(400).json({ message: 'Nom et chanson requis.' });
            }
            
            // On stocke un objet JSON stringifié dans la liste Redis
            const entry = { name, songTitle, id: Date.now() };
            await redis.rpush('karaoke_queue', JSON.stringify(entry));
            
            res.status(201).json({ message: "Ajouté à la file !", entry });
        } catch (error) {
            console.error('Redis POST error:', error);
            res.status(500).json({ message: 'Server error' });
        }
    } else {
        res.status(405).json({ message: 'Method Not Allowed' });
    }
}