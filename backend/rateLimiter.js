import Redis from 'ioredis';
import { verifyToken } from './auth.js';

// --- Redis Client with Runtime Reconnect Support ---
let redis = null;
let isRedisConnected = false;
let currentRedisConfig = { host: '127.0.0.1', port: 6379, password: null };
let redisReconnectTimer = null;

export const getRedisConfig = () => ({
  ...currentRedisConfig,
  connected: isRedisConnected
});

export const connectRedis = async (config = {}) => {
  // Disconnect existing
  if (redis) {
    try { redis.disconnect(); } catch {}
    redis = null;
    isRedisConnected = false;
  }

  const opts = {
    host: config.host || currentRedisConfig.host,
    port: config.port || currentRedisConfig.port,
    password: config.password !== undefined ? config.password : currentRedisConfig.password,
    connectTimeout: 3000,
    lazyConnect: true,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
    maxRetriesPerRequest: 3
  };

  currentRedisConfig = { host: opts.host, port: opts.port, password: opts.password || null };

  redis = new Redis(opts);

  redis.on('connect', () => {
    isRedisConnected = true;
    console.log('Connected to Redis.');
  });

  redis.on('error', (err) => {
    if (isRedisConnected) {
      isRedisConnected = false;
      console.warn('Redis connection lost. Falling back to In-Memory.');
    }
  });

  redis.on('close', () => {
    isRedisConnected = false;
  });

  // Define Lua scripts on the new instance
  defineLuaScripts(redis);

  try {
    await redis.connect();
    isRedisConnected = true;
    // Clear any reconnect timer
    if (redisReconnectTimer) { clearTimeout(redisReconnectTimer); redisReconnectTimer = null; }
    return { success: true, config: currentRedisConfig };
  } catch (err) {
    isRedisConnected = false;
    console.warn('Redis connection failed:', err.message);
    return { success: false, error: err.message, config: currentRedisConfig };
  }
};

export const disconnectRedis = () => {
  if (redis) {
    try { redis.disconnect(); } catch {}
    redis = null;
  }
  isRedisConnected = false;
  if (redisReconnectTimer) { clearTimeout(redisReconnectTimer); redisReconnectTimer = null; }
  return { success: true };
};

const defineLuaScripts = (client) => {
  client.defineCommand('runTokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
  client.defineCommand('runLeakyBucket', { numberOfKeys: 1, lua: LEAKY_BUCKET_LUA });
  client.defineCommand('runFixedWindow', { numberOfKeys: 1, lua: FIXED_WINDOW_LUA });
  client.defineCommand('runSlidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA });
};

// --- Lua Scripts ---
const TOKEN_BUCKET_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2]) -- tokens per millisecond
  local now = tonumber(ARGV[3])
  local requested = tonumber(ARGV[4] or 1)

  local bucket = redis.call('HMGET', key, 'tokens', 'last_updated')
  local tokens = tonumber(bucket[1])
  local last_updated = tonumber(bucket[2])

  if not tokens then
    tokens = capacity
    last_updated = now
  else
    local elapsed = now - last_updated
    if elapsed > 0 then
      local refilled = elapsed * refill_rate
      tokens = math.min(capacity, tokens + refilled)
      last_updated = now
    end
  end

  if tokens >= requested then
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
    redis.call('EXPIRE', key, math.ceil(capacity / (refill_rate * 1000)) + 60)
    return {1, tokens}
  else
    redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
    return {0, tokens}
  end
`;

// 2. Leaky Bucket Lua Script (Traffic Limiting)
const LEAKY_BUCKET_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local leak_rate = tonumber(ARGV[2]) -- water leaked per millisecond
  local now = tonumber(ARGV[3])
  local requested = tonumber(ARGV[4] or 1)

  local bucket = redis.call('HMGET', key, 'water', 'last_updated')
  local water = tonumber(bucket[1])
  local last_updated = tonumber(bucket[2])

  if not water then
    water = 0.0
    last_updated = now
  else
    local elapsed = now - last_updated
    if elapsed > 0 then
      local leaked = elapsed * leak_rate
      water = math.max(0.0, water - leaked)
      last_updated = now
    end
  end

  if water + requested <= capacity then
    water = water + requested
    redis.call('HMSET', key, 'water', water, 'last_updated', last_updated)
    redis.call('EXPIRE', key, math.ceil(capacity / (leak_rate * 1000)) + 60)
    return {1, capacity - water} -- allowed = 1, remaining capacity
  else
    redis.call('HMSET', key, 'water', water, 'last_updated', last_updated)
    return {0, capacity - water} -- allowed = 0, remaining capacity
  end
`;

