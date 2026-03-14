// ═══════════════════════════════════════════════════════════════════
// Chimera RAG Server — embedded Node.js replacement for the Docker stack
//
// Replaces: PostgreSQL+pgvector, TEI, SearXNG, FastAPI RAG server
// Uses:     better-sqlite3 + sqlite-vec, Ollama embeddings, duck-duck-scrape
//
// Exposes same HTTP API as the Python FastAPI RAG server so the
// orchestrator, gateway, and synapse MCP need zero changes.
//
// GET  /health
// POST /api/search              { query, type:'web'|'documents', limit? }
// GET  /api/documents
// POST /api/documents           multipart/form-data file upload
// DELETE /api/documents/:id
// POST /api/conversations/store { conversation_id, role, content }
// POST /api/conversations/recall { query, limit? }
// POST /api/synapse/session     { project_id, mode, user_request }
// POST /api/synapse/discuss     { session_id, area_id, answer }
// GET  /api/synapse/task/:id
// POST /api/synapse/complete    { session_id, task_id, notes? }
// POST /api/synapse/escalate    { session_id, reason }
// GET  /api/synapse/resume/:id
// ═══════════════════════════════════════════════════════════════════

const http   = require('node:http');
const path   = require('node:path');
const { randomUUID } = require('node:crypto');

let Database, sqliteVec, Busboy;
try {
  Database  = require('better-sqlite3');
  sqliteVec = require('sqlite-vec');
  Busboy    = require('busboy');
} catch {
  // Deps not installed yet — will be caught in startRagServer
}

// ─── Config ──────────────────────────────────────────────────────────
const RAG_PORT    = parseInt(process.env.RAG_PORT  || '8080');
const RAG_HOST    = process.env.RAG_HOST            || '127.0.0.1';
const DB_PATH     = process.env.RAG_DB              || path.join(__dirname, 'chimera-rag.db');
const LM_HOST     = process.env.LM_HOST             || '127.0.0.1';
const LM_PORT_NUM = parseInt(process.env.LM_PORT    || '11434');

// Ollama embedding model. nomic-embed-text ships with Ollama and is
// excellent for RAG — pull it once with: ollama pull nomic-embed-text
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL  || 'nomic-embed-text';
const EMBED_DIM   = parseInt(process.env.OLLAMA_EMBED_DIM || '768');

// ─── Database ────────────────────────────────────────────────────────
let db;

function initDb() {
  db = new Database(DB_PATH);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id         TEXT PRIMARY KEY,
      filename   TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'file',
      created_at TEXT NOT NULL,
      content    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      chunk_id    TEXT PRIMARY KEY,
      doc_id      TEXT NOT NULL,
      content     TEXT NOT NULL,
      chunk_index INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
      chunk_id  TEXT PRIMARY KEY,
      embedding FLOAT[${EMBED_DIM}]
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_vectors USING vec0(
      conv_id   TEXT PRIMARY KEY,
      embedding FLOAT[${EMBED_DIM}]
    );

    CREATE TABLE IF NOT EXISTS synapse_sessions (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL,
      mode             TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'discussing',
      user_request     TEXT NOT NULL,
      decisions        TEXT NOT NULL DEFAULT '{}',
      plan             TEXT NOT NULL DEFAULT '[]',
      completed_tasks  TEXT NOT NULL DEFAULT '[]',
      current_wave     INTEGER NOT NULL DEFAULT 0,
      current_task     INTEGER NOT NULL DEFAULT 0,
      escalation_reason TEXT,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      handoff_summary TEXT NOT NULL DEFAULT ''
    );
  `);
}

// ─── Embedding service (via Ollama) ──────────────────────────────────
let embeddingAvailable = true;

async function embed(text) {
  try {
    const body = JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 2000) });
    const res = await fetch(`http://${LM_HOST}:${LM_PORT_NUM}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Ollama embedding ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.embedding)) throw new Error('No embedding in response');
    embeddingAvailable = true;
    return new Float32Array(data.embedding);
  } catch (e) {
    embeddingAvailable = false;
    throw e;
  }
}

// ─── Text chunking ───────────────────────────────────────────────────
const CHUNK_SIZE    = 500;
const CHUNK_OVERLAP = 80;

