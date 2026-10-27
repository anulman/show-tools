from pathlib import Path
import hashlib
import json
import sys

import pymupdf
from pypdf import PdfReader

pdf = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
document = pymupdf.open(pdf)
assert len(document) == 6, f'Expected six designed pages, got {len(document)}'
receipt = {'pdf': str(pdf), 'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'pages': []}
for index, page in enumerate(document):
    spans = [span for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for span in line['spans']]
    assert spans, f'Empty page {index + 1}'
    for span in spans:
        x0, y0, x1, y1 = span['bbox']
        assert x0 >= 0 and y0 >= 0 and x1 <= 612.1 and y1 <= 792.1, (index + 1, span)
        assert '\ufffd' not in span['text'] and '\u25a0' not in span['text'], span
    links = page.get_links()
    assert all(link.get('uri', '').startswith('https://') for link in links), links
    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).save(out / f'page-{index + 1}.png')
    (out / f'page-{index + 1}.txt').write_text(page.get_text())
    receipt['pages'].append({'page': index + 1, 'text_spans': len(spans), 'external_links': len(links)})
assert len(PdfReader(pdf).pages) == len(document)
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
