import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratorInput } from "../src/server/generators/types";

const root = path.resolve(import.meta.dirname, "../../..");
const output = path.join(root, "output/ui-review-20260929/movie-album-runtime-v3");

async function main() {
  if ((process.argv.includes("--movie") || process.argv.includes("--all-movies")) && !process.env.LINGSUAN_IMAGE_API_KEY) process.loadEnvFile(path.join(root, ".env.imagegen"));
  const petPhoto = new Uint8Array(await readFile(path.join(root, "tools/imagegen/out/plugins/mp26-gray-toy-poodle-editorial-v1.jpg")));
  const source = {
    pet: { id: "00000000-0000-4000-8000-00000000c001", name: "豆豆", species: "dog" },
    photos: Array.from({ length: 6 }, (_, index) => ({
      metadata: { shotAt: new Date(2026, index, index + 1).toISOString(), shotAtSource: "manual" },
      object: { body: petPhoto, contentType: "image/jpeg" },
    })),
  } as unknown as GeneratorInput;

  await mkdir(output, { recursive: true });
  const { generateTimeAlbum } = await import("../src/server/generators/svg");
  for (const theme of ["growth", "birthday", "healing", "holiday"]) {
    const input = { ...source, plugin: { id: "pet-time-album" }, task: { options: { theme } } } as unknown as GeneratorInput;
    const result = await generateTimeAlbum(input);
    const png = result.files.find((file) => file.suffix === "png");
    if (!png) throw new Error(`Album preview missing: ${theme}`);
    await writeFile(path.join(output, `album-${theme}.png`), png.body);
  }

  if (process.argv.includes("--movie") || process.argv.includes("--all-movies")) {
    const { generateMoviePoster } = await import("../src/server/generators/movie-poster");
    const styles = process.argv.includes("--all-movies") ? ["rooftop", "highseas", "musical", "webcity", "starvoyage"] : ["highseas"];
    for (const style of styles) {
      const input = { ...source, photos: source.photos.slice(0, 1), plugin: { id: "pet-movie-poster" }, task: { options: { style } } } as unknown as GeneratorInput;
      const result = await generateMoviePoster(input);
      await writeFile(path.join(output, `movie-${style}.png`), result.files[0].body);
      console.log(`movie-${style}.png`);
    }
  }

  console.log(output);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