// 3. Fixed Window Lua Script
const FIXED_WINDOW_LUA = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local window_size = tonumber(ARGV[2]) -- in seconds

  local count = redis.call('INCR', key)
  if count == 1 then
    redis.call('EXPIRE', key, window_size)
  end

  if count <= limit then
    return {1, limit - count}
  else
    return {0, 0}
  end
`;

// 4. Sliding Window Log Lua Script
const SLIDING_WINDOW_LUA = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local window_size = tonumber(ARGV[2]) -- in milliseconds
  local now = tonumber(ARGV[3])
  local member = ARGV[4]

  local window_start = now - window_size
  redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
  local count = redis.call('ZCARD', key)

  if count < limit then
    redis.call('ZADD', key, now, member)
    redis.call('EXPIRE', key, math.ceil(window_size / 1000) + 10)
    return {1, limit - count - 1}
  else
    return {0, 0}
  end
`;

// --- In-Memory Cache and Fallback Stores ---
const memoryStores = {
  tokenBucket: new Map(),
  leakyBucket: new Map(),
  fixedWindow: new Map(),
  slidingWindow: new Map()
};

// --- Simulated Redis Metrics ---
const simMetrics = {
  startTime: Date.now(),
  commandsProcessed: 0,
  totalLatency: 0,
  hits: 0,
  misses: 0,
  opsTimestamps: [],
  algoCounts: {},
};

// --- DDoS Detection ---
const DDOS_WINDOW_MS = 10000;
const ddosState = {
  requestTimestamps: [],
  severity: 'normal',
  currentRps: 0,
  expectedMaxRps: 0,
  ratio: 0
};

const calculateDdosStatus = (currentLimit, windowSec) => {
  const now = Date.now();
  const cutoff = now - DDOS_WINDOW_MS;

  ddosState.requestTimestamps = ddosState.requestTimestamps.filter(t => t > cutoff);

  const currentRps = ddosState.requestTimestamps.length / (DDOS_WINDOW_MS / 1000);
  const expectedMaxRps = Math.max(0.1, currentLimit / Math.max(windowSec, 1));
  const ratio = currentRps / expectedMaxRps;

  let severity = 'normal';
  if (ratio >= 0.9) severity = 'critical';
  else if (ratio >= 0.6) severity = 'high';
  else if (ratio >= 0.3) severity = 'elevated';

  ddosState.severity = severity;
  ddosState.currentRps = parseFloat(currentRps.toFixed(2));
  ddosState.expectedMaxRps = parseFloat(expectedMaxRps.toFixed(2));
  ddosState.ratio = parseFloat(ratio.toFixed(2));

  return { severity, currentRps: ddosState.currentRps, expectedMaxRps: ddosState.expectedMaxRps, ratio: ddosState.ratio };
};

export const getDdosStatus = () => ({ ...ddosState });

// --- API Key Management with Tier-based Rate Limits ---
export const TIERS = {
  free: { limit: 5, window: 60, capacity: 5, refillRate: 5 / 60000, leakRate: 5 / 60000, name: 'Free', color: '#94a3b8' },
  pro: { limit: 50, window: 60, capacity: 50, refillRate: 50 / 60000, leakRate: 50 / 60000, name: 'Pro', color: '#22c55e' },
  enterprise: { limit: 500, window: 60, capacity: 500, refillRate: 500 / 60000, leakRate: 500 / 60000, name: 'Enterprise', color: '#c19451' }
};

const apiKeys = new Map();

export const generateApiKey = (name = 'My Key', tier = 'free') => {
  const key = 'rsk_' + Array.from({ length: 32 }, () => Math.random().toString(16)[2]).join('');
  const entry = { key, name, tier, enabled: true, created: Date.now(), lastUsed: null };
  apiKeys.set(key, entry);
  return entry;
};

export const listApiKeys = () => [...apiKeys.values()];

