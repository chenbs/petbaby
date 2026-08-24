import { describe, expect, it } from "vitest";

import { readShotAt } from "@/server/media/exif";

/**
 * 手搓一段最小 EXIF（TIFF header + IFD0 + Exif SubIFD），只放时间相关字段。
 * 用 sharp 反倒不行：`withMetadata` 不接受任意 EXIF 时间字段的写入组合，
 * 而这里要测的恰好是「字节怎么摆」，自己造字节最直接。
 *
 * @param options.dateTimeOriginal 0x9003
 * @param options.dateTime 0x0132，住在 IFD0
 * @param options.offset 0x9011 时区偏移
 * @param options.little 字节序，默认小端（II）
 * @param options.withPrefix 是否带 "Exif\0\0" 前缀
 */
function buildExif(options: {
  dateTimeOriginal?: string;
  dateTime?: string;
  offset?: string;
  little?: boolean;
  withPrefix?: boolean;
} = {}) {
  const little = options.little !== false;
  const prefix = options.withPrefix === false ? [] : [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

  const ascii = (value: string) => {
    const bytes = Array.from(value).map((char) => char.charCodeAt(0));
    bytes.push(0);
    return bytes;
  };

  // 值区放在 IFD 之后，entry 里存偏移。
  type Entry = { tag: number; bytes: number[] };
  const ifd0: Entry[] = [];
  const subIfd: Entry[] = [];
  if (options.dateTime) ifd0.push({ tag: 0x0132, bytes: ascii(options.dateTime) });
  if (options.dateTimeOriginal) subIfd.push({ tag: 0x9003, bytes: ascii(options.dateTimeOriginal) });
  if (options.offset) subIfd.push({ tag: 0x9011, bytes: ascii(options.offset) });

  const ENTRY = 12;
  const ifd0Offset = 8;
  const ifd0Size = 2 + (ifd0.length + 1) * ENTRY + 4; // +1 是 SubIFD 指针
  const ifd0ValuesOffset = ifd0Offset + ifd0Size;
  const ifd0ValuesSize = ifd0.reduce((total, entry) => total + entry.bytes.length, 0);
  const subIfdOffset = ifd0ValuesOffset + ifd0ValuesSize;
  const subIfdSize = 2 + subIfd.length * ENTRY + 4;
  const subValuesOffset = subIfdOffset + subIfdSize;
  const subValuesSize = subIfd.reduce((total, entry) => total + entry.bytes.length, 0);

  const total = subValuesOffset + subValuesSize;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 0x002a, little);
  view.setUint32(4, ifd0Offset, little);

  const writeIfd = (offset: number, entries: Entry[], valuesOffset: number, pointerTo?: number) => {
    const count = entries.length + (pointerTo === undefined ? 0 : 1);
    view.setUint16(offset, count, little);
    let cursor = offset + 2;
    let valueCursor = valuesOffset;
    for (const entry of entries) {
      view.setUint16(cursor, entry.tag, little);
      view.setUint16(cursor + 2, 2, little); // ASCII
      view.setUint32(cursor + 4, entry.bytes.length, little);
      if (entry.bytes.length <= 4) {
        bytes.set(entry.bytes, cursor + 8);
      } else {
        view.setUint32(cursor + 8, valueCursor, little);
        bytes.set(entry.bytes, valueCursor);
        valueCursor += entry.bytes.length;
      }
      cursor += ENTRY;
    }
    if (pointerTo !== undefined) {
      view.setUint16(cursor, 0x8769, little);
      view.setUint16(cursor + 2, 4, little); // LONG
      view.setUint32(cursor + 4, 1, little);
      view.setUint32(cursor + 8, pointerTo, little);
      cursor += ENTRY;
    }
    view.setUint32(cursor, 0, little); // 下一个 IFD：无
  };

  writeIfd(ifd0Offset, ifd0, ifd0ValuesOffset, subIfdOffset);
  writeIfd(subIfdOffset, subIfd, subValuesOffset);

  return Uint8Array.from([...prefix, ...bytes]);
}

