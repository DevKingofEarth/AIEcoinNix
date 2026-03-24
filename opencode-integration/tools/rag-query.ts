import { tool } from "@opencode-ai/plugin"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export default tool({
  description: `Query or ingest documents into the local RAG knowledge base.

  **Usage:**
  - Query knowledge base: @rag-query query='your question'
  - Set number of results: @rag-query query='...' top_k=10
  - Ingest documents: @rag-ingest path='/path/to/documents'
  
  **Features:**
  - Semantic search using local RAG
  - Returns relevant context chunks
  - Supports document ingestion from folders
  - Requires AI Services and ragdb package running on port 18090`,

  args: {
    query: tool.schema.string().optional().describe("Search query for the RAG knowledge base"),
    path: tool.schema.string().optional().describe("Path to folder with documents to ingest"),
    top_k: tool.schema.number().optional().describe("Number of results to return (default: 5)"),
  },

  async execute(args) {
    const { query, path, top_k = 5 } = args

    // Determine action: ingest or query
    const isIngest = !!path && !query

    try {
      let url: string
      let cmd: string

      if (isIngest) {
        // Ingest documents
        url = `http://localhost:18090/ingest-rag?path=${encodeURIComponent(path)}`
        cmd = `curl -s "${url}"`
      } else {
        // Query RAG
        url = `http://localhost:18090/query-rag?query=${encodeURIComponent(query)}&top_k=${top_k}`
        cmd = `curl -s "${url}"`
      }
      
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 })
      
      if (stderr && !stderr.includes("curl:")) {
        console.error("curl stderr:", stderr)
      }
      
      // Parse JSON response
      interface RAGResult {
        success: boolean
        results?: Array<{
          text: string
          score: number
          source?: string
        }>
        message?: string
        error?: string
      }
      
      const result: RAGResult = JSON.parse(stdout)
      
      if (!result.success) {
        if (isIngest) {
          return `**RAG Ingest - Error**

**Path:** ${path}
**Error:** ${result.error || "Unknown error"}

**Troubleshooting:**
1. Check folder exists: \`ls -la "${path}"\"
2. Verify AI Services are running
3. Check if ragdb package is installed`
        }
        
        return `**RAG Query - Error**

**Query:** ${query}
**Error:** ${result.error || "Unknown error"}

**Troubleshooting:**
1. Ensure RAG knowledge base is populated
2. Start AI Services: \`assist\`
3. Check service status: \`systemctl --user status ai-services\``
      }

      if (isIngest) {
        return `**RAG Ingest - Success**

**Path:** ${path}
**Status:** ✅ Documents ingested

${result.message || ""}

---
*Use @rag-query to search the knowledge base*`
      }

      // Format query results
      let output = `**RAG Query Results**

**Query:** ${query}
**Top K:** ${top_k}
**Results Found:** ${result.results?.length || 0}

---

`
      
      if (result.results && result.results.length > 0) {
        result.results.forEach((item, i) => {
          output += `### Result ${i + 1} (Score: ${(item.score * 100).toFixed(1)}%)\n\n`
          output += `${item.text}\n\n`
          if (item.source) {
            output += `*Source: ${item.source}*\n\n`
          }
          output += `---\n\n`
        })
      } else {
        output += "*No relevant results found in the knowledge base.*\n\n"
        output += "*Use @rag-ingest to add documents to the RAG knowledge base.*"
      }
      
      output += "\n\n*Powered by AI Services (RAG)*"
      
      return output

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage.includes("Connection refused")) {
        return `**RAG Service - Not Available**

AI Services are not running on port 18090.

**Start services with:**
\`assist\`

**Or check manually:**
\`curl http://localhost:18090/query-rag?query=test\``
      }
      
      if (isIngest) {
        return `**RAG Ingest - Error**

**Path:** ${path}
**Error:** ${errorMessage}

**Troubleshooting:**
1. Check folder exists
2. Start AI Services: \`assist\``
      }
      
      return `**RAG Query - Error**

**Query:** ${query}
**Error:** ${errorMessage}

**Troubleshooting:**
1. Start AI Services: \`assist\`
2. Check service status: \`systemctl --user status ai-services\``
    }
  }
})