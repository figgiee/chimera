// ═══════════════════════════════════════════════════════════════════
// Chimera Orchestrator — GSD-style intent routing + task execution
//
// Sits between user and LM Studio. Detects intent from user messages,
// auto-starts Synapse workflows, drives Q&A and task execution,
// handles loop detection, and auto-saves conversation summaries.
// ═══════════════════════════════════════════════════════════════════

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// ─── Config ───────────────────────────────────────────────────────
const LM_HOST = process.env.LM_HOST || '127.0.0.1';
const LM_PORT = parseInt(process.env.LM_PORT || '1235');
const LM_PATH = '/v1/chat/completions';
const LM_MODEL = process.env.LM_MODEL || 'qwen/qwen3.5-9b';
const RAG_URL = process.env.RAG_URL || 'http://localhost:8080';
const ALLOWED_DIRS = (process.env.ALLOWED_DIRS || 'C:/Users/sandv/Desktop,C:/Users/sandv/Documents,C:/Users/sandv/Downloads').split(',');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lmAgent = new http.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 1 });

// ─── LLM tool definitions ────────────────────────────────────────
const TOOLS = [
  { type: "function", function: { name: "find_tool", description: "Search for available tools by keyword.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "call_tool", description: "Execute a tool by name.", parameters: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object" } }, required: ["name"] } } }
];

// ─── HTTP helpers ─────────────────────────────────────────────────
function httpPost(host, port, reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: host, port, path: reqPath, method: 'POST', agent: lmAgent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`JSON parse error`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.end(data);
  });
}

// ─── Security ─────────────────────────────────────────────────────
const SENSITIVE_PATTERNS = [
  /\.env$/i, /\.env\./i, /\.key$/i, /\.pem$/i,
  /credential/i, /secret/i, /\.ssh[/\\]/i, /id_rsa/i,
];

const COMMAND_ALLOWLIST = [
  'node', 'npm', 'npx', 'git', 'ls', 'dir', 'cat', 'type',
  'head', 'tail', 'grep', 'rg', 'find', 'wc', 'echo', 'mkdir',
  'cp', 'copy', 'mv', 'move', 'touch', 'sed', 'awk', 'sort',
  'python', 'pip', 'docker', 'docker-compose',
];

function isPathAllowed(p) {
  const resolved = path.resolve(p);
  return ALLOWED_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
}

function isSensitive(p) {
  return SENSITIVE_PATTERNS.some(pat => pat.test(path.resolve(p)));
}

