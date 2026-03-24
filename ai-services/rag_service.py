"""
RAG Service - Local RAG knowledge base (using simple file search)
"""

import logging
import os
import glob
import re
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
DB_PATH = "research.ragdb"


def simple_text_search(query: str, top_k: int = 5):
    """Simple text search - grep through text files"""
    results = []
    query_lower = query.lower()
    
    # Search in common document locations
    search_dirs = [
        os.path.expanduser("~/Documents"),
        os.path.expanduser("~/Downloads"),
    ]
    
    for search_dir in search_dirs:
        if not os.path.exists(search_dir):
            continue
        for ext in ["*.txt", "*.md", "*.py", "*.js", "*.json"]:
            for filepath in glob.glob(os.path.join(search_dir, "**", ext), recursive=True):
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if query_lower in content.lower():
                            # Find context around match
                            idx = content.lower().find(query_lower)
                            context = content[max(0, idx-100):idx+100]
                            results.append({
                                "path": filepath,
                                "score": 1.0,
                                "media_type": "text",
                                "preview": f"...{context}..."
                            })
                            if len(results) >= top_k:
                                return results
                except:
                    pass
    return results


@app.post("/ingest-rag")
async def ingest_rag(path: str = Query(...)):
    """
    Ingest documents into RAG knowledge base.
    Note: Using simple search - ragdb requires special setup.
    """
    result = {"success": True, "message": "Using simple file search (ragdb not available)"}
    return JSONResponse(content=result)


@app.post("/query-rag")
async def query_rag(query: str = Query(...), top_k: int = Query(5)):
    """
    Query RAG knowledge base - uses simple text search
    """
    result = {"success": True, "results": simple_text_search(query, top_k)}
    return JSONResponse(content=result)
