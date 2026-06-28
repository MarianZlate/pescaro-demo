/**
 * get-youtube-token.js — Cloudflare Worker
 * Schimbă refresh token pe access token YouTube.
 *
 * Variabile de mediu în Cloudflare Dashboard (Workers → Settings → Variables):
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN
 */

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
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_REFRESH_TOKEN) {
      return jsonResponse({ error: 'Configurație YouTube lipsă pe server.' }, 500);
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     env.YOUTUBE_CLIENT_ID,
          client_secret: env.YOUTUBE_CLIENT_SECRET,
          refresh_token: env.YOUTUBE_REFRESH_TOKEN,
          grant_type:    'refresh_token',
        }),
      });

      const data = await response.json();

      if (!data.access_token) {
        return jsonResponse({ error: data.error_description || 'Nu s-a putut obține access token.' }, 401);
      }

      return jsonResponse({ access_token: data.access_token });

    } catch (err) {
      return jsonResponse({ error: 'Eroare server: ' + err.message }, 500);
    }
  },
};
