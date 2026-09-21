import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export async function svgToPdf(svg: Uint8Array) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const pdf = await PDFDocument.create();
  pdf.setCreator("麻麻抱我");
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return new Uint8Array(await pdf.save());
}
