"""Create samples/photosynthesis-sample.pdf: a short, original, selectable-text lesson.

Written for this project so demos and smoke tests do not depend on a private or
copyrighted PDF. Run from the repo root with the backend venv active.
"""
import pymupdf as fitz

PAGES = [
    "How Plants Make Food\n\n"
    "Plants make their own food. This process is called photosynthesis.\n"
    "Photosynthesis happens mostly in the leaves of a plant.\n"
    "Leaves contain chlorophyll, a green substance that captures energy from sunlight.\n"
    "The plant also takes in water through its roots and carbon dioxide from the air.\n"
    "Using sunlight, the plant turns water and carbon dioxide into sugar and oxygen.\n",
    "What Happens to the Sugar and Oxygen\n\n"
    "The sugar gives the plant energy to grow. Extra sugar can be stored in roots, stems, or fruit.\n"
    "The oxygen is released into the air through tiny openings in the leaves called stomata.\n"
    "Animals, including people, breathe in the oxygen that plants release.\n"
    "Without sunlight, a plant cannot carry out photosynthesis for long, and it will stop growing.\n",
]

document = fitz.open()
for text in PAGES:
    page = document.new_page()
    page.insert_textbox(fitz.Rect(72, 72, 523, 770), text, fontsize=13, fontname="helv")
document.save("samples/photosynthesis-sample.pdf")
print("Wrote samples/photosynthesis-sample.pdf")
