const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const LM_HOST = '127.0.0.1';
const LM_PORT = 1235;
const LM_PATH = '/v1/chat/completions';
const RAG = 'http://localhost:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const lmAgent = new http.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });

function httpPost(host, port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: host, port, path, method: 'POST', agent: lmAgent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`JSON parse: ${Buffer.concat(chunks).toString().slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end(data);
  });
}

const TOOLS = [
  { type: "function", function: { name: "find_tool", description: "Search for available tools by keyword.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "call_tool", description: "Execute a tool by name.", parameters: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object" } }, required: ["name"] } } }
];

// ─── Tool hints for find_tool ─────────────────────────────────
const TOOL_HINTS = {
  web: "• web_search(query, limit?): Search the web via SearXNG",
  search: "• web_search(query): Search the web\n• search_documents(query): Search knowledge base\n• search_files(path, pattern): Find files by name",
  file: "• read_file(path): Read a file\n• write_file(path, content): Write/create a file\n• list_directory(path): List directory contents\n• search_files(path, pattern): Find files",
  read: "• read_file(path): Read a file from disk\n• read_pdf(path): Read a PDF file",
  write: "• write_file(path, content): Write/create a file on disk",
  run: "• run_command(command, cwd?): Run a shell command",
  command: "• run_command(command, cwd?): Run a terminal command (npm, git, node, etc.)",
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
  synapse: "• synapse_new_session(project_id, mode, user_request): Start workflow\n• synapse_answer(session_id, area_id, answer): Answer question\n• synapse_get_task(session_id): Get task\n• synapse_complete_task(session_id, task_id): Complete task",
  plan: "• synapse_new_session(project_id, mode, user_request): Plan a feature, bugfix, or research task",
  build: "• synapse_new_session(project_id, mode, user_request): Start a feature workflow\n• write_file(path, content): Create files\n• run_command(command, cwd?): Run build commands",
  feature: "• synapse_new_session(project_id, mode, user_request): Start a feature workflow",
  bug: "• synapse_new_session(project_id, mode, user_request): Start a bugfix workflow",
  task: "• synapse_get_task(session_id): Get current task\n• synapse_complete_task(session_id, task_id): Mark done",
  health: "• rag_health(): Check system health",
  status: "• rag_health(): Check system status",
};

function findTools(query) {
  const q = query.toLowerCase();
  for (const [key, val] of Object.entries(TOOL_HINTS)) {
    if (q.includes(key)) return val;
  }
  return "Available categories: web, file, run (shell), memory (store/recall), document (upload/search), workflow (synapse), health. Try one of these keywords.";
}

// ─── Tool execution ───────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    case 'store_conversation':
      return fetch(`${RAG}/api/conversations/store`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: args.conversation_id || 'mini-project', role: args.role || 'user', content: args.content })
      }).then(r => r.json());
    case 'recall_conversation':
      return fetch(`${RAG}/api/conversations/recall`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit: args.limit || 5 })
      }).then(r => r.json());
    case 'web_search':
      return fetch(`${RAG}/api/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit: args.limit || 3, type: 'web' })
      }).then(r => r.json());
    case 'upload_document': {
      const title = args.title || args.filename || 'untitled';
      const content = args.content || '';
      const form = new FormData();
      form.append('file', new Blob([content], { type: 'text/plain' }), `${title}.txt`);
      return fetch(`${RAG}/api/documents/upload`, { method: 'POST', body: form }).then(r => r.json());
    }
    case 'search_documents':
      return fetch(`${RAG}/api/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit: args.limit || 3, threshold: 0.1, type: 'documents' })
      }).then(r => r.json());
    case 'list_documents':
      return fetch(`${RAG}/api/documents`).then(r => r.json());
    case 'rag_health':
      return fetch(`${RAG}/health`).then(r => r.json());
    case 'read_file': {
      try {
        const content = fs.readFileSync(args.path, 'utf-8');
        return { path: args.path, content: content.slice(0, 8000) };
      } catch (e) { return { error: e.message }; }
    }
    case 'write_file': {
      try {
        const dir = path.dirname(args.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.path, args.content, 'utf-8');
        return { path: args.path, status: 'written', bytes: Buffer.byteLength(args.content) };
      } catch (e) { return { error: e.message }; }
    }
    case 'list_directory': {
      try {
        const entries = fs.readdirSync(args.path, { withFileTypes: true });
        return { path: args.path, entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })) };
      } catch (e) { return { error: e.message }; }
    }
    case 'search_files': {
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
      const cwd = args.cwd || 'C:/Users/sandv/Desktop';
      try {
        const output = execSync(args.command, { cwd, timeout: 30000, maxBuffer: 512 * 1024, encoding: 'utf-8', shell: true });
        return { command: args.command, cwd, output: output.slice(0, 5000) };
      } catch (e) {
        return { command: args.command, cwd, error: e.message.slice(0, 1000), exitCode: e.status };
      }
    }
    case 'synapse_new_session':
      return fetch(`${RAG}/api/synapse/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: args.project_id || 'chimera', mode: args.mode, user_request: args.user_request })
      }).then(r => r.json());
    case 'synapse_answer':
      return fetch(`${RAG}/api/synapse/discuss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: args.session_id, area_id: args.area_id, answer: args.answer })
      }).then(r => r.json());
    case 'synapse_get_task':
      return fetch(`${RAG}/api/synapse/task/${encodeURIComponent(args.session_id)}`).then(r => r.json());
    case 'synapse_complete_task':
      return fetch(`${RAG}/api/synapse/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: args.session_id, task_id: args.task_id, notes: args.notes || '' })
      }).then(r => r.json());
    case 'synapse_escalate':
      return fetch(`${RAG}/api/synapse/escalate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: args.session_id, reason: args.reason })
      }).then(r => r.json());
    case 'synapse_resume':
      return fetch(`${RAG}/api/synapse/resume/${encodeURIComponent(args.session_id)}`).then(r => r.json());
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Chat with LM Studio ─────────────────────────────────────
async function chat(messages, maxTokens = 1200, useTools = true) {
  const body = {
    model: 'qwen/qwen3.5-9b', messages, max_tokens: maxTokens, temperature: 0.1,
  };
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
  const data = await httpPost(LM_HOST, LM_PORT, LM_PATH, body);
  await sleep(500);
  return data;
}

// No-tool chat — forces model to respond with text only
async function chatText(messages, maxTokens = 400) {
  return chat(messages, maxTokens, false);
}

let activeSynapseSession = null;
let activeSynapseAreaId = null;

function strip(content) { return (content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

// ═══════════════════════════════════════════════════════════════
// INTENT ROUTER — the brain that GSD-like orchestration needs
// Detects user intent and pre-executes framework actions so the
// model just needs to respond naturally, not figure out which
// tool to call.
// ═══════════════════════════════════════════════════════════════

const INTENT_PATTERNS = {
  build: /\b(build|add|create|implement|make|develop|write)\b.*\b(tool|feature|app|function|module|component|endpoint|api|page|service)\b/i,
  bugfix: /\b(fix|broken|bug|crash|error|fail|wrong|issue|not working|doesn.t work)\b/i,
  research: /\b(research|evaluate|compare|investigate|analyze|benchmark|should we)\b/i,
  refactor: /\b(refactor|restructure|reorganize|clean ?up|technical debt)\b/i,
  debug: /\b(debug|diagnose|troubleshoot|why is|why does|why doesn.t)\b/i,
};

function detectIntent(userMessage) {
  for (const [mode, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(userMessage)) return mode === 'build' ? 'feature' : mode;
  }
  return null;
}

// ─── Orchestrated conversation runner ─────────────────────────
// Unlike the old runner that just relayed messages, this one:
// 1. Detects intent from user messages
// 2. Auto-starts Synapse for build/fix/plan requests
// 3. Feeds Synapse questions to the model as structured prompts
// 4. Auto-submits the model's answers back to Synapse
// 5. Drives task execution loop (get_task → model works → complete_task)
async function conversation(title, turns) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  CONVERSATION: ${title}`);
  console.log('═'.repeat(70));

  const messages = [];
  let totalToolCalls = 0;
  const toolsUsed = new Set();

  function log(icon, msg) { console.log(`  │ ${icon} ${msg}`); }

  // Helper: send message to model and get text response (with tool calls handled)
  async function getModelResponse(messages, maxLoops = 8) {
    let loops = 0;
    while (loops < maxLoops) {
      const r = await chat(messages);
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

        messages.push({
          role: 'assistant', content: m.content || null,
          tool_calls: [{ type: 'function', id: `call_${totalToolCalls}`, function: tc.function }]
        });

        let toolResult;
        if (tc.function.name === 'find_tool') {
          toolResult = `Found tools:\n${findTools(fnArgs.query)}\n\nCall with: call_tool(name, arguments: {key: value})`;
          log('🔍', `find_tool("${fnArgs.query}")`);
          toolsUsed.add('find_tool');
        } else {
          let toolArgs = fnArgs.arguments || {};
          if (typeof toolArgs === 'string') { try { toolArgs = JSON.parse(toolArgs); } catch { toolArgs = {}; } }
          if (Object.keys(toolArgs).length === 0) {
            const { name: _n, arguments: _a, ...rest } = fnArgs;
            if (Object.keys(rest).length > 0) toolArgs = rest;
          }
          // Auto-inject session_id
          const needsSession = ['synapse_answer', 'synapse_get_task', 'synapse_complete_task', 'synapse_escalate', 'synapse_resume'];
          if (needsSession.includes(fnArgs.name) && !toolArgs.session_id && activeSynapseSession) {
            toolArgs.session_id = activeSynapseSession;
          }
          // Normalize synapse_answer
          if (fnArgs.name === 'synapse_answer') {
            if (typeof toolArgs.answer === 'object' && toolArgs.answer !== null) {
              if (!toolArgs.area_id && toolArgs.answer.area_id) toolArgs.area_id = toolArgs.answer.area_id;
              toolArgs.answer = toolArgs.answer.response || toolArgs.answer.content || toolArgs.answer.answer || JSON.stringify(toolArgs.answer);
            }
            if (!toolArgs.area_id && activeSynapseAreaId) toolArgs.area_id = activeSynapseAreaId;
          }

          try {
            const result = await executeTool(fnArgs.name, toolArgs);
            if (fnArgs.name === 'synapse_new_session' && result.session_id) activeSynapseSession = result.session_id;
            if (result.question?.area_id) activeSynapseAreaId = result.question.area_id;
            if (result.status && result.status !== 'discussing') activeSynapseAreaId = null;
            toolResult = JSON.stringify(result, null, 2).slice(0, 3000);
            toolsUsed.add(fnArgs.name);
            logToolCall(fnArgs.name, toolArgs, result);
          } catch (e) {
            toolResult = `Error: ${e.message}`;
            log('❌', `${fnArgs.name}: ${e.message.slice(0, 100)}`);
          }
        }

        messages.push({ role: 'tool', tool_call_id: `call_${totalToolCalls}`, content: toolResult });
        totalToolCalls++;
        loops++;
        await sleep(2000);
      } else {
        const answer = strip(m.content);
        messages.push({ role: 'assistant', content: m.content });
        return answer;
      }
    }
    return '[loop limit]';
  }

  function logToolCall(name, args, result) {
    if (name === 'write_file') log('📝', `write_file → ${args.path} (${result.bytes || '?'} bytes)`);
    else if (name === 'read_file') log('📖', `read_file → ${args.path} (${result.content?.length || 0} chars)`);
    else if (name === 'run_command') {
      const out = result.output?.split('\n')[0] || result.error?.split('\n')[0] || '';
      log('⚡', `run_command: ${args.command?.slice(0, 60)} → ${out.slice(0, 80)}`);
    }
    else if (name === 'web_search') log('🌐', `web_search("${args.query}")`);
    else if (name === 'synapse_new_session') log('🧠', `synapse_new_session(${result.mode || args.mode}) → ${result.status}`);
    else if (name === 'synapse_answer') log('💬', `synapse_answer(${args.area_id}) → ${result.status}`);
    else if (name === 'synapse_get_task') log('📋', `synapse_get_task → ${(result.task?.description || result.message || '').slice(0, 80)}`);
    else if (name === 'synapse_complete_task') log('✅', `synapse_complete_task(${args.task_id})`);
    else if (name === 'store_conversation') log('💾', `store_conversation("${args.conversation_id}")`);
    else if (name === 'recall_conversation') log('🔮', `recall_conversation("${args.query}")`);
    else if (name === 'search_documents') log('📚', `search_documents("${args.query}")`);
    else if (name === 'upload_document') log('📤', `upload_document("${args.title}")`);
    else if (name === 'list_directory') log('📂', `list_directory(${args.path})`);
    else if (name === 'rag_health') log('🏥', `rag_health → ${result.status || 'ok'}`);
    else log('🔧', `${name}(${JSON.stringify(args).slice(0, 100)})`);
  }

  for (const turn of turns) {
    console.log(`\n  ┌─ USER: "${turn.slice(0, 150)}${turn.length > 150 ? '...' : ''}"`);

    // ── INTENT ROUTING ──────────────────────────────────────
    // Detect if this is a "big task" that needs Synapse
    const intent = !activeSynapseSession ? detectIntent(turn) : null;

    if (intent) {
      // Auto-start Synapse — the framework drives, not the model
      log('🚀', `Intent detected: "${intent}" → auto-starting Synapse workflow`);

      try {
        const session = await executeTool('synapse_new_session', {
          project_id: 'chimera', mode: intent, user_request: turn
        });
        activeSynapseSession = session.session_id;
        toolsUsed.add('synapse_new_session');
        totalToolCalls++;
        log('🧠', `synapse_new_session(${session.mode}) → ${session.status}`);

        // Synapse asks questions — drive the Q&A loop
        // Use no-tool chat so the model ANSWERS instead of searching
        if (session.status === 'discussing' && session.question) {
          let question = session.question;
          let questionCount = 0;

          // Build a Q&A-specific message list (separate from main conversation)
          const qaMessages = [
            { role: 'system', content: 'You are answering planning questions about a feature request. Answer each question directly in 1-3 concise sentences. Do not search the web or use tools — just answer from what the user told you.' },
            { role: 'user', content: `User's request: "${turn}"` },
          ];

          while (question && questionCount < 10) {
            activeSynapseAreaId = question.area_id;
            const qText = question.text || question.question || JSON.stringify(question);
            log('❓', `Synapse asks [${question.area_id}]: "${qText.slice(0, 100)}"`);

            qaMessages.push({ role: 'user', content: `Planning question: ${qText}\nAnswer concisely based on what the user said.` });

            const r = await chatText(qaMessages, 300);
            const modelAnswer = strip(r.choices?.[0]?.message?.content || 'No answer');
            qaMessages.push({ role: 'assistant', content: modelAnswer });

            log('💭', `Model answers: "${modelAnswer.slice(0, 120)}"`);

            // Submit answer to Synapse
            const answerResult = await executeTool('synapse_answer', {
              session_id: activeSynapseSession,
              area_id: question.area_id,
              answer: modelAnswer
            });
            toolsUsed.add('synapse_answer');
            totalToolCalls++;
            log('💬', `synapse_answer(${question.area_id}) → ${answerResult.status}`);

            // Check if there's another question
            if (answerResult.status === 'discussing' && answerResult.question) {
              question = answerResult.question;
            } else {
              question = null; // Q&A done
            }
            questionCount++;
            await sleep(2000);
          }
        }

        // ── TASK EXECUTION PHASE ──────────────────────────────
        // Always try to get tasks after Q&A, regardless of how we got here
        log('⚙️', 'Starting task execution phase...');
        let taskResult = await executeTool('synapse_get_task', { session_id: activeSynapseSession });
        toolsUsed.add('synapse_get_task');
        totalToolCalls++;

        let tasksCompleted = 0;
        while (taskResult.task && taskResult.task.status === 'pending' && tasksCompleted < 15) {
          const task = taskResult.task;
          log('📋', `Task ${task.id}: ${task.description.slice(0, 80)}`);

          // Ask model to execute this task — WITH tools enabled
          messages.push({
            role: 'user',
            content: `Execute this task: "${task.description}"\n\nWorking dir: C:/Users/sandv/Desktop/chimera\nUse write_file, run_command, read_file, web_search, etc. Do the actual work.`
          });

          const taskResponse = await getModelResponse(messages, 10);
          const preview = taskResponse.split('\n').filter(l => l.trim()).slice(0, 2).join(' | ');
          log('🤖', `Model: ${preview.slice(0, 120)}`);

          // Mark task complete
          await executeTool('synapse_complete_task', {
            session_id: activeSynapseSession,
            task_id: task.id,
            notes: taskResponse.slice(0, 500)
          });
          toolsUsed.add('synapse_complete_task');
          totalToolCalls++;
          log('✅', `Completed: ${task.id}`);

          // Get next task
          taskResult = await executeTool('synapse_get_task', { session_id: activeSynapseSession });
          totalToolCalls++;
          tasksCompleted++;
          await sleep(2000);
        }

        if (tasksCompleted > 0) {
          log('🎉', `${tasksCompleted} tasks completed`);
        }
        if (taskResult.message) {
          log('📊', taskResult.message.slice(0, 100));
        }

        // Let the model summarize what happened
        messages.push({ role: 'user', content: 'Summarize what we just planned and built in 2-3 sentences.' });
        const summary = await getModelResponse(messages, 3);
        console.log(`  │`);
        console.log(`  └─ CHIMERA: ${summary.slice(0, 300)}`);

      } catch (e) {
        log('❌', `Synapse error: ${e.message}`);
        // Fall back to normal model response
        messages.push({ role: 'user', content: turn });
        const resp = await getModelResponse(messages);
        console.log(`  └─ CHIMERA: ${resp.slice(0, 300)}`);
      }

    } else {
      // ── NORMAL TURN — let model handle directly ───────────
      messages.push({ role: 'user', content: turn });
      const resp = await getModelResponse(messages);
      const lines = resp.split('\n').filter(l => l.trim());
      const preview = lines.slice(0, 3).join('\n    ');
      console.log(`  │`);
      console.log(`  └─ CHIMERA: ${preview}${lines.length > 3 ? '\n    ...' : ''}`);
    }

    await sleep(3000);
  }

  console.log(`\n  📊 Tool calls: ${totalToolCalls} | Tools used: ${[...toolsUsed].join(', ')}`);
  return { messages, totalToolCalls, toolsUsed };
}

