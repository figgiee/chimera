// ═══════════════════════════════════════════════════════════════════
// Chimera Chat Server — HTTP endpoint wrapping the orchestrator
//
// POST /api/chat   { message, session_id?, project_id?, working_dir? }
// GET  /api/health
// GET  /api/sessions/:id/logs
// *    /api/rag/*   (proxied to RAG stack)
//
// Non-API routes serve static files from web/build (SPA fallback).
//
// Manages multiple concurrent sessions. Each session_id gets its own
// ChimeraSession with independent message history and Synapse state.
// ═══════════════════════════════════════════════════════════════════

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { ChimeraSession } = require('./chimera-orchestrator');

const CHIMERA_DIR = __dirname.replace(/\\/g, '/');

const PORT = parseInt(process.env.CHIMERA_PORT || '3210');
const HOST = process.env.CHIMERA_HOST || '127.0.0.1';

// ─── Static file serving ─────────────────────────────────────────
const STATIC_DIR = path.resolve(__dirname, 'web/build');

const MIME_TYPES = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.mjs':   'application/javascript',
  '.css':   'text/css',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.json':  'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.txt':   'text/plain',
};

// ─── Session store ───────────────────────────────────────────────
const sessions = new Map();  // session_id → { session, created, lastActive, logs }
const MAX_SESSIONS = 20;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (persisted to disk)

// ─── Session persistence ─────────────────────────────────────────
const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function persistSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  try {
    const data = {
      created: entry.created,
      lastActive: entry.lastActive,
      projectId: entry.session.projectId,
      logs: entry.logs,
      messages: entry.session.messages,
    };
    fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify(data));
  } catch (e) {
    console.error(`[persist] failed to save session ${sessionId}:`, e.message);
  }
}

function loadPersistedSessions() {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const now = Date.now();
    let loaded = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
        if (now - data.lastActive > SESSION_TTL) {
          fs.unlinkSync(path.join(SESSIONS_DIR, file));
          continue;
        }
        const sessionId = file.replace('.json', '');
        const logs = data.logs || [];
        const session = new ChimeraSession({
          projectId: data.projectId || 'chimera',
          onEvent: (event) => {
            logs.push({ ts: Date.now(), ...event });
            if (logs.length > 200) logs.splice(0, logs.length - 100);
          }
        });
        // Restore LLM message history
        if (Array.isArray(data.messages)) session.messages = data.messages;
        sessions.set(sessionId, { session, created: data.created, lastActive: data.lastActive, logs });
        loaded++;
      } catch {
        // Delete corrupt/unreadable session files so they don't accumulate
        try { fs.unlinkSync(path.join(SESSIONS_DIR, file)); } catch {}
      }
    }
    if (loaded > 0) console.log(`  Sessions:  restored ${loaded} session(s) from disk`);
  } catch { /* sessions dir missing or unreadable */ }
}

function getOrCreateSession(sessionId, projectId) {
  // Prune expired sessions
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > SESSION_TTL) sessions.delete(id);
  }

  // Evict oldest if at capacity
  if (sessions.size >= MAX_SESSIONS && !sessions.has(sessionId)) {
    let oldest = null;
    for (const [id, s] of sessions) {
      if (!oldest || s.lastActive < oldest.lastActive) oldest = { id, ...s };
    }
    if (oldest) sessions.delete(oldest.id);
  }

  if (sessions.has(sessionId)) {
    const entry = sessions.get(sessionId);
    entry.lastActive = now;
    return entry;
  }

  const logs = [];
  const session = new ChimeraSession({
    projectId: projectId || 'chimera',
    onEvent: (event) => {
      logs.push({ ts: Date.now(), ...event });
      // Keep logs bounded
      if (logs.length > 200) logs.splice(0, logs.length - 100);
      logEvent(sessionId, event);
    }
  });

  const entry = { session, created: now, lastActive: now, logs };
  sessions.set(sessionId, entry);
  return entry;
}