function isCommandAllowed(cmd) {
  const first = cmd.trim().split(/[\s|;&]/)[0].replace(/^['"]|['"]$/g, '');
  const bin = path.basename(first).toLowerCase().replace(/\.(exe|cmd)$/, '');
  return COMMAND_ALLOWLIST.includes(bin);
}

// ─── Tool hints for find_tool ─────────────────────────────────────
const TOOL_HINTS = {
  web: "• web_search(query, limit?): Search the web via SearXNG",
  search: "• web_search(query): Search the web\n• search_documents(query): Search knowledge base\n• search_files(path, pattern): Find files by name",
  file: "• read_file(path): Read a file\n• write_file(path, content): Write/create a file\n• list_directory(path): List directory contents\n• search_files(path, pattern): Find files",
  read: "• read_file(path): Read a file from disk",
  write: "• write_file(path, content): Write/create a file on disk",
  run: "• run_command(command, cwd?): Run a shell command",
  command: "• run_command(command, cwd?): Run a terminal command",
  shell: "• run_command(command, cwd?): Run a shell command",
  terminal: "• run_command(command, cwd?): Run a terminal command",
  npm: "• run_command(command, cwd?): Run shell commands like npm, git, node",
  git: "• run_command(command, cwd?): Run shell commands like git, npm, node",
  remember: "• store_conversation(conversation_id, role, content): Save something to memory",
  recall: "• recall_conversation(query, limit?): Recall past conversations",
  memory: "• store_conversation(conversation_id, role, content): Save to memory\n• recall_conversation(query): Recall past context",
  document: "• upload_document(title, content): Add to knowledge base\n• search_documents(query): Search knowledge base\n• list_documents(): List all documents",
  upload: "• upload_document(title, content): Add text to searchable knowledge base",
  workflow: "• synapse_new_session(project_id, mode, user_request): Start a workflow\n• synapse_answer(session_id, area_id, answer): Answer a question\n• synapse_get_task(session_id): Get current task\n• synapse_complete_task(session_id, task_id, notes?): Mark task done",
  synapse: "• synapse_new_session, synapse_answer, synapse_get_task, synapse_complete_task, synapse_resume",
  plan: "• synapse_new_session(project_id, mode, user_request): Plan a feature, bugfix, or research task",
  build: "• synapse_new_session + write_file + run_command",
  feature: "• synapse_new_session(project_id, mode, user_request): Start a feature workflow",
  bug: "• synapse_new_session(project_id, mode, user_request): Start a bugfix workflow",
  task: "• synapse_get_task(session_id): Get current task\n• synapse_complete_task(session_id, task_id): Mark done",
  health: "• rag_health(): Check system health",
  status: "• rag_health(): Check system status",
  list: "• list_directory(path): List files in a directory\n• list_documents(): List all documents",
};

function findTools(query) {
  const q = query.toLowerCase();
  for (const [key, val] of Object.entries(TOOL_HINTS)) {
    if (q.includes(key)) return val;
  }
  return "Available: web, file, run (shell), memory, document, workflow, health. Try one of these keywords.";
}

// ─── Tool execution ───────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    case 'store_conversation':
      return fetch(`${RAG_URL}/api/conversations/store`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: args.conversation_id || 'chimera', role: args.role || 'user', content: args.content })
      }).then(r => r.json());
    case 'recall_conversation':
      return fetch(`${RAG_URL}/api/conversations/recall`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit: args.limit || 5 })
      }).then(r => r.json());
    case 'web_search':
      return fetch(`${RAG_URL}/api/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit: args.limit || 3, type: 'web' })
      }).then(r => r.json());
    case 'upload_document': {
      const title = args.title || args.filename || 'untitled';
      const content = args.content || '';
      const form = new FormData();
      form.append('file', new Blob([content], { type: 'text/plain' }), `${title}.txt`);
      return fetch(`${RAG_URL}/api/documents/upload`, { method: 'POST', body: form }).then(r => r.json());
    }
    case 'search_documents':
      return fetch(`${RAG_URL}/api/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit: args.limit || 3, threshold: 0.1, type: 'documents' })
      }).then(r => r.json());
    case 'list_documents':
      return fetch(`${RAG_URL}/api/documents`).then(r => r.json());
    case 'rag_health':
      return fetch(`${RAG_URL}/health`).then(r => r.json());
    case 'delete_document':
      return fetch(`${RAG_URL}/api/documents/${encodeURIComponent(args.document_id)}`, { method: 'DELETE' }).then(r => r.json());
    case 'read_file': {
      if (!args.path) throw new Error('path is required');
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      if (isSensitive(args.path)) throw new Error(`Blocked: ${path.basename(args.path)} contains sensitive data`);
      const content = fs.readFileSync(args.path, 'utf-8');
      return { path: args.path, content: content.slice(0, 10000) };
    }
    case 'write_file': {
      if (!args.path || !args.content) throw new Error('path and content are required');
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const dir = path.dirname(args.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(args.path, args.content, 'utf-8');
      return { path: args.path, status: 'written', bytes: Buffer.byteLength(args.content) };
    }
    case 'list_directory': {
      if (!args.path) throw new Error('path is required');
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const entries = fs.readdirSync(args.path, { withFileTypes: true });
      return { path: args.path, entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })) };
    }
    case 'search_files': {
      if (!args.path || !args.pattern) throw new Error('path and pattern are required');
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const regex = new RegExp(args.pattern, 'i');
      const results = [];
      function walk(dir, depth = 0) {
        if (depth > 5 || results.length >= 20) return;
        try {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (regex.test(e.name)) results.push(path.join(dir, e.name));
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(dir, e.name), depth + 1);
          }
        } catch {}
      }
      walk(args.path);
      return { pattern: args.pattern, matches: results };
    }
    case 'run_command': {
      if (!args.command) throw new Error('command is required');
      const cwd = args.cwd || 'C:/Users/sandv/Desktop';
      if (!isPathAllowed(cwd)) throw new Error(`Access denied: ${cwd}`);
      if (!isCommandAllowed(args.command)) throw new Error(`Command not allowed: "${args.command.split(/\s/)[0]}". Allowed: ${COMMAND_ALLOWLIST.slice(0, 8).join(', ')}...`);
      try {
        const output = execSync(args.command, { cwd, timeout: 30000, maxBuffer: 512 * 1024, encoding: 'utf-8', shell: true });
        return { command: args.command, cwd, output: output.slice(0, 5000) };
      } catch (e) {
        return { command: args.command, cwd, error: e.message.slice(0, 1000), exitCode: e.status };
      }
    }
    case 'synapse_new_session':
      return fetch(`${RAG_URL}/api/synapse/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: args.project_id || 'chimera', mode: args.mode, user_request: args.user_request })
      }).then(r => r.json());
    case 'synapse_answer':
      return fetch(`${RAG_URL}/api/synapse/discuss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: args.session_id, area_id: args.area_id, answer: args.answer })
      }).then(r => r.json());
    case 'synapse_get_task':
      return fetch(`${RAG_URL}/api/synapse/task/${encodeURIComponent(args.session_id)}`).then(r => r.json());
    case 'synapse_complete_task':
      return fetch(`${RAG_URL}/api/synapse/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: args.session_id, task_id: args.task_id, notes: args.notes || '' })
      }).then(r => r.json());
    case 'synapse_escalate':
      return fetch(`${RAG_URL}/api/synapse/escalate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: args.session_id, reason: args.reason })
      }).then(r => r.json());
    case 'synapse_resume':
      return fetch(`${RAG_URL}/api/synapse/resume/${encodeURIComponent(args.session_id)}`).then(r => r.json());
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── LLM chat ─────────────────────────────────────────────────────
async function chat(messages, { maxTokens = 1200, useTools = true } = {}) {
  const body = { model: LM_MODEL, messages, max_tokens: maxTokens, temperature: 0.1 };
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
  const data = await httpPost(LM_HOST, LM_PORT, LM_PATH, body);
  await sleep(300);
  return data;
}