function chunkText(text) {
  const chunks = [];
  // Split on double newlines (paragraphs) first, then merge/split to target size
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (current.length + trimmed.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from end of current chunk
      current = current.slice(-CHUNK_OVERLAP) + ' ' + trimmed;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  // Further split any oversized chunks
  const result = [];
  for (const chunk of chunks) {
    if (chunk.length <= CHUNK_SIZE * 1.5) {
      result.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        result.push(chunk.slice(i, i + CHUNK_SIZE));
      }
    }
  }
  return result.filter(c => c.length > 20);
}

// ─── HTTP helpers ────────────────────────────────────────────────────
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

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

// ─── Document helpers ─────────────────────────────────────────────────
async function indexDocument(docId, content) {
  const chunks = chunkText(content);
  const insertChunk = db.prepare(
    'INSERT OR REPLACE INTO document_chunks(chunk_id, doc_id, content, chunk_index) VALUES (?,?,?,?)'
  );
  const insertVec = db.prepare(
    'INSERT OR REPLACE INTO chunk_vectors(chunk_id, embedding) VALUES (?,?)'
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${docId}_chunk_${i}`;
    insertChunk.run(chunkId, docId, chunks[i], i);
    try {
      const vec = await embed(chunks[i]);
      insertVec.run(chunkId, Buffer.from(vec.buffer));
    } catch {
      // Store chunk without vector — search will skip it
    }
  }
}

// ─── Web search (duck-duck-scrape, ESM via dynamic import) ───────────
let _ddg;
async function webSearch(query, limit = 5) {
  if (!_ddg) {
    try {
      _ddg = await import('duck-duck-scrape');
    } catch {
      return [{ title: 'Web search unavailable', url: '', snippet: 'Run: npm install duck-duck-scrape' }];
    }
  }
  const { search, SafeSearchType } = _ddg;
  try {
    const results = await search(query, { safeSearch: SafeSearchType.MODERATE });
    return (results.results || []).slice(0, limit).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || '',
    }));
  } catch (e) {
    return [{ title: 'Search error', url: '', snippet: e.message }];
  }
}

// ─── Route handlers ──────────────────────────────────────────────────

// GET /health
async function handleHealth(_req, res) {
  sendJson(res, 200, {
    status: 'ok',
    embed_model: EMBED_MODEL,
    embed_available: embeddingAvailable,
    db: DB_PATH,
  });
}

// GET /api/documents
function handleListDocuments(_req, res) {
  const docs = db.prepare(
    'SELECT id, filename, source_type, created_at, substr(content,1,200) as content_preview FROM documents ORDER BY created_at DESC'
  ).all();
  sendJson(res, 200, { documents: docs });
}

// DELETE /api/documents/:id
function handleDeleteDocument(_req, res, docId) {
  const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(docId);
  if (!doc) { sendJson(res, 404, { error: 'Document not found' }); return; }

  const chunkIds = db.prepare('SELECT chunk_id FROM document_chunks WHERE doc_id = ?').all(docId).map(r => r.chunk_id);
  const tx = db.transaction(() => {
    if (chunkIds.length) {
      const ph = chunkIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM chunk_vectors WHERE chunk_id IN (${ph})`).run(...chunkIds);
      db.prepare('DELETE FROM document_chunks WHERE doc_id = ?').run(docId);
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  });
  tx();
  sendJson(res, 200, { status: 'deleted', id: docId });
}

// POST /api/documents (multipart upload)
async function handleUploadDocument(req, res) {
  let filename = 'unknown';
  let fileContent = '';

  try {
    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
      bb.on('file', (_fieldname, file, info) => {
        filename = info.filename || 'upload';
        const chunks = [];
        file.on('data', d => chunks.push(d));
        file.on('end', () => { fileContent = Buffer.concat(chunks).toString('utf-8'); });
      });
      bb.on('finish', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });
  } catch (e) {
    sendJson(res, 400, { error: `Upload error: ${e.message}` });
    return;
  }

  if (!fileContent.trim()) {
    sendJson(res, 400, { error: 'Empty or unreadable file' });
    return;
  }

  const docId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO documents(id, filename, source_type, created_at, content) VALUES (?,?,?,?,?)'
  ).run(docId, filename, 'file', now, fileContent);

  // Index in background — don't block the upload response
  indexDocument(docId, fileContent).catch(e =>
    console.error(`[rag] indexing failed for ${docId}:`, e.message)
  );

  sendJson(res, 200, { id: docId, filename, created_at: now });
}