describe("readShotAt", () => {
  it("读出 DateTimeOriginal，无时区字段时按本地时间", () => {
    const shotAt = readShotAt(buildExif({ dateTimeOriginal: "2025:02:03 14:30:05" }));
    expect(shotAt).toBeInstanceOf(Date);
    expect(shotAt?.getFullYear()).toBe(2025);
    expect(shotAt?.getMonth()).toBe(1);
    expect(shotAt?.getDate()).toBe(3);
    expect(shotAt?.getHours()).toBe(14);
  });

  it("有 OffsetTimeOriginal 时按该偏移换算成时刻", () => {
    const shotAt = readShotAt(buildExif({ dateTimeOriginal: "2025:02:03 14:30:05", offset: "+08:00" }));
    expect(shotAt?.toISOString()).toBe("2025-02-03T06:30:05.000Z");
  });

  it("DateTimeOriginal 缺失时回落 IFD0 的 DateTime", () => {
    const shotAt = readShotAt(buildExif({ dateTime: "2024:12:25 08:00:00" }));
    expect(shotAt?.getFullYear()).toBe(2024);
    expect(shotAt?.getMonth()).toBe(11);
    expect(shotAt?.getDate()).toBe(25);
  });

  it("大端字节序（MM）同样能读", () => {
    const shotAt = readShotAt(buildExif({ dateTimeOriginal: "2023:06:01 09:15:00", little: false }));
    expect(shotAt?.getFullYear()).toBe(2023);
    expect(shotAt?.getMonth()).toBe(5);
  });

  it("不带 Exif\\0\\0 前缀也能读", () => {
    const shotAt = readShotAt(buildExif({ dateTimeOriginal: "2022:01:02 03:04:05", withPrefix: false }));
    expect(shotAt?.getFullYear()).toBe(2022);
  });

  it("没有 EXIF、空值、太短的字节一律 undefined，不回落当前时间", () => {
    expect(readShotAt(undefined)).toBeUndefined();
    expect(readShotAt(null)).toBeUndefined();
    expect(readShotAt(new Uint8Array(0))).toBeUndefined();
    expect(readShotAt(Uint8Array.from([1, 2, 3, 4]))).toBeUndefined();
  });

  it("EXIF 段存在但没有时间字段时 undefined", () => {
    expect(readShotAt(buildExif())).toBeUndefined();
  });

  it("相机时钟没设置的 0000:00:00 与不存在的日期都判为无效", () => {
    expect(readShotAt(buildExif({ dateTimeOriginal: "0000:00:00 00:00:00" }))).toBeUndefined();
    expect(readShotAt(buildExif({ dateTimeOriginal: "2025:02:30 10:00:00" }))).toBeUndefined();
    expect(readShotAt(buildExif({ dateTimeOriginal: "2025:13:01 10:00:00" }))).toBeUndefined();
  });

  it("未来时间只可能来自错设的时钟，不采用", () => {
    const future = new Date(Date.now() + 400 * 86_400_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${future.getFullYear()}:${pad(future.getMonth() + 1)}:${pad(future.getDate())} 00:00:00`;
    expect(readShotAt(buildExif({ dateTimeOriginal: stamp }))).toBeUndefined();
  });

  it("字节序标记不对（非 II / MM）时不抛异常", () => {
    const broken = buildExif({ dateTimeOriginal: "2025:02:03 14:30:05" });
    broken[6] = 0x00;
    broken[7] = 0x00;
    expect(readShotAt(broken)).toBeUndefined();
  });

  it("IFD 被截断时不越界读取", () => {
    const truncated = buildExif({ dateTimeOriginal: "2025:02:03 14:30:05" }).slice(0, 20);
    expect(() => readShotAt(truncated)).not.toThrow();
  });
});
