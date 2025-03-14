#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Type definitions for tool arguments
// curl -u "{public_key}:{secret_key}"\
// https://{domain}/api/public/metrics/daily\?fromTimestamp=2025-03-13T10:00:00Z\&toTimestamp\=2025-03-13T11:00:00Z
interface QueryLLMMetricsArgs {
  fromTimestamp: string; // ISO 8601 format
  toTimestamp: string; // ISO 8601 format
  page?: number; // default 1
  limit?: number; // default 100
  traceName?: string;
  userId?: string;
  tags?: string[];
  environment?: string[];
}

// Tool definitions
const queryLLMMetricsTool: Tool = {
  name: "query_llm_metrics",
  description: "Query LLM metrics",
  inputSchema: {
    type: "object",
    properties: {
      fromTimestamp: {
        type: "string",
        description: "Start timestamp in ISO 8601 format",
      },
      toTimestamp: {
        type: "string",
        description: "End timestamp in ISO 8601 format",
      },
      page: {
        type: "number",
        description: "Page number (default 1)",
        default: 1,
      },
      limit: {
        type: "number",
        description: "limit (default 100)",
        default: 100,
      },
      traceName: {
        type: "string",
        description: "Trace name",
      },
      userId: {
        type: "string",
        description: "User ID, it's can filter by user",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Tags",
      },
      environment: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Environment",
      },
    },
  },
};

class LanfuseClient {

  // curl -u "pk-lf-fbf20471-0586-4a0f-9e31-abd92ba608d4:sk-lf-4be3be36-f12a-468b-839f-554f02dd1e7d"\
  // https://langfuse-moshimoshi.zeabur.app/api/public/metrics/daily\?fromTimestamp\=2025-03-13T09:00:00Z\&toTimestamp\=2025-03-13T10:00:00Z
  private apiHeader: { Authorization: string, "Content-Type": string };
  private domain: string;

  constructor(domain: string, public_key: string, private_key: string) {
    this.domain = domain

    // 創建 Basic Auth 認證
    const credentials = `${public_key}:${private_key}`;
    const encodedCredentials = btoa(credentials);

    this.apiHeader = {
      Authorization: `Basic ${encodedCredentials}`,
      "Content-Type": "application/json",
    };

  }

  async getLLMMetricsByTimeRange(payload: QueryLLMMetricsArgs): Promise<any> {
    const params = new URLSearchParams({
      fromTimestamp: payload.fromTimestamp,
      toTimestamp: payload.toTimestamp,
      page: payload.page?.toString() || '1',
      limit: payload.limit?.toString() || '100',
      traceName: payload.traceName || '',
      userId: payload.userId || '',
      tags: payload.tags?.join(',') || '',
      environment: payload.environment?.join(',') || '',
    });

    const response = await fetch(
      `${this.domain}/api/public/metrics/daily?${params}`,
      {
        headers: this.apiHeader,
        method: 'GET'
      }
    );

    return response.json();
  }
}

async function main() {

  const public_key = process.env.LANGFUSE_PUBLIC_KEY;
  const private_key = process.env.LANGFUSE_PRIVATE_KEY;
  const domain = process.env.LANGFUSE_DOMAIN || 'https://api.langfuse.com';

  if (!public_key || !private_key) {
    console.error(
      "Please set LANGFUSE_PUBLIC_KEY and LANGFUSE_PRIVATE_KEY environment variables",
    );
    process.exit(1);
  }
  

  console.error("Starting Slack MCP Server...");
  const server = new Server(
    {
      name: "Slack MCP Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const slackClient = new LanfuseClient(domain, public_key, private_key);

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      console.error("Received CallToolRequest:", request);
      try {
        if (!request.params.arguments) {
          throw new Error("No arguments provided");
        }

        switch (request.params.name) {
          case "query_llm_metrics": {
            const args = request.params
              .arguments as unknown as QueryLLMMetricsArgs;
            const response = await slackClient.getLLMMetricsByTimeRange(
              args,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("Received ListToolsRequest");
    return {
      tools: [
        queryLLMMetricsTool,
      ],
    };
  });

  const transport = new StdioServerTransport();
  console.error("Connecting server to transport...");
  await server.connect(transport);

  console.error("Slack MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});