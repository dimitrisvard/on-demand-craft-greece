// Fonts and logo of the generated PDFs. Liberation Sans Regular and Bold 2.1.5 (SIL Open Font License 1.1, licence
// text in assets/OFL.txt) are bundled as Data modules and embedded as subsets through @pdf-lib/fontkit, so Greek,
// Polish and other Latin-extended text renders (the PDF standard fonts cannot encode Greek). The logo is the site's
// public/logo.png (a test keeps the two files byte-equal); its bytes are JPEG despite the name, so the embedder is
// chosen by the file's signature, not its extension.
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

/** Image format by signature: PNG (89 50 4E 47) or JPEG (FF D8 FF); null otherwise. */
export function imageFormat(bytes: ArrayBuffer | Uint8Array): 'png' | 'jpeg' | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

/** The logo image, or null when the bundled bytes are neither PNG nor JPEG (the PDF is drawn without it). */
export async function embedLogo(doc: PDFDocument): Promise<PDFImage | null> {
  const format = imageFormat(logoPng);
  if (format === 'png') return doc.embedPng(logoPng);
  if (format === 'jpeg') return doc.embedJpg(logoPng);
  return null;
}

/** Text as drawable: control characters (tabs included) become spaces, CR/LF are kept for the caller to split. */
export function pdfSafe(text: unknown): string {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ');
}
