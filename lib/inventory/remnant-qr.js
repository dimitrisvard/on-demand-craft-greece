/**
 * QR Code & Remnant Label Generator
 *
 * Generates printable PDF labels (100mm × 50mm) with QR codes for stock items.
 * Uses pdf-lib for PDF generation and qrcode for QR generation.
 */

/**
 * Generate a QR code as a PNG data URL.
 * Uses the qrcode npm package (server-side).
 *
 * @param {string} text - The data to encode
 * @param {number} width - Width in pixels
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generateQrPng(text, width = 200) {
  // Dynamic import for server-side usage
  const QRCode = (await import('qrcode')).default;
  const buffer = await QRCode.toBuffer(text, {
    width,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  return buffer;
}

/**
 * Generate a printable remnant label as a PDF.
 *
 * Label size: 100mm × 50mm (283 × 142 points)
 *
 * Layout:
 * ┌─────────────────────────────────────────┐
 * │  MICRONS HUB — REMNANT                  │
 * │  ┌─────────┐  Material — Thickness      │
 * │  │  [QR]   │  W × H mm                  │
 * │  │         │  Area: X.XX m²             │
 * │  └─────────┘  Location                  │
 * │               Date       ID             │
 * └─────────────────────────────────────────┘
 */
export async function generateRemnantLabelPdf(stockItem, material, tenantDomain) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  const scanUrl = `https://${tenantDomain || 'micronshub.eu'}/dashboard/inventory/scan/${stockItem.qr_code}`;
  const qrBuffer = await generateQrPng(scanUrl, 200);

  // Create PDF — label size 100mm × 50mm = ~283pt × ~142pt
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([283, 142]);

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Embed QR image
  const qrImage = await pdfDoc.embedPng(qrBuffer);
  const qrSize = 80;

  // Background
  page.drawRectangle({
    x: 0, y: 0, width: 283, height: 142,
    color: rgb(1, 1, 1),
  });

  // Border
  page.drawRectangle({
    x: 1, y: 1, width: 281, height: 140,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 1,
  });

  // Header
  const isRemnant = stockItem.origin === 'remnant';
  const headerText = isRemnant ? 'MICRONS HUB — REMNANT' : 'MICRONS HUB — STOCK';
  page.drawText(headerText, {
    x: 10, y: 124, size: 8, font: fontBold, color: rgb(0, 0, 0),
  });

  // Separator line
  page.drawLine({
    start: { x: 10, y: 120 },
    end: { x: 273, y: 120 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  // QR code
  page.drawImage(qrImage, {
    x: 10, y: 25, width: qrSize, height: qrSize,
  });

  // Text info — right of QR
  const textX = 100;
  const thicknessStr = material.thickness_mm ? ` — ${material.thickness_mm}mm` : '';
  const materialLine = `${material.name}${material.grade ? ' ' + material.grade : ''}${thicknessStr}`;

  page.drawText(materialLine, {
    x: textX, y: 105, size: 9, font: fontBold, color: rgb(0, 0, 0),
  });

  if (stockItem.width_mm && stockItem.height_mm) {
    page.drawText(`${stockItem.width_mm} × ${stockItem.height_mm} mm`, {
      x: textX, y: 90, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2),
    });
  }

  const areaMm2 = stockItem.remaining_area_mm2 || stockItem.total_area_mm2 || 0;
  const areaM2 = (areaMm2 / 1_000_000).toFixed(3);
  page.drawText(`Area: ${areaM2} m²`, {
    x: textX, y: 75, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2),
  });

  if (stockItem.location) {
    page.drawText(stockItem.location, {
      x: textX, y: 60, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2),
    });
  }

  const dateStr = stockItem.received_date || new Date().toISOString().split('T')[0];
  page.drawText(dateStr, {
    x: textX, y: 45, size: 7, font: fontRegular, color: rgb(0.4, 0.4, 0.4),
  });

  page.drawText(stockItem.qr_code || 'N/A', {
    x: textX, y: 33, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  });

  // Bottom URL
  const shortUrl = `micronshub.eu/scan/${stockItem.qr_code}`;
  page.drawText(shortUrl, {
    x: 10, y: 10, size: 6, font: fontRegular, color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}

/**
 * Generate a batch of labels for multiple stock items.
 * Returns a single PDF with one label per page.
 */
export async function generateBatchLabels(stockItems, materials, tenantDomain) {
  const { PDFDocument } = await import('pdf-lib');

  const mergedPdf = await PDFDocument.create();

  for (const item of stockItems) {
    const material = materials.find(m => m.id === item.material_id);
    if (!material) continue;

    const labelBytes = await generateRemnantLabelPdf(item, material, tenantDomain);
    const labelPdf = await PDFDocument.load(labelBytes);
    const [page] = await mergedPdf.copyPages(labelPdf, [0]);
    mergedPdf.addPage(page);
  }

  return mergedPdf.save();
}
