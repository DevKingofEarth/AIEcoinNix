import { tool } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"
import { spawn, ChildProcess } from "child_process"

interface LSPConnection {
  process: ChildProcess
  documentUri: string
  serverPath: string
}

interface ServerConfig {
  command: string[]
  languageId: string
}

const SERVER_CONFIGS: Record<string, ServerConfig> = {
  typescript: {
    command: ["typescript-language-server", "--stdio"],
    languageId: "typescript",
  },
  python: {
    command: ["python-lsp-server", "--stdio"],
    languageId: "python",
  },
  javascript: {
    command: ["typescript-language-server", "--stdio"],
    languageId: "javascript",
  },
}

const state = new Map<string, LSPConnection>()

function getLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const languageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
  }
  return languageMap[ext] || "typescript"
}

function initServer(filePath: string): LSPConnection | null {
  const languageId = getLanguageId(filePath)
  const config = SERVER_CONFIGS[languageId]

  if (!config) {
    return null
  }

  try {
    const command = `~/.config/opencode/lsp-wrapper.sh ${config.command[0]} ${config.command.slice(1).join(" ")}`
    const process = spawn("bash", ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    process.stderr?.on("data", (data) => {
      console.error(`LSP Server stderr: ${data}`)
    })

    const connection: LSPConnection = {
      process,
      documentUri: `file://${filePath}`,
      serverPath: filePath,
    }

    state.set(filePath, connection)
    return connection
  } catch (error) {
    console.error(`Failed to start LSP server: ${error}`)
    return null
  }
}

function sendRequest(connection: LSPConnection, method: string, params: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substring(7)
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    })

    connection.process.stdin?.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)

    const onResponse = (data: Buffer) => {
      const response = JSON.parse(data.toString())
      if (response.id === id) {
        connection.process.stdout?.off("data", onResponse)
        resolve(response.result)
      }
    }

    connection.process.stdout?.on("data", onResponse)

    setTimeout(() => {
      connection.process.stdout?.off("data", onResponse)
      reject(new Error(`LSP request ${method} timed out`))
    }, 10000)
  })
}

export default tool({
  description: "LSP Client - Connect to language server for file diagnostics and analysis",

  args: {
    filePath: tool.schema.string().describe("Absolute path to file to analyze"),
    command: tool.schema.enum(["connect", "diagnostics", "close"]).describe("LSP command"),
  },

  async execute(args) {
    const { filePath, command } = args

    switch (command) {
      case "connect": {
        const connection = initServer(filePath)
        if (!connection) {
          return {
            success: false,
            error: `No LSP server configured for ${path.extname(filePath)} files`,
            supportedTypes: Object.keys(SERVER_CONFIGS),
          }
        }

        return {
          success: true,
          message: `Connected to LSP server for ${filePath}`,
          languageId: getLanguageId(filePath),
        }
      }

      case "diagnostics": {
        let connection = state.get(filePath)
        if (!connection) {
          connection = initServer(filePath)
        }

        if (!connection) {
          return {
            success: false,
            error: `Could not establish LSP connection for ${filePath}`,
          }
        }

        try {
          const result = await sendRequest(connection, "textDocument/diagnostic", {
            textDocument: { uri: connection.documentUri },
          })

          return {
            success: true,
            diagnostics: result,
            file: filePath,
          }
        } catch (error) {
          return {
            success: false,
            error: `Diagnostic request failed: ${error}`,
          }
        }
      }

      case "close": {
        const connection = state.get(filePath)
        if (connection) {
          connection.process.kill()
          state.delete(filePath)
          return { success: true, message: `LSP connection closed for ${filePath}` }
        }
        return { success: false, error: "No active connection for this file" }
      }

      default:
        return { success: false, error: `Unknown command: ${command}` }
    }
  },
})
