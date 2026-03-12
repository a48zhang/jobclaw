/**
 * src/mcp.ts — Playwright MCP クライアントファクトリー
 *
 * `@modelcontextprotocol/sdk` の StdioClientTransport を使い、
 * Playwright MCP サーバー（`npx @playwright/mcp@latest`）に接続します。
 * 返値は BaseAgent が期待する MCPClient インターフェースに適合します。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { MCPClient } from './agents/base/types.js'

/**
 * Playwright MCP クライアントを生成して接続する。
 * 呼び出し元は不要になった時点で `close()` すること。
 */
export async function createMCPClient(): Promise<MCPClient & { close(): Promise<void> }> {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['@playwright/mcp@latest', '--headless'],
  })

  const client = new Client({ name: 'jobclaw', version: '0.1.0' })
  await client.connect(transport)

  return {
    async listTools() {
      const { tools } = await client.listTools()
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      }))
    },

    async callTool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args })
      // Extract text content if available to save tokens
      const textParts = (result.content as any[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)

      if (textParts.length > 0) {
        return textParts.join('\n')
      }

      // Fallback to JSON if no text parts found
      return JSON.stringify(result.content)
    },

    async close() {
      await client.close()
    },
  }
}
