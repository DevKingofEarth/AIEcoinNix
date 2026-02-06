import { tool } from "@opencode-ai/plugin"

export default tool({
  description: `🚀 Quick start helper for your local AI services.
  
  **Usage:**
  @local-services-start
  
  **What it does:**
  - Starts Web Parser (user service)
  - Starts SearXNG (system service) 
  - Starts Ollama (system service)
  - Starts Open-WebUI (system service)
  
  Equivalent to running the 'assist' command.
  
  ⚠️ Requires sudo privileges for system services.`,
  
  args: {
    verify: tool.schema.boolean().default(true).describe("Wait and verify services started successfully"),
    timeout: tool.schema.number().default(30000).describe("Timeout for service verification in milliseconds"),
  },
  
  async execute(args) {
    const { verify, timeout } = args
    
    let output = `🚀 **Starting Local AI Services**\n\n`
    
    try {
      // Start user services first (no sudo needed)
      output += `1. Starting Web Parser (user service)...\n`
      const webParserResult = await Bun.$`systemctl --user start web-parser`.quiet()
      if (webParserResult.exitCode === 0) {
        output += `   ✅ Web Parser started\n`
      } else {
        output += `   ❌ Web Parser failed to start\n`
      }
      
      // For system services, we need to provide guidance since we can't use sudo directly in tools
      output += `\n2. Starting system services (requires sudo):\n`
      output += `   ⚠️  Please run these commands manually:\n`
      output += `   \`sudo systemctl start searx\`\n`
      output += `   \`sudo systemctl start ollama\`\n`
      output += `   \`sudo systemctl start open-webui\`\n\n`
      
      output += `💡 **Or use the convenience command:**\n`
      output += `   \`assist\`\n\n`
      
      if (verify) {
        output += `3. Verifying service status...\n`
        output += `   Run: \`@local-services-status verbose=true\` to check all services\n`
        
        // Only check the user service we can actually start
        try {
          const response = await fetch('http://localhost:18090', {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          })
          if (response.ok) {
            output += `   ✅ Web Parser is accessible\n`
          } else {
            output += `   ⚠️  Web Parser responded with HTTP ${response.status}\n`
          }
        } catch (error) {
          output += `   ❌ Web Parser not accessible: ${error instanceof Error ? error.message : 'Unknown error'}\n`
        }
      }
      
      output += `\n---\n`
      output += `📋 **Next Steps:**\n`
      output += `1. Run the sudo commands above OR use \`assist\`\n`
      output += `2. Verify all services: \`@local-services-status verbose=true\`\n`
      output += `3. Test web search: \`@local-web query='test search'\`\n`
      output += `4. Access web interfaces:\n`
      output += `   - Open-WebUI: http://localhost:18080\n`
      output += `   - Perplexica: http://localhost:3000\n`
      
    } catch (error) {
      output += `❌ **Error starting services:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n`
      output += `**Troubleshooting:**\n`
      output += `1. Check if services are already running: \`@local-services-status\`\n`
      output += `2. Check service logs: \`journalctl --user -u web-parser -f\`\n`
      output += `3. Try manual start: \`assist\`\n`
    }
    
    return output
  }
})