export const revokeApiKey = (keyId) => {
  const entry = apiKeys.get(keyId);
  if (entry) entry.enabled = false;
  return !!entry;
};

export const updateApiKeyTier = (keyId, tier) => {
  const entry = apiKeys.get(keyId);
  if (!entry) return false;
  entry.tier = tier;
  return true;
};

// Seed a demo key so the UI has something to show
generateApiKey('Demo Key', 'free');

// --- In-Memory Algorithms Implementation ---

const runTokenBucketMemory = (key, capacity, refillRate, now, requested = 1) => {
  let bucket = memoryStores.tokenBucket.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastUpdated: now };
  } else {
    const elapsed = now - bucket.lastUpdated;
    if (elapsed > 0) {
      const refilled = elapsed * refillRate;
      bucket.tokens = Math.min(capacity, bucket.tokens + refilled);
      bucket.lastUpdated = now;
    }
  }

  if (bucket.tokens >= requested) {
    bucket.tokens -= requested;
    memoryStores.tokenBucket.set(key, bucket);
    return [1, bucket.tokens];
  } else {
    memoryStores.tokenBucket.set(key, bucket);
    return [0, bucket.tokens];
  }
};

const runLeakyBucketMemory = (key, capacity, leakRate, now, requested = 1) => {
  let bucket = memoryStores.leakyBucket.get(key);
  if (!bucket) {
    bucket = { water: 0.0, lastUpdated: now };
  } else {
    const elapsed = now - bucket.lastUpdated;
    if (elapsed > 0) {
      const leaked = elapsed * leakRate;
      bucket.water = Math.max(0.0, bucket.water - leaked);
      bucket.lastUpdated = now;
    }
  }

  if (bucket.water + requested <= capacity) {
    bucket.water += requested;
    memoryStores.leakyBucket.set(key, bucket);
    return [1, capacity - bucket.water];
  } else {
    memoryStores.leakyBucket.set(key, bucket);
    return [0, capacity - bucket.water];
  }
};

const runFixedWindowMemory = (key, limit, windowSizeSec) => {
  const now = Date.now();
  let cell = memoryStores.fixedWindow.get(key);
  
  if (!cell || now > cell.expireAt) {
    cell = { count: 1, expireAt: now + windowSizeSec * 1000 };
    memoryStores.fixedWindow.set(key, cell);
    return [1, limit - 1];
  }

  cell.count += 1;
  memoryStores.fixedWindow.set(key, cell);

  if (cell.count <= limit) {
    return [1, limit - cell.count];
  } else {
    return [0, 0];
  }
};

const runSlidingWindowMemory = (key, limit, windowSizeMs, now, member) => {
  let log = memoryStores.slidingWindow.get(key) || [];
  const windowStart = now - windowSizeMs;
  
  // Filter out old timestamps
  log = log.filter(item => item.timestamp > windowStart);
  
  if (log.length < limit) {
    log.push({ timestamp: now, id: member });
    memoryStores.slidingWindow.set(key, log);
    return [1, limit - log.length];
  } else {
    memoryStores.slidingWindow.set(key, log);
    return [0, 0];
  }
};