function strip(content) {
  let s = (content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')  // XML think tags (Qwen wraps reasoning in these)
    .trim();
  return s || 'Acknowledged.';
}

// ═══════════════════════════════════════════════════════════════════
// INTENT ROUTER
// ═══════════════════════════════════════════════════════════════════

const INTENT_PATTERNS = {
  build:    /\b(build|add|create|implement|make|develop|write)\b.*\b(tool|feature|app|function|module|component|endpoint|api|page|service|project)\b/i,
  bugfix:   /\b(fix|broken|bug|crash|error|fail|wrong|issue|not working|doesn.t work)\b/i,
  research: /\b(research|evaluate|compare|investigate|analyze|benchmark|should we)\b/i,
  refactor: /\b(refactor|restructure|reorganize|clean ?up|technical debt)\b/i,
  debug:    /\b(debug|diagnose|troubleshoot|why is|why does|why doesn.t)\b/i,
};

function detectIntent(userMessage) {
  for (const [mode, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(userMessage)) return mode === 'build' ? 'feature' : mode;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// LOOP DETECTOR
// Catches error-driven loops: model retries the same failing call
// ═══════════════════════════════════════════════════════════════════

class LoopDetector {
  constructor(maxRepeats = 3) {
    this.maxRepeats = maxRepeats;
    this.history = [];  // [{signature, hadError}]
  }

  // Returns a short signature for a tool call
  _sig(toolName, args) {
    // Key on tool name + primary argument (path, command, query)
    const key = args.path || args.command || args.query || args.title || '';
    return `${toolName}:${key.slice(0, 80)}`;
  }

  // Record a call and check if we should break
  check(toolName, args, hadError = false) {
    const sig = this._sig(toolName, args);
    this.history.push({ sig, hadError });

    // Check last N calls for same signature
    const recent = this.history.slice(-this.maxRepeats);
    if (recent.length >= this.maxRepeats && recent.every(h => h.sig === sig)) {
      // All recent calls are identical — that's a loop
      return { looping: true, reason: hadError ? 'error-retry' : 'stuck', signature: sig };
    }

    // Check for rapid error accumulation (3 consecutive errors, any tool)
    const lastN = this.history.slice(-this.maxRepeats);
    if (lastN.length >= this.maxRepeats && lastN.every(h => h.hadError)) {
      return { looping: true, reason: 'consecutive-errors', signature: sig };
    }

    return { looping: false };
  }

  reset() { this.history = []; }
}

// ═══════════════════════════════════════════════════════════════════
// ORCHESTRATOR SESSION
// ═══════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are Chimera, a local AI assistant that can search the web, read/write files, run commands, remember things, and plan projects.

## Tools
You have two tools: find_tool and call_tool.
- find_tool(query) — discovers what you can do
- call_tool(name, arguments) — does it

Never call inner tool names directly. Always use call_tool(name: "tool_name", arguments: {...}).

## What you can do
- **Search the web**: call_tool(name: "web_search", arguments: {query: "..."})
- **Read/write files**: call_tool(name: "read_file", arguments: {path: "C:/Users/sandv/..."}) or write_file with {path, content}
- **Run commands**: call_tool(name: "run_command", arguments: {command: "npm init -y", cwd: "C:/Users/sandv/Desktop/myapp"})
- **Remember things**: call_tool(name: "store_conversation", arguments: {conversation_id: "topic", role: "user", content: "what to save"})
- **Recall past context**: call_tool(name: "recall_conversation", arguments: {query: "what you're looking for"})
- **Search saved docs**: call_tool(name: "search_documents", arguments: {query: "..."})
- **Upload to knowledge base**: call_tool(name: "upload_document", arguments: {title: "...", content: "..."})
- **Plan projects**: call_tool(name: "synapse_new_session", arguments: {project_id: "name", mode: "feature", user_request: "what to build"})

## Memory
You forget everything between conversations. When the user says "remember" or asks about past discussions, use store_conversation / recall_conversation. Do not pretend to remember.

## Behavior
- For clear, simple requests (read a file, search the web, run a command) — just do it. Don't ask "would you like me to...".
- For big or ambiguous requests (build an app, fix a complex bug, plan a project) — start a Synapse workflow.
- If the user's intent is unclear, ask 1-2 short clarifying questions before acting.
- Use absolute paths: C:/Users/sandv/Desktop/..., Documents/..., or Downloads/...
- If a tool fails, try once more. If it fails again, tell the user.
- Be concise.`;

class ChimeraSession {
  constructor({ projectId = 'chimera', onEvent = null } = {}) {
    this.projectId = projectId;
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    this.activeSynapseSession = null;
    this.activeSynapseAreaId = null;
    this.loopDetector = new LoopDetector(3);
    this.toolCallCount = 0;
    this.toolsUsed = new Set();
    this.onEvent = onEvent || (() => {}); // callback for logging/UI
    this.signal = null; // AbortSignal from chat server
  }

  emit(type, data) { this.onEvent({ type, ...data }); }

  // ─── Normalize tool args (same as gateway) ──────────────────
  _normalizeArgs(toolName, toolArgs) {
    // Auto-inject session_id
    const needsSession = ['synapse_answer', 'synapse_get_task', 'synapse_complete_task', 'synapse_escalate', 'synapse_resume'];
    if (needsSession.includes(toolName) && !toolArgs.session_id && this.activeSynapseSession) {
      toolArgs.session_id = this.activeSynapseSession;
    }

    // Normalize synapse_new_session
    if (toolName === 'synapse_new_session') {
      if (!toolArgs.user_request) toolArgs.user_request = toolArgs.description || toolArgs.request || toolArgs.task || '';
      if (toolArgs.mode && toolArgs.user_request) {
        const req = toolArgs.user_request.toLowerCase();
        if (toolArgs.mode === 'feature' && /\b(bug|fix|broken|crash|error|fail|wrong|issue)\b/.test(req)) toolArgs.mode = 'bugfix';
        else if (toolArgs.mode === 'feature' && /\b(research|evaluat|compar|investigat|analyz|benchmark)\b/.test(req)) toolArgs.mode = 'research';
        else if (toolArgs.mode === 'feature' && /\b(refactor|restructur|reorganiz|clean.?up)\b/.test(req)) toolArgs.mode = 'refactor';
        else if (toolArgs.mode === 'feature' && /\b(debug|diagnos|troubleshoot)\b/.test(req)) toolArgs.mode = 'debug';
      }
    }

    // Normalize synapse_answer
    if (toolName === 'synapse_answer') {
      if (typeof toolArgs.answer === 'object' && toolArgs.answer !== null) {
        if (!toolArgs.area_id && toolArgs.answer.area_id) toolArgs.area_id = toolArgs.answer.area_id;
        toolArgs.answer = toolArgs.answer.response || toolArgs.answer.content || toolArgs.answer.answer || JSON.stringify(toolArgs.answer);
      }
      if (!toolArgs.area_id && this.activeSynapseAreaId) toolArgs.area_id = this.activeSynapseAreaId;
      // Strip think tags from answers
      if (toolArgs.answer) toolArgs.answer = strip(toolArgs.answer);
    }

    return toolArgs;
  }

  _trackSynapseState(toolName, result) {
    if (toolName === 'synapse_new_session' && result.session_id) this.activeSynapseSession = result.session_id;
    if (result.question?.area_id) this.activeSynapseAreaId = result.question.area_id;
    if (result.status && result.status !== 'discussing') this.activeSynapseAreaId = null;
  }

  // ─── Trim message history to stay within context ────────────
  _trimMessages(maxMessages = 40) {
    // Keep system prompt (index 0) + last N messages
    if (this.messages.length <= maxMessages) return;
    const system = this.messages[0];
    const kept = this.messages.slice(-maxMessages + 1);
    this.messages = [system, ...kept];
    this.emit('trim', { dropped: this.messages.length - maxMessages, kept: kept.length });
  }

  // ─── Model response with tool handling + loop detection ─────
  async getModelResponse(maxLoops = 8) {
    let loops = 0;
    this.loopDetector.reset();

    while (loops < maxLoops) {
      if (this.signal?.aborted) return '[cancelled]';
      this._trimMessages();
      const r = await chat(this.messages);
      if (!r.choices?.[0]) return '[no response]';
      const m = r.choices[0].message;

      if (m.tool_calls?.length > 0) {
        const tc = m.tool_calls[0];
        let fnArgs;
        try { fnArgs = JSON.parse(tc.function.arguments); } catch { fnArgs = {}; }
        if (typeof fnArgs === 'string') { try { fnArgs = JSON.parse(fnArgs); } catch {} }

        // Rewrap inner tool names
        if (tc.function.name !== 'find_tool' && tc.function.name !== 'call_tool') {
          fnArgs = { name: tc.function.name, arguments: fnArgs };
          tc.function.name = 'call_tool';
          tc.function.arguments = JSON.stringify(fnArgs);
        }

        this.messages.push({
          role: 'assistant', content: m.content || null,
          tool_calls: [{ type: 'function', id: `call_${this.toolCallCount}`, function: tc.function }]
        });

        let toolResult;
        if (tc.function.name === 'find_tool') {
          toolResult = `Found tools:\n${findTools(fnArgs.query)}\n\nCall with: call_tool(name, arguments: {key: value})`;
          this.emit('tool', { tool: 'find_tool', query: fnArgs.query });
          this.toolsUsed.add('find_tool');
        } else {
          let toolArgs = fnArgs.arguments || {};
          if (typeof toolArgs === 'string') { try { toolArgs = JSON.parse(toolArgs); } catch { toolArgs = {}; } }
          if (Object.keys(toolArgs).length === 0) {
            const { name: _n, arguments: _a, ...rest } = fnArgs;
            if (Object.keys(rest).length > 0) toolArgs = rest;
          }

          toolArgs = this._normalizeArgs(fnArgs.name, toolArgs);

          // Loop detection
          let hadError = false;
          this.toolsUsed.add(fnArgs.name);
          try {
            const result = await executeTool(fnArgs.name, toolArgs);
            this._trackSynapseState(fnArgs.name, result);
            toolResult = JSON.stringify(result, null, 2).slice(0, 3000);
            hadError = !!result.error;
            this.emit('tool', { tool: fnArgs.name, args: toolArgs, result, hadError });
          } catch (e) {
            toolResult = `Error: ${e.message}`;
            hadError = true;
            this.emit('tool', { tool: fnArgs.name, args: toolArgs, error: e.message });
          }

          const loopCheck = this.loopDetector.check(fnArgs.name, toolArgs, hadError);
          if (loopCheck.looping) {
            this.emit('loop', { reason: loopCheck.reason, signature: loopCheck.signature });
            toolResult += `\n\n[SYSTEM: Loop detected (${loopCheck.reason}). Stop retrying and move on. Tell the user what happened.]`;
          }
        }

        this.messages.push({ role: 'tool', tool_call_id: `call_${this.toolCallCount}`, content: toolResult });
        this.toolCallCount++;
        loops++;
        await sleep(1500);
      } else {
        const answer = strip(m.content);
        this.messages.push({ role: 'assistant', content: m.content });
        return answer;
      }
    }
    return '[max tool calls reached]';
  }

  // ─── Text-only response (no tools) ─────────────────────────
  async getTextResponse(promptMessages, maxTokens = 400) {
    const r = await chat(promptMessages, { maxTokens, useTools: false });
    return strip(r.choices?.[0]?.message?.content || '');
  }

  // ─── Synapse Q&A loop (no-tool, separate context) ──────────
  async driveSynapseQA(userRequest, firstQuestion) {
    const qaMessages = [
      { role: 'system', content: 'Answer planning questions about a feature request. Be direct, 1-3 sentences. Do not use tools.' },
      { role: 'user', content: `User request: "${userRequest}"` },
    ];

    let question = firstQuestion;
    let count = 0;

    while (question && count < 10) {
      if (this.signal?.aborted) return;
      this.activeSynapseAreaId = question.area_id;
      const qText = question.text || question.question || JSON.stringify(question);
      this.emit('synapse_question', { area_id: question.area_id, text: qText });

      qaMessages.push({ role: 'user', content: `Question: ${qText}\nAnswer in 1-3 short sentences. No bullet points, no analysis, just answer the question directly.` });
      const answer = await this.getTextResponse(qaMessages, 300);
      qaMessages.push({ role: 'assistant', content: answer });

      // Strip think tags before submitting
      const cleanAnswer = strip(answer);
      this.emit('synapse_answer', { area_id: question.area_id, answer: cleanAnswer });

      const result = await executeTool('synapse_answer', {
        session_id: this.activeSynapseSession,
        area_id: question.area_id,
        answer: cleanAnswer
      });
      this.toolsUsed.add('synapse_answer');
      this.toolCallCount++;

      if (result.status === 'discussing' && result.question) {
        question = result.question;
      } else {
        question = null;
      }
      count++;
      await sleep(1500);
    }
  }

  // ─── Synapse task execution loop ────────────────────────────
  async driveSynapseTasks(workingDir) {
    let taskResult = await executeTool('synapse_get_task', { session_id: this.activeSynapseSession });
    this.toolsUsed.add('synapse_get_task');
    this.toolCallCount++;

    let completed = 0;
    while (taskResult.task?.status === 'pending' && completed < 15) {
      if (this.signal?.aborted) return completed;
      const task = taskResult.task;
      this.emit('task_start', { id: task.id, description: task.description });

      this.messages.push({
        role: 'user',
        content: `Execute this task: "${task.description}"\n\nWorking dir: ${workingDir}\nUse write_file, run_command, read_file, web_search, etc. Do the actual work.`
      });

      this.loopDetector.reset(); // fresh detector per task
      const response = await this.getModelResponse(10);
      this.emit('task_done', { id: task.id, response: response.slice(0, 200) });

      await executeTool('synapse_complete_task', {
        session_id: this.activeSynapseSession,
        task_id: task.id,
        notes: strip(response).slice(0, 500) // strip think tags from notes too
      });
      this.toolsUsed.add('synapse_complete_task');
      this.toolCallCount++;

      taskResult = await executeTool('synapse_get_task', { session_id: this.activeSynapseSession });
      this.toolCallCount++;
      completed++;
      await sleep(1500);
    }

    this.emit('tasks_complete', { count: completed, message: taskResult.message });
    return completed;
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN: Process a user message
  // ═══════════════════════════════════════════════════════════════
  async processMessage(userMessage, { workingDir = 'C:/Users/sandv/Desktop/chimera' } = {}) {
    this.emit('user_message', { text: userMessage });

    // Intent routing — detect big tasks, auto-start Synapse
    const intent = !this.activeSynapseSession ? detectIntent(userMessage) : null;

    if (intent) {
      this.emit('intent', { mode: intent, message: userMessage });

      // Auto-start Synapse
      const session = await executeTool('synapse_new_session', {
        project_id: this.projectId, mode: intent, user_request: userMessage
      });
      this.activeSynapseSession = session.session_id;
      this.toolsUsed.add('synapse_new_session');
      this.toolCallCount++;
      this.emit('synapse_start', { session_id: session.session_id, mode: session.mode, status: session.status });

      // Drive Q&A
      if (session.status === 'discussing' && session.question) {
        await this.driveSynapseQA(userMessage, session.question);
      }

      // Drive task execution
      const tasksCompleted = await this.driveSynapseTasks(workingDir);

      // Model summarizes
      this.messages.push({ role: 'user', content: 'Summarize what we planned and built in 2-3 sentences.' });
      const summary = await this.getModelResponse(3);

      // Auto-save conversation summary
      await this._autoSave(userMessage, summary);

      return summary;
    }

    // Normal turn — let model handle directly
    this.messages.push({ role: 'user', content: userMessage });
    this.loopDetector.reset();
    const response = await this.getModelResponse(8);

    return response;
  }

  // ─── Auto-save conversation summary to memory ──────────────
  async _autoSave(userRequest, summary) {
    try {
      const saveContent = `Session: ${new Date().toISOString().slice(0, 10)}\nRequest: ${userRequest.slice(0, 200)}\nResult: ${strip(summary).slice(0, 500)}\nTools used: ${[...this.toolsUsed].join(', ')}`;
      await executeTool('store_conversation', {
        conversation_id: `session-${Date.now()}`,
        role: 'assistant',
        content: saveContent
      });
      this.toolsUsed.add('store_conversation');
      this.emit('auto_save', { content: saveContent.slice(0, 200) });
    } catch (e) {
      this.emit('auto_save_error', { error: e.message });
    }
  }

  getStats() {
    return {
      toolCalls: this.toolCallCount,
      toolsUsed: [...this.toolsUsed],
      hasSynapseSession: !!this.activeSynapseSession,
    };
  }
}

module.exports = { ChimeraSession, executeTool, detectIntent, strip };
