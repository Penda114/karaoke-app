import os
import subprocess
import json
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

# Charge les variables d'environnement (DATABASE_URL) depuis le .env
load_dotenv()

def get_video_metadata(filepath):
    """Identique à avant : utilise ffprobe pour extraire les métadonnées."""
    command = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', str(filepath)
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        
        metadata = {
            'filename': filepath.name,
            'duration_seconds': 0,
            'title': filepath.stem, 
            'artist': 'Inconnu'
        }
        
        if 'format' in data and 'duration' in data['format']:
            metadata['duration_seconds'] = float(data['format']['duration'])
        
        if 'format' in data and 'tags' in data['format']:
            tags = data['format']['tags']
            if 'title' in tags:
                metadata['title'] = tags['title']
            if 'artist' in tags:
                metadata['artist'] = tags['artist']
            elif 'composer' in tags:
                metadata['artist'] = tags['composer']

        # Normalise les champs pour éviter les erreurs d'encodage
        metadata['title'] = metadata['title'].replace('\x00', '')
        metadata['artist'] = metadata['artist'].replace('\x00', '')
        
        return metadata
    except Exception as e:
        print(f"Erreur ffprobe sur {filepath}: {e}")
        return None

def scan_directory(directory):
    """Scanne le répertoire."""
    video_extensions = ['.mp4', '.mkv', '.avi', '.mov']
    song_list = []
    for filepath in Path(directory).rglob('*'):
        if filepath.suffix.lower() in video_extensions:
            print(f"Analyse de: {filepath.name}")
            metadata = get_video_metadata(filepath)
            if metadata:
                song_list.append(metadata)
    return song_list

def update_database(song_list):
    """Se connecte à Neon et remplace la liste des chansons."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERREUR: DATABASE_URL non trouvée. As-tu créé le fichier .env ?")
        return

    conn = None
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        print("Connexion à la base de données... OK.")
        
        # 1. Supprime l'ancienne table (logique "supprime tout")
        cur.execute("DROP TABLE IF EXISTS songs;")
        print("Ancienne table 'songs' supprimée.")
        
        # 2. Crée la nouvelle table
        cur.execute("""
            CREATE TABLE songs (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                duration_seconds REAL,
                filename TEXT
            );
        """)
        print("Nouvelle table 'songs' créée.")
        
        # 3. Insère les nouvelles chansons
        # Prépare la requête d'insertion
        insert_query = """
            INSERT INTO songs (title, artist, duration_seconds, filename)
            VALUES (%s, %s, %s, %s)
        """
        # Prépare la liste de tuples
        data_to_insert = [
            (s['title'], s['artist'], s['duration_seconds'], s['filename']) 
            for s in song_list
        ]
        
        # Exécute l'insertion en masse (beaucoup plus rapide)
        cur.executemany(insert_query, data_to_insert)
        
        # Valide la transaction
        conn.commit()
        
        print(f"SUCCÈS : {len(song_list)} chansons insérées dans la base Neon.")
        
    except Exception as e:
        print(f"ERREUR DATABASE: {e}")
        if conn:
            conn.rollback() # Annule les changements en cas d'erreur
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

# --- Script Principal ---
if __name__ == "__main__":
    # --- DÉFINIS TON DOSSIER ICI ---
    # Utilise un 'r' avant les guillemets pour que Windows comprenne bien les \
    target_directory = "D://"
    # ---------------------------------
    
    print(f"Scan du répertoire '{os.path.abspath(target_directory)}'...")
    
    songs = scan_directory(target_directory)
    
    if songs:
        update_database(songs)
    else:
        print("Aucune chanson trouvée. La base de données n'a pas été modifiée.")