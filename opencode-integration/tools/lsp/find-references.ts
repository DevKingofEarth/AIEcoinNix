import { tool } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"
import { spawn, ChildProcess } from "child_process"

interface Location {
  uri: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

interface LSPConnection {
  process: ChildProcess
  documentUri: string
}

const SERVER_CONFIGS: Record<string, { command: string[] }> = {
  typescript: { command: ["typescript-language-server", "--stdio"] },
  javascript: { command: ["typescript-language-server", "--stdio"] },
  python: { command: ["python-lsp-server", "--stdio"] },
}

const connections = new Map<string, LSPConnection>()

function getLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
  }
  return map[ext] || "typescript"
}

function getOrCreateConnection(filePath: string): LSPConnection | null {
  let conn = connections.get(filePath)
  if (conn) return conn

  const lang = getLanguageId(filePath)
  const config = SERVER_CONFIGS[lang]
  if (!config) return null

  try {
    const command = `~/.config/opencode/lsp-wrapper.sh ${config.command[0]} ${config.command.slice(1).join(" ")}`
    const proc = spawn("bash", ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    conn = {
      process: proc,
      documentUri: `file://${filePath}`,
    }

    connections.set(filePath, conn)
    return conn
  } catch {
    return null
  }
}

function sendRequest(conn: LSPConnection, method: string, params: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const id = Date.now().toString()
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    })

    conn.process.stdin?.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)

    const handler = (data: Buffer) => {
      const text = data.toString()
      const parts = text.split("\r\n\r\n")
      if (parts.length >= 2) {
        try {
          const response = JSON.parse(parts[1])
          if (response.id === id) {
            conn.process.stdout?.off("data", handler)
            resolve(response.result || {})
          }
        } catch {
          // Not parseable yet
        }
      }
    }

    conn.process.stdout?.on("data", handler)

    setTimeout(() => {
      conn.process.stdout?.off("data", handler)
      reject(new Error(`Find references request timed out`))
    }, 15000)
  })
}

export default tool({
  description: "Find all references to a symbol across the codebase using LSP",

  args: {
    filePath: tool.schema.string().describe("Absolute path to the file containing the symbol"),
    line: tool.schema.number().describe("Line number where symbol is located (0-indexed)"),
    character: tool.schema.number().describe("Character position of symbol (0-indexed)"),
    symbol: tool.schema.string().describe("Name of the symbol to search for"),
  },

  async execute(args) {
    const { filePath, line, character } = args

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }

    const conn = getOrCreateConnection(filePath)
    if (!conn) {
      return {
        success: false,
        error: `No LSP server available for ${path.extname(filePath)}`,
      }
    }

    try {
      const result = await sendRequest(conn, "textDocument/references", {
        textDocument: { uri: conn.documentUri },
        position: { line, character },
        context: { includeDeclaration: true },
      })

      const locations: Location[] = Array.isArray(result) ? result : [result].filter(Boolean)

      if (locations.length === 0) {
        return {
          success: true,
          symbol: args.symbol || "unknown",
          references: [],
          count: 0,
          message: "No references found",
        }
      }

      const references = locations.map((loc, idx) => {
        const refPath = loc.uri.replace("file://", "")
        return {
          id: idx + 1,
          file: refPath,
          line: loc.range.start.line + 1,
          uri: loc.uri,
        }
      })

      return {
        success: true,
        symbol: args.symbol || "unknown",
        references: references,
        count: references.length,
        file: filePath,
        position: { line: line + 1, character },
      }
    } catch (error) {
      return { success: false, error: `Find references failed: ${error}` }
    }
  },
})
