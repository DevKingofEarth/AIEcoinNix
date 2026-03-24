"""
AI Services - Main entry point
Combines: Web Parser, PDF Extractor, RAG Service
"""

import logging
import uvicorn
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

from web_parser import app as web_parser_app
from pdf_extractor import app as pdf_extractor_app
from rag_service import app as rag_service_app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Services",
    description="Web Parser, PDF Extractor, RAG Service",
    version="0.1.0"
)

# Mount at different paths
app.mount("/crawl", web_parser_app)
app.mount("/pdf", pdf_extractor_app)
app.mount("/rag", rag_service_app)

# Root redirect
@app.get("/")
async def root():
    return PlainTextResponse("AI Services running. Endpoints: /crawl, /pdf, /rag")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=18090)
