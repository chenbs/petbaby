/** 将已审核摄影底图制成首页电影海报，并压缩免费趣测封面。 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../..");
const sharp = createRequire(path.join(repo, "apps/platform/package.json"))("sharp");
const source = path.join(repo, "tools/imagegen/out/goal-20260929");
const posterFile = path.join(repo, "tools/imagegen/out/plugins/mp26-pet-movie-poster-v4.jpg");
const coverDir = path.join(repo, "apps/miniprogram/assets/fun-tests");

const posterText = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs><linearGradient id="shade"><stop stop-color="#071b30" stop-opacity=".82"/><stop offset=".67" stop-color="#071b30" stop-opacity=".14"/><stop offset="1" stop-color="#071b30" stop-opacity="0"/></linearGradient></defs>
  <rect width="950" height="1000" fill="url(#shade)"/>
  <text x="86" y="130" fill="#f7e8c8" font-family="Microsoft YaHei" font-size="27" letter-spacing="6">麻麻抱我 · ORIGINAL FILM</text>
  <path d="M88 168h480" stroke="#eec783" stroke-width="3"/>
  <text x="80" y="385" fill="#fff8eb" font-family="Microsoft YaHei" font-size="132" font-weight="bold" letter-spacing="13">天生</text>
  <text x="80" y="535" fill="#fff8eb" font-family="Microsoft YaHei" font-size="132" font-weight="bold" letter-spacing="13">主角</text>
  <text x="88" y="612" fill="#f8e7ca" font-family="Microsoft YaHei" font-size="37">每个平凡日子，都值得开场</text>
  <path d="M88 805h480" stroke="#eec783" stroke-width="3"/>
  <text x="88" y="856" fill="#fff8eb" font-family="Microsoft YaHei" font-size="26" letter-spacing="3">我的电影 · 2026 秋日上映</text>
  <text x="88" y="918" fill="#cdd8e3" font-family="sans-serif" font-size="20" letter-spacing="5">A PET FILM  /  MADE WITH LOVE</text>
</svg>`);

await mkdir(path.dirname(posterFile), { recursive: true });
await sharp(path.join(source, "movie-cover-v4.jpg"))
  .resize(1600, 1000, { fit: "cover" })
  .composite([{ input: posterText }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(posterFile);

for (const name of ["personality", "luck", "bond", "recharge"]) {
  const body = await sharp(path.join(source, `fun-${name}-v2.jpg`))
    .resize(900, 900, { fit: "cover", position: "attention" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  await writeFile(path.join(coverDir, `${name}.jpg`), body);
}
console.log(posterFile);
