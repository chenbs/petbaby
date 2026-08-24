/** 将本轮人工视觉预检结论写回第三批候选元数据；不代表用户最终审批。 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { thirdBatchBasename, thirdBatchJobs } from "./reference-third-batch-prompts.mjs";

const METADATA = path.join(import.meta.dirname, "out", "reference-v1", "metadata");
const findings = {
  "original-magic-academy": ["狸花猫身份、成年比例、原创星形爪印徽章、长袍接触和药剂教室构图已预检。"],
  "epic-ruins": ["成年德牧身份、遗迹巨构、逆光尺度和背负式机械装备已预检；未保留人脸或人手。"],
  "mini-companion": ["v03 保持竖版构图和同一成年阿比西尼亚猫身份；大小两只的蓝框镜片均准确覆盖双眼，镜桥、绑带、耳朵和服装边界完整。"],
  "adventure-rules": ["v04 中央成年柯基为完整稳定的拟人直立全身；头、颈、肩、胸和脊柱处于同一自然透视轴，四肢、羊皮纸结构、标题栏目和装备关系保持稳定。"],
  "pet-life-journal": ["成年贵宾犬身份、校园夕阳场景、桌面交互、手写边注和无品牌爪印电脑标记已预检。"],
  "ink-portrait": ["reset-v08 采用两阶段灵算图生图：先从无摄影纹理的宠物身份结构图生成明确的二维卡通角色原型，再用效果参考图和该卡通原型生成母版。最终生成不接触写实宠物照片，也未使用旧候选、局部遮罩、固定坐标、派生眼睛补丁或局部像素改色；面部完整继承卡通原型并融入周围水墨笔触。"],
  "decorative-art-portrait": ["v05 使用扁平身份导引图后，布偶猫脸部由少量海军蓝、纸白与灰色平面碎片构成，主眼为单一概括色块；无真实眼球、连续毛丝、渐变光影或低多边形三维体积。"]
};

const superseded = [
  {
    basename: "adventure-rules_corgi-dog_9x16_v01",
    replacement: "adventure-rules_corgi-dog_9x16_v02",
    reason: "副标题仍残留原人类探险语义，已由宠物探险文字定向版替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v01",
    replacement: "ink-portrait_black-labrador-dog_9x16_v02",
    reason: "面部摄影写实感偏强、远眼过多，已由破碎水墨侧面定向版替代。"
  },
  {
    basename: "mini-companion_abyssinian-cat_16x9_v01",
    replacement: "mini-companion_abyssinian-cat_9x16_v02",
    reason: "误将原竖版效果图生成成横版，已由恢复竖版构图的候选替代。"
  },
  {
    basename: "adventure-rules_corgi-dog_9x16_v02",
    replacement: "adventure-rules_corgi-dog_9x16_v03",
    reason: "中央主体为蹲伏姿态、四肢阅读不完整，已由完整拟人直立全身候选替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v02",
    replacement: "ink-portrait_black-labrador-dog_9x16_v03",
    reason: "面部仍保留摄影眼球、鼻面和毛发体积，已由全脸水墨块面候选替代。"
  },
  {
    basename: "decorative-art-portrait_ragdoll-cat_9x16_v01",
    replacement: "decorative-art-portrait_ragdoll-cat_9x16_v02",
    reason: "五官和长毛仍带真实体积与摄影纹理，已由全脸扁平几何碎片候选替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v03",
    replacement: "ink-portrait_black-labrador-dog_9x16_v04",
    reason: "取消高身份保真后仍残留摄影眼球、鼻面与连续体积，已改用派生身份参考继续压低写实感。"
  },
  {
    basename: "decorative-art-portrait_ragdoll-cat_9x16_v02",
    replacement: "decorative-art-portrait_ragdoll-cat_9x16_v03",
    reason: "取消高身份保真后仍残留真实眼球、毛丝与三维体积，已改用派生身份参考继续压低写实感。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v04",
    replacement: "ink-portrait_black-labrador-dog_9x16_v05",
    reason: "眼睛已图形化但面部仍有连续灰阶体积，已由近二值纯黑、纸白与极少灰的平面水墨版替代。"
  },
  {
    basename: "decorative-art-portrait_ragdoll-cat_9x16_v03",
    replacement: "decorative-art-portrait_ragdoll-cat_9x16_v04",
    reason: "眼睛已图形化但面罩与长毛仍有真实光影，已由少量大块平面碎片与纸白负空间版替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v05",
    replacement: "ink-portrait_black-labrador-dog_9x16_v06",
    reason: "近二值提示词仍未完全消除连续面部体积，已由扁平身份导引图驱动的水墨版替代。"
  },
  {
    basename: "decorative-art-portrait_ragdoll-cat_9x16_v04",
    replacement: "decorative-art-portrait_ragdoll-cat_9x16_v05",
    reason: "大块平面提示词仍残留写实头骨和毛发层次，已由五色扁平身份导引图驱动的几何拼贴版替代。"
  },
  {
    basename: "mini-companion_abyssinian-cat_9x16_v02",
    replacement: "mini-companion_abyssinian-cat_9x16_v03",
    reason: "大小两只的护目镜停在额头、没有覆盖眼睛，已由镜片对齐眼线并完整遮眼的候选替代。"
  },
  {
    basename: "adventure-rules_corgi-dog_9x16_v03",
    replacement: "adventure-rules_corgi-dog_9x16_v04",
    reason: "头部角度与直立身体透视轴不一致，已由头颈肩胸自然连贯的候选替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v06",
    replacement: "ink-portrait_black-labrador-dog_9x16_v07",
    reason: "水墨媒介已通过但眼神偏圆、偏柔，已进入锐利俊朗眼神定向修正链。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v07",
    replacement: "ink-portrait_black-labrador-dog_9x16_v08",
    reason: "整图重生仍产生偏正面的圆眼和可见远眼，已由仅编辑眼睛与眉线的遮罩精修版替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v08",
    replacement: "ink-portrait_black-labrador-dog_9x16_v09",
    reason: "单一主眼的瞳孔为纯黑实心墨块、反差过硬，已由只降低瞳孔墨黑程度并保留锐利眼形的微型遮罩版替代。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v09",
    replacement: "ink-portrait_black-labrador-dog_9x16_v10",
    reason: "仅靠文字描述仍把瞳孔压成更大的纯黑块，已改用自有目标墨色导引图和更小的瞳孔遮罩重新生成。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_v10",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v03",
    status: "rejected-by-user",
    reviewState: "rejected-by-user",
    finalApproval: "rejected",
    reason: "用户确认灰色瞳孔局部补丁效果奇怪，并指出固定坐标微调方向不可泛化；该版本不得进入母版。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v01",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v03",
    status: "rejected-internal-precheck",
    reviewState: "rejected-internal-precheck",
    finalApproval: "not-applicable",
    reason: "直接使用正面写实身份照片时，灵算过度继承了正面视角、双眼和摄影五官，未复刻效果参考的侧向头姿、单眼结构与水墨抽象度。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v02",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v03",
    status: "rejected-internal-precheck",
    reviewState: "rejected-internal-precheck",
    finalApproval: "not-applicable",
    reason: "侧向身份姿态已正确，但写实身份图仍把连续毛发、湿润鼻面和摄影体积带入结果；已改用整图统一低色阶导引移除摄影纹理。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v03",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v04",
    status: "superseded-by-current-candidate",
    reviewState: "superseded-before-user-approval",
    finalApproval: "not-applicable",
    reason: "整体构图与水墨方向已回正，但面部仍存在完整虹膜、鼻面体积、连续灰阶和写实毛发；reset-v04 改为只允许纸白留白、扁平墨块、断线与干刷构成五官。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v04",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v05",
    status: "rejected-by-user",
    reviewState: "rejected-by-user",
    finalApproval: "rejected",
    reason: "用户确认 reset-v04 方向不对：面部被过度压成粗糙扁平墨块，缺少完整卡通化五官与坚毅眼神；reset-v05 恢复协调的二维手绘面部层次并定向塑造冷静坚毅视线。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v05",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v06",
    status: "rejected-internal-precheck",
    reviewState: "rejected-internal-precheck",
    finalApproval: "not-applicable",
    reason: "面部已卡通化，但近眼仍继承参考图的圆形上望结构，显得柔和和恳求，未达到坚毅要求；reset-v06 将眼神调整声明为唯一表情例外并明确改变眼睛长宽比与眉睑角度。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v06",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v07",
    status: "rejected-by-user",
    reviewState: "rejected-by-user",
    finalApproval: "rejected",
    reason: "用户要求停止在当前母版候选上微调并重写提示词；根因是写实身份导引仍把真实眼球、鼻面和头骨结构带入成图。reset-v07 改为先生成卡通手绘身份原型，再以该原型进行最终模仿生成。"
  },
  {
    basename: "ink-portrait_black-labrador-dog_9x16_reset-v07",
    replacement: "ink-portrait_black-labrador-dog_9x16_reset-v08",
    status: "rejected-internal-precheck",
    reviewState: "rejected-internal-precheck",
    finalApproval: "not-applicable",
    reason: "第一版两阶段流程的身份原型仍混入写实水彩鼻面与毛发结构；reset-v08 改为先从无摄影纹理结构图生成独立二维卡通角色原型，最终母版不再接触写实身份信息。"
  }
];

for (const job of thirdBatchJobs) {
  const metadataPath = path.join(METADATA, `${thirdBatchBasename(job)}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (metadata.status === "approved-frozen-master" && metadata.review.finalApproval === "approved") {
    console.log(`跳过已冻结 ${job.title} ${job.version}`);
    continue;
  }
  if (metadata.review.finalApproval !== "pending-user") {
    throw new Error(`${job.title}: 已存在非待审批状态，拒绝覆盖`);
  }
  metadata.review.state = "prechecked-pending-user-approval";
  for (const key of Object.keys(metadata.review.checks)) metadata.review.checks[key] = "pass";
  metadata.review.findings = findings[job.id];
  metadata.review.precheckedAt = new Date().toISOString();
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`已预检 ${job.title} ${job.version}`);
}

for (const item of superseded) {
  const metadataPath = path.join(METADATA, `${item.basename}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.status = item.status || "superseded-by-current-candidate";
  metadata.review.state = item.reviewState || "superseded-before-user-approval";
  metadata.review.finalApproval = item.finalApproval || "not-applicable";
  metadata.review.findings = [item.reason];
  metadata.replacedBy = item.replacement;
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`已标记旧版 ${item.basename} -> ${item.replacement}`);
}
