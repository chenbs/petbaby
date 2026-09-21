import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const execute = promisify(execFile);

async function main() {
  const output = path.resolve(process.env.MEDIA_SMOKE_OUTPUT || "test-results/media");
  await mkdir(output, { recursive: true });
  process.env.DATABASE_URL = "memory://";
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_ENV = "staging";
  process.env.LOCAL_STORAGE_DIR = path.join(output, "objects");
  const font = process.env.FFMPEG_FONT_FILE;
  assert.ok(font, "设置 FFMPEG_FONT_FILE，必须使用带中文字形的字体");
  await access(font);
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  await execute(ffmpeg, ["-version"], { windowsHide: true });
  const { getDatabase } = await import("../src/server/db/client");
  const { objectStorage } = await import("../src/server/storage");
  const { renderMemorialAlbum, buildPages } = await import("../src/server/memorial/album");
  const { buildHealthDocumentSvg, renderHealthDocumentPdf } = await import("../src/server/health/document");
  const { renderAnnualFilm } = await import("../src/server/video/annual-film");
  const database = await getDatabase();
  try {
    const userId = crypto.randomUUID();
    const petId = crypto.randomUUID();
    const year = new Date().getFullYear();
    await database.query("INSERT INTO users(id,created_at) VALUES($1,now())", [userId]);
    await database.query("INSERT INTO pets(id,user_id,name,species,gender,date_type,life_stage,is_default,birthday,created_at) VALUES($1,$2,'年糕','cat','unknown','birthday','active',true,$3,now())", [petId, userId, `${year}-01-01`]);
    const photos = [];
    for (const [index, color] of ["#dca966", "#6eaf92"].entries()) {
      const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="${color}"/><circle cx="360" cy="540" r="190" fill="#f7ead7"/><text x="360" y="820" text-anchor="middle" font-family="sans-serif" font-size="64">年糕的第 ${index + 1} 张照片</text></svg>`)).png().toBuffer();
      const key = `private/${userId}/photos/smoke-${index}.png`;
      await objectStorage.put(key, image, "image/png");
      await database.query("INSERT INTO photos(id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,'clear',$8)", [crypto.randomUUID(), userId, petId, `smoke-${index}.png`, image.length, key, index, `${year}-${index ? "08" : "01"}-01T12:00:00Z`]);
      photos.push({ body: new Uint8Array(image), contentType: "image/png" });
    }
    const albumInput = { petName: "年糕", title: "一起度过的日常", story: "记得窗边的阳光，也记得你抬头看我的样子。", theme: "warm", sections: [{ title: "我们的照片", body: "两张不同时刻的照片，记录相处的日子。" }], photos, anchor: `${year}-01-01`, memorialSince: `${year}-08-01` };
    const album = await renderMemorialAlbum(albumInput);
    assert.ok((await PDFDocument.load(album)).getPageCount() >= 3);
    await writeFile(path.join(output, "memorial-album.pdf"), album);
    await sharp(Buffer.from(buildPages(albumInput)[0])).png().toFile(path.join(output, "memorial-cover.png"));
    const healthSvg = buildHealthDocumentSvg({ petName: "年糕", species: "cat", lifeStage: "active", generatedOn: `${year}-08-01`, weights: [{ weightGrams: 4000, measuredOn: `${year}-01-01` }, { weightGrams: 4200, measuredOn: `${year}-08-01` }], care: [{ kindText: "体检", label: "年度记录", performedOn: `${year}-08-01` }], sessions: [{ date: `${year}-08-01`, levelText: "日常记录", summary: "记录近期饮食与活动情况，供就医时沟通。" }] });
    const health = await renderHealthDocumentPdf(healthSvg);
    assert.equal((await PDFDocument.load(health)).getPageCount(), 1);
    await writeFile(path.join(output, "health-document.pdf"), health);
    await sharp(Buffer.from(healthSvg)).png().toFile(path.join(output, "health-document.png"));
    const rendered = await renderAnnualFilm({ id: crypto.randomUUID(), user_id: userId, config: { year, durationSeconds: 10 } });
    const video = await objectStorage.get(rendered.key);
    assert.ok(video?.body.length);
    const videoPath = path.join(output, "annual-film.mp4");
    await writeFile(videoPath, video.body);
    const probe = await execute(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", videoPath], { windowsHide: true });
    const metadata = JSON.parse(probe.stdout);
    assert.ok(Math.abs(Number(metadata.format.duration) - 10) < 0.3);
    assert.ok(metadata.streams.some((stream: { codec_type: string; width: number; height: number }) => stream.codec_type === "video" && stream.width === 720 && stream.height === 1280));
    for (const second of [1, 4, 7, 9]) await execute(ffmpeg, ["-y", "-ss", String(second), "-i", videoPath, "-frames:v", "1", path.join(output, `annual-frame-${second}.png`)], { windowsHide: true });
    await writeFile(path.join(output, "report.json"), JSON.stringify({ timestamp: new Date().toISOString(), duration: metadata.format.duration, albumPages: (await PDFDocument.load(album)).getPageCount(), healthPages: 1, photos: photos.length, frames: [1, 4, 7, 9], font }, null, 2));
    console.log(`导出冒烟通过：纪念册、健康 PDF、10 秒年度视频与四张抽帧已写入 ${output}`);
  } finally { await database.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
