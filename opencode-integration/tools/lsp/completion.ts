import { tool } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"
import { spawn, ChildProcess } from "child_process"

interface CompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string
  insertText?: string
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
      reject(new Error(`Completion request timed out`))
    }, 10000)
  })
}

export default tool({
  description: "Get code completion suggestions at a cursor position using LSP",

  args: {
    filePath: tool.schema.string().describe("Absolute path to the file"),
    line: tool.schema.number().describe("Line number (0-indexed)"),
    character: tool.schema.number().describe("Character position (0-indexed)"),
    triggerCharacter: tool.schema.string().optional()
      .describe("Trigger character (e.g., '.', '(', ':') if applicable"),
    maxItems: tool.schema.number().optional().describe("Maximum number of suggestions to return"),
  },

  async execute(args) {
    const { filePath, line, character, maxItems = 20 } = args

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
      const result = await sendRequest(conn, "textDocument/completion", {
        textDocument: { uri: conn.documentUri },
        position: { line, character },
        context: args.triggerCharacter
          ? { triggerKind: 2, triggerCharacter: args.triggerCharacter }
          : undefined,
      })

      const items: CompletionItem[] = Array.isArray(result)
        ? result
        : (result as any)?.items || []

      const suggestions = items.slice(0, maxItems).map((item, idx) => ({
        id: idx + 1,
        label: item.label,
        kind: getKindName(item.kind),
        detail: item.detail,
        insertText: item.insertText || item.label,
      }))

      return {
        success: true,
        file: filePath,
        position: { line: line + 1, character },
        count: suggestions.length,
        maxItems,
        suggestions,
      }
    } catch (error) {
      return { success: false, error: `Completion request failed: ${error}` }
    }
  },
})

function getKindName(kind?: number): string {
  if (!kind) return "text"
  const kinds: Record<number, string> = {
    1: "text",
    2: "method",
    3: "function",
    4: "constructor",
    5: "field",
    6: "variable",
    7: "class",
    8: "interface",
    9: "module",
    10: "property",
    11: "unit",
    12: "value",
    13: "enum",
    14: "keyword",
    15: "snippet",
    16: "color",
    17: "file",
    18: "reference",
    19: "folder",
    20: "enumMember",
    21: "constant",
    22: "struct",
    23: "event",
    24: "operator",
    25: "typeParameter",
  }
  return kinds[kind] || "unknown"
}
