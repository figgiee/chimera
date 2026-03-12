const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const RAG_URL = process.env.RAG_SERVER_URL || "http://localhost:8080";
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";
const ALLOWED_DIRS = (process.env.ALLOWED_DIRS || "C:/Users/sandv/Desktop,C:/Users/sandv/Documents,C:/Users/sandv/Downloads").split(",");

const agent = new http.Agent({ keepAlive: true, maxSockets: 10 });

// ─── Tool Registry ───────────────────────────────────────────────
// Every tool Chimera can use. Descriptions are kept SHORT to help
// fuzzy matching without wasting tokens when returned to the model.
const TOOLS = [
  // RAG
  { name: "search_documents", category: "rag", desc: "Semantic search through indexed documents" },
  { name: "upload_document", category: "rag", desc: "Upload text to RAG knowledge base" },
  { name: "list_documents", category: "rag", desc: "List all indexed documents" },
  { name: "delete_document", category: "rag", desc: "Delete a document by ID" },
  { name: "store_conversation", category: "rag", desc: "Save a conversation turn for future recall" },
  { name: "recall_conversation", category: "rag", desc: "Recall past conversations by semantic search" },
  { name: "rag_health", category: "rag", desc: "Check RAG pipeline health status" },

  // Synapse
  { name: "synapse_new_session", category: "synapse", desc: "Start structured workflow (feature/refactor/bugfix/research/debug)" },
  { name: "synapse_answer", category: "synapse", desc: "Answer a Synapse discussion question" },
  { name: "synapse_get_task", category: "synapse", desc: "Get current workflow task with context" },
  { name: "synapse_complete_task", category: "synapse", desc: "Mark workflow task done, advance to next" },
  { name: "synapse_escalate", category: "synapse", desc: "Pause workflow due to a blocker" },
  { name: "synapse_resume", category: "synapse", desc: "Resume workflow after context reset" },

  // Web search
  { name: "web_search", category: "web", desc: "Search the web via SearXNG" },

  // Filesystem
  { name: "read_file", category: "fs", desc: "Read a file from disk" },
  { name: "write_file", category: "fs", desc: "Write content to a file" },
  { name: "list_directory", category: "fs", desc: "List files in a directory" },
  { name: "search_files", category: "fs", desc: "Search for files by name pattern" },
  { name: "read_pdf", category: "fs", desc: "Read text content from a PDF file" },
];

