import argparse
from pathlib import Path
import xml.etree.ElementTree as ET

import reportlab
from reportlab.graphics import renderPDF
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen.canvas import Canvas
from svglib.fonts import FontMap
from svglib.svglib import svg2rlg

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--title', required=True)
parser.add_argument('pages', nargs='+')
args = parser.parse_args()

fonts = Path(reportlab.__file__).parent / 'fonts'
font_map = FontMap()
font_map.register_font_family(
    'Arial', str(fonts / 'Vera.ttf'), str(fonts / 'VeraBd.ttf'),
    str(fonts / 'VeraIt.ttf'), str(fonts / 'VeraBI.ttf'),
)
glyphs = pdfmetrics.getFont('Arial').face.charToGlyph
canvas = Canvas(args.output, invariant=1, pageCompression=1)
canvas.setTitle(args.title)
canvas.setAuthor('Show Tools')
for filename in args.pages:
    for node in ET.parse(filename).iter('{http://www.w3.org/2000/svg}text'):
        for character in ''.join(node.itertext()):
            if not character.isspace() and ord(character) not in glyphs:
                raise ValueError(f'{filename}: PDF font lacks U+{ord(character):04X}')
    drawing = svg2rlg(filename, font_map=font_map)
    if drawing is None:
        raise ValueError(f'Cannot read generated SVG page: {filename}')
    canvas.setPageSize((drawing.width, drawing.height))
    renderPDF.draw(drawing, canvas, 0, 0)
    canvas.showPage()
canvas.save()