// --- Helper: Retrieve store diagnostics for visualization ---
const getStoreState = async (ip, algo, config) => {
  const now = Date.now();
  const key = `rate_limit:${algo}:${ip}`;
  
  if (isRedisConnected) {
    try {
      if (algo === 'token_bucket') {
        const bucket = await redis.hmget(key, 'tokens', 'last_updated');
        const tokens = parseFloat(bucket[0]);
        const lastUpdated = parseInt(bucket[1]);
        if (isNaN(tokens)) return { tokens: config.capacity, lastUpdated: now };
        
        // Calculate dynamic real-time refill for visualization
        const elapsed = now - lastUpdated;
        const currentTokens = Math.min(config.capacity, tokens + (elapsed > 0 ? elapsed * config.refillRate : 0));
        return { tokens: currentTokens, lastUpdated };
      }
      
      if (algo === 'leaky_bucket') {
        const bucket = await redis.hmget(key, 'water', 'last_updated');
        const water = parseFloat(bucket[0]);
        const lastUpdated = parseInt(bucket[1]);
        if (isNaN(water)) return { water: 0, lastUpdated: now };
        
        // Calculate dynamic real-time leak for visualization
        const elapsed = now - lastUpdated;
        const currentWater = Math.max(0, water - (elapsed > 0 ? elapsed * config.leakRate : 0));
        return { water: currentWater, lastUpdated };
      }
      
      if (algo === 'fixed_window') {
        const windowId = Math.floor(now / (config.window * 1000));
        const windowKey = `${key}:${windowId}`;
        const count = await redis.get(windowKey);
        return { count: parseInt(count) || 0, windowId };
      }
      
      if (algo === 'sliding_window') {
        const timestamps = await redis.zrangebyscore(key, now - config.window * 1000, '+inf', 'WITHSCORES');
        const list = [];
        for (let i = 0; i < timestamps.length; i += 2) {
          list.push({ id: timestamps[i], timestamp: parseInt(timestamps[i+1]) });
        }
        return { log: list };
      }
    } catch (e) {
      console.error('Error fetching state from Redis:', e);
    }
  }

  // Local Memory Fallback Diagnostics
  if (algo === 'token_bucket') {
    const bucket = memoryStores.tokenBucket.get(key) || { tokens: config.capacity, lastUpdated: now };
    const elapsed = now - bucket.lastUpdated;
    const currentTokens = Math.min(config.capacity, bucket.tokens + (elapsed > 0 ? elapsed * config.refillRate : 0));
    return { tokens: currentTokens, lastUpdated: bucket.lastUpdated };
  }
  
  if (algo === 'leaky_bucket') {
    const bucket = memoryStores.leakyBucket.get(key) || { water: 0, lastUpdated: now };
    const elapsed = now - bucket.lastUpdated;
    const currentWater = Math.max(0, bucket.water - (elapsed > 0 ? elapsed * config.leakRate : 0));
    return { water: currentWater, lastUpdated: bucket.lastUpdated };
  }
  
  if (algo === 'fixed_window') {
    const windowId = Math.floor(now / (config.window * 1000));
    const cell = memoryStores.fixedWindow.get(`${key}:${windowId}`) || { count: 0 };
    return { count: cell.count, windowId };
  }
  
  if (algo === 'sliding_window') {
    const log = memoryStores.slidingWindow.get(key) || [];
    const active = log.filter(item => item.timestamp > now - config.window * 1000);
    return { log: active };
  }

  return {};
};

