/**
 * 展示小图（长边 ≤ 1440 的 JPEG，见 media/display-image.ts）在对象存储里的派生键。
 *
 * 只有支持预签名直连的存储（COS）才会落这份派生文件；删除原对象时由存储适配器一并删除，
 * 所以所有既有删除链路（删照片、删作品、注销、审核移除、对象清理队列）都不用各自追着清理。
 */
export function displayKeyOf(key: string) {
  if (key.startsWith("display/")) return null;
  const match = /^(.+)\.(png|jpe?g|webp|svg)$/i.exec(key);
  return match ? `display/${match[1]}-${match[2].toLowerCase()}.jpg` : null;
}
