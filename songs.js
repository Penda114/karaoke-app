// pages/api/songs.js
import { Pool } from 'pg';
import { NEW_KARAOKE_SONGS } from '../data/karaoke-songs.js';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Mentions ajoutées par les noms de fichiers karaoké : elles ne servent pas à
// identifier une chanson, on les ignore donc pour détecter les doublons.
const STOP_WORDS = new Set(
    (
        'karaoke karafun france lyricsparty sing now rapsound bdfab disney star academy ' +
        'concept version paroles lyrics instrumental official officiel video clip hd 4k ' +
        '720p 360p 480p 1080p h264 x264 avec sous titres original key guide melody ' +
        'inconnu with chours choeurs anglais italien espagnol allemand hollandais rap pk ' +
        'poprock tube2020 tube2021 abba bala dion esp fr fg jj hol it ambi lara de youtube ' +
        'duo hf hh ff acoustic guit guitar the'
    ).split(' ')
);

function normalizeTitle(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' et ')
        .replace(/['’`]/g, '')
        .replace(/\b([ldjmtcsn])\s+([aeiouyh])/g, '$1$2')
        .replace(/\bi\s+m\b/g, 'im')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** Clé insensible à l'ordre, aux accents, à la casse et aux mentions karaoké. */
export function songKey(title) {
    let tokens = normalizeTitle(title)
        .split(' ')
        .filter((token) => token && !STOP_WORDS.has(token));

    while (
        tokens.length > 0 &&
        (/^\d{1,4}$/.test(tokens[0]) ||
            /^[a-z]{1,5}\d{1,4}$/.test(tokens[0]) ||
            /^a\d{1,4}$/.test(tokens[0]))
    ) {
        tokens.shift();
    }

    tokens = tokens.filter((token) => token.length > 1 || /^\d+$/.test(token));
    return [...new Set(tokens)].sort().join(' ');
}

/**
 * Fusionne les chansons de la base avec les nouveaux morceaux karaoké.
 * Toutes les lignes existantes sont conservées ; un nouveau morceau est
 * ignoré s'il correspond déjà à une chanson présente ou déjà ajoutée.
 */
export function mergeSongs(existingSongs, newSongs = NEW_KARAOKE_SONGS) {
    const merged = existingSongs.slice();
    const seen = new Set(existingSongs.map((song) => songKey(song.title)));

    for (const song of newSongs) {
        if (!song || typeof song.title !== 'string') continue;
        const key = songKey(song.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push({ title: song.title, artist: song.artist || 'Inconnu' });
    }

    merged.sort(
        (a, b) =>
            String(a.artist || '').localeCompare(String(b.artist || ''), 'fr', { sensitivity: 'base' }) ||
            String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' })
    );
    return merged;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // Sélectionne et trie les chansons
        const result = await pool.query('SELECT title, artist FROM songs ORDER BY artist, title');
        res.status(200).json(mergeSongs(result.rows));
    } catch (error) {
        console.error('Error fetching songs:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}