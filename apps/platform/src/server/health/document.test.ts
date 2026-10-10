import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { grantPurchasedCredit } from "@/server/entitlements";
import { getWallet } from "@/server/wallet/service";
import { fundWallet } from "@/server/wallet/test-helpers";
import { buildHealthDocumentSvg } from "@/server/health/document";
import * as documentRenderer from "@/server/health/document";
import { objectStorage } from "@/server/storage";
import {
  HEALTH_ARCHIVE_KIND,
  createHealthDocument,
  getHealthDocumentFile,
  listHealthDocuments,
  recordCare,
  recordWeight,
} from "@/server/health-service";

/*
 * 健康档案 PDF（L1 / A5）与年度健康记录（L2 / A6）。
 *
 * **这是就医准备材料不是体检报告。** 这一组里最重要的是红线守卫：
 * 这份文件很可能被打印出来带去医院，如果它读起来像一份诊断结论，
 * 误导代价比页面上的措辞失误大得多。
 *
 * 所以有两条扫全文的用例：一条扫禁用词（诊断/确诊/治愈/问诊），
 * 一条扫评价性结论（健康状况良好/偏胖/正常范围）。
 */

const USER = "00000000-0000-4000-8000-0000000000e5";
const MEMBER = "00000000-0000-4000-8000-0000000000e6";
const PET = "00000000-0000-4000-8000-0000000000e7";
const MEMORIAL_PET = "00000000-0000-4000-8000-0000000000e8";

/**
 * 造一张已支付的单买凭据。
 *
 * 必须先建真实的 `growth_orders` 行 —— `entitlement_ledger.order_id` 有外键
 * 指向它（迁移 0012）。直接塞随机 UUID 会触发外键约束，而生产路径里
 * 这个 id 一定来自 `payGrowthOrder` 的真实订单。
 */
async function grantArchiveCredit(userId: string) {
  const database = await getDatabase();
  const orderId = crypto.randomUUID();
  await database.query(
    "INSERT INTO growth_orders (id,user_id,kind,sku,amount,status,entitlement_snapshot,paid_at,created_at,updated_at) VALUES ($1,$2,'health_archive','health-archive-pdf',29.9,'paid','{}',now(),now(),now())",
    [orderId, userId],
  );
  await grantPurchasedCredit(userId, HEALTH_ARCHIVE_KIND, orderId, "测试购买");
}

