/** Deterministically keep the edit target outside a transparent API mask. */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

async function readRgba(input) {
  return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function assertSameSize(images) {
  const [{ info: expected }, ...rest] = images;
  for (const image of rest) {
    if (image.info.width !== expected.width || image.info.height !== expected.height) {
      throw new Error(
        `Mask composite size mismatch: ${expected.width}x${expected.height} / ${image.info.width}x${image.info.height}`
      );
    }
  }
}

export async function lockOutsideMask({ basePath, edited, maskPath }) {
  const [baseImage, editedImage, maskImage] = await Promise.all([
    readRgba(basePath),
    readRgba(edited),
    readRgba(maskPath)
  ]);
  assertSameSize([baseImage, editedImage, maskImage]);
  const { width, height } = baseImage.info;

  const output = Buffer.alloc(baseImage.data.length);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const editWeight = (255 - maskImage.data[offset + 3]) / 255;
    if (editWeight === 0) {
      baseImage.data.copy(output, offset, offset, offset + 4);
      continue;
    }
    if (editWeight === 1) {
      editedImage.data.copy(output, offset, offset, offset + 4);
      continue;
    }
    for (let channel = 0; channel < 4; channel += 1) {
      output[offset + channel] = Math.round(
        baseImage.data[offset + channel] * (1 - editWeight)
        + editedImage.data[offset + channel] * editWeight
      );
    }
  }

  return sharp(output, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function auditOutsideMaskLock({ basePath, outputPath, maskPath }) {
  const [baseImage, outputImage, maskImage] = await Promise.all([
    readRgba(basePath),
    readRgba(outputPath),
    readRgba(maskPath)
  ]);
  assertSameSize([baseImage, outputImage, maskImage]);

  let outsideChanged = 0;
  let outsidePixels = 0;
  let insideChanged = 0;
  let insidePixels = 0;
  const pixelCount = baseImage.info.width * baseImage.info.height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const isEditable = maskImage.data[offset + 3] < 255;
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (baseImage.data[offset + channel] !== outputImage.data[offset + channel]) {
        changed = true;
        break;
      }
    }
    if (isEditable) {
      insidePixels += 1;
      if (changed) insideChanged += 1;
    } else {
      outsidePixels += 1;
      if (changed) outsideChanged += 1;
    }
  }
  return { outsideChanged, outsidePixels, insideChanged, insidePixels };
}
