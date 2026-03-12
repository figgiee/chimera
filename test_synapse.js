const http = require('node:http');
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
        catch (e) { reject(new Error(`JSON parse: ${Buffer.concat(chunks).toString().slice(0, 100)}`)); }
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

// Minimal find_tool simulation
const TOOL_HINTS = {
  workflow: "• synapse_new_session(project_id, mode, user_request): Start structured workflow (feature/refactor/bugfix/research/debug)\n• synapse_answer(session_id, area_id, answer): Answer a Synapse discussion question\n• synapse_get_task(session_id): Get current workflow task with context\n• synapse_complete_task(session_id, task_id, notes?): Mark workflow task done\n• synapse_escalate(session_id, reason): Pause workflow due to a blocker",
  synapse: "• synapse_new_session(project_id, mode, user_request): Start structured workflow\n• synapse_answer(session_id, area_id, answer): Answer a discussion question\n• synapse_get_task(session_id): Get current task\n• synapse_complete_task(session_id, task_id, notes?): Mark task done\n• synapse_resume(session_id): Resume workflow after context reset",
  feature: "• synapse_new_session(project_id, mode, user_request): Start structured workflow (feature/refactor/bugfix/research/debug)",
  bug: "• synapse_new_session(project_id, mode, user_request): Start structured workflow (feature/refactor/bugfix/research/debug)",
  task: "• synapse_get_task(session_id): Get current workflow task with context\n• synapse_complete_task(session_id, task_id, notes?): Mark workflow task done",
  answer: "• synapse_answer(session_id, area_id, answer): Answer a Synapse discussion question",
  complete: "• synapse_complete_task(session_id, task_id, notes?): Mark workflow task done, advance to next",
  escalate: "• synapse_escalate(session_id, reason): Pause workflow due to a blocker",
  resume: "• synapse_resume(session_id): Resume workflow after context reset",
};

function findTools(query) {
  const q = query.toLowerCase();
  for (const [key, val] of Object.entries(TOOL_HINTS)) {
    if (q.includes(key)) return val;
  }
  return null;
}

