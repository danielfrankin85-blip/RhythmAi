from ytmusicapi import YTMusic
import os

print("Testing YouTube Music API...\n")

# Try with authentication file if it exists, otherwise use without auth
auth_file = "headers_auth.json"
if os.path.exists(auth_file):
    print(f"Using authentication from {auth_file}")
    ytmusic = YTMusic(auth_file)
else:
    print("No authentication file found. Using public access (limited features)")
    ytmusic = YTMusic()

try:
    # Search for songs
    print("\nSearching for 'Blinding Lights'...\n")
    results = ytmusic.search("Blinding Lights", filter="songs")
    
    if results:
        print(f"Found {len(results)} results:\n")
        for i, song in enumerate(results[:5], 1):
            title = song.get("title", "Unknown")
            artist = song.get("artists", [{}])[0].get("name", "Unknown") if song.get("artists") else "Unknown"
            duration = song.get("duration", "Unknown")
            print(f"{i}. {title} - {artist} ({duration})")
    else:
        print("No results found")
        
except Exception as e:
    print(f"\nError: {e}")
    print("\nIf you need full API access, you may need to set up authentication.")
    print("Run setup_auth.py for instructions.")
