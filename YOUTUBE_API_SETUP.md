# YouTube API Setup Guide

The YouTube proxy servers can be unreliable. For better reliability, you can use your own **free** YouTube Data API v3 key.

## How to Get Your Free API Key

### Step 1: Go to Google Cloud Console
Visit: https://console.cloud.google.com/apis/credentials

### Step 2: Create a Project (if you don't have one)
1. Click the project dropdown at the top
2. Click "New Project"
3. Name it anything (e.g., "Rhythm Game")
4. Click "Create"

### Step 3: Enable YouTube Data API v3
1. Go to: https://console.cloud.google.com/apis/library
2. Search for "YouTube Data API v3"
3. Click on it
4. Click "Enable"

### Step 4: Create an API Key
1. Go back to: https://console.cloud.google.com/apis/credentials
2. Click "Create Credentials" → "API key"
3. Copy the generated key
4. (Optional) Click "Restrict Key" to limit it to YouTube Data API v3 for security

### Step 5: Use the Key
1. Open your game's YouTube tab
2. Paste the key in the "YouTube API Key" field
3. It will be saved automatically in your browser

## Quotas
- **Free tier**: 10,000 quota units per day
- **Each search**: ~100 units (~100 searches/day)
- **Each video info request**: ~1 unit (~10,000 requests/day)
- More than enough for personal use!

## Benefits
- ✅ More reliable than proxy servers
- ✅ Faster response times
- ✅ Works with all videos (no geo-restrictions from proxies)
- ✅ Official YouTube API
- ✅ Completely free for personal use

## Fallback
If you don't add an API key, the game will still work using proxy servers (Piped/Invidious/cobalt), but they may fail occasionally.
