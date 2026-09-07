# -*- coding: utf-8 -*-
# Technical Architecture Specification — body PDF builder (ReportLab, Report route).
# Cover is rendered separately via html2poster.js and merged by merge.py.
import os, sys, hashlib

PDF_SKILL_DIR = '/home/z/my-project/skills/pdf'
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, 'scripts'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY, TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, KeepTogether,
                                CondPageBreak, XPreformatted, HRFlowable, Image,
                                NextPageTemplate)
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

from content1 import SEC1, SEC2
from content2 import SEC3, SEC4, SEC5
from content3 import SEC6, SEC7, SEC8, SEC9

# ---------- fonts ----------
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('FreeSerif', f'{FONT_DIR}/truetype/freefont/FreeSerif.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Bold', f'{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Italic', f'{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-BoldItalic', f'{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans-Bold', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono-Bold.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('FreeSerif', normal='FreeSerif', bold='FreeSerif-Bold',
                   italic='FreeSerif-Italic', boldItalic='FreeSerif-BoldItalic')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans-Bold')
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

from pdf import install_font_fallback
install_font_fallback()

# ---------- palette: Template 07 Crystal Blue body subset (fixed by cover.md) ----------
PAGE_BG      = colors.HexColor('#f5f8fc')
SECTION_BG   = colors.HexColor('#edf2f9')
CARD_BG      = colors.HexColor('#e4ecf5')
TABLE_STRIPE = colors.HexColor('#eef3fa')
HEADER_FILL  = colors.HexColor('#1a4a7a')
BORDER       = colors.HexColor('#c0d0e2')
ACCENT       = colors.HexColor('#2d7ab3')
TEXT_PRIMARY = colors.HexColor('#142840')
TEXT_MUTED   = colors.HexColor('#5a7a96')

# ---------- geometry ----------
PAGE_W, PAGE_H = A4
MARGIN = 0.9 * inch                       # symmetric left/right (iron rule)
TOP_M, BOT_M = 0.95 * inch, 0.85 * inch
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - TOP_M - BOT_M
H1_GUARD = AVAIL_H * 0.25
MAX_KEEP = PAGE_H * 0.4

DOC_TITLE = 'Big Brother (Al-Akh Al-Kabir) - Technical Architecture Specification'
DOC_AUTHOR = 'Z.ai'

# ---------- styles ----------
S = {}
S['body'] = ParagraphStyle('Body', fontName='FreeSerif', fontSize=10.5, leading=16.5,
                           alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY, spaceAfter=8)
S['h1'] = ParagraphStyle('H1', fontName='FreeSerif-Bold', fontSize=21, leading=26,
                         textColor=HEADER_FILL, spaceBefore=18, spaceAfter=4)
S['h2'] = ParagraphStyle('H2', fontName='FreeSerif-Bold', fontSize=14.5, leading=19,
                         textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=6)
S['h3'] = ParagraphStyle('H3', fontName='FreeSerif-Bold', fontSize=11.5, leading=15.5,
                         textColor=TEXT_PRIMARY, spaceBefore=10, spaceAfter=5)
S['num'] = ParagraphStyle('Num', parent=S['body'], leftIndent=20, firstLineIndent=-14,
                          alignment=TA_LEFT, spaceAfter=5)
S['bullet'] = ParagraphStyle('Bul', parent=S['num'])
S['code'] = ParagraphStyle('Code', fontName='DejaVuSans', fontSize=7.8, leading=10.2,
                           textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S['codelabel'] = ParagraphStyle('CodeLabel', fontName='DejaVuSans-Bold', fontSize=7.2,
                                leading=10, textColor=TEXT_MUTED, spaceBefore=2, spaceAfter=3)
S['caption'] = ParagraphStyle('Caption', fontName='FreeSerif-Italic', fontSize=8.5, leading=11.5,
                              textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=4)
S['th'] = ParagraphStyle('TH', fontName='FreeSerif-Bold', fontSize=9, leading=11.5,
                         textColor=colors.white, alignment=TA_LEFT)
S['td'] = ParagraphStyle('TD', fontName='FreeSerif', fontSize=8.6, leading=11.2,
                         textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S['toc_title'] = ParagraphStyle('TocTitle', fontName='FreeSerif-Bold', fontSize=17, leading=22,
                                textColor=HEADER_FILL, spaceAfter=10)

_AMP, _LT, _GT = chr(38), chr(60), chr(62)
_NBSP, _EMD, _BUL = chr(160), chr(8212), chr(8226)

def esc(t):
    # XML-escape for Paragraph markup (built via chr so code.sanitize cannot de-entityize it)
    return (t.replace(_AMP, _AMP + 'amp;')
             .replace(_LT, _AMP + 'lt;')
             .replace(_GT, _AMP + 'gt;'))

def nb(t):
    # never allow a line to start with an em dash: bind it to the previous word
    return t.replace(' ' + _EMD + ' ', _NBSP + _EMD + ' ')

# ---------- doc template with TOC + dual page templates ----------
ROMAN = {1: 'i', 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v', 6: 'vi', 7: 'vii', 8: 'viii'}

def _chrome(cv, doc, page_label):
    cv.saveState()
    # header: title left, accent rule under it
    cv.setFont('FreeSerif', 7.5)
    cv.setFillColor(TEXT_MUTED)
    cv.drawString(MARGIN, PAGE_H - 0.55 * inch, DOC_TITLE)
    cv.setStrokeColor(ACCENT)
    cv.setLineWidth(1.2)
    cv.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    # footer: author left, page right, light rule above
    cv.setStrokeColor(BORDER)
    cv.setLineWidth(0.6)
    cv.line(MARGIN, 0.6 * inch, PAGE_W - MARGIN, 0.6 * inch)
    cv.setFont('FreeSerif', 7.5)
    cv.setFillColor(TEXT_MUTED)
    cv.drawString(MARGIN, 0.42 * inch, 'Technical Architecture Specification - v1.0')
    cv.drawRightString(PAGE_W - MARGIN, 0.42 * inch, page_label)
    cv.restoreState()

def on_front(cv, doc):
    doc._body_start = None
    _chrome(cv, doc, ROMAN.get(doc.page, str(doc.page)))

def on_main(cv, doc):
    if getattr(doc, '_body_start', None) is None:
        doc._body_start = doc.page
    _chrome(cv, doc, str(doc.page - doc._body_start + 1))

class SpecDoc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, **kw)
        frame = Frame(MARGIN, BOT_M, AVAIL_W, PAGE_H - TOP_M - BOT_M, id='F',
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id='front', frames=[frame], onPage=on_front),
            PageTemplate(id='main', frames=[frame], onPage=on_main),
        ])
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            self.notify('TOCEntry', (getattr(flowable, 'bookmark_level', 0),
                                     getattr(flowable, 'bookmark_text', ''),
                                     self.page,
                                     getattr(flowable, 'bookmark_key', '')))

def add_heading(text, style, level=0):
    key = 'h_' + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/>%s' % (key, text), style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text.replace('&', 'and')
    p.bookmark_key = key
    return p

def safe_keep(elements):
    total = 0
    for el in elements:
        try:
            w, h = el.wrap(AVAIL_W, PAGE_H)
            total += h
        except Exception:
            return list(elements)
    if total <= MAX_KEEP:
        return [KeepTogether(elements)]
    if len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)