// ─── Console logging ─────────────────────────────────────────────
function logEvent(sessionId, event) {
  const ts = new Date().toISOString().slice(11, 19);
  switch (event.type) {
    case 'user_message':
      console.log(`[${ts}] [${sessionId}] USER: ${event.text.slice(0, 80)}`);
      break;
    case 'intent':
      console.log(`[${ts}] [${sessionId}] INTENT: ${event.mode}`);
      break;
    case 'synapse_start':
      console.log(`[${ts}] [${sessionId}] SYNAPSE: started ${event.mode} session ${event.session_id}`);
      break;
    case 'synapse_question':
      console.log(`[${ts}] [${sessionId}] Q: ${event.text?.slice(0, 60)}`);
      break;
    case 'synapse_answer':
      console.log(`[${ts}] [${sessionId}] A: ${event.answer?.slice(0, 60)}`);
      break;
    case 'tool':
      console.log(`[${ts}] [${sessionId}] TOOL: ${event.tool}${event.hadError ? ' [ERROR]' : ''}`);
      break;
    case 'loop':
      console.log(`[${ts}] [${sessionId}] LOOP: ${event.reason} — ${event.signature}`);
      break;
    case 'task_start':
      console.log(`[${ts}] [${sessionId}] TASK: ${event.description?.slice(0, 60)}`);
      break;
    case 'task_done':
      console.log(`[${ts}] [${sessionId}] DONE: task ${event.id}`);
      break;
    case 'task_failed':
      console.log(`[${ts}] [${sessionId}] FAILED: task ${event.id} — ${event.error}`);
      break;
    case 'tasks_complete':
      console.log(`[${ts}] [${sessionId}] ALL TASKS: ${event.count} completed`);
      break;
    case 'auto_save':
      console.log(`[${ts}] [${sessionId}] SAVED: ${event.content?.slice(0, 60)}`);
      break;
    case 'auto_save_error':
      console.log(`[${ts}] [${sessionId}] SAVE ERR: ${event.error}`);
      break;
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// Only allow CORS from localhost origins — prevents malicious websites from
// accessing Chimera's API even if CHIMERA_HOST is misconfigured to 0.0.0.0.
// Called once at the top of handleRequest to set headers on every response.
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── Dependency health check ────────────────────────────────────
async function checkDeps() {
  const errors = [];
  try {
    const r = await fetch(`${process.env.RAG_URL || 'http://localhost:8080'}/health`);
    if (!r.ok) errors.push('RAG stack unhealthy');
  } catch { errors.push('RAG stack unreachable'); }
  try {
    const r = await fetch(`http://${process.env.LM_HOST || '127.0.0.1'}:${process.env.LM_PORT || '1235'}/v1/models`);
    if (!r.ok) errors.push('LM Studio unhealthy');
  } catch { errors.push('LM Studio unreachable'); }
  return errors;
}

// ─── SSE helpers ─────────────────────────────────────────────────
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function serveStatic(req, res, pathname) {
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(STATIC_DIR, `.${urlPath}`);

  // Guard against path traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => { if (!res.writableEnded) { res.writeHead(500); res.end(); } });
      stream.pipe(res);
    } else {
      // SPA fallback — serve 200.html
      const fallback = path.resolve(STATIC_DIR, '200.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const stream = fs.createReadStream(fallback);
      stream.on('error', () => { if (!res.writableEnded) { res.writeHead(404); res.end(); } });
      stream.pipe(res);
    }
  });
}

