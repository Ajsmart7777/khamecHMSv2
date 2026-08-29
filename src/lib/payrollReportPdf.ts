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
  if (tiledMaster) {
    const quadrantElements = Array.from(document.querySelectorAll<HTMLElement>('#payroll-report-print-tiles .payroll-print-page'));
    if (quadrantElements.length > 0) {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      for (let i = 0; i < quadrantElements.length; i++) {
        if (i > 0) pdf.addPage();
        const pageEl = quadrantElements[i];
        const canvas = await html2canvas(pageEl, {
          scale: Math.min(2, window.devicePixelRatio || 2),
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          onclone: (clonedDoc) => {
            const printTiles = clonedDoc.getElementById('payroll-report-print-tiles');
            if (printTiles) {
              printTiles.style.display = 'block';
              printTiles.style.visibility = 'visible';
            }
            const pages = clonedDoc.querySelectorAll<HTMLElement>('#payroll-report-print-tiles .payroll-print-page');
            pages.forEach((p, idx) => {
              p.style.display = idx === i ? 'flex' : 'none';
              p.style.visibility = idx === i ? 'visible' : 'hidden';
            });
          },
        });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 6;
        const usableWidth = pageWidth - margin * 2;
        const usableHeight = pageHeight - margin * 2;
        const imgWidth = usableWidth;
        const imgHeight = Math.min((canvas.height * usableWidth) / canvas.width, usableHeight);
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, imgWidth, imgHeight, undefined, 'FAST');
      }
      pdf.save(filename);
      return;
    }
  }

  const canvas = await html2canvas(element, {
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format, compress: true });
  addCanvasPages(pdf, canvas);
  pdf.save(filename);
}