// ═══════════════════════════════════════════════════════════════
// MINI PROJECT: Build fetch_url tool for Chimera
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('  CHIMERA MINI PROJECT: Build fetch_url tool');
  console.log('  Orchestrator-driven (GSD-style) with natural user prompts');
  console.log('█'.repeat(70));

  // ─── Conversation 1: Build the feature (Synapse-driven) ────
  const c1 = await conversation('1. Build fetch_url', [
    // This should auto-detect "build" intent and start Synapse
    "I want to add a fetch_url tool to Chimera that downloads a webpage and returns plain text. Max 50KB, http/https only. It goes in the gateway switch statement.",
  ]);

  // ─── Conversation 2: Research & iterate ─────────────────────
  const c2 = await conversation('2. Research & Iterate', [
    "What do you remember about the fetch_url feature?",
    "Search the web for how to strip HTML tags in Node.js without external dependencies",
    "Save your HTML stripping research to our knowledge base as fetch-url-research",
  ]);

  // ─── Conversation 3: Verify ────────────────────────────────
  const c3 = await conversation('3. Verify & Health Check', [
    "What files are in C:/Users/sandv/Desktop/chimera/ ? Use list_directory to check.",
    "Search our documents for fetch_url",
    "Check the RAG system health using the rag_health tool",
    "Read the file C:/Users/sandv/Desktop/chimera/mcp-chimera-gateway/package.json",
    "Remember that we completed the fetch_url mini-project — tool strips HTML, 50KB limit, http/https only",
  ]);

  // ─── Summary ────────────────────────────────────────────────
  console.log('\n' + '█'.repeat(70));
  console.log('  MINI PROJECT COMPLETE — TOOL COVERAGE REPORT');
  console.log('█'.repeat(70));

  const allTools = new Set();
  [c1, c2, c3].forEach(c => c.toolsUsed.forEach(t => allTools.add(t)));

  const expected = [
    'find_tool', 'synapse_new_session', 'synapse_answer', 'synapse_get_task', 'synapse_complete_task',
    'web_search', 'read_file', 'write_file', 'list_directory', 'run_command',
    'store_conversation', 'recall_conversation', 'upload_document', 'search_documents', 'rag_health'
  ];

  console.log('\n  Tool Coverage:');
  for (const tool of expected) {
    const hit = allTools.has(tool);
    console.log(`    ${hit ? '✅' : '❌'} ${tool}`);
  }
  const coverage = expected.filter(t => allTools.has(t)).length;
  console.log(`\n  Coverage: ${coverage}/${expected.length} tools (${Math.round(100 * coverage / expected.length)}%)`);
  console.log(`  Total tool calls: ${[c1, c2, c3].reduce((s, c) => s + c.totalToolCalls, 0)}`);

  // Clean up test artifacts
  try { fs.unlinkSync('C:/Users/sandv/Desktop/chimera/fetch_url.js'); } catch {}
  console.log('\n  Cleaned up test artifacts');
}

main().catch(console.error);