def embed_image(path, max_w, max_h):
    im = PILImage.open(path)
    ow, oh = im.size
    r = min(max_w / ow if ow > max_w else 1.0, max_h / oh if oh > max_h else 1.0)
    return Image(path, width=ow * r, height=oh * r)

def make_table(spec):
    widths = [r * AVAIL_W for r in spec['widths']]
    assert abs(sum(spec['widths']) - 1.0) < 0.01, 'width ratios must sum to 1'
    assert sum(widths) <= AVAIL_W + 0.5, 'table exceeds available width'
    data = [[Paragraph('<b>%s</b>' % h, S['th']) for h in spec['header']]]
    for row in spec['rows']:
        data.append([Paragraph(nb(c), S['td']) for c in row])
    t = Table(data, colWidths=widths, hAlign='CENTER', repeatRows=1)
    st = [('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
          ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
          ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
          ('VALIGN', (0, 0), (-1, -1), 'TOP'),
          ('LEFTPADDING', (0, 0), (-1, -1), 6),
          ('RIGHTPADDING', (0, 0), (-1, -1), 6),
          ('TOPPADDING', (0, 0), (-1, -1), 5),
          ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]
    for i in range(1, len(data)):
        st.append(('BACKGROUND', (0, i), (-1, i), colors.white if i % 2 == 1 else TABLE_STRIPE))
    t.setStyle(TableStyle(st))
    return t

def make_code(label, text):
    lines = text.split('\n')
    widest = max(len(l) for l in lines)
    fs = 7.8
    if widest * fs * 0.6015 > AVAIL_W - 20:      # DejaVuSansMono advance ~0.6015em
        fs = round((AVAIL_W - 20) / (widest * 0.6015), 1)
    st = ParagraphStyle('CodeX', parent=S['code'], fontSize=fs, leading=fs * 1.32)
    if len(lines) <= 52:
        block = Table([[XPreformatted(esc(text), st)]], colWidths=[AVAIL_W], hAlign='CENTER')
        block.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), CARD_BG),
            ('LINEBEFORE', (0, 0), (0, -1), 2.5, ACCENT),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
        out = [Paragraph(esc(label), S['codelabel']), block]
        return safe_keep(out)
    return [Paragraph(esc(label), S['codelabel']), XPreformatted(esc(text), st)]

