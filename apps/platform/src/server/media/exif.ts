/**
 * 从 JPEG/WebP 的 EXIF 段里取「拍摄时间」。
 *
 * 为什么要自己解析：`photos.created_at` 是上传时间，用它当拍摄时间会让成长时间线的
 * 「第 1 天」变成用户建档那天 —— 整条时间线连带年度视频里的日期全是错的。
 * sharp 的 `metadata().exif` 只把 APP1 段的原始字节交回来，不做解码，
 * 所以这里手写一个最小 TIFF/IFD 读取器，只取时间相关的几个 tag。
 *
 * 取值优先级：DateTimeOriginal（快门按下的那一刻）→ DateTimeDigitized → DateTime。
 * 最后那个是「文件修改时间」，某些相机和多数编辑软件会改写它，所以放在最后。
 *
 * 解析失败、无 EXIF、值明显不合理（截图、扫描件、写坏的 0000:00:00）时返回
 * undefined —— **绝不回落到当前时间**。列可空，读取侧 `mapPhoto` 会回落到
 * `created_at`；在这里塞一个假的拍摄时间会让错误数据变得无法区分。
 */

/** EXIF 时间字段的格式：`YYYY:MM:DD HH:MM:SS`，日期部分也用冒号分隔 */
const DATE_TIME_PATTERN = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/** `OffsetTimeOriginal` 之类的时区字段：`+08:00` / `-05:00` / `Z` */
const OFFSET_PATTERN = /^(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TAG_OFFSET_TIME = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;

/** ASCII 字符串类型。时间字段全是这个类型，其余类型直接跳过 */
const TYPE_ASCII = 2;
/** IFD 指针用的 LONG */
const TYPE_LONG = 4;

/** 一条 IFD entry 固定 12 字节 */
const ENTRY_SIZE = 12;

/** 相机时钟没设置时常见的产物，一律当作无效 */
const MIN_YEAR = 1900;

type Reader = {
  view: DataView;
  little: boolean;
};

function readUint16(reader: Reader, offset: number) {
  return reader.view.getUint16(offset, reader.little);
}

function readUint32(reader: Reader, offset: number) {
  return reader.view.getUint32(offset, reader.little);
}

function readAscii(reader: Reader, offset: number, length: number) {
  const bytes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (offset + index >= reader.view.byteLength) break;
    const byte = reader.view.getUint8(offset + index);
    if (byte === 0) break;
    bytes.push(byte);
  }
  return String.fromCharCode(...bytes).trim();
}

/**
 * 读一个 IFD 里我们关心的 tag，顺带把 Exif SubIFD 的指针交出来。
 *
 * 时间字段实际住在 SubIFD 里（IFD0 只有 DateTime），所以必须跟着
 * 0x8769 再走一跳，不能只扫 IFD0。
 */
function readIfd(reader: Reader, ifdOffset: number, into: Map<number, string>): number | undefined {
  if (ifdOffset <= 0 || ifdOffset + 2 > reader.view.byteLength) return undefined;
  const count = readUint16(reader, ifdOffset);
  // 条目数写坏时（截断的 APP1 段）不要按它循环，否则读越界。
  const maxCount = Math.floor((reader.view.byteLength - ifdOffset - 2) / ENTRY_SIZE);
  let subIfd: number | undefined;
  for (let index = 0; index < Math.min(count, maxCount); index += 1) {
    const entry = ifdOffset + 2 + index * ENTRY_SIZE;
    const tag = readUint16(reader, entry);
    const type = readUint16(reader, entry + 2);
    const valueCount = readUint32(reader, entry + 4);
    if (tag === TAG_EXIF_IFD_POINTER && type === TYPE_LONG) {
      subIfd = readUint32(reader, entry + 8);
      continue;
    }
    if (type !== TYPE_ASCII) continue;
    if (tag !== TAG_DATE_TIME && tag !== TAG_DATE_TIME_ORIGINAL && tag !== TAG_DATE_TIME_DIGITIZED
      && tag !== TAG_OFFSET_TIME && tag !== TAG_OFFSET_TIME_ORIGINAL && tag !== TAG_OFFSET_TIME_DIGITIZED) continue;
    // ASCII 值 ≤4 字节时直接内联在 entry 里，否则第 8 字节是偏移量。
    const valueOffset = valueCount <= 4 ? entry + 8 : readUint32(reader, entry + 8);
    const text = readAscii(reader, valueOffset, valueCount);
    if (text) into.set(tag, text);
  }
  return subIfd;
}

/**
 * 把 EXIF 的时间串 + 可选时区偏移变成 Date。
 *
 * 没有偏移字段时按**本地时间**处理（与 `apps/miniprogram/services/companion.js`
 * 的口径一致：纯日期语义按本地零点，不要按 UTC 解析）。多数手机会写
 * OffsetTimeOriginal，有就用它，这样跨时区拍的照片日期才不会偏一天。
 */
function toDate(value: string, offset?: string): Date | undefined {
  const matched = DATE_TIME_PATTERN.exec(value);
  if (!matched) return undefined;
  const [, year, month, day, hour, minute, second] = matched.map(Number) as unknown as number[];
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return undefined;
  }
  const zone = offset ? OFFSET_PATTERN.exec(offset.trim()) : null;
  if (zone) {
    const minutes = zone[1] ? 0 : (Number(zone[3]) * 60 + Number(zone[4])) * (zone[2] === "-" ? -1 : 1);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - minutes * 60_000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return undefined;
  // 闰日之类的溢出（"2025:02:30"）会被 Date 静默滚到下个月，回读校验挡掉。
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date;
}

/**
 * @param exif sharp `metadata().exif` 交回的原始字节；缺失时传 undefined
 * @returns 拍摄时间；解析不出或值不可信时 undefined
 */
export function readShotAt(exif: Uint8Array | undefined | null): Date | undefined {
  if (!exif || exif.byteLength < 8) return undefined;
  try {
    // sharp 通常带着 APP1 的 "Exif\0\0" 前缀，也有不带的情况，两种都认。
    let start = 0;
    if (exif.byteLength > 6 && exif[0] === 0x45 && exif[1] === 0x78 && exif[2] === 0x69 && exif[3] === 0x66) start = 6;
    const view = new DataView(exif.buffer, exif.byteOffset + start, exif.byteLength - start);
    if (view.byteLength < 8) return undefined;
    const marker = view.getUint16(0, false);
    if (marker !== 0x4949 && marker !== 0x4d4d) return undefined;
    const reader: Reader = { view, little: marker === 0x4949 };
    if (readUint16(reader, 2) !== 0x002a) return undefined;

    const tags = new Map<number, string>();
    const subIfd = readIfd(reader, readUint32(reader, 4), tags);
    if (subIfd) readIfd(reader, subIfd, tags);

    const candidates: Array<[number, number]> = [
      [TAG_DATE_TIME_ORIGINAL, TAG_OFFSET_TIME_ORIGINAL],
      [TAG_DATE_TIME_DIGITIZED, TAG_OFFSET_TIME_DIGITIZED],
      [TAG_DATE_TIME, TAG_OFFSET_TIME],
    ];
    for (const [dateTag, offsetTag] of candidates) {
      const raw = tags.get(dateTag);
      if (!raw) continue;
      const parsed = toDate(raw, tags.get(offsetTag));
      // 未来的拍摄时间只可能来自设错的时钟，宁可不填。留一天余量兜时区。
      if (parsed && parsed.getTime() <= Date.now() + 86_400_000) return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
