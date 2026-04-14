import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StaplerApiClient } from "./client.js";
import { readConfigFromEnv, type StaplerMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createStaplerMcpServer(config: StaplerMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "paperclip",
    version: "0.1.0",
  });

  const client = new StaplerApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: StaplerMcpConfig = readConfigFromEnv()) {
  const { server } = createStaplerMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
