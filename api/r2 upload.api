/**
 * api/r2-upload.js — Zoda Platform
 * Primește un fișier de la browser, îl uploadează în Cloudflare R2
 * și returnează URL-ul public.
 *
 * Variabile de mediu necesare în Vercel:
 *   R2_ACCOUNT_ID      — ID-ul contului Cloudflare (din dashboard → dreapta jos)
 *   R2_ACCESS_KEY_ID   — Access Key ID (R2 → Manage R2 API Tokens)
 *   R2_SECRET_ACCESS_KEY — Secret Access Key (același loc)
 *   R2_BUCKET_NAME     — Numele bucket-ului (ex: "zoda-media")
 *   R2_PUBLIC_URL      — URL-ul public al bucket-ului (ex: "https://media.zoda.ro")
 */

import { IncomingForm } from 'formidable';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

export const config = {
  api: { bodyParser: false },
};

// ── Semnare request AWS S3-compatible (R2 folosește același protocol) ────────
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey, date, region, service) {
  const kDate    = hmacSha256('AWS4' + secretKey, date);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function uploadToR2(fileBuffer, key, contentType) {
  const accountId   = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretKey   = process.env.R2_SECRET_ACCESS_KEY;
  const bucket      = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretKey || !bucket) {
    throw new Error('Configurație R2 lipsă (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)');
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const region   = 'auto';
  const service  = 's3';

  const now      = new Date();
  const amzDate  = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // 20250627T123456Z
  const dateStamp = amzDate.slice(0, 8); // 20250627

  const host          = `${accountId}.r2.cloudflarestorage.com`;
  const payloadHash   = sha256Hex(fileBuffer);
  const contentLength = fileBuffer.length;

  const canonicalHeaders =
    `content-length:${contentLength}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey  = getSigningKey(secretKey, dateStamp, region, service);
  const signature   = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint}/${bucket}/${key}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization':        authorization,
      'Content-Type':         contentType,
      'Content-Length':       String(contentLength),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date':           amzDate,
    },
    body: fileBuffer,
    // Node 18+ fetch suportă Buffer direct
    duplex: 'half',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`R2 upload eșuat (${response.status}): ${text}`);
  }

  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
  return `${publicUrl}/${key}`;
}

function getMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif',  '.webp': 'image/webp', '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

function buildKey(folder, originalName) {
  const ext  = path.extname(originalName || '.jpg').toLowerCase() || '.jpg';
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${folder}/${uuid}${ext}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // folder-ul vine în query string: /api/r2-upload?folder=capturi
  // valori acceptate: capturi | avatare | standuri | harti
  const ALLOWED_FOLDERS = ['capturi', 'avatare', 'standuri', 'harti'];
  const folder = ALLOWED_FOLDERS.includes(req.query?.folder)
    ? req.query.folder
    : 'diverse';

  const form = new IncomingForm({
    maxFileSize: 20 * 1024 * 1024, // 20MB per imagine
    keepExtensions: true,
  });

  let files;
  try {
    [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, fi) => {
        if (err) reject(err);
        else resolve([fields, fi]);
      });
    });
  } catch (err) {
    return res.status(400).json({ error: 'Eroare parsare fișier: ' + err.message });
  }

  const uploadedFile = files?.file?.[0] || files?.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'Niciun fișier găsit în request (câmp: "file").' });
  }

  const filePath    = uploadedFile.filepath || uploadedFile.path;
  const fileName    = uploadedFile.originalFilename || uploadedFile.name || 'upload.jpg';
  const contentType = uploadedFile.mimetype || getMimeType(fileName);

  try {
    const buffer  = fs.readFileSync(filePath);
    const key     = buildKey(folder, fileName);
    const fileUrl = await uploadToR2(buffer, key, contentType);

    // Șterge fișierul temporar
    try { fs.unlinkSync(filePath); } catch (_) {}

    return res.status(200).json({ url: fileUrl, key });
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    console.error('R2 upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
