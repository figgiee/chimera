// ═══════════════════════════════════════════════════════════════════
// Chimera Chat Server — HTTP endpoint wrapping the orchestrator
//
// POST /chat   { message, session_id?, project_id?, working_dir? }
// GET  /health
// GET  /sessions/:id/stats
//
// Manages multiple concurrent sessions. Each session_id gets its own
// ChimeraSession with independent message history and Synapse state.
// ═══════════════════════════════════════════════════════════════════

const http = require('node:http');
const { ChimeraSession } = require('./chimera-orchestrator');

const PORT = parseInt(process.env.CHIMERA_PORT || '3210');
const HOST = process.env.CHIMERA_HOST || '127.0.0.1';

// ─── Session store ───────────────────────────────────────────────
const sessions = new Map();  // session_id → { session, created, lastActive, logs }
const MAX_SESSIONS = 20;
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours

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

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

// ─── Request handler ─────────────────────────────────────────────
const activeLocks = new Set(); // prevent concurrent requests per session

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      sessions: sessions.size,
      uptime: Math.floor(process.uptime()),
    });
    return;
  }

  // GET /sessions/:id/stats
  const statsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/stats$/);
  if (req.method === 'GET' && statsMatch) {
    const entry = sessions.get(statsMatch[1]);
    if (!entry) { sendJson(res, 404, { error: 'Session not found' }); return; }
    sendJson(res, 200, {
      ...entry.session.getStats(),
      created: entry.created,
      lastActive: entry.lastActive,
      logCount: entry.logs.length,
    });
    return;
  }

  // GET /sessions/:id/logs
  const logsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/logs$/);
  if (req.method === 'GET' && logsMatch) {
    const entry = sessions.get(logsMatch[1]);
    if (!entry) { sendJson(res, 404, { error: 'Session not found' }); return; }
    const limit = parseInt(url.searchParams.get('limit') || '50');
    sendJson(res, 200, { logs: entry.logs.slice(-limit) });
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url.pathname === '/chat') {
    let body;
    try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

    const { message, session_id, project_id, working_dir } = body;
    if (!message || typeof message !== 'string') {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }

    const sid = session_id || `default-${Date.now()}`;

    // Prevent concurrent requests for the same session
    if (activeLocks.has(sid)) {
      sendJson(res, 429, { error: 'Session is busy processing another message. Wait for the current response.' });
      return;
    }

    activeLocks.add(sid);
    try {
      const { session } = getOrCreateSession(sid, project_id);
      const response = await session.processMessage(message, {
        workingDir: working_dir || 'C:/Users/sandv/Desktop/chimera'
      });

      sendJson(res, 200, {
        response,
        session_id: sid,
        stats: session.getStats(),
      });
    } catch (e) {
      console.error(`[ERROR] ${sid}:`, e.message);
      sendJson(res, 500, { error: e.message });
    } finally {
      activeLocks.delete(sid);
    }
    return;
  }

  // 404
  sendJson(res, 404, { error: 'Not found. Endpoints: POST /chat, GET /health, GET /sessions/:id/stats' });
}

// ─── Server ──────────────────────────────────────────────────────
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`\n  Chimera Chat Server`);
  console.log(`  ───────────────────`);
  console.log(`  Listening: http://${HOST}:${PORT}`);
  console.log(`  LM Studio: http://${process.env.LM_HOST || '127.0.0.1'}:${process.env.LM_PORT || '1235'}`);
  console.log(`  RAG:       ${process.env.RAG_URL || 'http://localhost:8080'}`);
  console.log(`\n  POST /chat  { message, session_id?, project_id?, working_dir? }`);
  console.log(`  GET  /health`);
  console.log(`  GET  /sessions/:id/stats`);
  console.log(`  GET  /sessions/:id/logs\n`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is in use. Set CHIMERA_PORT env var.`);
  } else {
    console.error('Server error:', e);
  }
  process.exit(1);
});
