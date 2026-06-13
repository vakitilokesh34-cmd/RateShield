import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { rateLimiter, resetStore, getRedisConfig, connectRedis, disconnectRedis, getRedisMetrics, getDdosStatus, TIERS, generateApiKey, listApiKeys, revokeApiKey, updateApiKeyTier } from './rateLimiter.js';
import { registerUser, loginUser } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:5173'
  ],
  credentials: true
}));


// Serve frontend static files (only if the dist directory exists)
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
const hasFrontend = fs.existsSync(frontendDist);
if (hasFrontend) {
  app.use(express.static(frontendDist));
  console.log('📦 Serving frontend from:', frontendDist);
}

// Status route (not rate limited, used for connection mode detection)
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: Date.now(),
    rateLimiterMode: req.rateLimit ? req.rateLimit.isRedis : false // will be overwritten, but we will check active status
  });
});

// Reset route (not rate limited, used to flush rate-limiting states)
app.post('/api/reset', async (req, res) => {
  try {
    const result = await resetStore();
    res.json({
      message: 'Rate limiting metrics reset successfully.',
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset rate limiter storage.', details: error.message });
  }
});

// Redis Management endpoints (not rate limited)
app.get('/api/redis/config', (req, res) => {
  res.json(getRedisConfig());
});

app.post('/api/redis/connect', async (req, res) => {
  const result = await connectRedis(req.body);
  res.json(result);
});

app.post('/api/redis/disconnect', (req, res) => {
  res.json(disconnectRedis());
});

app.get('/api/redis/metrics', async (req, res) => {
  const metrics = await getRedisMetrics();
  res.json(metrics);
});

// DDoS Detection Status (not rate limited)
app.get('/api/ddos/status', (req, res) => {
  res.json(getDdosStatus());
});

// Auth Routes (not rate limited)
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const result = registerUser(username, password);
  if (result.error) return res.status(409).json(result);
  res.status(201).json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const result = loginUser(username, password);
  if (result.error) return res.status(401).json(result);
  res.json(result);
});

// API Key Management Routes (not rate limited)
app.post('/api/keys', (req, res) => {
  const { name, tier } = req.body;
  if (tier && !['free', 'pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier. Must be free, pro, or enterprise.' });
  }
  const entry = generateApiKey(name || 'My Key', tier || 'free');
  res.status(201).json(entry);
});

app.get('/api/keys', (req, res) => {
  res.json(listApiKeys());
});

app.delete('/api/keys/:key', (req, res) => {
  const found = revokeApiKey(req.params.key);
  res.json({ success: found, message: found ? 'Key revoked successfully.' : 'Key not found.' });
});

app.patch('/api/keys/:key/tier', (req, res) => {
  const { tier } = req.body;
  if (!['free', 'pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier. Must be free, pro, or enterprise.' });
  }
  const found = updateApiKeyTier(req.params.key, tier);
  res.json({ success: found, message: found ? 'Tier updated successfully.' : 'Key not found.' });
});

app.get('/api/keys/tiers', (req, res) => {
  res.json(TIERS);
});

// Apply rate limiter middleware to all other endpoints
app.use('/api', rateLimiter);

// Endpoint 1: Home endpoint
app.get('/api/', (req, res) => {
  res.json({
    message: 'Welcome to the secure API. This endpoint is rate limited.',
    rateLimit: req.rateLimit
  });
});

// Endpoint 2: Data endpoint
app.get('/api/data', (req, res) => {
  res.json({
    data: 'Here is some protected server data. Accessing this consumes 1 quota.',
    rateLimit: req.rateLimit
  });
});

// SPA fallback — serve index.html for any non-API route
if (hasFrontend) {
  app.use((req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
