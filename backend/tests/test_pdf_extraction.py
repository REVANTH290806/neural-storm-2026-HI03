import pymupdf as fitz

from app.services.pdf_extraction import PdfProcessingError, extract_pdf_text


def make_pdf(*page_texts: str) -> bytes:
    document = fitz.open()
    for text in page_texts:
        page = document.new_page()
        page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def test_extracts_text_and_page_numbers():
    result = extract_pdf_text("lesson.pdf", make_pdf("First page", "Second page"))

    assert result.page_count == 2
    assert result.character_count == len("First page") + len("Second page")
    assert [(page.page_number, page.text) for page in result.pages] == [
        (1, "First page"),
        (2, "Second page"),
    ]


def test_rejects_non_pdf_extension():
    try:
        extract_pdf_text("lesson.txt", make_pdf("Text"))
    except PdfProcessingError as error:
        assert "PDF file" in str(error)
    else:
        raise AssertionError("Expected non-PDF extension to be rejected")


def test_rejects_image_only_or_empty_text_pdf():
    document = fitz.open()
    document.new_page()
    data = document.tobytes()
    document.close()

    try:
        extract_pdf_text("scan.pdf", data)
    except PdfProcessingError as error:
        assert "No selectable text" in str(error)
    else:
        raise AssertionError("Expected PDF without selectable text to be rejected")


def test_rejects_invalid_pdf_bytes():
    try:
        extract_pdf_text("broken.pdf", b"%PDF-not-a-real-document")
    except PdfProcessingError as error:
        assert "could not be opened" in str(error)
    else:
        raise AssertionError("Expected invalid PDF bytes to be rejected")
