import sharp from "sharp";

import { localCopy } from "@/server/generators/copy";
import type { GeneratorInput, GeneratorOutput } from "@/server/generators/types";
import { imageProvider } from "@/server/ai/provider";
import { AppError } from "@/server/errors";
import { applyAiMetadata } from "@/server/media/ai-label";
import { isTestHarness } from "@/server/runtime-mode";

const assetBase = "https://babykitty-static-one-1252454114.cos.ap-shanghai.myqcloud.com/samples/miniprogram-effects/v3/movie-master";

const scenes: Record<string, { file: string; color: string; accent: string; setting: string }> = {
  rooftop: { file: "rooftop-f70b26e6a5b67c353a30ae44d55127be30542ac1d5730a91379cfaf99046e0c5.jpg", color: "#10283e", accent: "#f2c67d", setting: "a cinematic city rooftop at dusk" },
  highseas: { file: "highseas-b799d5865808f145e0c8cc1f3aafd1b64aa357ab06ccd470f9cf980c684e9764.jpg", color: "#174b58", accent: "#f3e9c4", setting: "a bright sailing ship deck overlooking turquoise sea, distant islands and white sails" },
  musical: { file: "musical-2051de96093fb8221158dac50341bbff3fccf74c6ffa831449d0f058c8a3fcdd.jpg", color: "#723f50", accent: "#ffe3ad", setting: "a sunlit open-air theater plaza with terraces, festoon lights and a distant stage" },
  webcity: { file: "webcity-3f03aabd7e5d315b248c14f9884e46ce73c5fd0cb6a713943c9c4e6f4f10597d.jpg", color: "#7a3944", accent: "#ffcfb9", setting: "a bright pale-stone rooftop terrace overlooking a vermilion suspension bridge and warm ivory city skyline" },
  starvoyage: { file: "starvoyage-37acdd94d795c4091578613344117c3f72dca3cc10d1b1980a8e8c5c2881ab05.jpg", color: "#39516d", accent: "#dbeaff", setting: "a sunlit spacecraft observation deck above cloud valleys and an ice-blue planet" },
};

const legacyStyles: Record<string, string> = { classic: "rooftop", arthouse: "musical", hongkong: "webcity" };

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function wrapText(value: string, max: number, lines: number) {
  const characters = [...value];
  const output: string[] = [];
  while (characters.length && output.length < lines) output.push(characters.splice(0, max).join(""));
  if (characters.length) output[output.length - 1] = output[output.length - 1].slice(0, -1) + "…";
  return output;
}

export function buildMoviePosterPrompt(setting: string, composition: string) {
  const framing = composition === "closeup" ? "Frame the new pet closer while keeping its full face clear." :
    composition === "ensemble" ? "Keep the new pet as the single main character; show more of the surrounding environment." :
      "Keep the new pet's complete body and paws visible, with a strong hero composition.";
  return [
    "Use case: identity-preserve. Image 1 is the original, self-owned cinematic scene master. Image 2 is the user's pet identity photo.",
    `Replace the animal in Image 1 with the same individual pet from Image 2, inside ${setting}.`,
    "Preserve the scene, props, camera angle, lighting, perspective, atmosphere and realistic photographic finish of Image 1.",
    "Keep the pet recognizable by its breed, face, markings, coat and body proportions. Adapt the animal's pose naturally to the scene; paws must touch the ground and anatomy must be complete.",
    framing,
    "Remove any writing or logo. Keep the lower fifth compositionally simple for a title that will be added separately; retain the scene's natural brightness and color.",
    "No extra animals, branded costumes, franchise symbols, superhero insignia, recognizable copyrighted characters or distorted limbs.",
  ].join(" ");
}

