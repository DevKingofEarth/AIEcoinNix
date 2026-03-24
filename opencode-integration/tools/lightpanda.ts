import { tool } from "@opencode-ai/plugin"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export default tool({
  description: `Fetch web pages with JavaScript rendering using Lightpanda browser.

  **Usage:**
  - Fetch page: @lightpanda url='https://example.com'
  
  **Features:**
  - JavaScript rendering (unlike httpx which only gets static HTML)
  - 11x faster than Chrome, 9x less memory
  - Supports SPAs, dashboards, social media
  - Installed via NixOS (available in PATH)
  
  **When to use:**
  - Site requires JS to load content
  - Dynamic content not available via static fetch
  - SPAs, React/Vue/Angular apps
  - Social media pages`,
  
  args: {
    url: tool.schema.string().describe("URL to fetch with JavaScript rendering"),
    timeout: tool.schema.number().optional().describe("Timeout in seconds (default: 30)"),
  },
  
  async execute(args) {
    const { url, timeout = 30 } = args
    
    try {
      // Lightpanda on NixOS needs to be invoked with its dynamic linker directly
      // because NixOS has a stub loader that blocks generic Linux binaries
      const lightpandaBin = "/run/current-system/sw/bin/lightpanda"
      const dynamicLinker = "/nix/store/vr7ds8vwbl2fz7pr221d5y0f8n9a5wda-glibc-2.40-218/lib64/ld-linux-x86-64.so.2"
      const libPath = "/nix/store/vr7ds8vwbl2fz7pr221d5y0f8n9a5wda-glibc-2.40-218/lib:/nix/store/vr7ds8vwbl2fz7pr221d5y0f8n9a5wda-glibc-2.40-218/lib64"
      
      const cmd = `${dynamicLinker} --library-path ${libPath} ${lightpandaBin} fetch --insecure_disable_tls_host_verification ${url}`
      
      const { stdout, stderr } = await execAsync(cmd, { 
        timeout: timeout * 1000 
      })
      
      let output = stdout
      if (stderr && !stderr.includes('INFO')) {
        output += '\n' + stderr
      }
      
      return `**Lightpanda Fetch Complete**

**URL:** ${url}

${output.slice(0, 5000)}

---
*Fetched using Lightpanda (headless browser)*`
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage.includes('ENOENT')) {
        return `**Lightpanda - Binary Not Found**

Lightpanda not found in PATH. Run:
\`sudo nixos-rebuild switch\`

Or check: which lightpanda`
      }
      
      if (errorMessage.includes('timeout')) {
        return `**Lightpanda - Timeout**

**URL:** ${url}
**Timeout:** ${timeout}s

Page took too long to load. Try:
1. Increase timeout parameter
2. Check if site is accessible
3. Try simpler URL`
      }
      
      return `**Lightpanda - Error**

**URL:** ${url}
**Error:** ${errorMessage}

**Troubleshooting:**
1. Verify URL is accessible
2. Check Lightpanda binary: ~/.local/bin/lightpanda
3. Try running manually: lightpanda fetch ${url}`
    }
  }
})