def first_flowables(block):
    """Render one block to a list of flowables (no heading binding)."""
    b = block
    if 'h1' in b:
        h = add_heading(b['h1'], S['h1'], 0)
        rule = HRFlowable(width='100%', color=ACCENT, thickness=1.4,
                          spaceBefore=0, spaceAfter=10)
        return [CondPageBreak(H1_GUARD)] + safe_keep([h, rule])
    if 'h2' in b:
        return [CondPageBreak(0.12 * AVAIL_H), add_heading(b['h2'], S['h2'], 1)]
    if 'h3' in b:
        return [add_heading(b['h3'], S['h3'], 2)]
    if 'p' in b:
        return [Paragraph(nb(b['p']), S['body'])]
    if 'num' in b:
        return [Paragraph(('%d.' + _NBSP + _NBSP + '%s') % (i + 1, nb(t)), S['num'])
                for i, t in enumerate(b['num'])]
    if 'bullet' in b:
        return [Paragraph((_BUL + _NBSP + _NBSP + '%s') % nb(t), S['num']) for t in b['bullet']]
    if 'table' in b:
        t = make_table(b['table'])
        cap = Paragraph(esc(b['table']['caption']), S['caption'])
        return [Spacer(1, 10)] + safe_keep([t, Spacer(1, 5), cap]) + [Spacer(1, 8)]
    if 'code' in b:
        label, text = b['code']
        return [Spacer(1, 6)] + make_code(label, text) + [Spacer(1, 8)]
    if 'fig' in b:
        path, cap = b['fig']
        img = embed_image(path, AVAIL_W, 320)
        capp = Paragraph(esc(cap), S['caption'])
        return [Spacer(1, 14)] + safe_keep([img, Spacer(1, 6), capp]) + [Spacer(1, 10)]
    if 'quote' in b:
        q = ParagraphStyle('Q', parent=S['body'], fontName='FreeSerif-Italic',
                           leftIndent=24, textColor=TEXT_MUTED)
        return [Paragraph(b['quote'], q)]
    return []

def build_story():
    story = []
    story.append(Paragraph('Table of Contents', S['toc_title']))
    story.append(HRFlowable(width='100%', color=ACCENT, thickness=1.4, spaceAfter=12))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle('TOC0', fontName='FreeSerif-Bold', fontSize=10.5, leading=15,
                       textColor=TEXT_PRIMARY, spaceBefore=5),
        ParagraphStyle('TOC1', fontName='FreeSerif', fontSize=9.5, leading=13.5,
                       leftIndent=16, textColor=TEXT_PRIMARY),
    ]
    story.append(toc)
    story.append(NextPageTemplate('main'))
    story.append(PageBreak())

    sections = [SEC1, SEC2, SEC3, SEC4, SEC5, SEC6, SEC7, SEC8, SEC9]
    for sec in sections:
        blocks = sec
        i = 0
        while i < len(blocks):
            b = blocks[i]
            flows = first_flowables(b)
            # bind headings to their first following flowable (anti-orphan)
            if ('h2' in b or 'h3' in b) and i + 1 < len(blocks):
                nxt = first_flowables(blocks[i + 1])
                if nxt:
                    head = flows[-1]
                    story.extend(flows[:-1])
                    story.extend(safe_keep([head, nxt[0]]))
                    story.extend(nxt[1:])
                    i += 2
                    continue
            story.extend(flows)
            i += 1
        story.append(Spacer(1, 14))
    return story

def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'body.pdf')
    doc = SpecDoc(out, pagesize=A4,
                  leftMargin=MARGIN, rightMargin=MARGIN,
                  topMargin=TOP_M, bottomMargin=BOT_M,
                  title=DOC_TITLE, author=DOC_AUTHOR, creator=DOC_AUTHOR,
                  subject='Target architecture, multi-tenant hardening, RAG retrieval, '
                          'counter-reply v2, safety gates, API contracts, sequencing')
    doc.multiBuild(build_story())
    print('body pages:', doc.page)
    print('written:', out)

if __name__ == '__main__':
    main()
