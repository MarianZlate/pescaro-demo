/**
 * api/r2-migrate.js — Zoda Platform
 * Script de migrare one-time: descarcă toate pozele din Cloudinary
 * și le re-uploadează în Cloudflare R2, actualizând URL-urile în Supabase.
 *
 * ⚠️  RULAT O SINGURĂ DATĂ — după migrare, dezactivează sau șterge acest endpoint!
 *
 * Apelat via POST /api/r2-migrate cu header:
 *   Authorization: Bearer <MIGRATION_SECRET>
 *
 * Variabile de mediu suplimentare necesare:
 *   MIGRATION_SECRET       — parolă one-time pentru a proteja endpoint-ul
 *   CLOUDINARY_CLOUD_NAME  — cloud name Cloudinary (ex: dlafkx65j)
 *   CLOUDINARY_API_KEY     — API key Cloudinary
 *   CLOUDINARY_API_SECRET  — API secret Cloudinary
 *   SUPABASE_URL           — URL proiect Supabase
 *   SUPABASE_SERVICE_KEY   — Service Role Key Supabase (NU anon key!)
 *   + toate variabilele R2 din r2-upload.js
 */

import crypto from 'crypto';
import https from 'https';

// ── Helpers R2 (același cod ca în r2-upload.js) ──────────────────────────────
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function getSigningKey(secretKey, date, region, service) {
  return hmacSha256(hmacSha256(hmacSha256(hmacSha256('AWS4' + secretKey, date), region), service), 'aws4_request');
}
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function uploadBufferToR2(buffer, key, contentType) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256Hex(buffer);

  const canonicalHeaders =
    `content-length:${buffer.length}\ncontent-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${bucket}/${key}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', getSigningKey(secretKey, dateStamp, 'auto', 's3')).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resp = await fetch(`https://${host}/${bucket}/${key}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: buffer,
    duplex: 'half',
  });

  if (!resp.ok) {
    throw new Error(`R2 PUT eșuat (${resp.status}): ${await resp.text()}`);
  }

  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
  return `${publicUrl}/${key}`;
}

// ── Descarcă un URL ca Buffer ─────────────────────────────────────────────────
async function downloadUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download eșuat (${resp.status}): ${url}`);
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: resp.headers.get('content-type') || 'image/jpeg' };
}

// ── Detectează folderul R2 după URL-ul Cloudinary ────────────────────────────
function detectFolder(url) {
  if (!url) return 'migrate/diverse';
  if (url.includes('avatar_zoda') || url.includes('/avatare/')) return 'avatare';
  if (url.includes('harta_balta') || url.includes('/harti/'))   return 'harti';
  if (url.includes('record_stand'))                             return 'standuri';
  if (url.includes('galerie_stand'))                            return 'standuri';
  if (url.includes('captura_foto_zoda') || url.includes('/capturi/')) return 'capturi';
  return 'migrate/diverse';
}

function buildKey(folder, originalUrl) {
  const ext  = (originalUrl.split('?')[0].split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${folder}/${uuid}.${ext}`;
}

// ── Supabase helpers (fetch direct, fără SDK) ─────────────────────────────────
function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    Prefer: 'return=minimal',
  };
}

async function supabaseGet(path) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: supabaseHeaders(),
  });
  if (!resp.ok) throw new Error(`Supabase GET ${path} eșuat: ${await resp.text()}`);
  return resp.json();
}

async function supabasePatch(table, id, data) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`Supabase PATCH ${table}#${id} eșuat: ${await resp.text()}`);
}

