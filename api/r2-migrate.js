export default async function handler(req, res) {
  return res.status(410).json({ error: 'Migration completed. Endpoint disabled.' });
}
