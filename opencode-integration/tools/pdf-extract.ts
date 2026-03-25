import { tool } from "@opencode-ai/plugin"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export default tool({
  description: `Extract text, tables, and images from PDF files.

  **Usage:**
  - Extract text from PDF: @pdf-extract path='/path/to/file.pdf'
  - Disable OCR: @pdf-extract path='...' ocr=false
  
  **Features:**
  - Uses PyMuPDF (fitz) for text extraction
  - Supports table detection
  - Returns structured markdown output
  - Requires AI Services running on port 18090`,

  args: {
    path: tool.schema.string().describe("Path to the PDF file"),
    ocr: tool.schema.boolean().optional().describe("Enable OCR for scanned PDFs (default: true)"),
  },

  async execute(args) {
    const { path, ocr = true } = args

    try {
      // Call the AI Services endpoint
      const url = `http://localhost:18090/pdf/extract-pdf?path=${encodeURIComponent(path)}&ocr=${ocr}`
      const cmd = `curl -s "${url}"`
      
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 })
      
      if (stderr && !stderr.includes("curl:")) {
        console.error("curl stderr:", stderr)
      }
      
      // Parse JSON response
      interface PDFResult {
        success: boolean
        text?: string
        tables?: string[]
        ocr?: string
        error?: string
      }
      
      const result: PDFResult = JSON.parse(stdout)
      
      if (!result.success) {
        return `**PDF Extraction - Error**

**Path:** ${path}
**Error:** ${result.error || "Unknown error"}

**Troubleshooting:**
1. Check file exists: \`ls -la "${path}"\`
2. Verify file is a valid PDF
3. Ensure AI Services are running: \`curl http://localhost:18090/crawl?url=test\``
      }

      let output = `**PDF Extraction Results**

**File:** ${path}
**OCR Enabled:** ${ocr ? "Yes" : "No"}
**Status:** ✅ Success

---

`
      
      if (result.text && result.text.trim()) {
        output += `## Extracted Text\n\n${result.text}\n\n---\n\n`
      }
      
      if (result.tables && result.tables.length > 0) {
        output += `## Tables Found\n\n`
        result.tables.forEach((table, i) => {
          output += `### Table ${i + 1}\n\n${table}\n\n`
        })
        output += `---\n\n`
      }
      
      if (result.ocr && result.ocr.trim()) {
        output += `## OCR Content\n\n${result.ocr}\n\n---\n\n`
      }
      
      output += "*Extracted using AI Services (PyMuPDF)*"
      
      return output

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage.includes("Connection refused")) {
        return `**PDF Extraction - Service Not Available**

**Path:** ${path}

AI Services are not running on port 18090.

**Start services with:**
\`assist\`

**Or check manually:**
\`curl http://localhost:18090/crawl?url=test\``
      }
      
      return `**PDF Extraction - Error**

**Path:** ${path}
**Error:** ${errorMessage}

**Troubleshooting:**
1. Check file exists: \`ls -la "${path}"\`
2. Start AI Services: \`assist\`
3. Check service status: \`systemctl --user status ai-services\``
    }
  }
})