// ─── Request handler ─────────────────────────────────────────────
const activeLocks = new Set(); // prevent concurrent requests per session

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // Apply CORS headers to every response (localhost origins only)
  applyCors(req, res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/health
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const deep = url.searchParams.get('deep') === 'true';
    const lmUrl = `http://${process.env.LM_HOST || '127.0.0.1'}:${process.env.LM_PORT || '1235'}`;
    // Fetch model name server-side so the browser never has to make a cross-origin request to LM Studio
    let modelName = 'Unknown';
    try {
      const mr = await fetch(`${lmUrl}/v1/models`);
      if (mr.ok) {
        const md = await mr.json();
        modelName = md.data?.[0]?.id ?? 'Unknown';
      }
    } catch {}
    const result = { status: 'ok', version: '0.1.0', sessions: sessions.size, uptime: Math.floor(process.uptime()), lmUrl, modelName };
    if (deep) {
      const errors = await checkDeps();
      if (errors.length) { result.status = 'degraded'; result.errors = errors; }
    }
    sendJson(res, result.status === 'ok' ? 200 : 503, result);
    return;
  }

  // GET /api/sessions — list all active sessions
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const sessionList = [];
    for (const [id, entry] of sessions) {
      const firstUserMsg = entry.logs.find(l => l.type === 'user_message');
      const title = firstUserMsg ? firstUserMsg.text.slice(0, 50) : 'New conversation';
      const messageCount = entry.logs.filter(l => l.type === 'user_message').length;
      const lastLog = entry.logs.length ? entry.logs[entry.logs.length - 1] : null;
      const lastMessagePreview = lastLog?.text ? (lastLog.text.length > 80 ? lastLog.text.slice(0, 80) + '...' : lastLog.text) : '';
      sessionList.push({ id, title, created: entry.created, lastActive: entry.lastActive, messageCount, lastMessagePreview });
    }
    sessionList.sort((a, b) => b.lastActive - a.lastActive);
    sendJson(res, 200, { sessions: sessionList });
    return;
  }

  // GET /api/sessions/:id/logs
  const logsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/logs$/);
  if (req.method === 'GET' && logsMatch) {
    const entry = sessions.get(logsMatch[1]);
    if (!entry) { sendJson(res, 404, { error: 'Session not found' }); return; }
    const limit = parseInt(url.searchParams.get('limit') || '50');
    sendJson(res, 200, { logs: entry.logs.slice(-limit) });
    return;
  }

  // DELETE /api/sessions/:id — remove a session
  const deleteSessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteSessionMatch) {
    const id = deleteSessionMatch[1];
    if (!sessions.has(id)) { sendJson(res, 404, { error: 'Session not found' }); return; }
    sessions.delete(id);
    try { fs.unlinkSync(path.join(SESSIONS_DIR, `${id}.json`)); } catch {}
    sendJson(res, 200, { status: 'deleted', session_id: id });
    return;
  }

  // POST /api/chat/stream — SSE streaming endpoint
  if (req.method === 'POST' && url.pathname === '/api/chat/stream') {
    let body;
    try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

    const { message, session_id, project_id, working_dir } = body;
    if (!message || typeof message !== 'string') {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }

    const sid = session_id || `default-${randomUUID()}`;
    if (activeLocks.has(sid)) {
      sendJson(res, 429, { error: 'Session is busy.' });
      return;
    }

    // Set up SSE response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    activeLocks.add(sid);
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    const timeout = setTimeout(() => {
      abort.abort();
      sendSSE(res, 'error', { error: 'Timeout after 5 minutes' });
      res.end();
    }, 5 * 60 * 1000);

    try {
      // Create session with SSE-aware event handler
      const entry = getOrCreateSession(sid, project_id);
      const { session } = entry;
      const originalOnEvent = session.onEvent;
      session.onEvent = (event) => {
        originalOnEvent(event);
        if (!res.writableEnded) sendSSE(res, event.type, event);
      };
      session.signal = abort.signal;

      const response = await session.processMessage(message, {
        workingDir: working_dir || CHIMERA_DIR
      });

      // Restore original handler
      session.onEvent = originalOnEvent;

      if (!abort.signal.aborted && !res.writableEnded) {
        // Log the done event so session history hydration can reconstruct assistant messages
        const doneEvent = { type: 'done', response, session_id: sid, stats: session.getStats() };
        entry.logs.push({ ts: Date.now(), ...doneEvent });
        persistSession(sid);
        sendSSE(res, 'done', doneEvent);
        res.end();
      }
    } catch (e) {
      if (!res.writableEnded) {
        // Log the error event for session history hydration
        const entry = sessions.get(sid);
        if (entry) entry.logs.push({ ts: Date.now(), type: 'error', error: e.message });
        sendSSE(res, 'error', { error: e.message });
        res.end();
      }
    } finally {
      clearTimeout(timeout);
      activeLocks.delete(sid);
    }
    return;
  }

  // POST /api/chat
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body;
    try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

    const { message, session_id, project_id, working_dir } = body;
    if (!message || typeof message !== 'string') {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }

    const sid = session_id || `default-${randomUUID()}`;

    // Prevent concurrent requests for the same session
    if (activeLocks.has(sid)) {
      sendJson(res, 429, { error: 'Session is busy processing another message. Wait for the current response.' });
      return;
    }

    activeLocks.add(sid);
    const abort = new AbortController();
    req.on('close', () => { if (!res.writableEnded) abort.abort(); });

    // Server-side timeout: 5 minutes max per request
    const timeout = setTimeout(() => {
      abort.abort();
      if (!res.writableEnded) {
        console.log(`[${new Date().toISOString().slice(11,19)}] [${sid}] TIMEOUT after 5 min`);
        sendJson(res, 504, { error: 'Request timed out after 5 minutes', session_id: sid });
      }
    }, 5 * 60 * 1000);

    try {
      const entry = getOrCreateSession(sid, project_id);
      const { session } = entry;
      session.signal = abort.signal; // orchestrator checks this
      const response = await session.processMessage(message, {
        workingDir: working_dir || CHIMERA_DIR
      });

      if (abort.signal.aborted) {
        console.log(`[${new Date().toISOString().slice(11,19)}] [${sid}] CANCELLED by client disconnect`);
        return;
      }

      // Log the done event for session history hydration
      entry.logs.push({ ts: Date.now(), type: 'done', response, session_id: sid, stats: session.getStats() });
      persistSession(sid);

      sendJson(res, 200, {
        response,
        session_id: sid,
        stats: session.getStats(),
      });
    } catch (e) {
      if (abort.signal.aborted) {
        console.log(`[${new Date().toISOString().slice(11,19)}] [${sid}] CANCELLED by client disconnect`);
        return;
      }
      // Log the error event for session history hydration
      const entry = sessions.get(sid);
      if (entry) entry.logs.push({ ts: Date.now(), type: 'error', error: e.message });
      console.error(`[ERROR] ${sid}:`, e.message);
      sendJson(res, 500, { error: e.message });
    } finally {
      clearTimeout(timeout);
      activeLocks.delete(sid);
    }
    return;
  }

  // ─── RAG proxy — forwards /api/rag/* to the RAG stack ──────────
  const RAG_URL = process.env.RAG_URL || 'http://localhost:8080';

  if (url.pathname.startsWith('/api/rag/')) {
    const ragPath = url.pathname.replace('/api/rag', '/api');
    const ragUrl = `${RAG_URL}${ragPath}${url.search}`;

    try {
      const headers = {};
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

      // Collect request body for POST/PUT/DELETE
      let body = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = Buffer.concat(chunks);
      }

      const upstream = await fetch(ragUrl, {
        method: req.method,
        headers,
        body,
      });

      const responseBody = await upstream.arrayBuffer();
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      });
      res.end(Buffer.from(responseBody));
    } catch (e) {
      sendJson(res, 502, { error: `RAG proxy error: ${e.message}` });
    }
    return;
  }

  // Non-API routes: static files or SPA fallback
  serveStatic(req, res, url.pathname);
}