async function executeTool(name, args) {
  switch (name) {
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

async function chat(messages, maxTokens = 800) {
  const data = await httpPost(LM_HOST, LM_PORT, LM_PATH, {
    model: 'qwen/qwen3.5-9b', messages, max_tokens: maxTokens, temperature: 0.7, tools: TOOLS, tool_choice: 'auto'
  });
  await sleep(500);
  return data;
}

let activeSynapseSession = null;
let activeSynapseAreaId = null;

function strip(content) { return (content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

async function scenario(title, turns) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${title}`);
  console.log('='.repeat(60));

  const messages = [];

  for (const turn of turns) {
    console.log(`\n  USER: "${turn.slice(0, 120)}${turn.length > 120 ? '...' : ''}"`);
    messages.push({ role: 'user', content: turn });

    let loops = 0;
    while (loops < 10) {
      const r = await chat(messages);
      const m = r.choices[0].message;

      if (m.tool_calls && m.tool_calls.length > 0) {
        const tc = m.tool_calls[0];
        let fnArgs = JSON.parse(tc.function.arguments);
        // Handle double-encoded JSON strings
        if (typeof fnArgs === 'string') { try { fnArgs = JSON.parse(fnArgs); } catch {} }

        // If model called an inner tool name directly, wrap it as call_tool
        if (tc.function.name !== 'find_tool' && tc.function.name !== 'call_tool') {
          console.log(`  [rewrap ${tc.function.name} → call_tool]`);
          fnArgs = { name: tc.function.name, arguments: fnArgs };
          tc.function.name = 'call_tool';
          tc.function.arguments = JSON.stringify(fnArgs);
        }
        console.log(`  -> ${tc.function.name}(${JSON.stringify(fnArgs).slice(0, 200)})`);

        messages.push({
          role: 'assistant', content: m.content || null,
          tool_calls: [{ type: 'function', id: `call_${loops}`, function: tc.function }]
        });

        let toolResult;
        if (tc.function.name === 'find_tool') {
          const matches = findTools(fnArgs.query);
          toolResult = matches
            ? `Found tools:\n${matches}\n\nCall with: call_tool(name, arguments: {key: value})`
            : 'No matching tools found. Try: workflow, synapse, feature, bug, task, answer, complete, escalate, resume';
        } else if (tc.function.name === 'call_tool') {
          let toolArgs = fnArgs.arguments || {};
          // Handle double-encoded arguments (string instead of object)
          if (typeof toolArgs === 'string') { try { toolArgs = JSON.parse(toolArgs); } catch { toolArgs = {}; } }
          if (Object.keys(toolArgs).length === 0) {
            const { name: _n, arguments: _a, ...rest } = fnArgs;
            if (Object.keys(rest).length > 0) toolArgs = rest;
          }
          // Auto-inject session_id when model omits it
          const needsSession = ['synapse_answer', 'synapse_get_task', 'synapse_complete_task', 'synapse_escalate', 'synapse_resume'];
          if (needsSession.includes(fnArgs.name) && !toolArgs.session_id && activeSynapseSession) {
            toolArgs.session_id = activeSynapseSession;
            console.log(`  [auto-inject session_id: ${activeSynapseSession.slice(0, 8)}...]`);
          }
          // Normalize synapse_new_session
          if (fnArgs.name === 'synapse_new_session') {
            if (!toolArgs.user_request) toolArgs.user_request = toolArgs.description || toolArgs.request || toolArgs.task || '';
            // Auto-correct mode from user_request keywords
            if (toolArgs.mode && toolArgs.user_request) {
              const req = toolArgs.user_request.toLowerCase();
              if (toolArgs.mode === 'feature' && /\b(bug|fix|broken|crash|error|fail|wrong|issue)\b/.test(req)) { toolArgs.mode = 'bugfix'; console.log('  [auto-correct mode: feature→bugfix]'); }
              else if (toolArgs.mode === 'feature' && /\b(research|evaluat|compar|investigat|analyz|benchmark)\b/.test(req)) { toolArgs.mode = 'research'; console.log('  [auto-correct mode: feature→research]'); }
              else if (toolArgs.mode === 'feature' && /\b(refactor|restructur|reorganiz|clean.?up)\b/.test(req)) { toolArgs.mode = 'refactor'; console.log('  [auto-correct mode: feature→refactor]'); }
              else if (toolArgs.mode === 'feature' && /\b(debug|diagnos|troubleshoot)\b/.test(req)) { toolArgs.mode = 'debug'; console.log('  [auto-correct mode: feature→debug]'); }
            }
          }
          // Normalize synapse_answer — model sends answer as object or omits area_id
          if (fnArgs.name === 'synapse_answer') {
            if (typeof toolArgs.answer === 'object' && toolArgs.answer !== null) {
              if (!toolArgs.area_id && toolArgs.answer.area_id) toolArgs.area_id = toolArgs.answer.area_id;
              toolArgs.answer = toolArgs.answer.response || toolArgs.answer.content || toolArgs.answer.answer || JSON.stringify(toolArgs.answer);
            }
            if (!toolArgs.answer) {
              const { session_id: _s, area_id: _a, answer: _ans, ...extra } = toolArgs;
              const candidate = extra.response || extra.content || extra.question;
              if (candidate) toolArgs.answer = String(candidate);
            }
            // Auto-inject area_id from last known question
            if (!toolArgs.area_id && activeSynapseAreaId) {
              toolArgs.area_id = activeSynapseAreaId;
              console.log(`  [auto-inject area_id: ${activeSynapseAreaId}]`);
            }
            if (toolArgs.answer) console.log(`  [normalized answer: "${String(toolArgs.answer).slice(0, 80)}..."]`);
          }
          try {
            const result = await executeTool(fnArgs.name, toolArgs);
            // Track active session and area_id from responses
            if (fnArgs.name === 'synapse_new_session' && result.session_id) {
              activeSynapseSession = result.session_id;
            }
            if (result.question?.area_id) {
              activeSynapseAreaId = result.question.area_id;
            }
            if (result.status && result.status !== 'discussing') {
              activeSynapseAreaId = null;
            }
            toolResult = JSON.stringify(result, null, 2).slice(0, 2000);
            console.log(`  <- ${fnArgs.name}: ${toolResult.slice(0, 300)}...`);
          } catch (e) {
            toolResult = `Error: ${e.message}`;
            console.log(`  <- ERROR: ${e.message}`);
          }
        }

        messages.push({ role: 'tool', tool_call_id: `call_${loops}`, content: toolResult });
        loops++;
        await sleep(2000);
      } else {
        const answer = strip(m.content);
        console.log(`  CHIMERA: "${answer.slice(0, 500)}"`);
        messages.push({ role: 'assistant', content: m.content });
        break;
      }
    }
    await sleep(3000);
  }
}

async function main() {
  console.log('SYNAPSE WORKFLOW E2E TESTS');
  console.log('='.repeat(60));

  // TEST 1: Feature workflow — create session, answer questions, get plan
  await scenario('1. Feature: Create & Discuss', [
    'Start a new feature workflow for the chimera project. I want to add a fetch_url tool that downloads webpage content and returns plain text.',
    'The scope is: fetch_url takes a URL, downloads HTML, strips tags, returns plain text. Max 50KB. Only http/https allowed.',
    'The interface: fetch_url(url) returns {url, content, size}. Just a new case in the gateway switch statement, no new API surface.',
  ]);

  // TEST 2: Bugfix workflow
  await scenario('2. Bugfix: Threshold Bug', [
    'Start a bugfix workflow for chimera. Document search returns 0 results even when documents exist.',
    'To reproduce: upload any document, then search for a word in it. Expected: results. Actual: empty. Happens 100% of the time.',
    'Single bug. The cosine similarity threshold is 0.3 but nomic-embed-text scores 0.15-0.20 for valid matches.',
  ]);

  // TEST 3: Research workflow
  await scenario('3. Research: Embedding Models', [
    'Start a research workflow for chimera. I want to evaluate whether we should switch from nomic-embed-text to a different embedding model for better similarity scores.',
  ]);

  console.log('\n' + '='.repeat(60));
  console.log('SYNAPSE TESTS COMPLETE');
}

main().catch(console.error);
