import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { migrate, pool } from './db.js';
import { csrf, requireUser, purgeExpiredSessions } from './auth.js';
import { HttpError } from './util.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import locationRoutes from './routes/locations.js';
import itemRoutes from './routes/items.js';
import tagRoutes from './routes/tags.js';
import stocktakeRoutes from './routes/stocktakes.js';
import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } from './seed-demo.js';

const PUBLIC = path.join(import.meta.dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.get('/healthz', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(rateLimit({ windowMs: 60e3, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak permintaan.' } }));
  api.use(csrf);
  api.get('/demo', (req, res) => res.json({ email: DEMO_EMAIL, password: DEMO_PASSWORD }));
  api.use('/auth', authRoutes);
  api.use(requireUser);
  api.use('/users', userRoutes);
  api.use('/locations', locationRoutes);
  api.use('/items', itemRoutes);
  api.use('/tags', tagRoutes);
  api.use('/stocktakes', stocktakeRoutes);
  api.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
  app.use('/api', api);

  app.use(express.static(PUBLIC, {
    extensions: ['html'],
    setHeaders: (res, p) => {
      if (p.endsWith('.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      else if (p.includes(`${path.sep}vendor${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      else res.setHeader('Cache-Control', 'public, max-age=300');
    },
  }));
  // SPA: every /app/* path serves the app shell.
  app.get(/^\/app(\/.*)?$/, (req, res) => res.sendFile(path.join(PUBLIC, 'app.html')));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File/permintaan terlalu besar.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid.' });
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan di server. Coba lagi.' });
  });
  return app;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  await migrate();
  if (process.env.DEMO !== '0') {
    await seedDemo();
    // Reset the shared demo every 6 hours so it never stays messy.
    setInterval(() => seedDemo().catch(console.error), 6 * 3600e3).unref();
  }
  setInterval(() => purgeExpiredSessions().catch(console.error), 3600e3).unref();
  const port = Number(process.env.PORT) || 3000;
  const server = createApp().listen(port, () => console.log(`opnamo listening on :${port}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