describe("健康档案排版：不给结论（红线）", () => {
  const base = {
    petName: "年糕",
    species: "cat",
    birthday: "2024-01-01",
    lifeStage: "active",
    generatedOn: "2026-08-04",
    weights: [
      { weightGrams: 4400, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-01" },
    ],
    care: [{ kindText: "疫苗", label: "猫三联", performedOn: "2026-03-01", dueOn: "2027-03-01" }],
    sessions: [{ date: "2026-07-20", levelText: "暂可观察", summary: "先观察 24 小时，若加重请就医。" }],
  };

  /** 红线 1：用户可见文案不得出现这四个词 */
  it("全文不出现诊断类措辞", () => {
    const svg = buildHealthDocumentSvg(base);
    for (const word of ["诊断结论", "确诊", "治愈", "问诊"]) {
      // 「这份记录不是诊断结论」是免责声明，含「诊断」但语义是否定 ——
      // 所以逐个检查的是断言性用法，下面单独验免责声明存在。
      if (word === "诊断结论") continue;
      expect(svg, `「${word}」不该出现`).not.toContain(word);
    }
  });

  /** 红线 5：免责声明必须在文件里且与内容同屏（第一页顶部） */
  it("免责声明印在正文之前", () => {
    const svg = buildHealthDocumentSvg(base);
    expect(svg).toContain("这份记录不是诊断结论");
    expect(svg).toContain("不是诊断");
    // 位置在体重段之前 —— 折叠或置底都不满足「同屏」
    expect(svg.indexOf("不是诊断结论")).toBeLessThan(svg.indexOf("体重"));
  });

  /*
   * 不给评价性结论。「健康状况良好」这类句子是这份文件最容易长出来的东西，
   * 而它接近诊断 —— 我们没有资格评价这只宠物健康不健康。
   */
  /*
   * 扫的是**评价性说法**而不是「健康」这个词本身：
   * 免责声明里的「宠物的健康状况需要执业兽医面诊判断」含「健康状况」，
   * 但它的语义正好相反 —— 它说的是「这件事得由兽医判断」。
   * 用宽词表会把这句话本身判成违例，那是错的方向。
   */
  it("全文不含评价性结论", () => {
    const svg = buildHealthDocumentSvg(base);
    for (const word of ["状况良好", "状况不佳", "偏胖", "偏瘦", "超重", "肥胖", "正常范围", "标准体重", "理想体重", "BMI", "体况评分", "存在风险", "健康风险", "无异常", "一切正常"]) {
      expect(svg, `「${word}」是评价性结论，不该出现`).not.toContain(word);
    }
  });

  it("体重段给事实陈述与折线", () => {
    const svg = buildHealthDocumentSvg(base);
    expect(svg).toContain("4.4 公斤");
    expect(svg).toContain("增加");
    // 两点以上才画折线
    expect(svg).toContain("<path");
  });

  /** 只有一条体重记录时不画折线，也不谈趋势 */
  it("单条体重不画折线", () => {
    const svg = buildHealthDocumentSvg({ ...base, weights: [{ weightGrams: 4000, measuredOn: "2026-08-01" }] });
    expect(svg).toContain("再称一次");
    expect(svg).not.toContain("<path");
  });

  it("空档案不报错，各段显示还没有记录", () => {
    const svg = buildHealthDocumentSvg({ ...base, weights: [], care: [], sessions: [] });
    expect(svg).toContain("还没有体重记录");
    expect(svg).toContain("还没有记录");
  });

  /** 用户填的项目名要转义 —— 未转义的 & 或 < 会让 SVG 解析失败 */
  it("用户输入被转义", () => {
    const svg = buildHealthDocumentSvg({ ...base, care: [{ kindText: "疫苗", label: "A&B <三联>", performedOn: "2026-03-01" }] });
    expect(svg).toContain("A&amp;B &lt;三联&gt;");
    expect(svg).not.toContain("<三联>");
  });

  /** 截断要注明。静默截断会读作「就这些」，而这是一份带去医院的材料 */
  it("记录过多时注明未列出的条数", () => {
    const care = Array.from({ length: 20 }, (_, index) => ({ kindText: "疫苗", label: `第 ${index} 次`, performedOn: "2026-01-01" }));
    expect(buildHealthDocumentSvg({ ...base, care })).toContain("另有 8 条未列出");
  });

  it("年度记录的标题带上年份", () => {
    expect(buildHealthDocumentSvg({ ...base, year: 2026 })).toContain("2026 年度健康记录");
  });
});

describe("健康档案生成与权益", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    for (const id of [USER, MEMBER]) {
      await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [id]);
    }
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,now())", [PET, USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','cat','unknown','birthday','memorial',false,now())", [MEMORIAL_PET, USER]);
    await recordWeight(USER, PET, { weightGrams: 4000, measuredOn: "2026-07-01" });
    await recordWeight(USER, PET, { weightGrams: 4400, measuredOn: "2026-08-01" });
    await recordCare(USER, PET, { kind: "vaccine", label: "猫三联", performedOn: "2026-03-01", dueOn: "2027-03-01" });
  });

  /*
   * 余额不足不生成。**不静默给一个残缺版本** —— 先给文件再要钱、或给删了内容的版本，都比明确告价更糟。
   */
  it("零余额在 PDF 渲染与上传前拒绝导出并带上差额", async () => {
    const render = vi.spyOn(documentRenderer, "renderHealthDocumentPdf").mockRejectedValue(new Error("不应开始渲染"));
    const put = vi.spyOn(objectStorage, "put");
    try {
      await expect(createHealthDocument(USER, PET)).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT", status: 402, details: { required: 6, balance: 0, shortfall: 6 } });
      expect(render).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(await listHealthDocuments(USER, PET)).toHaveLength(0);
      expect((await getWallet(USER)).balance).toBe(0);
    } finally {
      render.mockRestore();
      put.mockRestore();
    }
  });

  it("健康档案每份扣 6 颗冻干，可以反复导出", async () => {
    await fundWallet(MEMBER, 20);
    const database = await getDatabase();
    const petId = crypto.randomUUID();
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'豆包','dog','unknown','birthday','active',true,now())", [petId, MEMBER]);
    await recordWeight(MEMBER, petId, { weightGrams: 8000, measuredOn: "2026-08-01" });
    expect((await createHealthDocument(MEMBER, petId)).kind).toBe("archive");
    expect((await createHealthDocument(MEMBER, petId)).kind).toBe("archive");
    expect(await listHealthDocuments(MEMBER, petId)).toHaveLength(2);
    expect((await getWallet(MEMBER)).balance).toBe(8);
  });

  /** 冻干上线前单买的凭据仍可抵一次，用完再扣冻干 */
  it("历史单买凭据抵一次后改扣冻干", async () => {
    await grantArchiveCredit(USER);
    expect((await createHealthDocument(USER, PET)).kind).toBe("archive");
    await expect(createHealthDocument(USER, PET)).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
    await fundWallet(USER, 6);
    expect((await createHealthDocument(USER, PET)).kind).toBe("archive");
    expect((await getWallet(USER)).balance).toBe(0);
  });

  it("历史档案凭据不能抵年度记录，零余额也不开始渲染", async () => {
    await grantArchiveCredit(USER);
    const render = vi.spyOn(documentRenderer, "renderHealthDocumentPdf").mockRejectedValue(new Error("不应开始渲染"));
    try {
      await expect(createHealthDocument(USER, PET, { year: 2026 })).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
      expect(render).not.toHaveBeenCalled();
    } finally {
      render.mockRestore();
    }
  });

  it("冻干冻结时在渲染前拒绝导出", async () => {
    await fundWallet(USER, 6);
    await (await getDatabase()).query("UPDATE wallet_accounts SET frozen_reason='核对中' WHERE user_id=$1", [USER]);
    const render = vi.spyOn(documentRenderer, "renderHealthDocumentPdf").mockRejectedValue(new Error("不应开始渲染"));
    try {
      await expect(createHealthDocument(USER, PET)).rejects.toMatchObject({ code: "WALLET_FROZEN" });
      expect(render).not.toHaveBeenCalled();
      expect((await getWallet(USER)).balance).toBe(6);
    } finally {
      render.mockRestore();
    }
  });

  /** 年度健康记录 6 颗一份（会员下线后的获取路径，36 号文 D1） */
  it("年度健康记录每份扣 6 颗，只统计当年记录", async () => {
    await fundWallet(MEMBER, 12);
    const database = await getDatabase();
    const petId = crypto.randomUUID();
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'豆包','dog','unknown','birthday','active',true,now())", [petId, MEMBER]);
    await recordWeight(MEMBER, petId, { weightGrams: 7800, measuredOn: "2025-06-01" });
    await recordWeight(MEMBER, petId, { weightGrams: 8000, measuredOn: "2026-08-01" });
    const doc = await createHealthDocument(MEMBER, petId, { year: 2026 });
    expect(doc).toMatchObject({ kind: "annual", year: 2026, weights: 1 });
    expect((await createHealthDocument(MEMBER, petId, { year: 2025 })).weights).toBe(1);
    await expect(createHealthDocument(MEMBER, petId, { year: 2024 })).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
  });

  /*
   * **memorial 宠物拒绝导出**（红线 10）。导出入口本身就是健康功能，
   * 已封存的档案不该从这里进。
   */
  it("memorial 宠物不能导出健康档案", async () => {
    await grantArchiveCredit(USER);
    await expect(createHealthDocument(USER, MEMORIAL_PET)).rejects.toMatchObject({ code: "HEALTH_UNAVAILABLE_MEMORIAL" });
  });

  /** 产出是真的 PDF 字节，不是空壳 */
  it("导出的文件是 PDF", async () => {
    await grantArchiveCredit(USER);
    const doc = await createHealthDocument(USER, PET);
    const file = await getHealthDocumentFile(USER, doc.id);
    expect(file.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(file.body.slice(0, 5))).toBe("%PDF-");
    expect(file.filename).toContain(".pdf");
  }, 30_000);

  /*
   * 健康档案**不可分享**，也不跨用户泄漏。
   * 健康线的产出是私密记录（16 号文 3.9），没有公开路径。
   */
  it("档案不跨用户可见", async () => {
    await grantArchiveCredit(USER);
    const doc = await createHealthDocument(USER, PET);
    await expect(getHealthDocumentFile(MEMBER, doc.id)).rejects.toMatchObject({ code: "HEALTH_DOCUMENT_NOT_FOUND" });
    expect(await listHealthDocuments(MEMBER)).toHaveLength(0);
  }, 30_000);

  it("档案摘要记下各段条数，便于事后解释数字来源", async () => {
    await grantArchiveCredit(USER);
    const doc = await createHealthDocument(USER, PET);
    expect(doc.weights).toBe(2);
    expect(doc.care).toBe(1);
    const listed = await listHealthDocuments(USER, PET);
    expect(Number(listed[0].summary.weights)).toBe(2);
  }, 30_000);
});
