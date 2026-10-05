// Fonts and logo of the generated PDFs. Liberation Sans Regular and Bold 2.1.5 (SIL Open Font License 1.1, licence
// text in assets/OFL.txt) are bundled as Data modules and embedded as subsets through @pdf-lib/fontkit, so Greek,
// Polish and other Latin-extended text renders (the PDF standard fonts cannot encode Greek). The logo is the site's
// public/logo.png (a test keeps the two files byte-equal).
//
// Rules
//   - Subset fonts get fixed names (customName), so the same document renders to the same bytes.
//   - Text is drawn through pdfSafe(): control characters become spaces; characters the font lacks render as the
//     font's missing-glyph box and never throw.

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont, PDFImage } from 'pdf-lib';
import boldTtf from './assets/LiberationSans-Bold.ttf';
import regularTtf from './assets/LiberationSans-Regular.ttf';
import logoPng from './assets/logo.png';

export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** PDF subset tag + font name (a fixed tag keeps the output deterministic). */
export const FONT_NAMES = Object.freeze({ regular: 'MHUBRG+LiberationSans', bold: 'MHUBBD+LiberationSans-Bold' });

export async function embedFonts(doc: PDFDocument): Promise<PdfFonts> {
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularTtf, { subset: true, customName: FONT_NAMES.regular });
  const bold = await doc.embedFont(boldTtf, { subset: true, customName: FONT_NAMES.bold });
  return { regular, bold };
}

export async function embedLogo(doc: PDFDocument): Promise<PDFImage> {
  return doc.embedPng(logoPng);
}

/** Text as drawable: control characters (tabs included) become spaces, CR/LF are kept for the caller to split. */
export function pdfSafe(text: unknown): string {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏  ﻿]/g, ' ');
}
