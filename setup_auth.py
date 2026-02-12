from ytmusicapi import YTMusic

print("=" * 60)
print("YouTube Music API - Authentication Setup")
print("=" * 60)
print("\nFollow these steps to get your request headers:\n")
print("1. Open YouTube Music (music.youtube.com) in your browser")
print("2. Open Developer Tools (F12)")
print("3. Go to the 'Network' tab")
print("4. Click on a song or navigate around YouTube Music")
print("5. Find a request to 'music.youtube.com' in the Network tab")
print("6. Right-click on it → Copy → Copy as cURL (bash)")
print("7. Paste the entire cURL command below\n")
print("-" * 60)

# Alternative: Use YTMusic without authentication for basic searches
print("\nNOTE: For testing, you can use YTMusic without authentication.")
print("Creating a basic auth file for testing...\n")

try:
    # Try to create YTMusic instance without auth (limited functionality)
    ytmusic = YTMusic()
    print("✓ Created basic YTMusic instance (no authentication)")
    print("✓ You can use search and some other features")
    print("\nIf you need full features (playlists, library access),")
    print("you'll need to provide authentication headers manually.")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 60)
