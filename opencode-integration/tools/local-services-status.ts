import { tool } from "@opencode-ai/plugin"

interface ServiceStatus {
  name: string
  url: string
  port: number
  status: 'running' | 'stopped' | 'error'
  responseTime?: number
  error?: string
}

export default tool({
  description: `📊 Check status of all local AI services (Ollama, Web Parser, SearXNG, Open-WebUI).
  
  **Usage:**
  @local-services-status
  
  **Services Checked:**
  - Web Parser (localhost:18090)
  - SearXNG (localhost:18081)  
  - Ollama (localhost:11434)
  - Open-WebUI (localhost:18080)
  
  Returns detailed status, response times, and troubleshooting tips.`,
  
  args: {
    verbose: tool.schema.boolean().default(false).describe("Show detailed troubleshooting information"),
  },
  
  async execute(args, context) {
    const { verbose } = args
    
    const services: ServiceStatus[] = [
      { name: 'Web Parser', url: 'http://localhost:18090', port: 18090, status: 'stopped' },
      { name: 'SearXNG', url: 'http://localhost:18081', port: 18081, status: 'stopped' },
      { name: 'Ollama', url: 'http://localhost:11434', port: 11434, status: 'stopped' },
      { name: 'Open-WebUI', url: 'http://localhost:18080', port: 18080, status: 'stopped' }
    ]

    let output = `📊 **Local AI Services Status**\n\n`
    let allRunning = true

    // Check each service
    for (const service of services) {
      const startTime = Date.now()
      
      try {
        const response = await fetch(service.url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        })
        
        service.responseTime = Date.now() - startTime
        
        if (response.ok) {
          service.status = 'running'
        } else {
          service.status = 'error'
          service.error = `HTTP ${response.status}`
          allRunning = false
        }
      } catch (error) {
        service.status = 'stopped'
        service.error = error instanceof Error ? error.message : String(error)
        allRunning = false
      }
    }

    // Generate status report
    for (const service of services) {
      const statusEmoji = service.status === 'running' ? '🟢' : 
                         service.status === 'error' ? '🟡' : '🔴'
      
      output += `${statusEmoji} **${service.name}** (${service.port}): ${service.status.toUpperCase()}`
      
      if (service.responseTime) {
        output += ` - ${service.responseTime}ms`
      }
      
      if (service.error && verbose) {
        output += `\n   └─ Error: ${service.error}`
      }
      
      output += `\n`
    }

    output += `\n---\n`

    if (allRunning) {
      output += `✅ **All services are running!** Your local AI stack is ready to use.\n\n`
      output += `**Quick Commands:**\n`
      output += `- Use @local-web for web search\n`
      output += `- Access Open-WebUI: http://localhost:18080\n`
      output += `- Access Perplexica: http://localhost:3000\n`
    } else {
      output += `⚠️ **Some services need attention**\n\n`
      output += `**To start all services:**\n`
      output += `\`assist\`\n\n`
      output += `**To stop all services:**\n`
      output += `\`assist-close\`\n\n`
      
      if (verbose) {
        output += `**Manual service commands:**\n`
        output += `- Web Parser: \`systemctl --user start web-parser\`\n`
        output += `- SearXNG: \`sudo systemctl start searx\`\n`
        output += `- Ollama: \`sudo systemctl start ollama\`\n`
        output += `- Open-WebUI: \`sudo systemctl start open-webui\`\n\n`
        
        output += `**Check service logs:**\n`
        output += `- Web Parser: \`journalctl --user -u web-parser -f\`\n`
        output += `- SearXNG: \`journalctl -u searx -f\`\n`
        output += `- Ollama: \`journalctl -u ollama -f\`\n`
        output += `- Open-WebUI: \`journalctl -u open-webui -f\`\n`
      }
    }

    return output
  }
})