// ─── Fuzzy search ────────────────────────────────────────────────
function findTools(query) {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/);

  const scored = TOOLS.map(tool => {
    const haystack = `${tool.name} ${tool.desc} ${tool.category}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += 1;
      if (tool.name.toLowerCase().includes(term)) score += 2; // boost name matches
    }
    return { ...tool, score };
  });

  return scored
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ name, desc, category }) => ({ name, desc, category }));
}

// ─── HTTP helper ─────────────────────────────────────────────────
async function httpJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, agent });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return {};
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Path security ───────────────────────────────────────────────
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
}

// ─── Tool execution router ───────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    // ── RAG tools ──
    case "search_documents":
      return httpJSON(`${RAG_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          limit: args.limit || 5,
          threshold: args.threshold || 0.3,
          type: "documents",
        }),
      });

    case "upload_document": {
      const formData = new FormData();
      const blob = new Blob([args.content], { type: "text/plain" });
      formData.append("file", blob, args.filename);
      return httpJSON(`${RAG_URL}/api/documents/upload`, {
        method: "POST",
        body: formData,
      });
    }

    case "list_documents":
      return httpJSON(`${RAG_URL}/api/documents`);

    case "delete_document":
      return httpJSON(`${RAG_URL}/api/documents/${encodeURIComponent(args.document_id)}`, {
        method: "DELETE",
      });

    case "store_conversation":
      return httpJSON(`${RAG_URL}/api/conversations/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: args.conversation_id,
          role: args.role,
          content: args.content,
        }),
      });

    case "recall_conversation":
      return httpJSON(`${RAG_URL}/api/conversations/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          conversation_id: args.conversation_id || null,
          limit: args.limit || 5,
        }),
      });

    case "rag_health":
      return httpJSON(`${RAG_URL}/health`);

    // ── Synapse tools ──
    case "synapse_new_session":
      return httpJSON(`${RAG_URL}/api/synapse/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: args.project_id,
          mode: args.mode,
          user_request: args.user_request,
        }),
      });

    case "synapse_answer":
      return httpJSON(`${RAG_URL}/api/synapse/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: args.session_id,
          area_id: args.area_id,
          answer: args.answer,
        }),
      });

    case "synapse_get_task":
      return httpJSON(`${RAG_URL}/api/synapse/task/${encodeURIComponent(args.session_id)}`);

    case "synapse_complete_task":
      return httpJSON(`${RAG_URL}/api/synapse/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: args.session_id,
          task_id: args.task_id,
          notes: args.notes || "",
        }),
      });

    case "synapse_escalate":
      return httpJSON(`${RAG_URL}/api/synapse/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: args.session_id,
          reason: args.reason,
        }),
      });

    case "synapse_resume":
      return httpJSON(`${RAG_URL}/api/synapse/resume/${encodeURIComponent(args.session_id)}`);

    // ── Web search ──
    case "web_search":
      return httpJSON(`${RAG_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          limit: args.limit || 5,
          type: "web",
        }),
      });

    // ── Filesystem tools ──
    case "read_file": {
      if (!args.path) throw new Error("path is required");
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const content = fs.readFileSync(args.path, "utf-8");
      return { path: args.path, content };
    }

    case "write_file": {
      if (!args.path || !args.content) throw new Error("path and content are required");
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const dir = path.dirname(args.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(args.path, args.content, "utf-8");
      return { path: args.path, status: "written", bytes: Buffer.byteLength(args.content) };
    }

    case "list_directory": {
      if (!args.path) throw new Error("path is required");
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const entries = fs.readdirSync(args.path, { withFileTypes: true });
      return {
        path: args.path,
        entries: entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        })),
      };
    }

    case "search_files": {
      if (!args.path || !args.pattern) throw new Error("path and pattern are required");
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      const results = [];
      const regex = new RegExp(args.pattern, "i");
      function walk(dir, depth = 0) {
        if (depth > 5 || results.length >= 20) return;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (regex.test(entry.name)) results.push(full);
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
              walk(full, depth + 1);
            }
          }
        } catch { /* permission errors */ }
      }
      walk(args.path);
      return { pattern: args.pattern, matches: results };
    }

    case "read_pdf": {
      if (!args.path) throw new Error("path is required");
      if (!isPathAllowed(args.path)) throw new Error(`Access denied: ${args.path}`);
      // Delegate to RAG server upload+extract if available, or read raw
      const content = fs.readFileSync(args.path);
      // Return base64 for the model to understand it's binary
      return {
        path: args.path,
        size: content.length,
        note: "PDF binary loaded. Use upload_document to index it, or use search_documents if already indexed.",
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ──────────────────────────────────────────────────
const server = new Server(
  { name: "chimera-gateway", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "find_tool",
      description: "Search for available tools by keyword. Returns matching tool names and descriptions. Always call this first to discover what tools can help with the task.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What you need to do (e.g. 'search web', 'read file', 'workflow')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "call_tool",
      description: "Execute a tool by name. Use find_tool first to discover available tools and their required arguments.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tool name from find_tool results",
          },
          arguments: {
            type: "object",
            description: "Tool arguments as key-value pairs",
          },
        },
        required: ["name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "find_tool") {
      if (!args.query || typeof args.query !== "string") {
        return {
          content: [{ type: "text", text: "Error: query is required" }],
          isError: true,
        };
      }

      const matches = findTools(args.query);

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: "No matching tools found. Try different keywords." }],
        };
      }

      // Return compact format to save tokens
      const lines = matches.map(m => `• ${m.name}: ${m.desc}`);
      return {
        content: [{ type: "text", text: `Found ${matches.length} tools:\n${lines.join("\n")}` }],
      };
    }

    if (name === "call_tool") {
      if (!args.name || typeof args.name !== "string") {
        return {
          content: [{ type: "text", text: "Error: tool name is required" }],
          isError: true,
        };
      }

      const toolArgs = args.arguments || {};
      const result = await executeTool(args.name, toolArgs);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown gateway command: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Chimera Gateway MCP running on stdio");
}

main().catch(console.error);
