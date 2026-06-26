export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Configurație YouTube lipsă pe server.' });
  }

  try {
    // Schimbă refresh token pe access token — request mic, sub 1KB
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });

    const data = await response.json();

    if (!data.access_token) {
      return res.status(401).json({ error: data.error_description || 'Nu s-a putut obține access token.' });
    }

    return res.status(200).json({ access_token: data.access_token });

  } catch (err) {
    return res.status(500).json({ error: 'Eroare server: ' + err.message });
  }
}