// POST /api/search { query, type: 'web'|'documents', limit?, threshold? }
async function handleSearch(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { query, type = 'documents', limit = 5 } = body;
  if (!query) { sendJson(res, 400, { error: 'query required' }); return; }

  if (type === 'web') {
    const results = await webSearch(query, limit);
    sendJson(res, 200, { results, type: 'web' });
    return;
  }

  // Document vector search
  let queryVec;
  try {
    queryVec = await embed(query);
  } catch {
    sendJson(res, 200, { results: [], type: 'documents', note: 'Ollama embedding unavailable' });
    return;
  }

  const rows = db.prepare(`
    SELECT cv.chunk_id, cv.distance, dc.content, dc.doc_id
    FROM chunk_vectors cv
    JOIN document_chunks dc ON dc.chunk_id = cv.chunk_id
    WHERE cv.embedding MATCH ?
    ORDER BY cv.distance
    LIMIT ?
  `).all(Buffer.from(queryVec.buffer), limit);

  const results = rows.map(r => {
    const doc = db.prepare('SELECT filename, source_type FROM documents WHERE id = ?').get(r.doc_id);
    return {
      chunk_id: r.chunk_id,
      content: r.content,
      score: 1 - r.distance,
      filename: doc?.filename || 'unknown',
      source_type: doc?.source_type || 'file',
    };
  });

  sendJson(res, 200, { results, type: 'documents' });
}

// POST /api/conversations/store { conversation_id, role, content }
async function handleConversationStore(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { conversation_id, role, content } = body;
  if (!conversation_id || !role || !content) {
    sendJson(res, 400, { error: 'conversation_id, role, content required' });
    return;
  }

  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    'INSERT INTO conversations(id, session_id, role, content, created_at) VALUES (?,?,?,?,?)'
  ).run(id, conversation_id, role, content, now);

  // Store vector in background
  embed(content).then(vec => {
    db.prepare('INSERT OR REPLACE INTO conversation_vectors(conv_id, embedding) VALUES (?,?)').run(
      id, Buffer.from(vec.buffer)
    );
  }).catch(() => {});

  sendJson(res, 200, { status: 'stored', id });
}

// POST /api/conversations/recall { query, limit? }
async function handleConversationRecall(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { query, limit = 5 } = body;
  if (!query) { sendJson(res, 400, { error: 'query required' }); return; }

  let queryVec;
  try {
    queryVec = await embed(query);
  } catch {
    sendJson(res, 200, { results: [], note: 'Ollama embedding unavailable' });
    return;
  }

  const rows = db.prepare(`
    SELECT cv.conv_id, cv.distance, c.role, c.content, c.session_id, c.created_at
    FROM conversation_vectors cv
    JOIN conversations c ON c.id = cv.conv_id
    WHERE cv.embedding MATCH ?
    ORDER BY cv.distance
    LIMIT ?
  `).all(Buffer.from(queryVec.buffer), limit);

  sendJson(res, 200, { results: rows.map(r => ({
    id: r.conv_id,
    role: r.role,
    content: r.content,
    session_id: r.session_id,
    score: 1 - r.distance,
    created_at: r.created_at,
  })) });
}

// ─── Project handlers ─────────────────────────────────────────────────

// GET /api/projects
function handleListProjects(_req, res) {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  sendJson(res, 200, { projects });
}