async function reference(body: Uint8Array, filename: string) {
  return {
    body: new Uint8Array(await sharp(Buffer.from(body)).rotate().resize(1000, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()),
    contentType: "image/jpeg",
    filename,
  };
}

export async function generateMoviePoster(input: GeneratorInput): Promise<GeneratorOutput> {
  const requestedStyle = typeof input.task.options.style === "string" ? input.task.options.style : "rooftop";
  const style = scenes[requestedStyle] ? requestedStyle : legacyStyles[requestedStyle] || "rooftop";
  const scene = scenes[style];
  const copy = localCopy(input.plugin.id, input.pet, input.task);
  const composition = typeof input.task.options.composition === "string" ? input.task.options.composition : "portrait";
  const review = typeof input.task.options.review === "string" ? input.task.options.review.trim() : "";

  const testProvider = imageProvider.name === "local" && isTestHarness();
  if (!testProvider && (imageProvider.name === "local" || imageProvider.name === "unconfigured")) {
    throw new AppError("AI_PROVIDER_CONFIG_PENDING", "电影海报生成服务尚未配置", 503);
  }
  let masterBody: Uint8Array;
  if (testProvider) {
    masterBody = input.photos[0].object.body;
  } else {
    const sceneResponse = await fetch(`${assetBase}/${scene.file}`, { signal: AbortSignal.timeout(30_000) });
    if (!sceneResponse.ok) throw new Error(`MOVIE_SCENE_UNAVAILABLE_${sceneResponse.status}`);
    masterBody = new Uint8Array(await sceneResponse.arrayBuffer());
  }
  const master = await reference(masterBody, "scene.jpg");
  const pet = await reference(input.photos[0].object.body, "pet.jpg");
  const generated = await imageProvider.generate(buildMoviePosterPrompt(scene.setting, composition), 1, [master, pet], { size: "1024x1536", quality: "high", inputFidelity: "high" });
  if (!generated[0]?.body.byteLength) throw new Error("MOVIE_IMAGE_EMPTY");

  const sideTitle = ["highseas", "webcity", "starvoyage"].includes(style);
  const titleLines = wrapText(copy.title, sideTitle ? 6 : 18, 3);
  const titleSize = sideTitle ? 52 : copy.title.length > 32 ? 48 : copy.title.length > 18 ? 58 : 76;
  const titleX = sideTitle ? 560 : 68;
  const titleY = sideTitle ? 1190 - (titleLines.length - 2) * (titleSize + 10) : 1260 - (titleLines.length - 1) * (titleSize + 12);
  const title = titleLines.map((line, index) => `<text x="${titleX}" y="${titleY + index * (titleSize + 12)}" fill="#fffaf1" ${sideTitle ? `stroke="${scene.color}" stroke-opacity=".48" stroke-width="3" paint-order="stroke fill"` : ""} font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="${titleSize}" font-weight="800">${escapeXml(line)}</text>`).join("");
  const subtitle = wrapText(copy.subtitle, 27, 1)[0] || "";
  const shortReview = wrapText(review, 31, 1)[0] || "";
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="${scene.color}" stop-opacity="0"/><stop offset="1" stop-color="${scene.color}" stop-opacity=".92"/></linearGradient></defs><rect width="1024" height="1536" fill="url(#shade)"/><text x="${titleX}" y="${titleY - 84}" fill="${scene.accent}" font-family="sans-serif" font-size="${sideTitle ? 17 : 24}" letter-spacing="${sideTitle ? 2 : 4}">A PET FILM / MAMA HOLD ME</text>${title}<text x="${sideTitle ? titleX : 70}" y="1365" fill="#fffaf1" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="${sideTitle ? 24 : 30}">${escapeXml(subtitle)}</text>${shortReview ? `<text x="${sideTitle ? titleX : 70}" y="1410" fill="#fffaf1" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="${sideTitle ? 22 : 25}">“${escapeXml(shortReview)}”</text>` : ""}<path d="M68 1450h888" stroke="${scene.accent}" stroke-width="2"/><text x="68" y="1490" fill="#fffaf1" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="23">麻麻抱我 · 原创电影海报</text></svg>`;
  const poster = await sharp(Buffer.from(generated[0].body)).rotate().resize(1024, 1536, { fit: "cover" }).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
  const body = await applyAiMetadata(new Uint8Array(poster), input.task.id);
  return {
    title: copy.title,
    subtitle: copy.subtitle,
    serialNumber: `${new Date().getFullYear()}-${input.pet.id.slice(0, 4).toUpperCase()}-PET`,
    authority: input.pet.species === "cat" ? "猫猫管理局" : "好朋友管理局",
    files: [{ suffix: "png", body, contentType: "image/png" }],
  };
}
