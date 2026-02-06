import { tool } from "@opencode-ai/plugin"

interface ServiceConfig {
  webParser: {
    url: string
    timeout: number
  }
  ollama: {
    url: string
    timeout: number
  }
}

export default tool({
  description: `Private local web search using your SearXNG + Web Parser services.
  
  **Usage:**
  - Quick search: @local-web query='latest AI news'
  - Deep research: @local-web query='machine learning trends' deep=true
  - URL extraction: @local-web query='https://example.com'
  
  **Features:**
  - 100% private (local SearXNG + Web Parser)
  - Token-efficient (no external API calls)
  - Comprehensive analysis with deep=true
  
  **Service Details:**
  - Web Parser: http://localhost:18090
  - SearXNG: http://localhost:18081
  
  Uses local services - no external APIs`,
  
  args: {
    query: tool.schema.string().describe("Search query, research topic, or direct URL"),
    deep: tool.schema.boolean().default(false).describe("Enable comprehensive crawling and content extraction"),
    timeout: tool.schema.number().default(60000).describe("Request timeout in milliseconds"),
    maxResults: tool.schema.number().default(10).describe("Maximum number of results to return"),
  },
  
  async execute(args) {
    const { query, deep, timeout, maxResults } = args
    
    const config: ServiceConfig = {
      webParser: {
        url: "http://localhost:18090",
        timeout: deep ? 60000 : 30000
      },
      ollama: {
        url: "http://localhost:11434",
        timeout: 10000
      }
    }

    const serviceStatus = await checkServiceStatus(config.webParser.url)
    if (!serviceStatus.available) {
      return `**Web Search Failed**

**Error**: Web Parser service is not accessible at ${config.webParser.url}

**Solutions:**
1. Start services: \`assist\`
2. Check status: \`systemctl --user status web-parser\`
3. Verify port: \`netstat -tlnp | grep 18090\`

**Service Details:**
- Web Parser: ${config.webParser.url}
- Expected Status: Running
- Current Status: ${serviceStatus.error || 'Unknown'}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout || config.webParser.timeout)

    try {
      const response = await fetch(`${config.webParser.url}/crawl?${new URLSearchParams({
        url: query,
        deep: String(deep),
        max_results: String(maxResults)
      })}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0',
          'Accept': 'text/plain; charset=utf-8',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorMessage = `HTTP ${response.status}: ${response.statusText}`
        return `**Web Search Failed**

**Error**: Service returned ${response.status}: ${response.statusText}

**Troubleshooting:**
1. Check service logs: \`journalctl --user -u web-parser -f\`
2. Restart service: \`systemctl --user restart web-parser\`
3. Test manually: \`curl "${config.webParser.url}/crawl?url=test"\``
      }

      const content = await response.text()
      
      if (!content || content.trim() === '') {
        return `**Web Search Failed**

**Error**: Empty response from web parser service

**Troubleshooting:**
1. Check service logs: \`journalctl --user -u web-parser -f\`
2. Verify SearXNG is running: \`curl http://localhost:18081\`
3. Test manually: \`curl "${config.webParser.url}/crawl?url=test"\``
      }

      return `**Local Web Search Complete**

${content}

---
**Search Details:**
- Query: "${query}"
- Mode: ${deep ? 'Deep Research' : 'Quick Search'}
- Results: ${maxResults} max
- Service: ${config.webParser.url}`
    } catch (error) {
      clearTimeout(timeoutId)
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutMsg = deep ? 'Deep research timed out' : 'Web search timed out'
        return `**Web Search Failed**

**Error**: ${timeoutMsg} after ${timeout}ms

**Solutions:**
1. Increase timeout parameter
2. Try simpler search query
3. Use deep=false for faster results
4. Check service performance: \`curl -w "%{time_total}" -o /dev/null -s "${config.webParser.url}/crawl?url=test"\``
      }
      
      return `**Web Search Failed**

**Error**: Network error: ${errorMessage}

**Troubleshooting:**
1. Verify service is running: \`systemctl --user status web-parser\`
2. Check network connectivity: \`curl ${config.webParser.url}\`
3. Restart services: \`assist-close && assist\``
    }
  }
})

async function checkServiceStatus(url: string): Promise<{available: boolean, error?: string}> {
  try {
    const response = await fetch(`${url}/crawl?url=test&deep=false`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })
    return { available: response.status < 500 }
  } catch (error) {
    return { 
      available: false, 
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