// POST /api/projects { name, description? }
async function handleCreateProject(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
  const { name, description = '' } = body;
  if (!name?.trim()) { sendJson(res, 400, { error: 'name required' }); return; }
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO projects(id, name, description, created_at, updated_at, handoff_summary) VALUES (?,?,?,?,?,?)')
    .run(id, name.trim(), description, now, now, '');
  sendJson(res, 200, db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

// GET /api/projects/:id
function handleGetProject(_req, res, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) { sendJson(res, 404, { error: 'Project not found' }); return; }
  sendJson(res, 200, project);
}

// PATCH /api/projects/:id { name?, description?, handoff_summary? }
async function handleUpdateProject(req, res, projectId) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) { sendJson(res, 404, { error: 'Project not found' }); return; }
  const updates = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = String(body.description);
  if (body.handoff_summary !== undefined) updates.handoff_summary = String(body.handoff_summary).slice(0, 1000);
  if (!Object.keys(updates).length) { sendJson(res, 200, db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)); return; }
  const keys = Object.keys(updates);
  db.prepare(`UPDATE projects SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map(k => updates[k]), Date.now(), projectId);
  sendJson(res, 200, db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId));
}

// DELETE /api/projects/:id
function handleDeleteProject(_req, res, projectId) {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) { sendJson(res, 404, { error: 'Project not found' }); return; }
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  sendJson(res, 200, { status: 'deleted', id: projectId });
}

// ─── Synapse engine ───────────────────────────────────────────────────

const MODES = {
  feature: {
    id: 'feature', name: 'Feature Addition',
    description: 'Add new functionality to the codebase',
    discussion_areas: [
      { id: 'scope',        label: 'Scope',        question: 'What exactly should this feature do? What are the boundaries?',    required: true  },
      { id: 'interface',    label: 'Interface',    question: 'How will users interact with this? What is the API surface?',      required: true  },
      { id: 'dependencies', label: 'Dependencies', question: 'Does this require new libraries or external services?',            required: false },
      { id: 'testing',      label: 'Testing',      question: 'What test coverage is needed? Any edge cases to consider?',       required: false },
    ],
    verification_criteria: ['Feature works as specified', 'Tests pass', 'No regressions', 'API documented if public'],
  },
  refactor: {
    id: 'refactor', name: 'Code Refactor',
    description: 'Restructure existing code without changing behavior',
    discussion_areas: [
      { id: 'scope',           label: 'Scope',           question: 'What code needs restructuring? Target architecture?',     required: true  },
      { id: 'api-preservation', label: 'API Preservation', question: 'Which public interfaces must remain unchanged?',         required: true  },
      { id: 'testing',         label: 'Testing',         question: 'How will you verify behavior is unchanged?',              required: false },
    ],
    verification_criteria: ['All tests still pass', 'Public API unchanged', 'Target architecture met'],
  },
  bugfix: {
    id: 'bugfix', name: 'Bug Fix',
    description: 'Diagnose and fix a specific bug',
    discussion_areas: [
      { id: 'reproduction', label: 'Reproduction', question: 'How do you reproduce this? Expected vs actual behavior?', required: true  },
      { id: 'scope',        label: 'Scope',        question: 'Is this a single bug or symptom of a larger issue?',     required: true  },
      { id: 'root-cause',   label: 'Root Cause',   question: 'Any idea what is causing it? Where in the code?',       required: false },
    ],
    verification_criteria: ['Bug no longer reproducible', 'Regression test added', 'Root cause documented'],
  },
  research: {
    id: 'research', name: 'Research & Investigation',
    description: 'Explore a technical question or evaluate options',
    discussion_areas: [
      { id: 'question',    label: 'Research Question', question: 'What specific question are you trying to answer?',              required: true  },
      { id: 'constraints', label: 'Constraints',       question: 'What constraints apply? (performance, compatibility, cost)',    required: false },
      { id: 'deliverable', label: 'Deliverable',       question: 'What form should the answer take? (doc, prototype, summary?)', required: false },
    ],
    verification_criteria: ['Research question answered with evidence', 'Constraints addressed', 'Deliverable produced'],
  },
  debug: {
    id: 'debug', name: 'Debug Session',
    description: 'Systematic debugging with hypothesis tracking',
    discussion_areas: [
      { id: 'symptoms',    label: 'Symptoms',        question: 'What is going wrong? Error messages, unexpected behavior?',                          required: true  },
      { id: 'environment', label: 'Environment',     question: 'Where does this happen? OS, runtime, versions, config?',                            required: true  },
      { id: 'changes',     label: 'Recent Changes',  question: 'What changed recently before this started? Deployments, updates, config changes?',  required: false },
    ],
    verification_criteria: ['Root cause identified', 'Fix verified or workaround documented', 'Steps to reproduce documented'],
  },
};

// Map mode aliases used by the orchestrator to canonical mode IDs
const MODE_ALIASES = { build: 'feature', plan: 'feature', implement: 'feature' };

function resolveMode(mode) {
  return MODE_ALIASES[mode] || mode;
}

const DELEGATION_PHRASES = [
  'you decide', 'your call', 'up to you', 'whatever you think',
  'your choice', 'auto', 'default', 'skip', 'dont care', "don't care",
];

function getNextQuestion(session) {
  const mode = MODES[session.mode];
  if (!mode) return null;
  const decisions = JSON.parse(session.decisions || '{}');
  for (const area of mode.discussion_areas) {
    if (decisions[area.id]) continue;
    if (area.required) return { area_id: area.id, label: area.label, question: area.question };
    // Optional areas — include only if user request seems relevant (simple keyword check)
    const keywords = area.label.toLowerCase().split(/\s+/);
    const req = session.user_request.toLowerCase();
    if (keywords.some(k => req.includes(k))) {
      return { area_id: area.id, label: area.label, question: area.question };
    }
  }
  return null;
}

function generatePlan(modeId, decisions, userRequest) {
  const mode = MODES[modeId];
  if (!mode) return [];
  const tasks = [];
  const d = decisions;

  if (modeId === 'feature') {
    const scope = d.scope?.answer || userRequest;
    const iface = d.interface?.answer || '';
    tasks.push({ id: 'task-1', description: `Implement core logic: ${scope.slice(0, 200)}`, status: 'pending', notes: '' });
    if (iface) tasks.push({ id: 'task-2', description: `Wire up interface: ${iface.slice(0, 200)}`, status: 'pending', notes: '' });
    tasks.push({ id: 'task-3', description: 'Write tests for the new feature', status: 'pending', notes: '' });
    if (d.dependencies?.answer && !d.dependencies.delegated) {
      tasks.push({ id: 'task-deps', description: `Install/configure: ${d.dependencies.answer.slice(0, 150)}`, status: 'pending', notes: '' });
    }
  } else if (modeId === 'bugfix') {
    const repro = d.reproduction?.answer || userRequest;
    const root  = d['root-cause']?.answer || '';
    tasks.push({ id: 'task-1', description: `Reproduce the bug: ${repro.slice(0, 200)}`, status: 'pending', notes: '' });
    tasks.push({ id: 'task-2', description: root ? `Fix root cause: ${root.slice(0, 200)}` : `Identify and fix root cause`, status: 'pending', notes: '' });
    tasks.push({ id: 'task-3', description: 'Add regression test to prevent recurrence', status: 'pending', notes: '' });
  } else if (modeId === 'refactor') {
    const scope  = d.scope?.answer || userRequest;
    const apiPres = d['api-preservation']?.answer || '';
    tasks.push({ id: 'task-1', description: `Restructure: ${scope.slice(0, 200)}`, status: 'pending', notes: '' });
    if (apiPres) tasks.push({ id: 'task-2', description: `Verify API unchanged: ${apiPres.slice(0, 150)}`, status: 'pending', notes: '' });
    tasks.push({ id: 'task-3', description: 'Run existing tests to confirm no behavior change', status: 'pending', notes: '' });
  } else if (modeId === 'research') {
    const question    = d.question?.answer || userRequest;
    const deliverable = d.deliverable?.answer || 'summary document';
    const constraints = d.constraints?.answer || '';
    tasks.push({ id: 'task-1', description: `Research: ${question.slice(0, 200)}`, status: 'pending', notes: '' });
    if (constraints) tasks.push({ id: 'task-2', description: `Evaluate against constraints: ${constraints.slice(0, 150)}`, status: 'pending', notes: '' });
    tasks.push({ id: 'task-3', description: `Produce deliverable: ${deliverable.slice(0, 150)}`, status: 'pending', notes: '' });
  } else if (modeId === 'debug') {
    const symptoms = d.symptoms?.answer || userRequest;
    const env      = d.environment?.answer || '';
    tasks.push({ id: 'task-1', description: `Investigate symptoms: ${symptoms.slice(0, 200)}`, status: 'pending', notes: '' });
    if (env) tasks.push({ id: 'task-2', description: `Check environment: ${env.slice(0, 150)}`, status: 'pending', notes: '' });
    tasks.push({ id: 'task-3', description: 'Isolate root cause and document findings', status: 'pending', notes: '' });
    tasks.push({ id: 'task-4', description: 'Document steps to reproduce for future reference', status: 'pending', notes: '' });
  } else {
    mode.verification_criteria.forEach((c, i) =>
      tasks.push({ id: `task-${i+1}`, description: c, status: 'pending', notes: '' })
    );
  }

  // Verification wave
  mode.verification_criteria.forEach((c, i) =>
    tasks.push({ id: `verify-${i+1}`, description: `[verify] ${c}`, status: 'pending', notes: '' })
  );

  // Group into waves of 3
  const waves = [];
  for (let i = 0; i < tasks.length; i += 3) {
    waves.push({ wave: waves.length + 1, tasks: tasks.slice(i, i + 3) });
  }
  return waves;
}

function buildTaskContext(session) {
  const plan      = JSON.parse(session.plan || '[]');
  const decisions = JSON.parse(session.decisions || '{}');
  const completed = JSON.parse(session.completed_tasks || '[]');
  const mode      = MODES[session.mode] || {};

  if (!plan.length || session.current_wave >= plan.length) {
    return { status: 'no_task', message: 'All tasks completed or no plan generated' };
  }
  const wave  = plan[session.current_wave];
  const tasks = wave?.tasks || [];
  const task  = tasks[session.current_task];
  if (!task) return { status: 'no_task', message: 'No current task' };

  const totalTasks = plan.reduce((s, w) => s + w.tasks.length, 0);
  const keyDecisions = {};
  for (const [k, v] of Object.entries(decisions)) {
    if (!v.delegated) keyDecisions[k] = (v.answer || '').slice(0, 150);
  }

  return {
    mode: mode.name || session.mode,
    request: session.user_request.slice(0, 300),
    wave: session.current_wave + 1,
    total_waves: plan.length,
    task,
    progress: `${completed.length}/${totalTasks} tasks done`,
    ...(Object.keys(keyDecisions).length ? { decisions: keyDecisions } : {}),
  };
}

// DB helpers for synapse
const stmtGetSession = () => db.prepare('SELECT * FROM synapse_sessions WHERE id = ?');

function updateSession(id, fields) {
  const keys = Object.keys(fields);
  const vals = keys.map(k => fields[k]);
  db.prepare(`UPDATE synapse_sessions SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...vals, Date.now(), id);
}

