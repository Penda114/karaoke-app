import { Pool } from 'pg';

// Vercel injecte automatiquement les variables d'environnement
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const result = await pool.query('SELECT title, artist FROM songs ORDER BY artist, title');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching songs:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}