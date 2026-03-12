const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const http = require("node:http");

const RAG_URL = process.env.RAG_SERVER_URL || "http://localhost:8080";
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "30000");

const agent = new http.Agent({ keepAlive: true, maxSockets: 10 });

const server = new Server(
  { name: "chimera-synapse", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// --- Helpers ---

async function ragFetch(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const url = `${RAG_URL}${path}`;
    const res = await fetch(url, { ...options, signal: controller.signal, agent });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(msg) {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// --- Tool definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "synapse_new_session",
      description:
        "Start a new Synapse workflow session. Choose a mode (feature, refactor, bugfix, research, debug) and describe what you want to accomplish. Returns the first discussion question to resolve before work begins.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project identifier (e.g. 'chimera', 'my-app')" },
          mode: { type: "string", enum: ["feature", "refactor", "bugfix", "research", "debug"], description: "Workflow mode" },
          user_request: { type: "string", description: "What you want to accomplish" },
        },
        required: ["project_id", "mode", "user_request"],
      },
    },
    {
      name: "synapse_answer",
      description:
        "Answer a Synapse discussion question. After all required questions are answered, a plan is auto-generated and execution begins. Say 'you decide' to delegate optional decisions.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID from synapse_new_session" },
          area_id: { type: "string", description: "The area_id from the question" },
          answer: { type: "string", description: "Your answer (or 'you decide' to delegate)" },
        },
        required: ["session_id", "area_id", "answer"],
      },
    },
    {
      name: "synapse_get_task",
      description:
        "Get the current task to work on with compact context. Returns only what's needed for this specific task — mode, decisions, progress, and the task description. Use this after discussion is complete.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "synapse_complete_task",
      description:
        "Mark the current task as done and advance to the next one. Include brief notes about what was accomplished. When all tasks are done, the session completes with verification criteria.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID" },
          task_id: { type: "string", description: "The task ID being completed" },
          notes: { type: "string", description: "Brief notes on what was done" },
        },
        required: ["session_id", "task_id"],
      },
    },
    {
      name: "synapse_escalate",
      description:
        "Pause the session because of a blocker. Use when you hit an issue that needs human input — unclear requirements, risky operation, missing access, etc.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID" },
          reason: { type: "string", description: "What's blocking progress" },
        },
        required: ["session_id", "reason"],
      },
    },
    {
      name: "synapse_resume",
      description:
        "Resume a session after a context reset, escalation, or new conversation. Returns compact state so you can pick up exactly where you left off without reloading the full history.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID to resume" },
        },
        required: ["session_id"],
      },
    },
  ],
}));

// --- Tool handlers ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "synapse_new_session": {
        if (!args.project_id || !args.mode || !args.user_request) {
          return err("project_id, mode, and user_request are all required");
        }
        const data = await ragFetch("/api/synapse/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: args.project_id,
            mode: args.mode,
            user_request: args.user_request,
          }),
        });
        return ok(data);
      }

      case "synapse_answer": {
        if (!args.session_id || !args.area_id || !args.answer) {
          return err("session_id, area_id, and answer are all required");
        }
        const data = await ragFetch("/api/synapse/discuss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: args.session_id,
            area_id: args.area_id,
            answer: args.answer,
          }),
        });
        return ok(data);
      }

      case "synapse_get_task": {
        if (!args.session_id) {
          return err("session_id is required");
        }
        const data = await ragFetch(`/api/synapse/task/${encodeURIComponent(args.session_id)}`);
        return ok(data);
      }

      case "synapse_complete_task": {
        if (!args.session_id || !args.task_id) {
          return err("session_id and task_id are required");
        }
        const data = await ragFetch("/api/synapse/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: args.session_id,
            task_id: args.task_id,
            notes: args.notes || "",
          }),
        });
        return ok(data);
      }

      case "synapse_escalate": {
        if (!args.session_id || !args.reason) {
          return err("session_id and reason are required");
        }
        const data = await ragFetch("/api/synapse/escalate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: args.session_id,
            reason: args.reason,
          }),
        });
        return ok(data);
      }

      case "synapse_resume": {
        if (!args.session_id) {
          return err("session_id is required");
        }
        const data = await ragFetch(`/api/synapse/resume/${encodeURIComponent(args.session_id)}`);
        return ok(data);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return err(error.message);
  }
});

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Chimera Synapse MCP server running on stdio");
}

main().catch(console.error);
