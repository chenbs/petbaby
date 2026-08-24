/** Remove photographic texture from the full pose-aligned identity image without semantic coordinates. */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const referenceRoot = path.join(import.meta.dirname, "out", "reference-v1");
const source = path.join(referenceRoot, "identity-guides", "ink-portrait_black-labrador-dog_profile-identity_reset-v02.png");
const output = path.join(referenceRoot, "identity-guides", "ink-portrait_black-labrador-dog_profile-flat-guide_reset-v03.png");

await mkdir(path.dirname(output), { recursive: true });
await sharp(source)
  .grayscale()
  .blur(5)
  .png({ compressionLevel: 9, palette: true, colours: 4, dither: 0 })
  .toFile(output);
console.log(output);
