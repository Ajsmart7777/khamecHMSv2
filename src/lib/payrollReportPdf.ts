import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

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
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sourceHeight;
    const context = slice.getContext('2d');
    if (!context) throw new Error('Could not prepare payroll report page.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
    const sliceHeight = (sourceHeight * usableWidth) / canvas.width;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableWidth, sliceHeight, undefined, 'FAST');
    offset += usableHeight;
    page += 1;
  }
}

export async function downloadPayrollReportPdf(element: HTMLElement, filename: string, landscape = false) {
  const canvas = await html2canvas(element, {
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  addCanvasPages(pdf, canvas);
  pdf.save(filename);
}
