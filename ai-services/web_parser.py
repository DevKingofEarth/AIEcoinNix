"""
Web Parser - HTTP endpoints for web crawling and research
"""

import uvicorn
import httpx
import json
import logging
import asyncio
from fastapi import FastAPI, Query, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from bs4 import BeautifulSoup
from trafilatura import extract
from urllib.parse import urlparse
from pydantic import BaseModel

# Set up logging to see output in journalctl
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
HEADERS = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0'}

# SearXNG configuration - PORT 18081 (not 18080!)
SEARXNG_URL = "http://127.0.0.1:18081/search"

# Async HTTP client (verify=False for Nix SSL issues)
client = httpx.AsyncClient(timeout=30.0, follow_redirects=True, verify=False)

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
        for result in data.get('results', [])[:max_results]:
            if result.get('url'):
                results.append({
                    "title": result.get('title', 'No title'),
                    "url": result.get('url'),
                    "content": result.get('content', 'No content')[:200],
                    "engine": result.get('engine', 'unknown')
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
            for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
                tag.decompose()
            text = soup.get_text(separator='\n', strip=True)
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
                f"# {i+1}. {res['title']}\n"
                f"**URL:** {res['url']}\n"
                f"**Preview:** {res['content']}...\n"
                f"**Source:** {res['engine']}\n\n"
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
            logger.info(f"🌐 Crawling ({i+1}/{len(search_results)}): {res['url']}")
            if i > 0:
                await asyncio.sleep(1.0)
            content = await extract_article(res['url'])
            all_content.append(
                f"## Source {i+1}: {res['title']}\n"
                f"**URL:** {res['url']}\n"
                f"**Engine:** {res['engine']}\n\n"
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
    top_urls = [res['url'] for res in search_data[:3]]
    logger.info(f"🌐 Step 2: Crawling {len(top_urls)} sources...")
    all_crawled_content = []
    for url in top_urls:
        content = await extract_article(url)
        all_crawled_content.append(f"## Source: {url}\n{content[:5000]}")
        await asyncio.sleep(0.5)
    research_context = "\n\n---\n\n".join(all_crawled_content)
    # Step 3: Return raw data for OpenWebUI's LLM to synthesize
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
        body_text = body_bytes.decode('utf-8', errors='ignore')
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
