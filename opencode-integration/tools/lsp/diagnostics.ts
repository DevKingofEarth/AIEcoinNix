import { tool } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"
import { spawn, ChildProcess } from "child_process"

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity: number
  message: string
  source?: string
  code?: string | number
}

interface LSPConnection {
  process: ChildProcess
  documentUri: string
  serverPath: string
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

function initServer(filePath: string): LSPConnection | null {
  const lang = getLanguageId(filePath)
  const config = SERVER_CONFIGS[lang]
  if (!config) return null

  try {
    const command = `~/.config/opencode/lsp-wrapper.sh ${config.command[0]} ${config.command.slice(1).join(" ")}`
    const proc = spawn("bash", ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    const conn: LSPConnection = {
      process: proc,
      documentUri: `file://${filePath}`,
      serverPath: filePath,
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
      try {
        const text = data.toString()
        const parts = text.split("\r\n\r\n")
        if (parts.length >= 2) {
          const response = JSON.parse(parts[1])
          if (response.id === id) {
            conn.process.stdout?.off("data", handler)
            resolve(response.result || {})
          }
        }
      } catch {
        // Not a complete response yet
      }
    }

    conn.process.stdout?.on("data", handler)

    setTimeout(() => {
      conn.process.stdout?.off("data", handler)
      reject(new Error(`Timeout: ${method}`))
    }, 15000)
  })
}

export default tool({
  description: "Fetch diagnostic information (errors, warnings, hints) for a file using LSP",

  args: {
    filePath: tool.schema.string().describe("Absolute path to file"),
    severity: tool.schema.enum(["error", "warning", "hint", "info"]).optional()
      .describe("Filter by severity level"),
    languageId: tool.schema.string().optional()
      .describe("Language ID (typescript, python, javascript) - auto-detected if not provided"),
  },

  async execute(args) {
    const { filePath, severity, languageId } = args

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }

    let conn = connections.get(filePath)
    if (!conn) {
      const lang = languageId || getLanguageId(filePath)
      conn = initServerWithLang(filePath, lang)
    }

    if (!conn) {
      return {
        success: false,
        error: `Could not initialize LSP server for ${filePath}`,
        hint: "Install language server: npm i -g typescript-language-server OR pip install python-lsp-server",
      }
    }

    try {
      const result = await sendRequest(conn, "textDocument/diagnostic", {
        textDocument: { uri: conn.documentUri },
      })

      const diagnostics = (result as any).items || []
      const filtered = severity
        ? diagnostics.filter((d: Diagnostic) => getSeverityName(d.severity) === severity)
        : diagnostics

      return {
        success: true,
        file: filePath,
        totalDiagnostics: diagnostics.length,
        filteredCount: filtered.length,
        severity,
        diagnostics: filtered.map((d: Diagnostic) => ({
          line: d.range.start.line + 1,
          message: d.message,
          severity: getSeverityName(d.severity),
          source: d.source || "lsp",
        })),
      }
    } catch (error) {
      return { success: false, error: `Diagnostic request failed: ${error}` }
    }
  },
})

function initServerWithLang(filePath: string, lang: string): LSPConnection | null {
  const config = SERVER_CONFIGS[lang] || SERVER_CONFIGS.typescript
  try {
    const command = `~/.config/opencode/lsp-wrapper.sh ${config.command[0]} ${config.command.slice(1).join(" ")}`
    const proc = spawn("bash", ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    return {
      process: proc,
      documentUri: `file://${filePath}`,
      serverPath: filePath,
    }
  } catch {
    return null
  }
}

function getSeverityName(severity: number): string {
  const names: Record<number, string> = {
    1: "error",
    2: "warning",
    3: "info",
    4: "hint",
  }
  return names[severity] || "unknown"
}