// ── Migrare un URL individual ─────────────────────────────────────────────────
async function migrateUrl(url) {
  if (!url || !url.includes('cloudinary.com')) return { skipped: true, url };
  const folder = detectFolder(url);
  const { buffer, contentType } = await downloadUrl(url);
  const key = buildKey(folder, url);
  const newUrl = await uploadBufferToR2(buffer, key, contentType);
  return { ok: true, oldUrl: url, newUrl };
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Securitate: endpoint protejat cu secret
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!secret || secret !== process.env.MIGRATION_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Setează header Authorization: Bearer <MIGRATION_SECRET>' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const log     = [];
  const errors  = [];
  let   total   = 0;
  let   migrated = 0;
  let   skipped  = 0;

  function logInfo(msg)  { log.push(`ℹ️  ${msg}`);  console.log(msg); }
  function logOk(msg)    { log.push(`✅ ${msg}`);   console.log(msg); migrated++; }
  function logErr(msg)   { log.push(`❌ ${msg}`);   errors.push(msg); console.error(msg); }
  function logSkip(msg)  { log.push(`⏭️  ${msg}`);  skipped++; }

  try {
    // ── 1. TABELUL `poze` (hărți bălți + poze standuri) ─────────────────────
    logInfo('Citesc tabelul poze...');
    const poze = await supabaseGet('poze?select=id,url&limit=1000');
    logInfo(`Găsite ${poze.length} înregistrări în poze`);
    total += poze.length;

    for (const poza of poze) {
      if (!poza.url || !poza.url.includes('cloudinary.com')) { logSkip(`poze#${poza.id} — nu e Cloudinary`); continue; }
      try {
        const result = await migrateUrl(poza.url);
        await supabasePatch('poze', poza.id, { url: result.newUrl });
        logOk(`poze#${poza.id}: ${poza.url.split('/').pop()} → ${result.newUrl}`);
      } catch (e) {
        logErr(`poze#${poza.id}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 50)); // evită rate limiting
    }

    // ── 2. TABELUL `standuri` — câmpul rec_foto ──────────────────────────────
    logInfo('Citesc rec_foto din standuri...');
    const standuri = await supabaseGet('standuri?select=id,rec_foto&rec_foto=not.is.null&limit=1000');
    logInfo(`Găsite ${standuri.length} standuri cu rec_foto`);
    total += standuri.length;

    for (const stand of standuri) {
      if (!stand.rec_foto?.includes('cloudinary.com')) { logSkip(`standuri#${stand.id} — nu e Cloudinary`); continue; }
      try {
        const result = await migrateUrl(stand.rec_foto);
        await supabasePatch('standuri', stand.id, { rec_foto: result.newUrl });
        logOk(`standuri#${stand.id} rec_foto → ${result.newUrl}`);
      } catch (e) {
        logErr(`standuri#${stand.id} rec_foto: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    // ── 3. TABELUL `capturi` — câmpul foto_url ───────────────────────────────
    logInfo('Citesc foto_url din capturi...');
    const capturi = await supabaseGet('capturi?select=id,foto_url&foto_url=not.is.null&limit=2000');
    logInfo(`Găsite ${capturi.length} capturi cu foto`);
    total += capturi.length;

    for (const cap of capturi) {
      if (!cap.foto_url?.includes('cloudinary.com')) { logSkip(`capturi#${cap.id} — nu e Cloudinary`); continue; }
      try {
        const result = await migrateUrl(cap.foto_url);
        await supabasePatch('capturi', cap.id, { foto_url: result.newUrl });
        logOk(`capturi#${cap.id} foto_url → ${result.newUrl}`);
      } catch (e) {
        logErr(`capturi#${cap.id} foto_url: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    // ── 4. TABELUL `user_profiles` — câmpul avatar_url ───────────────────────
    logInfo('Citesc avatar_url din user_profiles...');
    const profiles = await supabaseGet('user_profiles?select=id,avatar_url&avatar_url=not.is.null&limit=5000');
    logInfo(`Găsite ${profiles.length} profiluri cu avatar`);
    total += profiles.length;

    for (const profile of profiles) {
      if (!profile.avatar_url?.includes('cloudinary.com')) { logSkip(`user_profiles#${profile.id} — nu e Cloudinary`); continue; }
      try {
        const result = await migrateUrl(profile.avatar_url);
        // user_profiles folosește uuid ca PK, nu bigint
        const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${profile.id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ avatar_url: result.newUrl }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        logOk(`user_profiles#${profile.id} avatar → ${result.newUrl}`);
      } catch (e) {
        logErr(`user_profiles#${profile.id} avatar: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

  } catch (fatalErr) {
    logErr('EROARE FATALĂ: ' + fatalErr.message);
  }

  const summary = {
    total,
    migrated,
    skipped,
    errors: errors.length,
    success: errors.length === 0,
  };

  logInfo(`\n── SUMAR ──\nTotal: ${total} | Migrate: ${migrated} | Skipped: ${skipped} | Erori: ${errors.length}`);

  return res.status(200).json({ summary, log, errors });
}
