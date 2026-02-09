import { tool } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"
import { spawn, ChildProcess } from "child_process"

interface LSPConnection {
  process: ChildProcess
  documentUri: string
}

interface WorkspaceEdit {
  changes?: Record<string, unknown[]>
  documentChanges?: unknown[]
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
      reject(new Error(`Rename request timed out`))
    }, 20000)
  })
}

export default tool({
  description: "Rename a symbol across all files in the workspace using LSP",

  args: {
    filePath: tool.schema.string().describe("Absolute path to file containing the symbol"),
    line: tool.schema.number().describe("Line number of the symbol (0-indexed)"),
    character: tool.schema.number().describe("Character position of the symbol (0-indexed)"),
    newName: tool.schema.string().describe("New name for the symbol"),
    dryRun: tool.schema.boolean().optional().describe("Preview changes without applying"),
  },

  async execute(args) {
    const { filePath, line, character, newName, dryRun = false } = args

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }

    if (!newName || newName.trim().length === 0) {
      return { success: false, error: "New name cannot be empty" }
    }

    const conn = getOrCreateConnection(filePath)
    if (!conn) {
      return {
        success: false,
        error: `No LSP server available for ${path.extname(filePath)}`,
      }
    }

    try {
      const result = await sendRequest(conn, "textDocument/rename", {
        textDocument: { uri: conn.documentUri },
        position: { line, character },
        newName,
      })

      const edit: WorkspaceEdit = result as WorkspaceEdit || {}

      if (!edit.changes && !edit.documentChanges) {
        return {
          success: true,
          file: filePath,
          newName,
          changes: {},
          message: "No changes needed (symbol not referenced elsewhere)",
        }
      }

      const changes = edit.changes || {}
      const changeCount = Object.keys(changes).length

      const fileChanges = Object.entries(changes).map(([uri, edits]) => ({
        file: uri.replace("file://", ""),
        uri,
        edits: (edits as unknown[]).map((e: any) => ({
          range: {
            startLine: e.range.start.line + 1,
            startChar: e.range.start.character,
            endLine: e.range.end.line + 1,
            endChar: e.range.end.character,
          },
          newText: e.newText || "",
        })),
      }))

      if (dryRun) {
        return {
          success: true,
          file: filePath,
          symbol: "unknown",
          newName,
          dryRun: true,
          filesAffected: changeCount,
          changes: fileChanges,
          message: `Would rename "${newName}" in ${changeCount} file(s)`,
        }
      }

      return {
        success: true,
        file: filePath,
        newName,
        dryRun: false,
        filesAffected: changeCount,
        changes: fileChanges,
        message: `Renamed "${newName}" in ${changeCount} file(s)`,
      }
    } catch (error) {
      return { success: false, error: `Rename failed: ${error}` }
    }
  },
})
