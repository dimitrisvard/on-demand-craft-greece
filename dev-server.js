import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import sendRfqEmailsHandler from './api/send-rfq-emails.js';
import sitemapHandler from './api/sitemap.xml.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createServer() {
  const app = express();

  // JSON body parser for API routes
  app.use(express.json({ limit: '5mb' }));

  // Create Vite server in middleware mode
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  // Sitemap route - must be before other routes
  app.get('/sitemap.xml', async (req, res) => {
    console.log('[API] GET /sitemap.xml hit');
    await sitemapHandler(req, res);
  });

  // API routes - register BEFORE Vite middleware to prevent SPA routing
  // Handle both /api/* and /en/api/* (and other language prefixes)
  app.post('/api/send-rfq-emails', (req, res) => {
    console.log('[API] POST /api/send-rfq-emails hit');
    sendRfqEmailsHandler(req, res);
  });

  app.post('/:lang/api/send-rfq-emails', (req, res) => {
    console.log('[API] POST /:lang/api/send-rfq-emails hit');
    sendRfqEmailsHandler(req, res);
  });

  // Simple health check
  app.get('/api/health', (_req, res) => {
    console.log('[API] GET /api/health hit');
    res.status(200).json({ ok: true });
  });

  app.get('/:lang/api/health', (_req, res) => {
    console.log('[API] GET /:lang/api/health hit');
    res.status(200).json({ ok: true });
  });

  // Explicit JSON 404 for other /api routes
  app.all('/api/*', (req, res) => {
    console.log('[API] 404 for:', req.method, req.path);
    res.status(404).json({ error: 'Not Found' });
  });

  app.all('/:lang/api/*', (req, res) => {
    console.log('[API] 404 for:', req.method, req.path);
    res.status(404).json({ error: 'Not Found' });
  });

  // Debug middleware to log all requests
  app.use((req, res, next) => {
    console.log(`[DEBUG] ${req.method} ${req.path}`);
    next();
  });

  // Use vite's connect instance as middleware
  app.use(vite.middlewares);

  // Handle all other routes by serving index.html
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html'));
  });

  app.listen(8080, () => {
    console.log('🚀 Development server running at http://localhost:8080');
    console.log('✅ Client-side routing is now properly handled!');
  });
}

createServer();
