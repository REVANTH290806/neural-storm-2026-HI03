from dataclasses import dataclass

import pymupdf as fitz


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PAGES = 100


class PdfProcessingError(ValueError):
    """Raised when the uploaded bytes are not a usable text PDF."""


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    text: str


@dataclass(frozen=True)
class ExtractedDocument:
    page_count: int
    pages: list[ExtractedPage]
    character_count: int


def extract_pdf_text(filename: str, data: bytes) -> ExtractedDocument:
    if not filename.lower().endswith(".pdf"):
        raise PdfProcessingError("Please choose a PDF file.")
    if not data:
        raise PdfProcessingError("The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise PdfProcessingError("The PDF must be 10 MB or smaller.")
    if not data.startswith(b"%PDF-"):
        raise PdfProcessingError("This file does not appear to be a valid PDF.")

    try:
        document = fitz.open(stream=data, filetype="pdf")
    except (fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise PdfProcessingError("The PDF could not be opened. Try another file.") from exc

    with document:
        if document.is_encrypted:
            raise PdfProcessingError("Password-protected PDFs are not supported yet.")
        page_count = document.page_count
        if page_count == 0:
            raise PdfProcessingError("This PDF has no pages.")
        if page_count > MAX_PAGES:
            raise PdfProcessingError("The PDF must have 100 pages or fewer.")

        pages = [
            ExtractedPage(page_number=index + 1, text=page.get_text("text").strip())
            for index, page in enumerate(document)
        ]

    character_count = sum(len(page.text) for page in pages)
    if character_count == 0:
        raise PdfProcessingError(
            "No selectable text was found. This may be a scanned PDF; OCR support is not available yet."
        )

    return ExtractedDocument(
        page_count=page_count,
        pages=pages,
        character_count=character_count,
    )
