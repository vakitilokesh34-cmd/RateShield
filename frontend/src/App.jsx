import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function App() {
  const presets = [
    { id: 'balanced', name: 'Balanced', limit: 10, windowSec: 30, isAuto: true, desc: 'Standard limits with auto-refill.' },
    { id: 'strict', name: 'Strict', limit: 3, windowSec: 15, isAuto: false, refillRate: 0.1, leakRate: 0.1, desc: 'Tight limits, slow refill.' },
    { id: 'ddos', name: 'DDoS Test', limit: 5, windowSec: 10, isAuto: false, refillRate: 0.2, leakRate: 0.2, desc: 'Extreme rate simulation.' }
  ];

  const [activePreset, setActivePreset] = useState('balanced');
  const [algorithm, setAlgorithm] = useState('token_bucket');
  const [limit, setLimit] = useState(10);
  const [windowSec, setWindowSec] = useState(30);
  const [capacity, setCapacity] = useState(10);
  const [isAutoRates, setIsAutoRates] = useState(true);
  const [customRefillRate, setCustomRefillRate] = useState(0.33);
  const [customLeakRate, setCustomLeakRate] = useState(0.33);

  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isRedis, setIsRedis] = useState(false);
  const [simulateRedis, setSimulateRedis] = useState(false);
  const [serverState, setServerState] = useState(null);
  const [stats, setStats] = useState({ total: 0, success: 0, blocked: 0 });
  const [logs, setLogs] = useState([]);
  const [spamRps, setSpamRps] = useState(3);
  const [isSpamming, setIsSpamming] = useState(false);
  const spamIntervalRef = useRef(null);
  const triggerRequestRef = useRef(null);

  const [simulatedTokens, setSimulatedTokens] = useState(10);
  const [simulatedWater, setSimulatedWater] = useState(0);
  const [windowResetTime, setWindowResetTime] = useState(30);
  const [slidingNodes, setSlidingNodes] = useState([]);
  const serverStateRef = useRef(null);

  // --- Real-time Chart State ---
  const [chartData, setChartData] = useState([]);
  const chartAccumRef = useRef({});

  // --- Redis Configuration State ---
  const [redisMetrics, setRedisMetrics] = useState(null);
  const [redisConfig, setRedisConfig] = useState(null);
  const [redisHost, setRedisHost] = useState('127.0.0.1');
  const [redisPort, setRedisPort] = useState(6379);
  const [redisPassword, setRedisPassword] = useState('');
  const [redisConnecting, setRedisConnecting] = useState(false);

  // --- API Key Management State ---
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyTier, setNewKeyTier] = useState('free');
  const [activeApiKey, setActiveApiKey] = useState(null);
  const [showKeyCopied, setShowKeyCopied] = useState(null);

  // --- Auth State ---
  const [authMode, setAuthMode] = useState('sandbox');
  const [jwtToken, setJwtToken] = useState(null);
  const [jwtUser, setJwtUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [authError, setAuthError] = useState(null);

  // --- DDoS Detection State ---
  const [ddosStatus, setDdosStatus] = useState(null);

  const applyPreset = (preset) => {
    setActivePreset(preset.id);
    setLimit(preset.limit);
    setWindowSec(preset.windowSec);
    setIsAutoRates(preset.isAuto);
    if (!preset.isAuto) {
      setCustomRefillRate(preset.refillRate);
      setCustomLeakRate(preset.leakRate);
    }
  };

  useEffect(() => {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => setIsRedis(data.rateLimiterMode))
      .catch(() => {});
  }, []);

  useEffect(() => { setCapacity(limit); }, [limit]);

  const activeRefillRateMs = isAutoRates ? (capacity / (windowSec * 1000)) : (customRefillRate / 1000);
  const activeLeakRateMs = isAutoRates ? (capacity / (windowSec * 1000)) : (customLeakRate / 1000);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const state = serverStateRef.current;
      if (algorithm === 'token_bucket') {
        if (state) {
          const elapsed = now - state.lastUpdated;
          setSimulatedTokens(Math.min(capacity, state.tokens + (elapsed > 0 ? elapsed * activeRefillRateMs : 0)));
        } else {
          setSimulatedTokens(capacity);
        }
      } else if (algorithm === 'leaky_bucket') {
        if (state) {
          const elapsed = now - state.lastUpdated;
          setSimulatedWater(Math.max(0, state.water - (elapsed > 0 ? elapsed * activeLeakRateMs : 0)));
        } else {
          setSimulatedWater(0);
        }
      } else if (algorithm === 'fixed_window') {
        setWindowResetTime(windowSec - (Math.floor(now / 1000) % windowSec));
      } else if (algorithm === 'sliding_window' && state && state.log) {
        setSlidingNodes(state.log.filter(item => now - item.timestamp < windowSec * 1000));
      }
    }, 50);
    return () => clearInterval(timer);
  }, [algorithm, capacity, windowSec, activeRefillRateMs, activeLeakRateMs]);

  const addChartPoint = (success) => {
    const sec = new Date().toLocaleTimeString();
    const accum = chartAccumRef.current;
    if (!accum[sec]) accum[sec] = { time: sec, success: 0, blocked: 0 };
    accum[sec][success ? 'success' : 'blocked']++;
    const entries = Object.values(accum);
    const keep = entries.slice(-30);
    setChartData([...keep]);
  };

  const triggerRequest = async (path = '/api/') => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const headers = {
      'Content-Type': 'application/json',
      'X-Limiter-Algo': algorithm,
      'X-Limiter-Limit': limit.toString(),
      'X-Limiter-Window': windowSec.toString(),
      'X-Limiter-Capacity': capacity.toString(),
      'X-Limiter-Refill-Rate': activeRefillRateMs.toString(),
      'X-Limiter-Leak-Rate': activeLeakRateMs.toString(),
      'X-Auth-Mode': authMode,
      'X-Simulate-Redis': simulateRedis ? 'true' : 'false',
      ...(authMode === 'user' && jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {}),
      ...(authMode === 'apikey' && activeApiKey ? { 'X-API-Key': activeApiKey } : {}),
      ...(authMode === 'sandbox' && activeApiKey ? { 'X-API-Key': activeApiKey } : {}),
    };
    try {
      const res = await fetch(path, { headers });
      const data = await res.json();
      const success = res.status === 200;
      setIsRedis(data.isRedis);
      addChartPoint(success);
      setStats(prev => ({ total: prev.total + 1, success: prev.success + (success ? 1 : 0), blocked: prev.blocked + (success ? 0 : 1) }));
      setLogs(prev => [{
        id: Math.random().toString(36).substr(2, 9),
        time: new Date().toLocaleTimeString(),
        method: 'GET', path,
        status: res.status,
        remaining: data.remaining !== undefined ? data.remaining : null,
        mode: data.isRedis ? 'Redis' : 'Memory'
      }, ...prev].slice(0, 100));
      if (!success) {
        setError(data);
        if (data.meta) setServerState({ ...data.meta, lastUpdated: Date.now() });
      } else {
        setResponse(data);
        if (data.rateLimit && data.rateLimit.meta) {
          setServerState({ ...data.rateLimit.meta, lastUpdated: Date.now() });
        }
      }
    } catch (err) {
      setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), time: new Date().toLocaleTimeString(), method: 'GET', path, status: 'Error', remaining: 0, mode: 'None' }, ...prev]);
      setError({ message: 'Server connection failed', error: err.message });
    } finally { setLoading(false); }
  };

  triggerRequestRef.current = triggerRequest;
  serverStateRef.current = serverState;

  useEffect(() => {
    if (isSpamming) {
      spamIntervalRef.current = setInterval(() => triggerRequestRef.current('/api/data'), 1000 / spamRps);
    } else {
      if (spamIntervalRef.current) clearInterval(spamIntervalRef.current);
    }
    return () => { if (spamIntervalRef.current) clearInterval(spamIntervalRef.current); };
  }, [isSpamming, spamRps]);

  // --- Poll Redis Config & Metrics ---
  const fetchRedisConfig = async () => {
    try {
      const res = await fetch('/api/redis/config');
      setRedisConfig(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchRedisConfig();
    const interval = setInterval(fetchRedisConfig, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/redis/metrics');
        const data = await res.json();
        setRedisMetrics(data);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // --- Poll DDoS Status ---
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/ddos/status');
        const data = await res.json();
        setDdosStatus(data);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // --- API Key Management Functions ---
  const fetchApiKeys = async () => {
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();
      setApiKeys(data);
      if (authMode === 'apikey' && !activeApiKey) {
        const enabledKey = data.find(k => k.enabled);
        if (enabledKey) setActiveApiKey(enabledKey.key);
      }
    } catch {}
  };

  const generateKey = async () => {
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName || 'My Key', tier: newKeyTier })
      });
      const data = await res.json();
      if (data.key) {
        setActiveApiKey(data.key);
        setNewKeyName('');
      }
      fetchApiKeys();
    } catch {}
  };

  const revokeKey = async (key) => {
    await fetch(`/api/keys/${key}`, { method: 'DELETE' });
    if (activeApiKey === key) setActiveApiKey(null);
    fetchApiKeys();
  };

  const changeTier = async (key, tier) => {
    await fetch(`/api/keys/${key}/tier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier })
    });
    fetchApiKeys();
  };

  const copyKey = (key) => {
    navigator.clipboard.writeText(key);
    setShowKeyCopied(key);
    setTimeout(() => setShowKeyCopied(null), 2000);
  };

  useEffect(() => { fetchApiKeys(); }, []);

  // --- Auth Functions ---
  const handleLogin = async () => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      if (data.error) { setAuthError(data.error); return; }
      setJwtToken(data.token);
      setJwtUser(data.user);
      setLoginUsername('');
      setLoginPassword('');
    } catch { setAuthError('Server connection failed'); }
  };

  const handleRegister = async () => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      if (data.error) { setAuthError(data.error); return; }
      setJwtToken(data.token);
      setJwtUser(data.user);
      setLoginUsername('');
      setLoginPassword('');
      setRegisterMode(false);
    } catch { setAuthError('Server connection failed'); }
  };

  const handleLogout = () => {
    setJwtToken(null);
    setJwtUser(null);
  };

  const changeAuthMode = (mode) => {
    if (mode === 'user') { setActiveApiKey(null); }
    if (mode === 'apikey') {
      setJwtToken(null); setJwtUser(null);
      if (!activeApiKey) {
        const enabledKey = apiKeys.find(k => k.enabled);
        if (enabledKey) setActiveApiKey(enabledKey.key);
      }
    }
    setAuthMode(mode);
  };

  const handleFlush = async () => {
    setIsSpamming(false);
    setLoading(true);
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      await res.json();
      setStats({ total: 0, success: 0, blocked: 0 });
      setLogs([]); setResponse(null); setError(null); setServerState(null);
      setSimulatedTokens(capacity); setSimulatedWater(0); setSlidingNodes([]);
      setChartData([]); chartAccumRef.current = {};
    } catch (e) {
      alert('Reset failed: ' + e.message);
    } finally { setLoading(false); }
  };

  const algorithmsList = [
    { id: 'token_bucket', name: 'Token Bucket', tagline: 'Burst permit, continuous refill', desc: 'Requests consume tokens. Tokens refill at a fixed rate. Handles bursts up to capacity.' },
    { id: 'leaky_bucket', name: 'Leaky Bucket', tagline: 'Queue processing, uniform flow', desc: 'Requests add "water" to the bucket. Water leaks at a steady rate. Excess overflows (429).' },
    { id: 'fixed_window', name: 'Fixed Window', tagline: 'Time-block counter, rapid resets', desc: 'Counters reset each time window. Simple but allows boundary bursts.' },
    { id: 'sliding_window', name: 'Sliding Window', tagline: 'Rolling timeline, precise', desc: 'Request timestamps in a rolling window. Highly accurate, more memory.' }
  ];

  const chartColors = { success: '#22c55e', blocked: '#ef4444' };

  return (
    <div className="min-h-screen bg-[#0d0e11] text-slate-200 flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 bg-[#0d0e11]/90 backdrop-blur-md px-6 md:px-12 py-3 flex justify-between items-center border-b border-slate-800 z-50">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="RateShield Logo" className="h-12 w-auto"/>
          <span className="text-xl font-bold tracking-widest text-[#d4b26f] ml-1">RateShield</span>
        </div>
        <nav className="flex items-center gap-4 text-xs text-slate-400">
          <span className="text-[#d4b26f] font-semibold">Dashboard</span>
          <button onClick={handleFlush} className="hover:text-white transition-colors">Reset</button>
          <span className="text-[10px] text-slate-600 uppercase">{authMode}</span>
          {jwtUser && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-emerald-900/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-emerald-300">{jwtUser.username}</span>
            </div>
          )}
          {activeApiKey && authMode !== 'user' && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-[#c19451]/10 border border-[#c19451]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <code className="text-[10px] text-[#d4b26f]">{apiKeys.find(k => k.key === activeApiKey)?.name || 'Key'}</code>
              <span className="text-[9px] uppercase font-semibold text-slate-500">{apiKeys.find(k => k.key === activeApiKey)?.tier}</span>
            </div>
          )}
        </nav>
      </header>

      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Left Panel - Controls */}
          <div className="lg:col-span-5 space-y-4">

            {/* Algorithm Selection */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f] mb-3">Algorithm</h3>
              <div className="space-y-2">
                {algorithmsList.map(item => (
                  <button key={item.id} onClick={() => { setAlgorithm(item.id); }}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                      algorithm === item.id
                        ? 'bg-[#c19451]/10 border-[#c19451]/50 text-white'
                        : 'border-slate-800 text-slate-400 hover:border-slate-600'
                    }`}>
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">{item.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${
                        algorithm === item.id ? 'bg-[#c19451]/20 text-[#d4b26f]' : 'bg-slate-800 text-slate-500'
                      }`}>{item.tagline}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">{item.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Authentication */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f] mb-3">Authentication</h3>

              {/* Auth mode selector */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { id: 'sandbox', label: 'Sandbox', desc: 'Headers' },
                  { id: 'ip', label: 'By IP', desc: 'Auto' },
                  { id: 'user', label: 'By User', desc: 'JWT' },
                  { id: 'apikey', label: 'By API Key', desc: 'Tiered' }
                ].map(m => (
                  <button key={m.id} onClick={() => changeAuthMode(m.id)}
                    className={`text-xs py-2 px-2 rounded-lg text-center font-semibold border transition-all ${
                      authMode === m.id
                        ? 'bg-[#c19451]/15 border-[#c19451] text-[#d4b26f]'
                        : 'border-slate-800 text-slate-400 hover:border-slate-600'
                    }`}>
                    <div>{m.label}</div>
                    <div className="text-[9px] font-normal text-slate-500">{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* User auth form */}
              {authMode === 'user' && !jwtUser && (
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <input type="text" placeholder="Username" value={loginUsername}
                    onChange={e => setLoginUsername(e.target.value)}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#c19451]/50" />
                  <input type="password" placeholder="Password" value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#c19451]/50" />
                  {authError && <p className="text-red-400 text-[10px]">{authError}</p>}
                  <div className="flex gap-2">
                    <button onClick={handleLogin}
                      className="flex-1 py-2 bg-[#c19451] text-white rounded-lg text-xs font-semibold hover:bg-[#a77c3a] transition-all">
                      Login
                    </button>
                    <button onClick={() => { setRegisterMode(!registerMode); setAuthError(null); }}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                        registerMode ? 'bg-emerald-900/30 border-emerald-500/40 text-emerald-400' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}>
                      {registerMode ? 'Switch to Login' : 'Register'}
                    </button>
                  </div>
                  {registerMode && (
                    <button onClick={handleRegister}
                      className="w-full py-2 bg-emerald-700 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600 transition-all">
                      Create Account
                    </button>
                  )}
                  <p className="text-[9px] text-slate-600 text-center">Demo account: demo / password</p>
                </div>
              )}

              {/* Logged in as user */}
              {authMode === 'user' && jwtUser && (
                <div className="border-t border-slate-800 pt-3">
                  <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-emerald-400 font-semibold">Authenticated</span>
                      <button onClick={handleLogout}
                        className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">Logout</button>
                    </div>
                    <p className="text-xs text-slate-200">{jwtUser.username} <span className="text-[9px] text-slate-500">(id: {jwtUser.id})</span></p>
                    <code className="text-[9px] text-slate-600 block truncate mt-1">Bearer {jwtToken.slice(0, 24)}...</code>
                  </div>
                </div>
              )}

              {/* IP mode info */}
              {authMode === 'ip' && (
                <div className="border-t border-slate-800 pt-3">
                  <p className="text-[10px] text-slate-500">Rate limiting by IP address. No authentication required. Rate limit key is derived from your IP.</p>
                </div>
              )}

              {/* API key mode info */}
              {authMode === 'apikey' && (
                <div className="border-t border-slate-800 pt-3">
                  <p className="text-[10px] text-slate-500 mb-2">Rate limiting by API key tier. Select or generate a key in the API Key Management section below.</p>
                  {!activeApiKey && (
                    <p className="text-[10px] text-amber-400">No API key selected. Requests will fail with 401.</p>
                  )}
                </div>
              )}
            </div>

            {/* Configuration */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f] mb-3">Rate Configuration</h3>

              {/* Presets */}
              <div className="mb-4 pb-4 border-b border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase mb-2 block">Presets</span>
                <div className="grid grid-cols-3 gap-2">
                  {presets.map(p => (
                    <button key={p.id} onClick={() => applyPreset(p)}
                      className={`text-xs py-2 rounded-lg text-center font-semibold border transition-all ${
                        activePreset === p.id
                          ? 'bg-[#c19451]/15 border-[#c19451] text-[#d4b26f]'
                          : 'border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}>{p.name}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Request Limit</span>
                    <span className="text-[#d4b26f] font-semibold">{limit}</span>
                  </div>
                  <input type="range" min="1" max="30" value={limit} onChange={e => { setLimit(parseInt(e.target.value)); setActivePreset('custom'); }} className="w-full" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Time Window (seconds)</span>
                    <span className="text-[#d4b26f] font-semibold">{windowSec}s</span>
                  </div>
                  <input type="range" min="5" max="90" value={windowSec} onChange={e => { setWindowSec(parseInt(e.target.value)); setActivePreset('custom'); }} className="w-full" />
                </div>
                {(algorithm === 'token_bucket' || algorithm === 'leaky_bucket') && (
                  <div className="pt-3 border-t border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-slate-400">Rate Control</label>
                      <button onClick={() => { setIsAutoRates(!isAutoRates); setActivePreset('custom'); }}
                        className={`text-[10px] px-2 py-1 rounded font-semibold border ${
                          isAutoRates ? 'bg-[#c19451]/10 text-[#d4b26f] border-[#c19451]/20' : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>{isAutoRates ? 'Auto (sync to window)' : 'Manual'}</button>
                    </div>
                    {!isAutoRates && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">{algorithm === 'token_bucket' ? 'Refill' : 'Leak'} Rate / sec</span>
                          <span className="text-[#d4b26f]">{(algorithm === 'token_bucket' ? customRefillRate : customLeakRate).toFixed(1)}</span>
                        </div>
                        <input type="range" min="0.1" max="5" step="0.1"
                          value={algorithm === 'token_bucket' ? customRefillRate : customLeakRate}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (algorithm === 'token_bucket') setCustomRefillRate(v); else setCustomLeakRate(v);
                            setActivePreset('custom');
                          }} className="w-full" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Redis Configuration */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f]">Redis</h3>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${redisConfig?.connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className={`text-[10px] font-semibold ${redisConfig?.connected ? 'text-emerald-400' : 'text-red-400'}`}>
                    {redisConfig?.connected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>

              {/* Connection config form */}
              <div className="space-y-2 mb-3">
                <div className="flex gap-2">
                  <input type="text" placeholder="Host" value={redisHost}
                    onChange={e => setRedisHost(e.target.value)}
                    className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#c19451]/50" />
                  <input type="number" placeholder="Port" value={redisPort}
                    onChange={e => setRedisPort(parseInt(e.target.value) || 6379)}
                    className="w-20 bg-slate-800/50 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#c19451]/50" />
                </div>
                <input type="password" placeholder="Password (optional)" value={redisPassword}
                  onChange={e => setRedisPassword(e.target.value)}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#c19451]/50" />
                <div className="flex gap-2">
                  <button onClick={async () => {
                    setRedisConnecting(true);
                    try {
                      const res = await fetch('/api/redis/connect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ host: redisHost, port: redisPort, password: redisPassword || null })
                      });
                      const data = await res.json();
                      if (!data.success) alert('Redis connection failed: ' + (data.error || 'unknown error'));
                      await fetchRedisConfig();
                    } catch (e) { alert('Connection error: ' + e.message); }
                    setRedisConnecting(false);
                  }} disabled={redisConnecting}
                    className="flex-1 py-1.5 bg-[#c19451] text-white rounded-lg text-[10px] font-semibold hover:bg-[#a77c3a] transition-all disabled:opacity-50">
                    {redisConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                  <button onClick={async () => {
                    await fetch('/api/redis/disconnect', { method: 'POST' });
                    await fetchRedisConfig();
                  }}
                    className="px-3 py-1.5 border border-slate-700 text-slate-400 rounded-lg text-[10px] font-semibold hover:border-red-500/50 hover:text-red-400 transition-all">
                    Disconnect
                  </button>
                </div>
              </div>

              {/* Status / Metrics */}
              {redisMetrics && (
                <div className="border-t border-slate-800 pt-3">
                  {redisConfig?.connected && redisMetrics.connected ? (
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Mode</span>
                        <span className="text-white font-semibold">{redisMetrics.redis_mode}</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Version</span>
                        <span className="text-white font-semibold">{redisMetrics.version || '-'}</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Uptime</span>
                        <span className="text-emerald-400 font-semibold">{redisMetrics.uptime_seconds}s</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Clients</span>
                        <span className="text-white font-semibold">{redisMetrics.connected_clients}</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Memory</span>
                        <span className="text-white font-semibold">{redisMetrics.used_memory_human || 'N/A'}</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Keys</span>
                        <span className="text-white font-semibold">{redisMetrics.keys_count}</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Hit Rate</span>
                        <span className={redisMetrics.hit_rate > 80 ? 'text-emerald-400' : 'text-amber-400'}>{redisMetrics.hit_rate}%</span>
                      </div>
                      <div className="bg-black/20 rounded-lg p-2">
                        <span className="text-slate-500 block">Commands</span>
                        <span className="text-white font-semibold">{redisMetrics.total_commands_processed || redisMetrics.commands_processed}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-[10px] text-slate-500">Not connected to Redis.</p>
                      <p className="text-[9px] text-slate-600 mt-1">Rate limiting falls back to in-memory storage.</p>
                      <p className="text-[9px] text-slate-600">Configure connection above or use .env variables.</p>
                      {!redisConfig?.connected && redisMetrics.uptime_seconds > 0 && (
                        <div className="mt-2 text-[9px] text-slate-600">
                          <span className="text-slate-500">Simulated uptime: {redisMetrics.uptime_seconds}s</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* API Key Management */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f] mb-3">API Key Management</h3>

              {/* Generate new key form */}
              <div className="flex gap-2 mb-3">
                <input type="text" placeholder="Key name..." value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#c19451]/50" />
                <select value={newKeyTier} onChange={e => setNewKeyTier(e.target.value)}
                  className="bg-slate-800/50 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#c19451]/50">
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <button onClick={generateKey}
                  className="px-3 py-2 bg-[#c19451] text-white rounded-lg text-xs font-semibold hover:bg-[#a77c3a] transition-all whitespace-nowrap">
                  Generate
                </button>
              </div>

              {/* Active key indicator */}
              {activeApiKey && (
                <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <code className="text-[11px] text-slate-300">{activeApiKey.slice(0, 12)}...{activeApiKey.slice(-4)}</code>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase text-emerald-400 bg-emerald-900/20">
                      {apiKeys.find(k => k.key === activeApiKey)?.tier}
                    </span>
                  </div>
                  <button onClick={() => setActiveApiKey(null)}
                    className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">Clear</button>
                </div>
              )}

              {/* Key list */}
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {apiKeys.length === 0 ? (
                  <p className="text-[11px] text-slate-500 text-center py-4">No API keys yet. Generate one above.</p>
                ) : apiKeys.map(entry => {
                  const tierColors = {
                    free: 'text-slate-400 bg-slate-800',
                    pro: 'text-emerald-400 bg-emerald-900/20',
                    enterprise: 'text-[#d4b26f] bg-[#c19451]/10'
                  };
                  return (
                    <div key={entry.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                      activeApiKey === entry.key ? 'bg-emerald-900/5 border-emerald-500/20' : 'bg-slate-800/30 border-slate-800'
                    }`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-200 truncate">{entry.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${tierColors[entry.tier]}`}>{entry.tier}</span>
                          {!entry.enabled && <span className="text-red-400 text-[9px]">Revoked</span>}
                        </div>
                        <code className="text-[10px] text-slate-500 block truncate">{entry.key}</code>
                        {entry.lastUsed && <span className="text-[9px] text-slate-600">Last used: {new Date(entry.lastUsed).toLocaleTimeString()}</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => copyKey(entry.key)}
                          className="px-1.5 py-1 rounded hover:bg-slate-700 text-[10px] text-slate-400 hover:text-white transition-all">
                          {showKeyCopied === entry.key ? 'Copied' : 'Copy'}
                        </button>
                        {activeApiKey !== entry.key ? (
                          <button onClick={() => setActiveApiKey(entry.key)}
                            className="px-1.5 py-1 rounded hover:bg-slate-700 text-[10px] text-slate-400 hover:text-emerald-400 transition-all">
                            Use
                          </button>
                        ) : (
                          <span className="px-1.5 text-emerald-400 text-[10px]">Active</span>
                        )}
                        {entry.enabled && (
                          <>
                            <select value={entry.tier} onChange={e => changeTier(entry.key, e.target.value)}
                              className="bg-transparent text-[9px] text-slate-500 border border-slate-700 rounded p-0.5">
                              <option value="free">Free</option>
                              <option value="pro">Pro</option>
                              <option value="enterprise">Enterprise</option>
                            </select>
                            <button onClick={() => revokeKey(entry.key)}
                              className="px-1.5 py-1 rounded hover:bg-red-900/30 text-[10px] text-slate-500 hover:text-red-400 transition-all">
                              Revoke
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* DDoS Detection */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f]">DDoS Protection</h3>
                {ddosStatus && (() => {
                  const colors = { normal: 'bg-emerald-500', elevated: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500' };
                  const labels = { normal: 'Normal', elevated: 'Elevated', high: 'High', critical: 'Critical' };
                  const textColors = { normal: 'text-emerald-400', elevated: 'text-yellow-400', high: 'text-orange-400', critical: 'text-red-400' };
                  const bgColors = { normal: 'bg-emerald-900/20 border-emerald-500/20', elevated: 'bg-yellow-900/20 border-yellow-500/20', high: 'bg-orange-900/20 border-orange-500/20', critical: 'bg-red-900/20 border-red-500/20' };
                  const s = ddosStatus.severity || 'normal';
                  return (
                    <div className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-[10px] font-semibold uppercase ${bgColors[s]} ${textColors[s]}`}>
                      <span className={`w-2 h-2 rounded-full ${colors[s]}`} />
                      {labels[s]}
                    </div>
                  );
                })()}
              </div>
              {ddosStatus ? (
                <div className="space-y-3">
                  {/* RPS Gauge */}
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                      <span>Traffic Load</span>
                      <span className={ddosStatus.ratio >= 0.9 ? 'text-red-400' : ddosStatus.ratio >= 0.6 ? 'text-orange-400' : ddosStatus.ratio >= 0.3 ? 'text-yellow-400' : 'text-emerald-400'}>
                        {Math.round(ddosStatus.ratio * 100)}%
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                      {(() => {
                        const pct = Math.min(100, Math.round(ddosStatus.ratio * 100));
                        const barColor = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-orange-500' : pct >= 30 ? 'bg-yellow-500' : 'bg-emerald-500';
                        return <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />;
                      })()}
                    </div>
                  </div>
                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-black/20 rounded-lg p-2">
                      <span className="text-slate-500 block">Current RPS</span>
                      <span className="text-white font-semibold">{ddosStatus.currentRps}</span>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <span className="text-slate-500 block">Expected Max</span>
                      <span className="text-white font-semibold">{ddosStatus.expectedMaxRps}</span>
                    </div>
                  </div>
                  {/* Severity description */}
                  <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2">
                    <span className={ddosStatus.severity === 'normal' ? 'text-emerald-400' : ddosStatus.severity === 'elevated' ? 'text-yellow-400' : ddosStatus.severity === 'high' ? 'text-orange-400' : 'text-red-400'}>
                      {ddosStatus.severity === 'normal' ? 'Traffic is within normal range.' :
                       ddosStatus.severity === 'elevated' ? 'Traffic is above normal. Monitoring closely.' :
                       ddosStatus.severity === 'high' ? 'Suspicious traffic pattern detected.' :
                       'DDoS attack likely in progress. Mitigation recommended.'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500">Waiting for traffic data...</p>
              )}
            </div>

            {/* Stress Spammer */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4b26f] mb-3">Stress Test</h3>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Requests / sec</span>
                    <span className="text-[#d4b26f]">{spamRps}</span>
                  </div>
                  <input type="range" min="1" max="10" value={spamRps} disabled={isSpamming} onChange={e => setSpamRps(parseInt(e.target.value))} className="w-full" />
                </div>
                <button onClick={() => setIsSpamming(!isSpamming)}
                  className={`px-5 py-3 rounded-lg text-xs font-semibold uppercase whitespace-nowrap transition-all ${
                    isSpamming ? 'bg-red-900/40 text-red-400 border border-red-500/30' : 'bg-[#c19451] text-white hover:bg-[#a77c3a]'
                  }`}>
                  {isSpamming ? 'Stop' : 'Start'}
                </button>
              </div>
            </div>

          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-7 space-y-4">

            {/* Send Request */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex gap-3">
                <button onClick={() => triggerRequest('/api/')} disabled={loading}
                  className="flex-1 py-3 rounded-lg text-xs font-semibold border border-[#c19451]/30 bg-slate-800/60 hover:bg-slate-700/60 transition-all disabled:opacity-50">
                  GET /api (public)
                </button>
                <button onClick={() => triggerRequest('/api/data')} disabled={loading}
                  className="flex-1 py-3 rounded-lg text-xs font-semibold bg-[#c19451] text-white hover:bg-[#a77c3a] transition-all disabled:opacity-50">
                  {loading ? 'Sending...' : 'GET /api/data (protected)'}
                </button>
              </div>
            </div>

            {/* Real-time Throughput Chart */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Real-Time Throughput</h3>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Success
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-red-400">
                    <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Blocked
                  </span>
                </div>
              </div>
              <div className="h-48">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                      <defs>
                        <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="blockedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Area type="monotone" dataKey="success" stroke="#22c55e" fill="url(#successGrad)" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="blocked" stroke="#ef4444" fill="url(#blockedGrad)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                    Send requests to populate the chart
                  </div>
                )}
              </div>
            </div>

            {/* Status / Response */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 min-h-[120px]">
              {!response && !error && (
                <p className="text-slate-500 text-sm">Send a request to see the response here.</p>
              )}
              {error && (
                <div>
                  <span className="text-red-400 text-xs font-semibold uppercase">Blocked (429)</span>
                  <pre className="mt-2 text-xs text-slate-400 whitespace-pre-wrap">{JSON.stringify(error, null, 2)}</pre>
                </div>
              )}
              {response && (
                <div>
                  <span className="text-emerald-400 text-xs font-semibold uppercase">Allowed (200)</span>
                  <pre className="mt-2 text-xs text-slate-400 whitespace-pre-wrap">{JSON.stringify(response, null, 2)}</pre>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-[10px] text-slate-500 uppercase block">Total</span>
                <span className="text-lg font-semibold text-white">{stats.total}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-[10px] text-slate-500 uppercase block">Success</span>
                <span className="text-lg font-semibold text-emerald-400">{stats.success}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-[10px] text-slate-500 uppercase block">Blocked</span>
                <span className="text-lg font-semibold text-red-400">{stats.blocked}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-[10px] text-slate-500 uppercase block">Rate</span>
                <span className="text-lg font-semibold text-[#d4b26f]">
                  {stats.total > 0 ? `${Math.round((stats.success / stats.total) * 100)}%` : '\u2014'}
                </span>
              </div>
            </div>

            {/* Algorithm Visual */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                {algorithmsList.find(a => a.id === algorithm)?.name} State
              </h3>
              <div className="flex items-center justify-center min-h-[100px]">
                {algorithm === 'token_bucket' && (
                  <div className="text-center">
                    <div className="text-3xl font-light text-[#d4b26f]">
                      {simulatedTokens.toFixed(1)} <span className="text-sm text-slate-500">/ {capacity}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Available Tokens</p>
                    <div className="w-48 h-2 bg-slate-800 rounded-full mt-2 overflow-hidden mx-auto">
                      <div className="h-full bg-[#c19451] rounded-full transition-all duration-300" style={{ width: `${(simulatedTokens / capacity) * 100}%` }} />
                    </div>
                  </div>
                )}
                {algorithm === 'leaky_bucket' && (
                  <div className="text-center">
                    <div className="text-3xl font-light text-[#d4b26f]">
                      {simulatedWater.toFixed(1)} <span className="text-sm text-slate-500">/ {capacity}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Water Level</p>
                    <div className="w-48 h-2 bg-slate-800 rounded-full mt-2 overflow-hidden mx-auto">
                      <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${(simulatedWater / capacity) * 100}%` }} />
                    </div>
                  </div>
                )}
                {algorithm === 'fixed_window' && (
                  <div className="text-center">
                    <div className="text-3xl font-light text-[#d4b26f]">
                      {serverState ? serverState.count : 0} <span className="text-sm text-slate-500">/ {limit}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Window resets in {windowResetTime}s</p>
                    <div className="w-48 h-2 bg-slate-800 rounded-full mt-2 overflow-hidden mx-auto">
                      <div className="h-full bg-[#d4b26f] rounded-full transition-all duration-1000" style={{ width: `${((serverState?.count || 0) / limit) * 100}%` }} />
                    </div>
                  </div>
                )}
                {algorithm === 'sliding_window' && (
                  <div className="text-center w-full">
                    <div className="text-3xl font-light text-[#d4b26f]">
                      {slidingNodes.length} <span className="text-sm text-slate-500">/ {limit}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Active requests in window</p>
                    <div className="w-full max-w-xs h-10 bg-slate-800/50 rounded-lg mt-2 mx-auto relative overflow-hidden">
                      {slidingNodes.map((node) => {
                        const pos = 100 - ((Date.now() - node.timestamp) / (windowSec * 1000)) * 100;
                        if (pos < 0 || pos > 100) return null;
                        return <div key={node.id} className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#d4b26f]" style={{ left: `${pos}%` }} />;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Log Console */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Request Log</h3>
                <button onClick={() => setLogs([])} className="text-[10px] text-slate-500 hover:text-slate-300">Clear</button>
              </div>
              <div className="bg-black/30 rounded-lg p-3 h-[200px] overflow-y-auto font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <p className="text-slate-600 italic">No requests yet.</p>
                ) : logs.map(log => (
                  <div key={log.id} className="flex items-center gap-2 text-slate-400 border-b border-slate-800/50 pb-1">
                    <span className="text-slate-600">[{log.time}]</span>
                    <span className={log.status === 200 ? 'text-emerald-400' : log.status === 429 ? 'text-red-400' : 'text-amber-400'}>{log.status}</span>
                    <span>{log.path}</span>
                    {log.remaining !== null && <span className="text-slate-600">rem: {log.remaining}</span>}
                    <span className="text-slate-700">{log.mode}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>

      <footer className="text-center py-4 text-slate-700 text-[10px]">
        RateShield — Distributed Rate Limiter Sandbox
      </footer>
    </div>
  );
}

export default App;
