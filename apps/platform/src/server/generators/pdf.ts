import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

export async function svgToPdf(svg: Uint8Array) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Petbaby", { x: 18, y: 18, size: 10, font, color: rgb(0.1, 0.2, 0.15) });
  return new Uint8Array(await pdf.save());
}
