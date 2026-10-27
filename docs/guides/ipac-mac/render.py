from pathlib import Path
import re
import sys
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics.shapes import Drawing, Line, Rect, String, Circle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).with_name('guide.md')
OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'output/pdf/ipac-mac-keyboard.pdf'
INK = colors.HexColor('#182F35')
TEAL = colors.HexColor('#087E84')
PALE = colors.HexColor('#EAF3F1')
MUTED = colors.HexColor('#56686C')
WIDTH = 504

styles = {
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10.3, leading=13.4, textColor=INK, spaceAfter=7),
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=27, leading=30, textColor=INK, spaceAfter=15),
    'heading': ParagraphStyle('heading', fontName='Helvetica-Bold', fontSize=13, leading=16, textColor=TEAL, spaceBefore=7, spaceAfter=5, keepWithNext=True),
    'callout': ParagraphStyle('callout', fontName='Helvetica', fontSize=10, leading=13.5, textColor=INK),
    'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=9.2, leading=12, textColor=INK),
    'headcell': ParagraphStyle('headcell', fontName='Helvetica-Bold', fontSize=9.2, leading=12, textColor=colors.white),
    'code': ParagraphStyle('code', fontName='Courier', fontSize=8, leading=12, textColor=INK, spaceAfter=3),
    'bullet': ParagraphStyle('bullet', fontName='Helvetica', fontSize=10.5, leading=14.2, textColor=INK, leftIndent=12, firstLineIndent=-10, spaceAfter=5),
}


def rich(text):
    value = escape(text)
    return re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)', r'<link href="\2" color="#087E84"><u>\1</u></link>', value)


def diagram(kind):
    d = Drawing(WIDTH, 107)
    d.add(Rect(0, 0, WIDTH, 107, fillColor=PALE, strokeColor=None, rx=6))
    if kind == 'switch':
        d.add(String(16, 87, 'ONE SWITCH / USB AND LED POWER DISCONNECTED', fontName='Helvetica-Bold', fontSize=9, fillColor=TEAL))
        d.add(Rect(16, 24, 165, 49, fillColor=colors.white, strokeColor=MUTED, rx=3))
        d.add(String(26, 56, 'I-PAC switch-input lead', fontName='Helvetica', fontSize=10, fillColor=INK))
        d.add(String(26, 35, 'I-PAC GND to ground chain', fontName='Helvetica', fontSize=10, fillColor=INK))
        d.add(Line(181, 59, 316, 59, strokeColor=TEAL, strokeWidth=2))
        d.add(Line(181, 36, 316, 36, strokeColor=INK, strokeWidth=2))
        d.add(Circle(320, 59, 3, strokeColor=TEAL, fillColor=colors.white))
        d.add(Circle(320, 36, 3, strokeColor=INK, fillColor=colors.white))
        d.add(Line(323, 37, 342, 52, strokeColor=INK, strokeWidth=2))
        d.add(String(354, 56, 'NO', fontName='Helvetica-Bold', fontSize=11, fillColor=INK))
        d.add(String(354, 33, 'COM', fontName='Helvetica-Bold', fontSize=11, fillColor=INK))
        d.add(String(16, 9, 'Open at rest. Pressing closes the circuit. NC and LED contacts remain unused.', fontName='Helvetica', fontSize=9, fillColor=MUTED))
    else:
        d.add(String(16, 87, 'KEEP THE POWER PATHS SEPARATE', fontName='Helvetica-Bold', fontSize=9, fillColor=TEAL))
        for y, left, right in [(59, 'Mac USB data + bus power', 'I-PAC USB / keyboard test'), (32, 'External 5 V LED supply', 'I-PAC LED power / later stage')]:
            d.add(String(16, y, left, fontName='Helvetica', fontSize=10, fillColor=INK))
            d.add(Line(210, y + 3, 280, y + 3, strokeColor=TEAL, strokeWidth=2))
            d.add(String(290, y, right, fontName='Helvetica', fontSize=10, fillColor=INK))
        d.add(String(16, 9, 'Relationship diagram only. No pin positions or harness orientation are implied.', fontName='Helvetica', fontSize=9, fillColor=MUTED))
    return d


def table(lines):
    rows = [[cell.strip() for cell in line.strip('|').split('|')] for line in lines]
    rows = [row for row in rows if not all(re.fullmatch(r'[-: ]+', cell) for cell in row)]
    count = len(rows[0])
    weights = {2: [.32, .68], 4: [.33, .27, .27, .13]}[count]
    cells = [[Paragraph(rich(cell or ' '), styles['headcell' if i == 0 else 'cell']) for cell in row] for i, row in enumerate(rows)]
    result = Table(cells, colWidths=[WIDTH * w for w in weights], repeatRows=1, hAlign='LEFT', minRowHeights=[27] * len(cells))
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), TEAL), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [PALE, colors.white]),
        ('LINEBELOW', (0, 1), (-1, -1), .4, colors.HexColor('#CCDAD7')),
    ]))
    return result


def page_content(source):
    lines = source.strip().splitlines()
    story = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith('|'):
            group = []
            while i < len(lines) and lines[i].startswith('|'):
                group.append(lines[i]); i += 1
            story.extend([table(group), Spacer(1, 8)])
            continue
        if line.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code.append(Paragraph(escape(lines[i]), styles['code'])); i += 1
            block = Table([[code]], colWidths=[WIDTH])
            block.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), PALE), ('BOX', (0, 0), (-1, -1), .5, colors.HexColor('#CCDAD7')), ('LEFTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
            story.extend([KeepTogether(block), Spacer(1, 9)])
        elif line.startswith(':::'):
            story.extend([diagram(line[3:]), Spacer(1, 9)])
        elif line.startswith('# '):
            story.append(Paragraph(rich(line[2:]), styles['title']))
        elif line.startswith('## '):
            story.append(Paragraph(rich(line[3:]), styles['heading']))
        elif line.startswith('> '):
            block = Table([[Paragraph(rich(line[2:]), styles['callout'])]], colWidths=[WIDTH])
            block.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), PALE), ('LINEBEFORE', (0, 0), (0, 0), 3, TEAL), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10)]))
            story.extend([block, Spacer(1, 10)])
        elif line.startswith('- '):
            story.append(Paragraph('- ' + rich(line[2:]), styles['bullet']))
        else:
            story.append(Paragraph(rich(line), styles['body']))
        i += 1
    return story


def furniture(canvas, doc):
    canvas.setTitle('Build your first I-PAC keyboard - MacBook bench guide')
    canvas.setAuthor('show-tools')
    canvas.setFillColor(TEAL)
    canvas.rect(0, 781, 612, 11, fill=1, stroke=0)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawString(54, 758, 'SHOW-TOOLS  /  I-PAC ULTIMATE I/O')
    canvas.setStrokeColor(colors.HexColor('#CCDAD7'))
    canvas.line(54, 44, 558, 44)
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(54, 29, 'MacBook bench guide  |  Source-checked 27 Oct 2026  |  Physical test pending')
    canvas.drawRightString(558, 29, str(doc.page))


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
pages = SOURCE.read_text().split('<!-- page -->')
story = []
for i, source in enumerate(pages):
    if i:
        story.append(PageBreak())
    story.extend(page_content(source))
doc = SimpleDocTemplate(str(OUTPUT), pagesize=(612, 792), leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=59, pageCompression=1, invariant=1)
doc.build(story, onFirstPage=furniture, onLaterPages=furniture)
print(OUTPUT)
