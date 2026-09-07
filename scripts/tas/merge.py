# -*- coding: utf-8 -*-
# Merge cover.pdf (Playwright) + body.pdf (ReportLab) -> final deliverable, A4-normalized.
import os
from pypdf import PdfReader, PdfWriter

HERE = os.path.dirname(os.path.abspath(__file__))
A4_W, A4_H = 595.28, 841.89

def normalize(page):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

def main():
    cover = os.path.join(HERE, 'cover.pdf')
    body = os.path.join(HERE, 'body.pdf')
    out = os.path.join(HERE, 'final.pdf')
    w = PdfWriter()
    w.add_page(normalize(PdfReader(cover).pages[0]))
    for p in PdfReader(body).pages:
        w.add_page(normalize(p))
    w.add_metadata({
        '/Title': 'Big Brother (Al-Akh Al-Kabir) - Technical Architecture Specification',
        '/Author': 'Z.ai', '/Creator': 'Z.ai',
        '/Subject': 'Target architecture, multi-tenant hardening, RAG retrieval, '
                    'counter-reply v2, safety gates, API contracts, sequencing',
    })
    with open(out, 'wb') as f:
        w.write(f)
    print('final pages:', len(PdfReader(out).pages))
    print('written:', out)

if __name__ == '__main__':
    main()
