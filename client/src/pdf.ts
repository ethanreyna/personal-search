import type { TailoredDocument } from './types';

const PAGE_W = 612; // US Letter in points
const PAGE_H = 792;
const MARGIN = 50;
const WIDTH = PAGE_W - MARGIN * 2;

type JsPDF = import('jspdf').jsPDF;

/**
 * Lays the document out at a given body font size. With `pdf` null it only
 * measures, so the caller can pick the largest size that fits one page.
 * Returns the y position after the last line (may exceed the page when measuring).
 */
function layout(pdf: JsPDF, d: TailoredDocument, size: number, draw: boolean): number {
  let y = MARGIN;
  const lh = size * 1.22;

  const text = (s: string | string[], x: number, yy: number, opts?: { align?: 'right' }) => {
    if (!draw) return;
    if (opts?.align === 'right') pdf.text(s, x, yy, { align: 'right' });
    else pdf.text(s, x, yy);
  };
  const font = (style: 'normal' | 'bold', pt: number) => {
    pdf.setFont('times', style);
    pdf.setFontSize(pt);
  };
  const breakIfNeeded = (h: number) => {
    if (draw && y + h > PAGE_H - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }
  };
  const heading = (label: string) => {
    y += size * 0.7;
    breakIfNeeded(size * 2.4);
    font('normal', size + 3.5);
    y += size + 3.5;
    text(label, MARGIN, y);
    if (draw) {
      pdf.setLineWidth(0.5);
      pdf.line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3);
    }
    y += size * 0.55;
  };
  /** "Bold part - normal part" on the left, bold date on the right. */
  const entryLine = (bold: string, normal: string, right: string) => {
    breakIfNeeded(lh * 2);
    y += lh;
    font('bold', size);
    text(bold, MARGIN, y);
    const bw = pdf.getTextWidth(bold);
    font('normal', size);
    text(normal ? ` - ${normal}` : '', MARGIN + bw, y);
    font('bold', size);
    text(right, PAGE_W - MARGIN, y, { align: 'right' });
  };
  /** Bullet with hanging indent; an optional bold lead-in ("Frontend:"). */
  const bullet = (body: string, lead?: string) => {
    const indent = 14;
    font('normal', size);
    const leadText = lead ? `${lead}: ` : '';
    const lines: string[] = pdf.splitTextToSize(leadText + body, WIDTH - indent);
    breakIfNeeded(lh * lines.length);
    lines.forEach((line, i) => {
      y += lh;
      if (i === 0) {
        text('•', MARGIN + 3, y);
        if (lead && line.startsWith(leadText)) {
          // Measure the label without its trailing space, then add a normal-weight space.
          font('bold', size);
          text(`${lead}:`, MARGIN + indent, y);
          const lw = pdf.getTextWidth(`${lead}:`);
          font('normal', size);
          text(line.slice(leadText.length).trimStart(), MARGIN + indent + lw + pdf.getTextWidth(' '), y);
          return;
        }
      }
      text(line, MARGIN + indent, y);
    });
  };

  // Header
  font('bold', size + 9);
  y += size + 9;
  text(d.name, MARGIN, y);
  y += 4;
  font('normal', size - 0.5);
  for (const c of d.contact) {
    y += (size - 0.5) * 1.2;
    text(c, MARGIN, y);
  }

  if (d.summary) {
    heading('Summary');
    font('normal', size);
    const lines: string[] = pdf.splitTextToSize(d.summary, WIDTH);
    for (const line of lines) {
      y += lh;
      text(line, MARGIN, y);
    }
  }

  heading('Education');
  for (const e of d.education) entryLine(e.school, e.detail, e.date);

  heading('Skills');
  for (const g of d.skills) bullet(g.items.join(', '), g.label);

  heading('Work Experience');
  d.experience.forEach((e, i) => {
    if (i > 0) y += size * 0.45;
    entryLine(e.company, e.title, e.dates);
    for (const b of e.bullets) bullet(b);
  });

  return y;
}

/** Builds the PDF, shrinking the font a little if needed to fit one page. */
export async function buildPdf(d: TailoredDocument): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf');
  const make = () => new jsPDF({ unit: 'pt', format: 'letter' });

  let size = 11;
  const probe = make();
  for (const s of [11, 10.5, 10, 9.5, 9]) {
    size = s;
    if (layout(probe, d, s, false) <= PAGE_H - MARGIN) break;
  }

  const pdf = make();
  pdf.setProperties({ title: d.name, author: d.name });
  layout(pdf, d, size, true);
  return pdf;
}

export async function downloadDocument(d: TailoredDocument): Promise<void> {
  (await buildPdf(d)).save(d.fileName);
}