// --- Main Rate Limiter Middleware ---
export const rateLimiter = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const simulateRedis = req.headers['x-simulate-redis'] === 'true';
    
    // 0. Determine auth mode and identity
    const authMode = req.headers['x-auth-mode'] || 'sandbox';
    let identifier = ip;
    let tierConfig = null;
    let authUser = null;
    const apiKey = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];

    if (authMode === 'user') {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization: Bearer <token> header.' });
      }
      const decoded = verifyToken(authHeader.slice(7));
      if (!decoded) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired JWT token.' });
      }
      identifier = `user:${decoded.userId}`;
      authUser = decoded;
    } else if (authMode === 'apikey') {
      if (!apiKey || !apiKeys.has(apiKey) || !apiKeys.get(apiKey).enabled) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid API key.' });
      }
      const entry = apiKeys.get(apiKey);
      entry.lastUsed = Date.now();
      tierConfig = TIERS[entry.tier];
      identifier = `apikey:${apiKey}`;
    } else if (authMode === 'ip') {
      identifier = `ip:${ip}`;
    } else {
      // sandbox mode — use IP with header-based config (existing behavior)
      identifier = `ip:${ip}`;
    }
    
    // 1. Parse client configurations from headers (with tier override)
    const algo = req.headers['x-limiter-algo'] || 'token_bucket';
    const limit = tierConfig ? tierConfig.limit : (parseInt(req.headers['x-limiter-limit']) || 10);
    const windowSec = tierConfig ? tierConfig.window : (parseInt(req.headers['x-limiter-window']) || 60);
    const capacity = tierConfig ? tierConfig.capacity : (parseInt(req.headers['x-limiter-capacity']) || limit);
    
    const refillRate = tierConfig ? tierConfig.refillRate : (parseFloat(req.headers['x-limiter-refill-rate']) || (capacity / (windowSec * 1000)));
    const leakRate = tierConfig ? tierConfig.leakRate : (parseFloat(req.headers['x-limiter-leak-rate']) || (capacity / (windowSec * 1000)));
    
    const now = Date.now();
    let allowed = 0;
    let remaining = 0;
    const key = `rate_limit:${algo}:${identifier}`;

    const config = { limit, window: windowSec, capacity, refillRate, leakRate };
    const opStart = Date.now();

    // 2. Execute core algorithm
    if (algo === 'token_bucket') {
      if (isRedisConnected) {
        const results = await redis.runTokenBucket(key, capacity, refillRate, now, 1);
        allowed = results[0];
        remaining = results[1];
      } else {
        const results = runTokenBucketMemory(key, capacity, refillRate, now, 1);
        allowed = results[0];
        remaining = results[1];
      }
    } 
    else if (algo === 'leaky_bucket') {
      if (isRedisConnected) {
        const results = await redis.runLeakyBucket(key, capacity, leakRate, now, 1);
        allowed = results[0];
        remaining = results[1]; // represented as remaining capacity in the bucket
      } else {
        const results = runLeakyBucketMemory(key, capacity, leakRate, now, 1);
        allowed = results[0];
        remaining = results[1];
      }
    } 
    else if (algo === 'fixed_window') {
      const windowId = Math.floor(now / (windowSec * 1000));
      const windowKey = `${key}:${windowId}`;
      if (isRedisConnected) {
        const results = await redis.runFixedWindow(windowKey, limit, windowSec);
        allowed = results[0];
        remaining = results[1];
      } else {
        const results = runFixedWindowMemory(windowKey, limit, windowSec);
        allowed = results[0];
        remaining = results[1];
      }
    } 
    else if (algo === 'sliding_window') {
      const member = `${now}-${Math.random()}`;
      if (isRedisConnected) {
        const results = await redis.runSlidingWindow(key, limit, windowSec * 1000, now, member);
        allowed = results[0];
        remaining = results[1];
      } else {
        const results = runSlidingWindowMemory(key, limit, windowSec * 1000, now, member);
        allowed = results[0];
        remaining = results[1];
      }
    }

    // Track simulated metrics
    const opLatency = Date.now() - opStart;
    simMetrics.commandsProcessed++;
    simMetrics.totalLatency += opLatency;
    simMetrics.opsTimestamps.push(Date.now());
    simMetrics.algoCounts[algo] = (simMetrics.algoCounts[algo] || 0) + 1;
    if (allowed) simMetrics.hits++;
    else simMetrics.misses++;

    // Track for DDoS detection
    ddosState.requestTimestamps.push(now);
    const ddosStatus = calculateDdosStatus(limit, windowSec);

    // 3. Compute headers & visual states
    let resetTime = windowSec;
    if (algo === 'token_bucket') {
      resetTime = Math.max(0, Math.ceil((capacity - remaining) / (refillRate * 1000)));
    } else if (algo === 'leaky_bucket') {
      resetTime = Math.max(0, Math.ceil((capacity - remaining) / (leakRate * 1000)));
    } else if (algo === 'fixed_window') {
      resetTime = windowSec - (Math.floor(now / 1000) % windowSec);
    } else if (algo === 'sliding_window') {
      resetTime = windowSec; // Sliding window is continuous
    }

    // Fetch dynamic store state for visualization
    const state = await getStoreState(ip, algo, config);

    const rateLimitInfo = {
      allowed: !!allowed,
      remaining: Math.max(0, Math.round(remaining * 100) / 100),
      limit,
      reset: resetTime,
      algorithm: algo,
      isRedis: simulateRedis || isRedisConnected,
      meta: state,
      authMode,
      identifier,
      tier: tierConfig ? tierConfig.name : null,
      apiKey: apiKey || null,
      user: authUser || null,
      ddos: ddosStatus
    };

    // Attach to response object for routes to include
    req.rateLimit = rateLimitInfo;

    // Set standard response headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, Math.floor(remaining)));
    res.setHeader('X-RateLimit-Reset', resetTime);
    res.setHeader('X-RateLimit-Algorithm', algo);
    res.setHeader('X-RateLimit-Mode', isRedisConnected ? 'redis' : 'memory');

    if (!allowed) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `API rate limit of ${limit} requests per ${windowSec}s exceeded!`,
        ...rateLimitInfo
      });
    }

    next();
  } catch (error) {
    console.error('Rate Limiter Middleware Error:', error);
    // On structural error, we log and proceed to avoid breaking production
    next();
  }
};

