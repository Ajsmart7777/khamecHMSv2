import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

function drawTile(pdf: jsPDF, canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number, margin: number) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;
  const sourceWidth = Math.max(1, Math.floor(width));
  const sourceHeight = Math.max(1, Math.floor(height));
  const tile = document.createElement('canvas');
  tile.width = sourceWidth;
  tile.height = sourceHeight;
  const context = tile.getContext('2d');
  if (!context) throw new Error('Could not prepare payroll report page.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(canvas, Math.floor(x), Math.floor(y), sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  const scale = Math.min(usableWidth / sourceWidth, usableHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const left = margin + (usableWidth - renderedWidth) / 2;
  const top = margin + (usableHeight - renderedHeight) / 2;
  pdf.addImage(tile.toDataURL('image/jpeg', 0.94), 'JPEG', left, top, renderedWidth, renderedHeight, undefined, 'FAST');
}

/**
 * Master payroll reports are deliberately tiled instead of squeezed into one page.
 * Two horizontal tiles are used (ID through RESP, then RESP through NET PAY), and
 * the staff rows are split across as many vertical tiles as needed, with a minimum
 * of two row bands so a normal payroll produces four joinable pages.
 */
function addTiledPages(pdf: jsPDF, canvas: HTMLCanvasElement) {
  const margin = 8;
  const horizontalTiles = 2;
  const verticalTiles = Math.max(2, Math.ceil(canvas.height / (canvas.width / horizontalTiles)));
  const overlapX = Math.max(8, Math.round(canvas.width * 0.012));
  const overlapY = Math.max(8, Math.round(canvas.height * 0.012));
  const tileWidth = canvas.width / horizontalTiles;
  const tileHeight = canvas.height / verticalTiles;

  for (let row = 0; row < verticalTiles; row += 1) {
    for (let column = 0; column < horizontalTiles; column += 1) {
      if (row !== 0 || column !== 0) pdf.addPage();
      const x = Math.max(0, column * tileWidth - (column > 0 ? overlapX : 0));
      const y = Math.max(0, row * tileHeight - (row > 0 ? overlapY : 0));
      const right = Math.min(canvas.width, (column + 1) * tileWidth + (column < horizontalTiles - 1 ? overlapX : 0));
      const bottom = Math.min(canvas.height, (row + 1) * tileHeight + (row < verticalTiles - 1 ? overlapY : 0));
      drawTile(pdf, canvas, x, y, right - x, bottom - y, margin);
    }
  }
}

function addCanvasPages(pdf: jsPDF, canvas: HTMLCanvasElement) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const imageHeight = (canvas.height * usableWidth) / canvas.width;
  const usableHeight = pageHeight - margin * 2;
  let offset = 0;
  let page = 0;

  while (offset < imageHeight) {
    if (page > 0) pdf.addPage();
    const sourceY = Math.floor((offset / imageHeight) * canvas.height);
    const sourceHeight = Math.min(canvas.height - sourceY, Math.floor((usableHeight / imageHeight) * canvas.height));
    drawTile(pdf, canvas, 0, sourceY, canvas.width, sourceHeight, margin);
    offset += usableHeight;
    page += 1;
  }
}

export async function downloadPayrollReportPdf(
  element: HTMLElement,
  filename: string,
  landscape = false,
  format: 'a3' | 'a4' = 'a4',
  tiledMaster = false,
) {
  const canvas = await html2canvas(element, {
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format, compress: true });
  if (tiledMaster) addTiledPages(pdf, canvas);
  else addCanvasPages(pdf, canvas);
  pdf.save(filename);
}
