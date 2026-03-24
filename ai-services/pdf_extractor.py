"""
PDF Extractor - Extract text, tables, and OCR from PDFs
"""

import logging
import os
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Set tesseract path for OCR
os.environ["PATH"] = os.environ.get("PATH", "") + ":/run/current-system/sw/bin"


@app.get("/extract-pdf")
async def extract_pdf(path: str = Query(...), ocr: bool = Query(True)):
    """
    Extract text, tables, and OCR from PDFs.
    
    Args:
        path: Path to PDF file
        ocr: Enable OCR for scanned PDFs (default: True)
    """
    result = {
        "success": True,
        "text": "",
        "tables": [],
        "ocr": "",
        "error": None
    }
    
    if not Path(path).exists():
        result["success"] = False
        result["error"] = "File not found"
        return JSONResponse(content=result)
    
    try:
        import fitz
        from PIL import Image
        import pytesseract
        
        doc = fitz.open(path)
        
        # Extract text from each page
        text_parts = []
        ocr_texts = []
        
        for page_num, page in enumerate(doc):
            text = page.get_text()
            
            # If text found, use it
            if text.strip():
                text_parts.append(f"## Page {page_num + 1}\n\n{text}")
            # If OCR enabled and no text, try OCR
            elif ocr:
                try:
                    # Render page as image
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    
                    # Run OCR
                    page_text = pytesseract.image_to_string(img)
                    if page_text.strip():
                        ocr_texts.append(f"## Page {page_num + 1} (OCR)\n\n{page_text}")
                        logger.info(f"OCR extracted {len(page_text)} chars from page {page_num + 1}")
                except Exception as ocr_err:
                    logger.error(f"OCR error on page {page_num + 1}: {ocr_err}")
        
        result["text"] = "\n\n".join(text_parts)
        result["ocr"] = "\n\n".join(ocr_texts)
        
        # If no text at all, use OCR result
        if not result["text"] and result["ocr"]:
            result["text"] = result["ocr"]
            result["ocr"] = ""
        
        doc.close()
        
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        result["success"] = False
        result["error"] = str(e)
    
    return JSONResponse(content=result)