// POST /api/synapse/session
async function handleSynapseSession(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { project_id = 'chimera', mode: rawMode, user_request } = body;
  const mode = resolveMode(rawMode);

  if (!MODES[mode]) {
    sendJson(res, 400, { error: `Unknown mode: ${rawMode}. Available: ${Object.keys(MODES).join(', ')}` });
    return;
  }
  if (!user_request) { sendJson(res, 400, { error: 'user_request required' }); return; }

  const id  = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO synapse_sessions(id, project_id, mode, status, user_request, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, project_id, mode, 'discussing', user_request, now, now);

  const session  = stmtGetSession().get(id);
  const question = getNextQuestion(session);

  sendJson(res, 200, {
    session_id: id,
    mode: MODES[mode].name,
    status: 'discussing',
    question,
  });
}

// POST /api/synapse/discuss
async function handleSynapseDiscuss(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { session_id, area_id, answer } = body;
  if (!session_id || !area_id || answer === undefined) {
    sendJson(res, 400, { error: 'session_id, area_id, answer required' });
    return;
  }

  const session = stmtGetSession().get(session_id);
  if (!session) { sendJson(res, 404, { error: 'Session not found' }); return; }
  if (session.status !== 'discussing') {
    sendJson(res, 400, { error: `Session is '${session.status}', not discussing` });
    return;
  }

  const decisions = JSON.parse(session.decisions || '{}');
  const delegated = DELEGATION_PHRASES.some(p => answer.toLowerCase().includes(p));
  decisions[area_id] = { answer, delegated, timestamp: new Date().toISOString() };

  updateSession(session_id, { decisions: JSON.stringify(decisions) });
  const updated = stmtGetSession().get(session_id);
  const question = getNextQuestion(updated);

  if (question) {
    sendJson(res, 200, { session_id, status: 'discussing', question });
    return;
  }

  // All questions resolved — generate plan and move to executing
  const plan = generatePlan(session.mode, decisions, session.user_request);
  updateSession(session_id, {
    status: 'executing',
    plan: JSON.stringify(plan),
    current_wave: 0,
    current_task: 0,
  });

  sendJson(res, 200, {
    session_id,
    status: 'executing',
    message: 'Discussion complete. Plan generated.',
    plan_summary: {
      waves: plan.length,
      total_tasks: plan.reduce((s, w) => s + w.tasks.length, 0),
    },
  });
}