// ─── Server ──────────────────────────────────────────────────────
const server = http.createServer(handleRequest);

loadPersistedSessions();

server.listen(PORT, HOST, () => {
  console.log(`\n  Chimera Chat Server`);
  console.log(`  ───────────────────`);
  console.log(`  Listening: http://${HOST}:${PORT}`);
  console.log(`  LM Studio: http://${process.env.LM_HOST || '127.0.0.1'}:${process.env.LM_PORT || '1235'}`);
  console.log(`  RAG:       ${process.env.RAG_URL || 'http://localhost:8080'}`);
  console.log(`\n  POST /api/chat         { message, session_id?, project_id?, working_dir? }`);
  console.log(`  POST /api/chat/stream  Same as /api/chat but returns SSE events`);
  console.log(`  GET  /api/health       ?deep=true to check dependencies`);
  console.log(`  GET  /api/sessions             List all sessions (sorted by lastActive)`);
  console.log(`  DELETE /api/sessions/:id       Delete a session`);
  console.log(`  GET  /api/sessions/:id/logs`);
  console.log(`  *    /api/rag/*            Proxied to RAG stack\n`);

  // Warn if exposed beyond localhost — Chimera has no authentication
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    console.warn(`  ⚠  WARNING: CHIMERA_HOST=${HOST} — server is exposed beyond localhost.`);
    console.warn(`     Chimera has no authentication. Do not expose on a public network.\n`);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is in use. Set CHIMERA_PORT env var.`);
  } else {
    console.error('Server error:', e);
  }
  process.exit(1);
});
