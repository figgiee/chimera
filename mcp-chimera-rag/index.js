const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const RAG_URL = process.env.RAG_SERVER_URL || "http://localhost:8080";

const server = new Server(
  { name: "chimera-rag", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

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
        const res = await fetch(`${RAG_URL}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query,
            limit: args.limit || 5,
            threshold: args.threshold || 0.3,
            type: "documents",
          }),
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "upload_document": {
        const formData = new FormData();
        const blob = new Blob([args.content], { type: "text/plain" });
        formData.append("file", blob, args.filename);

        const res = await fetch(`${RAG_URL}/api/documents/upload`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "list_documents": {
        const res = await fetch(`${RAG_URL}/api/documents`);
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "delete_document": {
        const res = await fetch(`${RAG_URL}/api/documents/${args.document_id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "store_conversation": {
        const res = await fetch(`${RAG_URL}/api/conversations/store`, {
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
        const res = await fetch(`${RAG_URL}/api/conversations/recall`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query,
            conversation_id: args.conversation_id || null,
            limit: args.limit || 5,
          }),
        });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "rag_health": {
        const res = await fetch(`${RAG_URL}/health`);
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Chimera RAG MCP server running on stdio");
}

main().catch(console.error);
