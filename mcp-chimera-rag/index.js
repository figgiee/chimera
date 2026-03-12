const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const https = require("node:https");
const http = require("node:http");

const RAG_URL = process.env.RAG_SERVER_URL || "http://localhost:8080";
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "30000"); // 30s timeout
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3");
const INITIAL_BACKOFF = 500; // 500ms
const MAX_BACKOFF = 10000; // 10s

// HTTP agents with keep-alive for connection pooling
const agentHttp = new http.Agent({ keepAlive: true, maxSockets: 10 });
const agentHttps = new https.Agent({ keepAlive: true, maxSockets: 10 });

const server = new Server(
  { name: "chimera-rag", version: "2.1.0" },
  { capabilities: { tools: {} } }
);

// Helper: Exponential backoff delay
function getBackoffDelay(attempt) {
  return Math.min(INITIAL_BACKOFF * (2 ** attempt) + Math.random() * 100, MAX_BACKOFF);
}

// Helper: Fetch with timeout
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const agent = url.startsWith("https") ? agentHttps : agentHttp;
    const response = await fetch(url, { ...options, signal: controller.signal, agent });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Helper: Retry with exponential backoff
async function fetchWithRetry(url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);

      // Retry on 5xx errors or connection errors
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Check if response is valid JSON for non-204 responses
      if (response.status !== 204) {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error(`Invalid response type: ${contentType}`);
        }
      }

      return response;
    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx) except 429 (rate limit)
      if (error.message?.includes("status: 4") && !error.message?.includes("429")) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown error"}`);
}

// Helper: Validate RAG URL is accessible
async function validateRAGServer() {
  try {
    const response = await fetchWithTimeout(`${RAG_URL}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error(`RAG server validation failed: ${error.message}`);
    return false;
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_documents",
      description:
        "Search through indexed documents in the Chimera RAG knowledge base using semantic vector search. Returns relevant document chunks ranked by similarity.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          limit: {
            type: "number",
            description: "Max results to return (default 5)",
          },
          threshold: {
            type: "number",
            description: "Minimum similarity score 0-1 (default 0.3)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "upload_document",
      description:
        "Upload a text document to the RAG knowledge base. The document will be chunked, embedded via TEI, and stored in pgvector for future semantic search.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Name for the document" },
          content: {
            type: "string",
            description: "The text content of the document",
          },
        },
        required: ["filename", "content"],
      },
    },
    {
      name: "list_documents",
      description:
        "List all documents indexed in the RAG knowledge base with their IDs, filenames, and previews.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "delete_document",
      description:
        "Delete a document and all its embeddings from the RAG knowledge base by document ID.",
      inputSchema: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "The document ID to delete" },
        },
        required: ["document_id"],
      },
    },
    {
      name: "store_conversation",
      description:
        "Store a conversation turn (user message or assistant response) in the RAG database with semantic embedding for future recall. Use this to save important exchanges for long-term memory.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: {
            type: "string",
            description: "Unique conversation identifier",
          },
          role: {
            type: "string",
            enum: ["user", "assistant"],
            description: "Who said this",
          },
          content: {
            type: "string",
            description: "The message content to store",
          },
        },
        required: ["conversation_id", "role", "content"],
      },
    },
    {
      name: "recall_conversation",
      description:
        "Recall relevant past conversation turns from the RAG database using semantic search. Searches across all stored conversations to find contextually similar past exchanges.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to search for in past conversations",
          },
          conversation_id: {
            type: "string",
            description: "Optional: limit search to a specific conversation",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 5)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "rag_health",
      description:
        "Check the health status of all RAG pipeline services (database, embeddings, search, LM Studio).",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_documents": {
        if (!args.query || typeof args.query !== "string" || args.query.trim().length === 0) {
          return {
            content: [{ type: "text", text: "Error: query must be a non-empty string" }],
            isError: true,
          };
        }

        const res = await fetchWithRetry(`${RAG_URL}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query,
            limit: Math.min(Math.max(args.limit || 5, 1), 100),
            threshold: Math.max(Math.min(args.threshold || 0.3, 1), 0),
            type: "documents",
          }),
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "upload_document": {
        if (!args.filename || typeof args.filename !== "string") {
          return {
            content: [{ type: "text", text: "Error: filename is required and must be a string" }],
            isError: true,
          };
        }
        if (!args.content || typeof args.content !== "string") {
          return {
            content: [{ type: "text", text: "Error: content is required and must be a string" }],
            isError: true,
          };
        }

        // Limit to 50MB
        const MAX_FILE_SIZE = 50 * 1024 * 1024;
        if (args.content.length > MAX_FILE_SIZE) {
          return {
            content: [{ type: "text", text: `Error: file size exceeds 50MB limit (${(args.content.length / 1024 / 1024).toFixed(2)}MB)` }],
            isError: true,
          };
        }

        const formData = new FormData();
        const blob = new Blob([args.content], { type: "text/plain" });
        formData.append("file", blob, args.filename);

        const res = await fetchWithRetry(`${RAG_URL}/api/documents/upload`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "list_documents": {
        const res = await fetchWithRetry(`${RAG_URL}/api/documents`);
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "delete_document": {
        if (!args.document_id || typeof args.document_id !== "string") {
          return {
            content: [{ type: "text", text: "Error: document_id is required and must be a string" }],
            isError: true,
          };
        }

        const res = await fetchWithRetry(`${RAG_URL}/api/documents/${encodeURIComponent(args.document_id)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "store_conversation": {
        if (!args.conversation_id || typeof args.conversation_id !== "string") {
          return {
            content: [{ type: "text", text: "Error: conversation_id is required and must be a string" }],
            isError: true,
          };
        }
        if (!args.role || !["user", "assistant"].includes(args.role)) {
          return {
            content: [{ type: "text", text: "Error: role must be 'user' or 'assistant'" }],
            isError: true,
          };
        }
        if (!args.content || typeof args.content !== "string") {
          return {
            content: [{ type: "text", text: "Error: content is required and must be a string" }],
            isError: true,
          };
        }

        const res = await fetchWithRetry(`${RAG_URL}/api/conversations/store`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: args.conversation_id,
            role: args.role,
            content: args.content,
          }),
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "recall_conversation": {
        if (!args.query || typeof args.query !== "string" || args.query.trim().length === 0) {
          return {
            content: [{ type: "text", text: "Error: query must be a non-empty string" }],
            isError: true,
          };
        }

        const res = await fetchWithRetry(`${RAG_URL}/api/conversations/recall`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query,
            conversation_id: args.conversation_id || null,
            limit: Math.min(Math.max(args.limit || 5, 1), 100),
          }),
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "rag_health": {
        const res = await fetchWithRetry(`${RAG_URL}/health`);
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  // Validate RAG server is accessible before starting
  console.error(`Validating RAG server at ${RAG_URL}...`);
  const isHealthy = await validateRAGServer();
  if (!isHealthy) {
    console.error("WARNING: RAG server is not responding. MCP server starting anyway, but tool calls may fail.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Chimera RAG MCP server running on stdio");
}

main().catch(console.error);