// GET /api/synapse/task/:id
function handleSynapseGetTask(_req, res, sessionId) {
  const session = stmtGetSession().get(sessionId);
  if (!session) { sendJson(res, 404, { error: 'Session not found' }); return; }
  if (!['executing', 'paused'].includes(session.status)) {
    sendJson(res, 400, { error: `Session is '${session.status}', not executing` });
    return;
  }
  sendJson(res, 200, buildTaskContext(session));
}

// POST /api/synapse/complete
async function handleSynapseComplete(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { session_id, task_id, notes = '' } = body;
  if (!session_id || !task_id) { sendJson(res, 400, { error: 'session_id, task_id required' }); return; }

  const session = stmtGetSession().get(session_id);
  if (!session) { sendJson(res, 404, { error: 'Session not found' }); return; }

  const plan      = JSON.parse(session.plan || '[]');
  const completed = JSON.parse(session.completed_tasks || '[]');
  completed.push({ task_id, notes: notes.slice(0, 500), completed_at: new Date().toISOString() });

  let wave = session.current_wave;
  let taskIdx = session.current_task;
  if (plan.length && wave < plan.length) {
    const waveTasks = plan[wave]?.tasks || [];
    if (taskIdx + 1 < waveTasks.length) {
      taskIdx++;
    } else {
      wave++;
      taskIdx = 0;
    }
  }

  const totalTasks = plan.reduce((s, w) => s + w.tasks.length, 0);
  const isDone = completed.length >= totalTasks;
  const newStatus = isDone ? 'completed' : 'executing';

  updateSession(session_id, {
    completed_tasks: JSON.stringify(completed),
    current_wave: wave,
    current_task: taskIdx,
    status: newStatus,
  });

  if (isDone) {
    const mode = MODES[session.mode] || {};
    sendJson(res, 200, {
      session_id,
      status: 'completed',
      message: 'All tasks completed.',
      verification_criteria: mode.verification_criteria || [],
      total_completed: completed.length,
    });
    return;
  }

  sendJson(res, 200, {
    session_id,
    status: 'executing',
    completed_count: completed.length,
    total_tasks: totalTasks,
    next_wave: wave + 1,
    next_task_index: taskIdx,
  });
}

