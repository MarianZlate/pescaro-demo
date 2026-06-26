import { google } from 'googleapis';
import { IncomingForm } from 'formidable';
import fs from 'fs';

// Dezactivează body parser built-in al Vercel — formidable îl gestionează el
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // CORS — permite doar de pe domeniul platformei
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verifică că env variables există
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Configurație YouTube lipsă pe server.' });
  }

  // Parsează fișierul din request (max 2GB)
  const form = new IncomingForm({
    maxFileSize: 2 * 1024 * 1024 * 1024,
    keepExtensions: true,
  });

  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, f, fi) => {
        if (err) reject(err);
        else resolve([f, fi]);
      });
    });
  } catch (err) {
    return res.status(400).json({ error: 'Eroare la parsarea fișierului: ' + err.message });
  }

  const videoFile = files?.video?.[0] || files?.video;
  if (!videoFile) {
    return res.status(400).json({ error: 'Niciun fișier video găsit în request.' });
  }

  const filePath = videoFile.filepath || videoFile.path;

  try {
    // Autentificare OAuth2 cu credențialele platformei
    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET
    );
    auth.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    });

    const youtube = google.youtube({ version: 'v3', auth });

    // Upload pe YouTube ca "unlisted" — vizibil doar cu link
    const timestamp = new Date().toISOString().split('T')[0];
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: `Zoda Dovada Captura ${timestamp}`,
          description: 'Videoclip dovadă captură — Zoda Platform. Accesat doar de administratori.',
          tags: ['zoda', 'captura', 'dovada'],
          categoryId: '17', // Sports
        },
        status: {
          privacyStatus: 'unlisted', // Nevizibil public, doar cu link direct
        },
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    });

    const videoId = response.data.id;

    // Șterge fișierul temporar
    try { fs.unlinkSync(filePath); } catch(e) {}

    return res.status(200).json({
      url: `https://youtu.be/${videoId}`,
      videoId,
    });

  } catch (err) {
    // Șterge fișierul temporar și în caz de eroare
    try { fs.unlinkSync(filePath); } catch(e) {}

    console.error('YouTube upload error:', err);
    return res.status(500).json({
      error: 'Eroare upload YouTube: ' + (err?.message || 'Eroare necunoscută'),
    });
  }
}
