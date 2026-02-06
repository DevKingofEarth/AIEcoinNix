{ config, pkgs, lib, ... }:

let
  ###########################################################################
  # Python env for Docling (moved outside the big attr-set)
  ###########################################################################
  pyPower = pkgs.python313.withPackages (ps: with ps; [
    fastapi uvicorn python-multipart httpx beautifulsoup4 trafilatura
  ]);

in
{
  ###########################################################################
  # 1.  OLLAMA  – CPU only, LAN reachable for phone app
  ###########################################################################
  services.ollama = {
    enable       = true;
    acceleration = false;
    environmentVariables = {
      OLLAMA_HOST = "0.0.0.0:11434";
      OLLAMA_KEEP_ALIVE = "0";
    };
   };
  systemd.services.ollama.serviceConfig.MemoryMax = "8G";
  systemd.services.ollama.wantedBy = [ ];


 ###########################################################################
 # PERPLEXICA – AI-Powered Research Engine (port 3000)
 # FINAL VERSION: For use AFTER manual 'npm run build'
 ###########################################################################
 systemd.services.perplexica = {
   enable = true;
   wantedBy = [ ]; # Start manually with `assist`
   after = [ "network-online.target" "searx.service" ];
   wants = [ "network-online.target" "searx.service" ];
   # The service only needs Node.js at runtime
   path = with pkgs; [ nodejs_20 ];
   environment = {
     SEARXNG_URL = "http://127.0.0.1:18081";
     OLLAMA_API_URL = "http://127.0.0.1:11434";
     NODE_ENV = "production";
     PORT = "3000";
   };
   serviceConfig = {
     Type = "simple";
     User = "$OLLAMA_USER";           # ⚠️ REPLACE with your username
     WorkingDirectory = "$PERPLEXICA_PATH";  # ⚠️ REPLACE with your perplexica path
     # CORRECT COMMAND: Start the Next.js production server
     ExecStart = "${pkgs.nodejs_20}/bin/node node_modules/.bin/next start";
     Restart = "on-failure";
     RestartSec = "10s";
     MemoryMax = "4G";
   };
 };

 ###########################################################################
 # 3.  SEARXNG  – Privacy-focused meta search engine
 ###########################################################################
 services.searx = {
   enable = true;
   settings = {
     server = {
       port = 18081;  # Different port from Open WebUI (18080)
       bind_address = "127.0.0.1";
       # Generate with: openssl rand -hex 32
       secret_key = "$SEARXNG_SECRET";  # ⚠️ REPLACE with: openssl rand -hex 32
     };
     search = {
       formats = ["html" "json"];  # JSON is crucial for your API
       safesearch = 0;  # 0=off, 1=moderate, 2=strict
       autocomplete = "duckduckgo";
     };
     engines = [
       {
         name = "duckduckgo";
         engine = "duckduckgo";
         shortcut = "ddg";
         disabled = false;
       }
       {
         name = "startpage";
         engine = "startpage";
         shortcut = "sp";
         disabled = false;
       }
       {
         name = "qwant";
         engine = "qwant";
         shortcut = "qw";
         disabled = false;
       }
       {
         name = "wikipedia";
         engine = "wikipedia";
         shortcut = "wp";
         disabled = false;
       }
     ];
     limiter = {
       enabled = true;
       proxy_strategy = "forward";
     };
   };
 };

 # Add this systemd override for SearXNG
 systemd.services.searx = {
   # This prevents it from starting at boot or with 'multi-user.target'
   wantedBy = lib.mkForce [ ];
   # Optional: Also stop it from starting on system boot-up phases
   before = lib.mkForce [ ];
 };

   ###########################################################################
   # 4. WEB PARSER – Crawlee + Trafilatura (localhost:18090)
   ###########################################################################
 systemd.user.services.web-parser = {
   wantedBy = [ ];
   description = "Smart FLOSS crawler (BS4 + Trafilatura + SearXNG)";
   serviceConfig = {
     ExecStart = "${pyPower}/bin/python ${pkgs.writeText "web-serve-optimized.py" ''
from urllib.parse import quote
import httpx
import json
import logging
import asyncio
from fastapi import FastAPI, Query, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from bs4 import BeautifulSoup
from trafilatura import extract
import uvicorn
from urllib.parse import urlparse
from pydantic import BaseModel

# Set up logging to see output in journalctl
logging.basicConfig(level=logging.INFO, format='"'"'%(message)s'"'"')
logger = logging.getLogger(__name__)

app = FastAPI()
HEADERS = {'"'"'User-Agent'"'"': '"'"'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0'"'"'}

# SearXNG configuration - PORT 18081 (not 18080!)
SEARXNG_URL = "http://127.0.0.1:18081/search"

# Async HTTP client
client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)

async def searxng_search(query, max_results=5):
    """Search using local SearXNG instance."""
    try:
        params = {
            "q": query,
            "format": "json",
            "safesearch": 0,
            "categories": "general",
            "language": "en"
        }
        logger.info(f"🔍 Querying SearXNG: {query}")
        response = await client.get(SEARXNG_URL, params=params)
        logger.info(f"HTTP: {response.request.method} {response.request.url} \"{response.status_code} {response.reason_phrase}\"")

        if response.status_code != 200:
            logger.error(f"SearXNG returned status {response.status_code}")
            return []
        try:
            data = response.json()
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from SearXNG: {e}")
            return []

        results = []
        for result in data.get('"'"'results'"'"', [])[:max_results]:
            if result.get('"'"'url'"'"'):
                results.append({
                    "title": result.get('"'"'title'"'"', 'No title'"'"'),
                    "url": result.get('"'"'url'"'"'),
                    "content": result.get('"'"'content'"'"', 'No content'"'"')[:200],
                    "engine": result.get('"'"'engine'"'"', 'unknown'"'"')
                })
        logger.info(f"✅ SearXNG found {len(results)} results")
        return results
    except Exception as e:
        logger.error(f"❌ SearXNG search failed: {e}")
        return []

async def extract_article(url):
    """Fetches a URL and returns extracted markdown text, or an error string."""
    try:
        logger.info(f"🌐 Fetching: {url}")
        response = await client.get(url, headers=HEADERS)
        html = response.text
        extracted = extract(html, output_format='markdown')
        if extracted:
            return extracted
        else:
            # Fallback to basic text extraction
            soup = BeautifulSoup(html, 'html.parser')
            for tag in soup(['"'"'script'"'"', '"'"'style'"'"', '"'"'nav'"'"', '"'"'footer'"'"', '"'"'header'"'"', '"'"'aside'"'"']):
                tag.decompose()
            text = soup.get_text(separator='"'"'\n'"'"', strip=True)
            return f"# Extracted from {url}\n\n{text[:2000]}"
    except httpx.TimeoutException:
        return f"# Timeout Error\n\nRequest timed out for {url}"
    except Exception as e:
        return f"# Error\n\nFailed to fetch {url}\nError: {e}"

@app.get("/crawl")
async def crawl(
    url: str = Query(..., description="page or search query"),
    deep: bool = Query(False, description="Deep research mode")
):
    """Main endpoint for OpenWebUI tool integration."""
    logger.info(f"📨 Received request for: {url}, deep={deep}")
    url = url.strip()
    # Remove leading/trailing slashes from queries
    if url.startswith('/') and url.endswith('/'):
        url = url[1:-1]
    # Check if it's a direct URL
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        logger.info(f"🔗 Direct URL detected: {url}")
        markdown_content = await extract_article(url)
        return PlainTextResponse(content=markdown_content, media_type="text/plain; charset=utf-8")
    # Check if it looks like a domain (no spaces, has dot)
    if '.' in url and ' ' not in url and not url.startswith(('http://', 'https://')):
        logger.info(f"🌐 Domain-like input detected, trying as URL: {url}")
        try_url = f"https://{url}"
        markdown_content = await extract_article(try_url)
        return PlainTextResponse(content=markdown_content, media_type="text/plain; charset=utf-8")
    # Otherwise it's a search query - use SearXNG
    logger.info(f"🔍 Using SearXNG for query: {url}")
    max_results = 3 if deep else 5
    search_results = await searxng_search(url, max_results=max_results)
    if not search_results:
        return PlainTextResponse(
            content=f"# No search results found\n\nQuery: {url}\n\nTry rephrasing your search or check if SearXNG is running on port 18081.",
            media_type="text/plain; charset=utf-8"
        )
    if not deep:
        # Web Search Mode: Return formatted search results
        formatted = []
        for i, res in enumerate(search_results):
            formatted.append(
                f"# {i+1}. {res['"'"'title'"'"']}\n"
                f"**URL:** {res['"'"'url'"'"']}\n"
                f"**Preview:** {res['"'"'content'"'"']}...\n"
                f"**Source:** {res['"'"'engine'"'"']}\n\n"
            )
        response_text = (
            f"# Search Results for: {url}\n\n"
            + "".join(formatted)
            + f"*Found {len(search_results)} results via SearXNG*\n\n"
            + "*Use `&deep=true` to crawl and extract content from these sources.*"
        )
        return PlainTextResponse(content=response_text, media_type="text/plain; charset=utf-8")
    else:
        # Deep Research Mode: Crawl top results
        logger.info(f"🕵️ Deep research mode - crawling {len(search_results)} sources")
        all_content = []
        for i, res in enumerate(search_results):
            logger.info(f"🌐 Crawling ({i+1}/{len(search_results)}): {res['"'"'url'"'"']}")
            if i > 0:
                await asyncio.sleep(1.0)
            content = await extract_article(res['"'"'url'"'"'])
            all_content.append(
                f"## Source {i+1}: {res['"'"'title'"'"']}\n"
                f"**URL:** {res['"'"'url'"'"']}\n"
                f"**Engine:** {res['"'"'engine'"'"']}\n\n"
                f"{content}\n\n{'='*60}\n\n"
            )
        response_text = (
            f"# Deep Research: {url}\n\n"
            + f"**Sources analyzed:** {len(search_results)}\n\n"
            + "".join(all_content)
        )
        return PlainTextResponse(
            content=response_text[:25000],
            media_type="text/plain; charset=utf-8"
        )

# NEW: Cloud LLM Research Endpoint
class ResearchRequest(BaseModel):
    query: str
    max_search_results: int = 5

@app.post("/research")
async def research_endpoint(request: ResearchRequest):
    """Cloud-LLM powered deep research. Orchestrates search, fetch, and synthesis."""
    logger.info(f"🧠 Research request: {request.query}")
    # Step 1: Search
    logger.info("🔍 Step 1: Searching via SearXNG...")
    search_data = await searxng_search(request.query, max_results=request.max_search_results)
    if not search_data:
        return JSONResponse(content={"query": request.query, "answer": "No relevant search results found."})
    # Step 2: Fetch Content
    top_urls = [res['"'"'url'"'"'] for res in search_data[:3]]
    logger.info(f"🌐 Step 2: Crawling {len(top_urls)} sources...")
    all_crawled_content = []
    for url in top_urls:
        content = await extract_article(url)
        all_crawled_content.append(f"## Source: {url}\n{content[:5000]}")
        await asyncio.sleep(0.5)
    research_context = "\n\n---\n\n".join(all_crawled_content)
    # Step 3: Return raw data for OpenWebUI'"'"'s LLM to synthesize
    logger.info("✅ Research data gathered. Returning raw data for OpenWebUI.")
    return JSONResponse(content={
        "query": request.query,
        "sources": top_urls,
        "research_data": research_context
    })

@app.api_route("/debug", methods=["POST", "PUT", "GET"])
async def debug_request(request: Request):
    """Critical endpoint to log the exact request format from OpenWebUI."""
    logger.info("=== OPENWEBUI REQUEST DUMP ===")
    logger.info(f"Method: {request.method}")
    logger.info(f"Headers: {dict(request.headers)}")
    body_bytes = await request.body()
    try:
        body_json = json.loads(body_bytes)
        logger.info(f"Body (JSON): {json.dumps(body_json, indent=2)}")
    except json.JSONDecodeError:
        body_text = body_bytes.decode('"'"'utf-8'"'"', errors='"'"'ignore'"'"')
        logger.info(f"Body (Text): {body_text[:1000]}")
    logger.info("=== END DUMP ===")
    return {"status": "debug_logged"}

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up HTTP client on shutdown."""
    await client.aclose()
    logger.info("✅ HTTP client closed")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=18090)
 ''}"};
     MemoryMax = "1G";
     Restart = "on-failure";
     RestartSec = "5s";
   };
 };

 ###########################################################################
 # 6. GUARD – user service, watches port 18080
 ###########################################################################
 systemd.user.services.ollama-guard = {
   wantedBy = [ ];
   description = "Tab watcher (user mode)";
   script = ''
     echo "👀 Guard: waiting 15s for perplexica to start…"
     sleep 15
     echo "👀 Guard: monitoring Perplexica…"
     while ! ${pkgs.curl}/bin/curl -s http://localhost:3000 > /dev/null; do sleep 8; done
     echo "👀 Guard: perplexica detected, waiting for tab close…"
     while [ $(${pkgs.iproute2}/bin/ss -tlnp | grep -c '"'"':3000'"'"') -gt 0 ]; do sleep 20; done
     echo "👀 Guard: No tabs left, shutting down…"
     systemctl stop perplexica
     sudo systemctl stop ollama
     echo "  ✓ Ollama stopped"
     sudo systemctl stop searx
     echo "  ✓ Searxng stopped"
     systemctl stop --user web-parser ollama-guard
     echo "  ✓ User services stopped"
     echo "👀 Guard: All services stopped. Exiting."
   '';
 };

   ###########################################################################
   # 6. ALIASES – no sudo, user commands only
   ###########################################################################
  environment.shellAliases = {
   assist = lib.concatStringsSep " && " [
     "echo '🚀 Starting LLM & Research services…'"
     "echo '  → SearXNG (search engine)…'"
     "sudo systemctl start searx"
     "sleep 2"
     "echo '  → Ollama (model host)…'"
     "sudo systemctl start ollama"
     "sleep 5" # Increased sleep for Ollama to fully initialize
     "echo '  → Web parser (BS + Trafilatura)…'"
     "systemctl --user start web-parser"
     "sleep 2"
     "echo '  → Perplexica (research engine)…'"
     "sudo systemctl start perplexica"
     "sleep 3"
     "echo '  → Tab guard (auto-stop watcher)…'"
     "systemctl --user start ollama-guard"
     "echo '✅ All services running.'"
     "echo '   • Perplexica (Research): http://localhost:3000'"
   ];

   assist-close = lib.concatStringsSep " && " [
     "echo '🔴 Force-stopping LLM services…'"
     "echo '  → Stopping Perplexica…'"
     "sudo systemctl stop perplexica"
     "echo '  ✓ Perplexica stopped'"
     "systemctl --user stop web-parser"
     "echo '  ✓ Web parser stopped'"
     "systemctl --user stop ollama-guard"
     "echo '  ✓ Guard stopped'"
     "sudo systemctl stop searx"
     "echo '  ✓ SearXNG stopped'"
     "sudo systemctl stop ollama"
     "echo '  ✓ Ollama stopped (model unloaded)'"
     "echo '🟢 All services stopped.'"
   ];
 };

   ###########################################################################
   # 7. FIREWALL – allow Ollama (11434) and user ports (18080-18090)
   ###########################################################################
   networking.firewall.allowedTCPPorts = [ 11434 18081 18090 3000 ];