// POST /api/synapse/escalate
async function handleSynapseEscalate(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const { session_id, reason } = body;
  if (!session_id || !reason) { sendJson(res, 400, { error: 'session_id, reason required' }); return; }

  const session = stmtGetSession().get(session_id);
  if (!session) { sendJson(res, 404, { error: 'Session not found' }); return; }

  updateSession(session_id, { status: 'escalated', escalation_reason: reason.slice(0, 500) });
  sendJson(res, 200, {
    session_id,
    status: 'escalated',
    reason,
    message: 'Session paused. Resolve the issue and resume.',
  });
}

// GET /api/synapse/resume/:id
function handleSynapseResume(_req, res, sessionId) {
  const session = stmtGetSession().get(sessionId);
  if (!session) { sendJson(res, 404, { error: 'Session not found' }); return; }

  let status = session.status;
  if (status === 'escalated') {
    const plan = JSON.parse(session.plan || '[]');
    status = plan.length ? 'executing' : 'discussing';
    updateSession(sessionId, { status, escalation_reason: null });
  }

  const plan      = JSON.parse(session.plan || '[]');
  const completed = JSON.parse(session.completed_tasks || '[]');
  const total     = plan.reduce((s, w) => s + w.tasks.length, 0);

  const context = {
    session_id: session.id,
    mode: session.mode,
    status,
    request: session.user_request.slice(0, 300),
    progress: `${completed.length}/${total} tasks done`,
    current_wave: session.current_wave + 1,
    escalation: session.escalation_reason,
  };

  if (status === 'executing') {
    context.current_task = buildTaskContext({ ...session, status });
  }

  sendJson(res, 200, context);
}

