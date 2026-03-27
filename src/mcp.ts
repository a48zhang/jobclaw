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
export interface MCPClientStatus {
  enabled: boolean
  connected: boolean
  message?: string
}

export interface MCPClientConnection {
  client: (MCPClient & { close(): Promise<void> }) | null
  status: MCPClientStatus
}

export async function createMCPClient(): Promise<MCPClientConnection> {
  if (process.env.MCP_DISABLED === '1') {
    return {
      client: null,
      status: {
        enabled: false,
        connected: false,
        message: 'MCP 已通过 MCP_DISABLED=1 禁用',
      },
    }
  }
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['@playwright/mcp@latest', '--headless'],
  })

  const client = new Client({ name: 'jobclaw', version: '0.1.0' })
  try {
    await client.connect(transport)
  } catch (err) {
    try {
      await client.close()
    } catch {
      // ignore
    }
    return {
      client: null,
      status: {
        enabled: true,
        connected: false,
        message: `MCP 连接失败: ${(err as Error).message || 'Failed to connect to MCP server'}`,
      },
    }
  }

  return {
    status: {
      enabled: true,
      connected: true,
      message: 'MCP 已连接',
    },
    client: {
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
        const textParts = (result.content as any[])
          .filter((c) => c.type === 'text')
          .map((c) => c.text)

        if (textParts.length > 0) {
          return textParts.join('\n')
        }

        return JSON.stringify(result.content)
      },

      async close() {
        await client.close()
      },
    },
  }
}
