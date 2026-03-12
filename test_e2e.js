const http = require('node:http');
const LM_HOST = '127.0.0.1';
const LM_PORT = 1235;
const LM_PATH = '/v1/chat/completions';
const RAG = 'http://localhost:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Persistent agent with keepAlive to reuse one TCP connection
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
        catch (e) { reject(new Error(`JSON parse failed: ${Buffer.concat(chunks).toString().slice(0, 100)}`)); }
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

const ALIASES = {
  weather: "web_search", forecast: "web_search", news: "web_search", current: "web_search",
  google: "web_search", browse: "web_search", lookup: "web_search", internet: "web_search",
  remember: "store_conversation", memory: "store_conversation", memorize: "store_conversation",
  recall: "recall_conversation", past: "recall_conversation", history: "recall_conversation",
  health: "rag_health", status: "rag_health",
  upload: "upload_document", index: "upload_document",
  save: "write_file", create: "write_file",
  open: "read_file", cat: "read_file", view: "read_file", show: "read_file",
  find: "search_files", locate: "search_files",
  ls: "list_directory", dir: "list_directory", folder: "list_directory", files: "list_directory",
  document: "search_documents", search: "search_documents",
};

const TOOL_REG = [
  { name: "search_documents", category: "rag", desc: "Semantic search through indexed documents", args: "query, limit?, threshold?" },
  { name: "upload_document", category: "rag", desc: "Upload text to RAG knowledge base", args: "filename, content" },
  { name: "list_documents", category: "rag", desc: "List all indexed documents", args: "(none)" },
  { name: "store_conversation", category: "rag", desc: "Save a conversation turn for future recall", args: "conversation_id, role, content" },
  { name: "recall_conversation", category: "rag", desc: "Recall past conversations by semantic search", args: "query, limit?" },
  { name: "rag_health", category: "rag", desc: "Check RAG pipeline health status", args: "(none)" },
  { name: "web_search", category: "web", desc: "Search the web via SearXNG", args: "query, limit?" },
  { name: "read_file", category: "fs", desc: "Read a file from disk", args: "path" },
  { name: "write_file", category: "fs", desc: "Write content to a file", args: "path, content" },
  { name: "list_directory", category: "fs", desc: "List files in a directory", args: "path" },
  { name: "search_files", category: "fs", desc: "Search for files by name pattern", args: "path, pattern" },
];

function findTools(query) {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/);
  const expanded = new Set(terms);
  for (const t of terms) { if (ALIASES[t]) expanded.add(ALIASES[t]); }
  const scored = TOOL_REG.map(tool => {
    const hay = `${tool.name} ${tool.desc} ${tool.category}`.toLowerCase();
    let score = 0;
    for (const t of expanded) {
      if (hay.includes(t)) score += 1;
      if (tool.name.toLowerCase().includes(t)) score += 2;
      if (ALIASES[t] === tool.name) score += 3;
    }
    return { ...tool, score };
  });
  return scored.filter(t => t.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
    .map(({ name, desc, args }) => `\u2022 ${name}(${args}): ${desc}`).join('\n');
}

async function executeTool(name, args) {
  switch (name) {
    case 'store_conversation':
      return fetch(`${RAG}/api/conversations/store`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: args.conversation_id || 'e2e-test', role: args.role || 'user', content: args.content })
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
      const form = new FormData();
      form.append('file', new Blob([args.content], { type: 'text/plain' }), args.filename);
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
      const fs = require('node:fs');
      const content = fs.readFileSync(args.path, 'utf-8');
      return { path: args.path, content };
    }
    case 'write_file': {
      const fs = require('node:fs');
      const path = require('node:path');
      const dir = path.dirname(args.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(args.path, args.content, 'utf-8');
      return { path: args.path, status: 'written', bytes: Buffer.byteLength(args.content) };
    }
    case 'list_directory': {
      const fs = require('node:fs');
      const entries = fs.readdirSync(args.path, { withFileTypes: true });
      return { path: args.path, entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })) };
    }
    case 'search_files': {
      const fs = require('node:fs');
      const path = require('node:path');
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
    default:
      return { error: `Tool ${name} not wired for E2E test` };
  }
}

async function chat(messages, maxTokens = 600) {
  const data = await httpPost(LM_HOST, LM_PORT, LM_PATH, {
    model: 'qwen/qwen3.5-9b', messages, max_tokens: maxTokens, temperature: 0.7, tools: TOOLS, tool_choice: 'auto'
  });
  await sleep(500);
  return data;
}