// --- Store flusher for reset button ---
export const resetStore = async () => {
  memoryStores.tokenBucket.clear();
  memoryStores.leakyBucket.clear();
  memoryStores.fixedWindow.clear();
  memoryStores.slidingWindow.clear();
  
  if (isRedisConnected) {
    try {
      await redis.flushdb();
      return { success: true, store: 'redis' };
    } catch (e) {
      console.error('Redis flush failed:', e);
    }
  }
  return { success: true, store: 'memory' };
};

export const getSimulatedRedisMetrics = () => {
  const now = Date.now();
  const uptime = Math.floor((now - simMetrics.startTime) / 1000);
  simMetrics.opsTimestamps = simMetrics.opsTimestamps.filter(t => now - t < 1000);
  const opsPerSec = simMetrics.opsTimestamps.length;
  const avgLatency = simMetrics.commandsProcessed > 0
    ? (simMetrics.totalLatency / simMetrics.commandsProcessed)
    : 0;
  const totalOps = simMetrics.hits + simMetrics.misses;
  const hitRate = totalOps > 0 ? (simMetrics.hits / totalOps) * 100 : 0;

  return {
    redis_mode: 'simulated',
    uptime_seconds: uptime,
    commands_processed: simMetrics.commandsProcessed,
    ops_per_sec: opsPerSec,
    hit_rate: parseFloat(hitRate.toFixed(1)),
    avg_latency_ms: parseFloat((avgLatency + Math.random() * 0.2).toFixed(3)),
    connected_clients: Math.floor(Math.random() * 4) + 1,
    memory_usage_mb: parseFloat((1.2 + Math.random() * 1.5).toFixed(2)),
    cache_keys: Math.floor(Math.random() * 50) + 10,
    algo_distribution: { ...simMetrics.algoCounts }
  };
};

export const getRedisMetrics = async () => {
  if (!isRedisConnected || !redis) {
    return { connected: false, ...getSimulatedRedisMetrics() };
  }
  try {
    const info = await redis.info();
    const parseInfo = (str) => {
      const lines = str.split('\r\n').filter(l => l && !l.startsWith('#'));
      const result = {};
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) result[line.slice(0, idx)] = line.slice(idx + 1);
      }
      return result;
    };
    const parsed = parseInfo(info);
    const db0 = await redis.info('keyspace');
    const keyCount = (db0.match(/keys=(\d+)/) || [])[1] || '0';

    return {
      connected: true,
      redis_mode: parsed.redis_mode || 'standalone',
      uptime_seconds: parseInt(parsed.uptime_in_seconds) || 0,
      connected_clients: parseInt(parsed.connected_clients) || 0,
      used_memory_human: parsed.used_memory_human || '0B',
      total_commands_processed: parseInt(parsed.total_commands_processed) || 0,
      keys_hits: parseInt(parsed.keyspace_hits) || 0,
      keys_misses: parseInt(parsed.keyspace_misses) || 0,
      hit_rate: (() => {
        const hits = parseInt(parsed.keyspace_hits) || 0;
        const misses = parseInt(parsed.keyspace_misses) || 0;
        const total = hits + misses;
        return total > 0 ? parseFloat(((hits / total) * 100).toFixed(1)) : 0;
      })(),
      keys_count: parseInt(keyCount) || 0,
      os: parsed.os || '',
      version: parsed.redis_version || ''
    };
  } catch {
    return { connected: false, ...getSimulatedRedisMetrics() };
  }
};

// Auto-connect on startup from env vars
const envConfig = {};
if (process.env.REDIS_URL) {
  try {
    const url = new URL(process.env.REDIS_URL);
    envConfig.host = url.hostname;
    envConfig.port = parseInt(url.port) || 6379;
    envConfig.password = url.password || null;
  } catch {}
} else {
  if (process.env.REDIS_HOST) envConfig.host = process.env.REDIS_HOST;
  if (process.env.REDIS_PORT) envConfig.port = parseInt(process.env.REDIS_PORT);
  if (process.env.REDIS_PASSWORD) envConfig.password = process.env.REDIS_PASSWORD;
}
connectRedis(envConfig);
