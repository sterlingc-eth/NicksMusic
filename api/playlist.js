// api/playlist.js — Vercel serverless function
// Fetches your Spotify playlist server-side using the Client Credentials flow.
// Your Client ID + Secret live in Vercel Environment Variables (never sent to the browser).
//
// Required environment variables (set these in the Vercel dashboard):
//   SPOTIFY_CLIENT_ID      — from your Spotify Developer app
//   SPOTIFY_CLIENT_SECRET  — from your Spotify Developer app
//   SPOTIFY_PLAYLIST_ID    — the id of your playlist (the part after /playlist/ in its URL)

let cachedToken = null;
let tokenExpiry = 0;

async function getToken(id, secret) {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  if (!res.ok) throw new Error('token request failed: ' + res.status);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

async function fetchAllTracks(playlistId, token) {
  const out = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists(name),album(name,release_date,images),duration_ms)),next`;
  while (url) {
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) throw new Error('playlist request failed: ' + res.status);
    const data = await res.json();
    for (const item of (data.items || [])) {
      const t = item.track;
      if (!t) continue;
      out.push({
        id: t.id,
        title: t.name,
        artist: (t.artists || []).map(a => a.name).join(', '),
        album: t.album?.name || '',
        year: (t.album?.release_date || '').slice(0, 4),
        duration: msToTime(t.duration_ms),
        artwork_url: t.album?.images?.[0]?.url || ''
      });
    }
    url = data.next; // auto-paginate past 100 tracks
  }
  return out;
}

function msToTime(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export default async function handler(req, res) {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_PLAYLIST_ID } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_PLAYLIST_ID) {
    res.status(500).json({ error: 'Missing Spotify environment variables' });
    return;
  }
  try {
    const token = await getToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
    const tracks = await fetchAllTracks(SPOTIFY_PLAYLIST_ID, token);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ count: tracks.length, tracks });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