function strip(content) { return (content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

async function scenario(title, turns) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${title}`);
  console.log('='.repeat(60));

  // No system message — let LM Studio's preset handle it
  const messages = [];

  for (const turn of turns) {
    console.log(`\n  USER: "${turn}"`);
    messages.push({ role: 'user', content: turn });

    let loops = 0;
    while (loops < 4) {
      const r = await chat(messages);
      const m = r.choices[0].message;

      if (m.tool_calls && m.tool_calls.length > 0) {
        const tc = m.tool_calls[0];
        const fnArgs = JSON.parse(tc.function.arguments);
        console.log(`  -> ${tc.function.name}(${JSON.stringify(fnArgs)})`);

        messages.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: [{ type: 'function', id: `call_${loops}`, function: tc.function }]
        });

        let toolResult;
        if (tc.function.name === 'find_tool') {
          const matches = findTools(fnArgs.query);
          toolResult = matches
            ? `Found tools:\n${matches}\n\nCall with: call_tool(name, arguments: {key: value})`
            : 'No matching tools found.';
        } else if (tc.function.name === 'call_tool') {
          let toolArgs = fnArgs.arguments || {};
          if (Object.keys(toolArgs).length === 0) {
            const { name: _n, arguments: _a, ...rest } = fnArgs;
            if (Object.keys(rest).length > 0) toolArgs = rest;
          }
          try {
            const result = await executeTool(fnArgs.name, toolArgs);
            toolResult = JSON.stringify(result, null, 2).slice(0, 1500);
            console.log(`  <- ${fnArgs.name}: ${toolResult.slice(0, 250)}...`);
          } catch (e) {
            toolResult = `Error: ${e.message}`;
            console.log(`  <- ERROR: ${e.message}`);
          }
        }

        messages.push({ role: 'tool', tool_call_id: `call_${loops}`, content: toolResult });
        loops++;
        await sleep(3000);
      } else {
        const answer = strip(m.content);
        console.log(`  CHIMERA: "${answer.slice(0, 400)}"`);
        messages.push({ role: 'assistant', content: m.content });
        break;
      }
    }
    await sleep(4000);
  }
}

async function main() {
  console.log('CHIMERA END-TO-END SCENARIOS (real services)');
  console.log('='.repeat(60));

  // SCENARIO 1: Memory store then recall
  await scenario('1. Memory: Store & Recall', [
    'Remember this: we decided to use PostgreSQL for the vector store because pgvector is simpler than running a separate Qdrant instance.',
    'What database decisions have we made recently?'
  ]);

  // SCENARIO 2: Web search
  await scenario('2. Research: Web Search', [
    'Search the web for best practices for RAG chunking strategies'
  ]);

  // SCENARIO 3: Document upload then search
  await scenario('3. Knowledge Base: Upload & Query', [
    'Upload this as a document called "arch-notes.txt": Chimera uses a 3-layer architecture. Layer 1 is the MCP gateway exposing find_tool and call_tool. Layer 2 is the RAG pipeline with PostgreSQL and pgvector. Layer 3 is SearXNG for private web search.',
    'Search my documents for info about the gateway'
  ]);

  // SCENARIO 4: Health check then store memory
  await scenario('4. Multi-turn: Health Check & Remember', [
    'Check if all services are healthy',
    'Remember that all services were confirmed healthy during the March 12th stress test'
  ]);

  // SCENARIO 5: Student research workflow — upload notes, search later
  await scenario('5. Student: Upload Notes & Study', [
    'Upload this as "cs-notes.txt": Binary search has O(log n) time complexity. It requires a sorted array. Compare the middle element, then recurse on the left or right half. Base case: element found or subarray is empty.',
    'What do my notes say about time complexity?'
  ]);

  // SCENARIO 6: Developer reads a local file and asks about it
  await scenario('6. Developer: Read & Understand Code', [
    'Read the file C:/Users/sandv/Desktop/chimera/mcp-chimera-gateway/package.json',
    'What dependencies does it use?'
  ]);

  // SCENARIO 7: Cross-tool — web search then save findings to memory
  await scenario('7. Research & Remember', [
    'Search the web for what SearXNG is',
    'Remember the key points about SearXNG from that search'
  ]);

  // SCENARIO 8: Memory continuity — recall from earlier in this test
  await scenario('8. Memory Continuity', [
    'What do you know about our database decisions?',
    'What do you know about SearXNG?'
  ]);

  console.log('\n' + '='.repeat(60));
  console.log('ALL SCENARIOS COMPLETE');
}

main().catch(console.error);
