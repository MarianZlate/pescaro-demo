/**
 * r2-upload.js — Cloudflare Worker
 * Primește un fișier de la browser și îl uploadează în R2 via binding nativ.
 *
 * Variabile de mediu în Cloudflare Dashboard (Workers → Settings → Variables):
 *   R2_PUBLIC_URL  — URL-ul public al bucket-ului (ex: https://pub-xxx.r2.dev)
 *
 * Binding R2 în wrangler.toml:
 *   [[r2_buckets]]
 *   binding = "ZODA_MEDIA"
 *   bucket_name = "zoda-media"
 */

const ALLOWED_FOLDERS = ['capturi', 'avatare', 'standuri', 'harti'];

function getMimeType(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif',  webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

function buildKey(folder, originalName) {
  const ext  = (originalName || 'upload.jpg').split('.').pop().toLowerCase() || 'jpg';
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${folder}/${uuid}.${ext}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Verificăm că binding-ul R2 există
    if (!env.ZODA_MEDIA) {
      return jsonResponse({ error: 'R2 binding lipsă. Verifică wrangler.toml.' }, 500);
    }

    // Folder din query string: /r2-upload?folder=capturi
    const url    = new URL(request.url);
    const folder = ALLOWED_FOLDERS.includes(url.searchParams.get('folder'))
      ? url.searchParams.get('folder')
      : 'diverse';

    // Parsăm multipart/form-data nativ — fără formidable, fără disk
    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return jsonResponse({ error: 'Eroare parsare formData: ' + e.message }, 400);
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return jsonResponse({ error: 'Niciun fișier găsit în request (câmp: "file").' }, 400);
    }

    // Limită 100MB (Workers suportă până la 100MB body)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return jsonResponse({ error: `Fișierul depășește limita de 100MB.` }, 413);
    }

    try {
      const buffer      = await file.arrayBuffer();
      const contentType = file.type || getMimeType(file.name);
      const key         = buildKey(folder, file.name);

      // Upload direct în R2 via binding nativ — fără semnare AWS4!
      await env.ZODA_MEDIA.put(key, buffer, {
        httpMetadata: { contentType },
      });

      const publicUrl = (env.R2_PUBLIC_URL || '').replace(/\/$/, '');
      const fileUrl   = `${publicUrl}/${key}`;

      return jsonResponse({ url: fileUrl, key });

    } catch (err) {
      console.error('R2 upload error:', err);
      return jsonResponse({ error: 'Eroare upload R2: ' + err.message }, 500);
    }
  },
};