// ─── Main request router ──────────────────────────────────────────────
async function handleRagRequest(req, res) {
  const url = new URL(req.url, `http://${RAG_HOST}:${RAG_PORT}`);
  const p   = url.pathname;

  // Health
  if (req.method === 'GET' && p === '/health') {
    await handleHealth(req, res); return;
  }

  // Documents
  if (req.method === 'GET'    && p === '/api/documents')               { handleListDocuments(req, res);  return; }
  if (req.method === 'POST'   && p === '/api/documents')               { await handleUploadDocument(req, res); return; }

  const deleteMatch = p.match(/^\/api\/documents\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch)                          { handleDeleteDocument(req, res, deleteMatch[1]); return; }

  // Search
  if (req.method === 'POST'   && p === '/api/search')                  { await handleSearch(req, res); return; }

  // Conversations
  if (req.method === 'POST'   && p === '/api/conversations/store')     { await handleConversationStore(req, res); return; }
  if (req.method === 'POST'   && p === '/api/conversations/recall')    { await handleConversationRecall(req, res); return; }

  // Projects
  if (req.method === 'GET'  && p === '/api/projects') { handleListProjects(req, res); return; }
  if (req.method === 'POST' && p === '/api/projects') { await handleCreateProject(req, res); return; }
  const projectMatch = p.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    if (req.method === 'GET')    { handleGetProject(req, res, projectMatch[1]);          return; }
    if (req.method === 'PATCH')  { await handleUpdateProject(req, res, projectMatch[1]); return; }
    if (req.method === 'DELETE') { handleDeleteProject(req, res, projectMatch[1]);        return; }
  }

  // Synapse
  if (req.method === 'POST'   && p === '/api/synapse/session')         { await handleSynapseSession(req, res);  return; }
  if (req.method === 'POST'   && p === '/api/synapse/discuss')         { await handleSynapseDiscuss(req, res);  return; }
  if (req.method === 'POST'   && p === '/api/synapse/complete')        { await handleSynapseComplete(req, res); return; }
  if (req.method === 'POST'   && p === '/api/synapse/escalate')        { await handleSynapseEscalate(req, res); return; }

  const taskMatch   = p.match(/^\/api\/synapse\/task\/([^/]+)$/);
  const resumeMatch = p.match(/^\/api\/synapse\/resume\/([^/]+)$/);
  if (req.method === 'GET'    && taskMatch)                            { handleSynapseGetTask(req, res, taskMatch[1]); return; }
  if (req.method === 'GET'    && resumeMatch)                         { handleSynapseResume(req, res, resumeMatch[1]); return; }

  sendJson(res, 404, { error: 'Not found' });
}

// ─── Exported start function ──────────────────────────────────────────
function startRagServer() {
  return new Promise((resolve, reject) => {
    if (!Database || !sqliteVec || !Busboy) {
      return reject(new Error(
        'RAG dependencies missing. Run: npm install better-sqlite3 sqlite-vec busboy duck-duck-scrape'
      ));
    }
    try {
      initDb();
    } catch (e) {
      return reject(new Error(`RAG database init failed: ${e.message}`));
    }

    const server = http.createServer((req, res) => {
      handleRagRequest(req, res).catch(e => {
        if (!res.writableEnded) sendJson(res, 500, { error: e.message });
      });
    });

    server.listen(RAG_PORT, RAG_HOST, () => {
      console.log(`  RAG:       http://${RAG_HOST}:${RAG_PORT} (sqlite-vec + Ollama embeddings)`);
      console.log(`  Embed:     ${EMBED_MODEL} — pull with: ollama pull ${EMBED_MODEL}`);
      resolve(server);
    });

    server.on('error', reject);
  });
}

module.exports = { startRagServer };
