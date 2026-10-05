import "server-only";

import { z } from "zod";

import type { PluginManifest } from "@/domain/models";
import { plugins } from "@/plugins/registry";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { recordAdminAudit } from "@/server/admin/audit";

const toneVariantSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  tagline: z.string().max(160).optional(),
  description: z.string().max(1000).optional(),
  unlockPrice: z.number().nonnegative().optional(),
  label: z.string().min(1).max(80).optional(),
});

const previousArtSceneOptions = [
  { id: "window-morning", title: "窗边晨光", description: "坐姿望窗 · 平静神态" },
  { id: "garden-curious", title: "花园探索", description: "抬爪嗅花 · 好奇神态" },
  { id: "studio-confident", title: "影棚主角", description: "正面坐姿 · 自信凝视" },
  { id: "night-playful", title: "夜色追光", description: "回头跃起 · 惊喜活泼" },
];

const previousV2ArtSceneOptions = [
  { id: "window-morning", title: "窗边观鸟", description: "伏窗望鸟 · 安静专注" },
  { id: "garden-curious", title: "花园探花", description: "抬爪嗅花 · 好奇" },
  { id: "studio-confident", title: "复古影棚", description: "登上木台 · 自信回望" },
  { id: "night-playful", title: "夜庭追光", description: "跃步追光 · 惊喜活泼" },
  { id: "seaside-breeze", title: "海边栈道", description: "迎风站立 · 警觉舒展" },
  { id: "library-whisper", title: "书店探险", description: "转角探身 · 机灵好奇" },
  { id: "autumn-leaves", title: "枫叶小径", description: "轻跑落叶 · 兴奋" },
  { id: "snow-cabin", title: "雪窗木屋", description: "蜷卧毛毯 · 困倦满足" },
  { id: "cafe-afternoon", title: "街角咖啡馆", description: "坐椅转头 · 悠闲观察" },
  { id: "lakeside-sunset", title: "湖畔木桥", description: "伸懒腰 · 眯眼迎光" },
  { id: "city-rain", title: "雨后骑楼", description: "跨过水洼 · 惊讶" },
  { id: "spring-picnic", title: "春日野餐", description: "伸爪拨带 · 轻快愉悦" },
];

const previousSampleDefaults: Record<string, { heroUrl?: string; styleUrls?: Record<string, string>; sceneUrls?: Record<string, string> }> = {
  "pet-id-card": { heroUrl: "/api/plugin-samples/samples/pet-id-card-cee27b346c67.jpg" },
  "pet-movie-poster": { heroUrl: "/api/plugin-samples/samples/pet-movie-poster-d49f06ae0fdf.jpg" },
  "pet-time-album": { heroUrl: "/api/plugin-samples/samples/pet-time-album-a56e5316f509.jpg" },
  "pl-10": {
    heroUrl: "/api/plugin-samples/samples/pl-10-df4b766033ec.jpg",
    sceneUrls: {
      "window-morning": "/api/plugin-samples/samples/scene-window-morning-v1-9770823ac40a.jpg",
      "garden-curious": "/api/plugin-samples/samples/scene-garden-curious-v1-d4fa01fd949b.jpg",
      "studio-confident": "/api/plugin-samples/samples/scene-studio-confident-v1-0eaea2bc2fc0.jpg",
      "night-playful": "/api/plugin-samples/samples/scene-night-playful-v1-7057658d097e.jpg",
    },
    styleUrls: {
      "warm-film": "/api/plugin-samples/samples/style-warm-film-745db4c3d705.jpg",
      "paper-cut": "/api/plugin-samples/samples/style-paper-cut-e6ab5e0ba3d3.jpg",
      studio: "/api/plugin-samples/samples/style-studio-9006fcd75888.jpg",
      fantasy: "/api/plugin-samples/samples/style-fantasy-aae6d3e4c431.jpg",
    },
  },
  "pl-15": { heroUrl: "/api/plugin-samples/samples/pl-15-2b583f83d80c.jpg" },
  "pl-19": { heroUrl: "/api/plugin-samples/samples/pl-19-c88acc8d9d43.jpg" },
};

const previousV2SampleDefaults: Record<string, { heroUrl?: string; sceneUrls?: Record<string, string> }> = {
  "pet-movie-poster": { heroUrl: "/api/plugin-samples/samples/mp26-pet-movie-poster-v3-0f9f70e6c032.jpg" },
  "pl-10": {
    heroUrl: "/api/plugin-samples/samples/mp26-pl-10-8bfc17d3b3b5.jpg",
    sceneUrls: {
      "window-morning": "/api/plugin-samples/samples/scene-window-morning-v2-76d6e35bcd80.jpg",
      "garden-curious": "/api/plugin-samples/samples/scene-garden-curious-v2-6afe0ff901ac.jpg",
      "studio-confident": "/api/plugin-samples/samples/scene-studio-confident-v2-52ea373449b2.jpg",
      "night-playful": "/api/plugin-samples/samples/scene-night-playful-v2-4e6edc0635d4.jpg",
      "seaside-breeze": "/api/plugin-samples/samples/scene-seaside-breeze-v2-5d97dde2ceff.jpg",
      "library-whisper": "/api/plugin-samples/samples/scene-library-whisper-v2-2a60ecd39569.jpg",
      "autumn-leaves": "/api/plugin-samples/samples/scene-autumn-leaves-v2-1885e1d0a87d.jpg",
      "snow-cabin": "/api/plugin-samples/samples/scene-snow-cabin-v2-6efe37c5381b.jpg",
      "cafe-afternoon": "/api/plugin-samples/samples/scene-cafe-afternoon-v2-47cc12cccf0a.jpg",
      "lakeside-sunset": "/api/plugin-samples/samples/scene-lakeside-sunset-v3-1e2beeb35285.jpg",
      "city-rain": "/api/plugin-samples/samples/scene-city-rain-v2-a33c5af764c0.jpg",
      "spring-picnic": "/api/plugin-samples/samples/scene-spring-picnic-v3-eed947ea641e.jpg",
    },
  },
  "pl-15": { heroUrl: "/api/plugin-samples/samples/mp26-pl-15-bd5db2c1f693.jpg" },
};

// 上一批已发布的 12 张扩展写真样片。仅这些默认键升级到新图，后台自定义值保留。
const previousV4ArtSceneUrls: Record<string, string> = {
  "railway-traveler": "/api/plugin-samples/samples/scene-railway-traveler-v4-af7a29506d35.jpg",
  "tennis-champion": "/api/plugin-samples/samples/scene-tennis-champion-v4-4747aee4a90a.jpg",
  "greenhouse-gardener": "/api/plugin-samples/samples/scene-greenhouse-gardener-v4-c96b83f9b34b.jpg",
  "sailboat-holiday": "/api/plugin-samples/samples/scene-sailboat-holiday-v4-09c7ec74bcc6.jpg",
  "berry-pastry-chef": "/api/plugin-samples/samples/scene-berry-pastry-chef-v4-f7f46fd4c271.jpg",
  "paper-flower-window": "/api/plugin-samples/samples/scene-paper-flower-window-v4-b24f5e5c987f.jpg",
  "mountain-cable-car": "/api/plugin-samples/samples/scene-mountain-cable-car-v4-92450690e202.jpg",
  "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v4-12a2a8746e9d.jpg",
  "museum-curator": "/api/plugin-samples/samples/scene-museum-curator-v4-ecba3a50b34d.jpg",
  "poolside-vacation": "/api/plugin-samples/samples/scene-poolside-vacation-v4-742a01182dd2.jpg",
  "post-office": "/api/plugin-samples/samples/scene-post-office-v4-539386983243.jpg",
  "ballet-backstage": "/api/plugin-samples/samples/scene-ballet-backstage-v4-8e2f1641b5c0.jpg",
};

// 2026-10 后 12 套改成棚拍 / 窗光写真（v6）。v5 的默认键与旧标题都视为上一版默认值，升级到新图新名。
const previousV5ArtSceneUrls: Record<string, string> = {
  "railway-traveler": "/api/plugin-samples/samples/scene-railway-traveler-v5-f24db13edc82.jpg",
  "tennis-champion": "/api/plugin-samples/samples/scene-tennis-champion-v5-0ae23472a221.jpg",
  "greenhouse-gardener": "/api/plugin-samples/samples/scene-greenhouse-gardener-v5-a71fe9c8e0d0.jpg",
  "sailboat-holiday": "/api/plugin-samples/samples/scene-sailboat-holiday-v5-eaa6af812d7a.jpg",
  "berry-pastry-chef": "/api/plugin-samples/samples/scene-berry-pastry-chef-v5-9286c659a9af.jpg",
  "paper-flower-window": "/api/plugin-samples/samples/scene-paper-flower-window-v5-fe346facff9d.jpg",
  "mountain-cable-car": "/api/plugin-samples/samples/scene-mountain-cable-car-v5-7e2293f53ae9.jpg",
  "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v5-3e876d0040b8.jpg",
  "museum-curator": "/api/plugin-samples/samples/scene-museum-curator-v5-3beffc285413.jpg",
  "poolside-vacation": "/api/plugin-samples/samples/scene-poolside-vacation-v5-5972f6411c66.jpg",
  "post-office": "/api/plugin-samples/samples/scene-post-office-v5-11ab721e08d4.jpg",
  "ballet-backstage": "/api/plugin-samples/samples/scene-ballet-backstage-v5-1721da6836b7.jpg",
};
const previousV5ExtendedSceneOptions = [
  { id: "railway-traveler", title: "复古车站旅人", description: "月台漫步 · 回望列车" },
  { id: "tennis-champion", title: "网球场冠军", description: "追球小跑 · 活力昂扬" },
  { id: "greenhouse-gardener", title: "温室小园丁", description: "低头嗅香 · 好奇探寻" },
  { id: "sailboat-holiday", title: "帆船甲板假日", description: "甲板卧歇 · 迎着海风" },
  { id: "berry-pastry-chef", title: "莓果甜品师", description: "甜点车旁 · 认真端详" },
  { id: "paper-flower-window", title: "纸花橱窗主角", description: "彩纸花间 · 轻快走过" },
  { id: "mountain-cable-car", title: "山顶缆车乘客", description: "车厢望远 · 警觉好奇" },
  { id: "laundry-day", title: "彩色洗衣日", description: "抽出方巾 · 俏皮一刻" },
  { id: "museum-curator", title: "琥珀博物馆", description: "展柜旁漫步 · 好奇回头" },
  { id: "poolside-vacation", title: "蓝色泳池假日", description: "躺椅舒展 · 慵懒晒暖" },
  { id: "post-office", title: "旧书邮局来信", description: "轻触包裹 · 好奇查看" },
  { id: "ballet-backstage", title: "紫色芭蕾后台", description: "走出幕布 · 优雅回眸" },
];

// 更早一版（v4，2026-09-28）的后 12 套名称，部分老库仍停在这一版。
const previousV4ExtendedSceneOptions = [
  { id: "railway-traveler", title: "复古车站旅人", description: "月台候车 · 笑着回望" },
  { id: "tennis-champion", title: "网球场冠军", description: "球拍在旁 · 活力昂扬" },
  { id: "greenhouse-gardener", title: "温室小园丁", description: "花盆之间 · 好奇探头" },
  { id: "sailboat-holiday", title: "帆船甲板假日", description: "迎着海风 · 轻松远眺" },
  { id: "berry-pastry-chef", title: "莓果甜品师", description: "甜点台前 · 认真守候" },
  { id: "paper-flower-window", title: "纸花橱窗主角", description: "彩纸花间 · 安静端坐" },
  { id: "mountain-cable-car", title: "山顶缆车乘客", description: "车厢望远 · 警觉好奇" },
  { id: "laundry-day", title: "彩色洗衣日", description: "布篮旁边 · 俏皮抬头" },
  { id: "museum-curator", title: "琥珀博物馆", description: "展柜前驻足 · 沉静凝视" },
  { id: "poolside-vacation", title: "蓝色泳池假日", description: "遮阳伞下 · 慵懒晒暖" },
  { id: "post-office", title: "旧书邮局来信", description: "信封旁边 · 端坐等待" },
  { id: "ballet-backstage", title: "紫色芭蕾后台", description: "幕布之间 · 优雅回眸" },
];

// 2026-10 v7：后 12 套里 6 套加了点缀重拍，这 6 个 v6 默认键视为上一版默认值，升级到 v7 新图。
const previousV6ArtSceneUrls: Record<string, string> = {
  "railway-traveler": "/api/plugin-samples/samples/scene-railway-traveler-v6-3f285ddc2007.jpg",
  "greenhouse-gardener": "/api/plugin-samples/samples/scene-greenhouse-gardener-v6-abd1b392c9f2.jpg",
  "berry-pastry-chef": "/api/plugin-samples/samples/scene-berry-pastry-chef-v6-59a5b8da40d6.jpg",
  "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v6-604567ceac29.jpg",
  "museum-curator": "/api/plugin-samples/samples/scene-museum-curator-v6-37388c59d363.jpg",
  "post-office": "/api/plugin-samples/samples/scene-post-office-v6-5e43a0e22c26.jpg",
};

// 2026-10 v8：13–36 里 14 套按用户反馈重拍（更明亮、表情更生动），这些旧默认键与 v7 的 36 套名称表视为上一版默认值。
const previousV7ArtSceneUrls: Record<string, string> = {
  "tennis-champion": "/api/plugin-samples/samples/scene-tennis-champion-v6-d5ab3116793d.jpg",
  "paper-flower-window": "/api/plugin-samples/samples/scene-paper-flower-window-v6-bfc2839be0f4.jpg",
  "mountain-cable-car": "/api/plugin-samples/samples/scene-mountain-cable-car-v6-a43c4d0638d7.jpg",
  "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v7-2763c59f3869.jpg",
  "post-office": "/api/plugin-samples/samples/scene-post-office-v7-a9e003e2fe03.jpg",
  "shorthair-night-rim": "/api/plugin-samples/samples/scene-shorthair-night-rim-v7-583825a24ae6.jpg",
  "shorthair-paper-bag": "/api/plugin-samples/samples/scene-shorthair-paper-bag-v7-0b4028711f38.jpg",
  "corgi-denim": "/api/plugin-samples/samples/scene-corgi-denim-v7-e7e48edfe8c4.jpg",
  "corgi-crate": "/api/plugin-samples/samples/scene-corgi-crate-v7-d66de9ed3d9a.jpg",
  "corgi-sploot": "/api/plugin-samples/samples/scene-corgi-sploot-v7-349dbd00fcf4.jpg",
  "corgi-sweater": "/api/plugin-samples/samples/scene-corgi-sweater-v7-5745a21e7119.jpg",
  "calico-bowl": "/api/plugin-samples/samples/scene-calico-bowl-v7-7741cbae84e4.jpg",
  "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v7-329134844693.jpg",
  "calico-cane-stool": "/api/plugin-samples/samples/scene-calico-cane-stool-v7-abcd00e986d4.jpg",
};
const previousV7SceneOptions = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松" },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇" },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容" },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想" },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑" },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察" },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视" },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视" },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸" },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视" },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步" },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带" },
  { id: "railway-traveler", title: "暗调伦勃朗", description: "单灯侧光 · 沉静凝望" },
  { id: "tennis-champion", title: "北窗午后", description: "窗光亚麻 · 安静趴卧" },
  { id: "greenhouse-gardener", title: "百叶光影", description: "斜阳条纹 · 眯眼晒暖" },
  { id: "sailboat-holiday", title: "油画布肖像", description: "手绘背景 · 侧身回望" },
  { id: "berry-pastry-chef", title: "奶油纸静物", description: "陶罐相伴 · 乖巧端坐" },
  { id: "paper-flower-window", title: "丝绒与干花", description: "深绿丝绒 · 轻嗅花束" },
  { id: "mountain-cable-car", title: "高调白棚", description: "通透白底 · 歪头好奇" },
  { id: "laundry-day", title: "赭石毛毯", description: "暖色布景 · 蜷卧小憩" },
  { id: "museum-curator", title: "旧皮箱", description: "炭灰布景 · 端坐皮箱" },
  { id: "poolside-vacation", title: "纱帘逆光", description: "逆光轮廓 · 柔和剪影" },
  { id: "post-office", title: "暖棕胶片", description: "胶片颗粒 · 温柔回眸" },
  { id: "ballet-backstage", title: "藤篮蓝调", description: "深蓝布景 · 藤篮里探头" },
  { id: "shorthair-armchair", title: "旧扶手椅", description: "窗光丝绒 · 蜷坐抬眼" },
  { id: "shorthair-books", title: "一摞旧书", description: "布面书堆 · 歪头端详" },
  { id: "shorthair-night-rim", title: "夜色轮廓", description: "黑底轮廓 · 金光描边" },
  { id: "shorthair-paper-bag", title: "牛皮纸袋", description: "探头纸袋 · 机灵好奇" },
  { id: "corgi-denim", title: "靛蓝布景", description: "牛仔方巾 · 咧嘴微笑" },
  { id: "corgi-crate", title: "旧木箱", description: "前爪搭箱 · 期待张望" },
  { id: "corgi-sploot", title: "蜜桃色趴趴", description: "后腿伸平 · 青蛙趴" },
  { id: "corgi-sweater", title: "午后地板", description: "条纹毛衣 · 晒着打盹" },
  { id: "calico-silk", title: "香槟绸布", description: "丝缎侧卧 · 慵懒回眸" },
  { id: "calico-bowl", title: "手作陶碗", description: "鼠尾草绿 · 端坐碗后" },
  { id: "calico-rain-window", title: "雨天窗台", description: "雨痕玻璃 · 静静望外" },
  { id: "calico-cane-stool", title: "藤编小凳", description: "陶土色底 · 乖巧端坐" },
];

// 2026-10 v9：五套改成时尚杂志棚拍，这 5 个 v8 默认键与 v8 的 36 套名称表视为上一版默认值。
const previousV8ArtSceneUrls: Record<string, string> = {
  "shorthair-night-rim": "/api/plugin-samples/samples/scene-shorthair-night-rim-v8-32db7fc1e5c3.jpg",
  "corgi-denim": "/api/plugin-samples/samples/scene-corgi-denim-v8-0c9845c98f36.jpg",
  "corgi-crate": "/api/plugin-samples/samples/scene-corgi-crate-v8-d5a6c91d5b00.jpg",
  "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v8-622166c1573d.jpg",
  "calico-cane-stool": "/api/plugin-samples/samples/scene-calico-cane-stool-v8-48314f68f025.jpg",
};
const previousV8SceneOptions = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松" },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇" },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容" },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想" },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑" },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察" },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视" },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视" },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸" },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视" },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步" },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带" },
  { id: "railway-traveler", title: "暗调伦勃朗", description: "单灯侧光 · 沉静凝望" },
  { id: "tennis-champion", title: "泡泡时光", description: "追着泡泡 · 咧嘴大笑" },
  { id: "greenhouse-gardener", title: "百叶光影", description: "斜阳条纹 · 眯眼晒暖" },
  { id: "sailboat-holiday", title: "油画布肖像", description: "手绘背景 · 侧身回望" },
  { id: "berry-pastry-chef", title: "奶油纸静物", description: "陶罐相伴 · 乖巧端坐" },
  { id: "paper-flower-window", title: "雏菊花冠", description: "花冠歪头 · 甜甜一笑" },
  { id: "mountain-cable-car", title: "花店门口", description: "花香里 · 安静等待" },
  { id: "laundry-day", title: "云朵毛毯", description: "毯子卷卷 · 软萌一团" },
  { id: "museum-curator", title: "旧皮箱", description: "炭灰布景 · 端坐皮箱" },
  { id: "poolside-vacation", title: "纱帘逆光", description: "逆光轮廓 · 柔和剪影" },
  { id: "post-office", title: "珍珠与猫", description: "珍珠项链 · 优雅侧颜" },
  { id: "ballet-backstage", title: "藤篮蓝调", description: "深蓝布景 · 藤篮里探头" },
  { id: "shorthair-armchair", title: "旧扶手椅", description: "窗光丝绒 · 蜷坐抬眼" },
  { id: "shorthair-books", title: "一摞旧书", description: "布面书堆 · 歪头端详" },
  { id: "shorthair-night-rim", title: "咖啡馆窗边", description: "窗边晒太阳 · 眯眼惬意" },
  { id: "shorthair-paper-bag", title: "毛线球游戏", description: "伸爪拨球 · 机灵俏皮" },
  { id: "corgi-denim", title: "向日葵花田", description: "花田里 · 阳光笑脸" },
  { id: "corgi-crate", title: "泡泡浴", description: "浴缸探头 · 湿漉漉的笑" },
  { id: "corgi-sploot", title: "蜜桃趴趴", description: "青蛙趴 · 吐舌卖萌" },
  { id: "corgi-sweater", title: "小绅士", description: "领结端坐 · 骄傲挺胸" },
  { id: "calico-silk", title: "香槟绸布", description: "丝缎侧卧 · 慵懒回眸" },
  { id: "calico-bowl", title: "草莓早餐", description: "舔舔鼻子 · 早餐时间" },
  { id: "calico-rain-window", title: "樱花树下", description: "花瓣飘落 · 抬头张望" },
  { id: "calico-cane-stool", title: "复古梳妆台", description: "镜前端坐 · 温柔回眸" },
];

// 2026-10 v10：按「丝绒王座」标准重拍 4 套，这 4 个 v9 默认键与 v9 的 36 套名称表视为上一版默认值。
const previousV9ArtSceneUrls: Record<string, string> = {
  "shorthair-night-rim": "/api/plugin-samples/samples/scene-shorthair-night-rim-v9-8c3175819c89.jpg",
  "corgi-denim": "/api/plugin-samples/samples/scene-corgi-denim-v9-714b61fef98a.jpg",
  "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v9-3b7a193bfb57.jpg",
  "calico-cane-stool": "/api/plugin-samples/samples/scene-calico-cane-stool-v9-7ac4f494a35f.jpg",
};
const previousV9SceneOptions = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松" },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇" },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容" },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想" },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑" },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察" },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视" },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视" },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸" },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视" },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步" },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带" },
  { id: "railway-traveler", title: "暗调伦勃朗", description: "单灯侧光 · 沉静凝望" },
  { id: "tennis-champion", title: "泡泡时光", description: "追着泡泡 · 咧嘴大笑" },
  { id: "greenhouse-gardener", title: "百叶光影", description: "斜阳条纹 · 眯眼晒暖" },
  { id: "sailboat-holiday", title: "油画布肖像", description: "手绘背景 · 侧身回望" },
  { id: "berry-pastry-chef", title: "奶油纸静物", description: "陶罐相伴 · 乖巧端坐" },
  { id: "paper-flower-window", title: "雏菊花冠", description: "花冠歪头 · 甜甜一笑" },
  { id: "mountain-cable-car", title: "花店门口", description: "花香里 · 安静等待" },
  { id: "laundry-day", title: "云朵毛毯", description: "毯子卷卷 · 软萌一团" },
  { id: "museum-curator", title: "旧皮箱", description: "炭灰布景 · 端坐皮箱" },
  { id: "poolside-vacation", title: "纱帘逆光", description: "逆光轮廓 · 柔和剪影" },
  { id: "post-office", title: "珍珠与猫", description: "珍珠项链 · 优雅侧颜" },
  { id: "ballet-backstage", title: "藤篮蓝调", description: "深蓝布景 · 藤篮里探头" },
  { id: "shorthair-armchair", title: "旧扶手椅", description: "窗光丝绒 · 蜷坐抬眼" },
  { id: "shorthair-books", title: "一摞旧书", description: "布面书堆 · 歪头端详" },
  { id: "shorthair-night-rim", title: "无毛猫高定", description: "雕塑光影 · 冷艳凝视" },
  { id: "shorthair-paper-bag", title: "毛线球游戏", description: "伸爪拨球 · 机灵俏皮" },
  { id: "corgi-denim", title: "飘逸长发", description: "风吹长毛 · 超模气场" },
  { id: "corgi-crate", title: "丝绒王座", description: "端坐高背椅 · 贵族气质" },
  { id: "corgi-sploot", title: "蜜桃趴趴", description: "青蛙趴 · 吐舌卖萌" },
  { id: "corgi-sweater", title: "小绅士", description: "领结端坐 · 骄傲挺胸" },
  { id: "calico-silk", title: "香槟绸布", description: "丝缎侧卧 · 慵懒回眸" },
  { id: "calico-bowl", title: "草莓早餐", description: "舔舔鼻子 · 早餐时间" },
  { id: "calico-rain-window", title: "珍珠白缎", description: "白缎垫上 · 柔光贵气" },
  { id: "calico-cane-stool", title: "墨镜大片", description: "复古墨镜 · 酷感回眸" },
];

// 2026-10 v11：4 套改成半身时尚大片，这 4 个 v10 默认键与 v10 的 36 套名称表视为上一版默认值。
const previousV10ArtSceneUrls: Record<string, string> = {
  "shorthair-night-rim": "/api/plugin-samples/samples/scene-shorthair-night-rim-v10-434f0b9cf397.jpg",
  "corgi-denim": "/api/plugin-samples/samples/scene-corgi-denim-v10-171a6077b301.jpg",
  "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v10-3fdab0d41fba.jpg",
  "calico-cane-stool": "/api/plugin-samples/samples/scene-calico-cane-stool-v10-906bac7f9610.jpg",
};
const previousV10SceneOptions = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松" },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇" },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容" },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想" },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑" },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察" },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视" },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视" },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸" },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视" },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步" },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带" },
  { id: "railway-traveler", title: "暗调伦勃朗", description: "单灯侧光 · 沉静凝望" },
  { id: "tennis-champion", title: "泡泡时光", description: "追着泡泡 · 咧嘴大笑" },
  { id: "greenhouse-gardener", title: "百叶光影", description: "斜阳条纹 · 眯眼晒暖" },
  { id: "sailboat-holiday", title: "油画布肖像", description: "手绘背景 · 侧身回望" },
  { id: "berry-pastry-chef", title: "奶油纸静物", description: "陶罐相伴 · 乖巧端坐" },
  { id: "paper-flower-window", title: "雏菊花冠", description: "花冠歪头 · 甜甜一笑" },
  { id: "mountain-cable-car", title: "花店门口", description: "花香里 · 安静等待" },
  { id: "laundry-day", title: "云朵毛毯", description: "毯子卷卷 · 软萌一团" },
  { id: "museum-curator", title: "旧皮箱", description: "炭灰布景 · 端坐皮箱" },
  { id: "poolside-vacation", title: "纱帘逆光", description: "逆光轮廓 · 柔和剪影" },
  { id: "post-office", title: "珍珠与猫", description: "珍珠项链 · 优雅侧颜" },
  { id: "ballet-backstage", title: "藤篮蓝调", description: "深蓝布景 · 藤篮里探头" },
  { id: "shorthair-armchair", title: "旧扶手椅", description: "窗光丝绒 · 蜷坐抬眼" },
  { id: "shorthair-books", title: "一摞旧书", description: "布面书堆 · 歪头端详" },
  { id: "shorthair-night-rim", title: "书房绅士", description: "驼色高领 · 书堆上端坐" },
  { id: "shorthair-paper-bag", title: "毛线球游戏", description: "伸爪拨球 · 机灵俏皮" },
  { id: "corgi-denim", title: "酒店大堂", description: "千鸟格外套 · 行李车旁" },
  { id: "corgi-crate", title: "丝绒王座", description: "端坐高背椅 · 贵族气质" },
  { id: "corgi-sploot", title: "蜜桃趴趴", description: "青蛙趴 · 吐舌卖萌" },
  { id: "corgi-sweater", title: "小绅士", description: "领结端坐 · 骄傲挺胸" },
  { id: "calico-silk", title: "香槟绸布", description: "丝缎侧卧 · 慵懒回眸" },
  { id: "calico-bowl", title: "草莓早餐", description: "舔舔鼻子 · 早餐时间" },
  { id: "calico-rain-window", title: "钢琴独奏", description: "珍珠缎带 · 琴盖上端坐" },
  { id: "calico-cane-stool", title: "黑胶时光", description: "复古丝巾 · 唱机旁回眸" },
];

// 2026-10 v12：13–36 里除 4 套时尚大片外的 20 套改成「宠物瞬间」，这 20 个 v11 默认键与 v11 的 36 套名称表视为上一版默认值。
const previousV11ArtSceneUrls: Record<string, string> = {
  "railway-traveler": "/api/plugin-samples/samples/scene-railway-traveler-v7-f0a84c31cb26.jpg",
  "tennis-champion": "/api/plugin-samples/samples/scene-tennis-champion-v8-5e19c038af7d.jpg",
  "greenhouse-gardener": "/api/plugin-samples/samples/scene-greenhouse-gardener-v7-551e92fc6249.jpg",
  "sailboat-holiday": "/api/plugin-samples/samples/scene-sailboat-holiday-v6-4a22e633a7a8.jpg",
  "berry-pastry-chef": "/api/plugin-samples/samples/scene-berry-pastry-chef-v7-a9086e9f1beb.jpg",
  "paper-flower-window": "/api/plugin-samples/samples/scene-paper-flower-window-v8-ab5124661b86.jpg",
  "mountain-cable-car": "/api/plugin-samples/samples/scene-mountain-cable-car-v8-70b6325e355a.jpg",
  "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v8-5509c49e6617.jpg",
  "museum-curator": "/api/plugin-samples/samples/scene-museum-curator-v7-ddfec7859821.jpg",
  "poolside-vacation": "/api/plugin-samples/samples/scene-poolside-vacation-v6-bf0a1f6d4423.jpg",
  "post-office": "/api/plugin-samples/samples/scene-post-office-v8-39fcfcf4bee7.jpg",
  "ballet-backstage": "/api/plugin-samples/samples/scene-ballet-backstage-v6-b34c002eee53.jpg",
  "shorthair-armchair": "/api/plugin-samples/samples/scene-shorthair-armchair-v7-c566d0b61a0e.jpg",
  "shorthair-books": "/api/plugin-samples/samples/scene-shorthair-books-v7-26a1786ebfb6.jpg",
  "shorthair-paper-bag": "/api/plugin-samples/samples/scene-shorthair-paper-bag-v8-970c4eec5358.jpg",
  "corgi-sploot": "/api/plugin-samples/samples/scene-corgi-sploot-v8-edf4739eb97b.jpg",
  "corgi-sweater": "/api/plugin-samples/samples/scene-corgi-sweater-v8-357ccfaceb0a.jpg",
  "calico-silk": "/api/plugin-samples/samples/scene-calico-silk-v7-00d1eb65bef0.jpg",
  "calico-bowl": "/api/plugin-samples/samples/scene-calico-bowl-v8-2dba23841d9f.jpg",
  "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v11-c34a877fa2ea.jpg",
};
const previousV11SceneOptions = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松" },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇" },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容" },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想" },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑" },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察" },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视" },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视" },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸" },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视" },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步" },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带" },
  { id: "railway-traveler", title: "暗调伦勃朗", description: "单灯侧光 · 沉静凝望" },
  { id: "tennis-champion", title: "泡泡时光", description: "追着泡泡 · 咧嘴大笑" },
  { id: "greenhouse-gardener", title: "百叶光影", description: "斜阳条纹 · 眯眼晒暖" },
  { id: "sailboat-holiday", title: "油画布肖像", description: "手绘背景 · 侧身回望" },
  { id: "berry-pastry-chef", title: "奶油纸静物", description: "陶罐相伴 · 乖巧端坐" },
  { id: "paper-flower-window", title: "雏菊花冠", description: "花冠歪头 · 甜甜一笑" },
  { id: "mountain-cable-car", title: "花店门口", description: "花香里 · 安静等待" },
  { id: "laundry-day", title: "云朵毛毯", description: "毯子卷卷 · 软萌一团" },
  { id: "museum-curator", title: "旧皮箱", description: "炭灰布景 · 端坐皮箱" },
  { id: "poolside-vacation", title: "纱帘逆光", description: "逆光轮廓 · 柔和剪影" },
  { id: "post-office", title: "珍珠与猫", description: "珍珠项链 · 优雅侧颜" },
  { id: "ballet-backstage", title: "藤篮蓝调", description: "深蓝布景 · 藤篮里探头" },
  { id: "shorthair-armchair", title: "旧扶手椅", description: "窗光丝绒 · 蜷坐抬眼" },
  { id: "shorthair-books", title: "一摞旧书", description: "布面书堆 · 歪头端详" },
  { id: "shorthair-night-rim", title: "黑金礼服", description: "昂首睥睨 · 礼服绅士" },
  { id: "shorthair-paper-bag", title: "毛线球游戏", description: "伸爪拨球 · 机灵俏皮" },
  { id: "corgi-denim", title: "机车先生", description: "皮衣回眸 · 酷感气场" },
  { id: "corgi-crate", title: "丝绒王座", description: "端坐高背椅 · 贵族气质" },
  { id: "corgi-sploot", title: "蜜桃趴趴", description: "青蛙趴 · 吐舌卖萌" },
  { id: "corgi-sweater", title: "小绅士", description: "领结端坐 · 骄傲挺胸" },
  { id: "calico-silk", title: "香槟绸布", description: "丝缎侧卧 · 慵懒回眸" },
  { id: "calico-bowl", title: "草莓早餐", description: "舔舔鼻子 · 早餐时间" },
  { id: "calico-rain-window", title: "金链名伶", description: "侧颜微扬 · 冷艳贵气" },
  { id: "calico-cane-stool", title: "墨镜风衣", description: "立领风衣 · 墨镜压低" },
];

// 2026-10 v13：v12 的 16 套生活情景改回棚拍逻辑（保留半空接球、气球派对、抱着玩偶睡、冰淇淋舔舔），这 16 个 v12 默认键与 v12 的 36 套名称表视为上一版默认值。
const previousV12ArtSceneUrls: Record<string, string> = {
  "railway-traveler": "/api/plugin-samples/samples/scene-railway-traveler-v12-67267f22d3d7.jpg",
  "tennis-champion": "/api/plugin-samples/samples/scene-tennis-champion-v12-792b7220deb6.jpg",
  "greenhouse-gardener": "/api/plugin-samples/samples/scene-greenhouse-gardener-v12-bdb43989b741.jpg",
  "sailboat-holiday": "/api/plugin-samples/samples/scene-sailboat-holiday-v12-86a1a51e3e81.jpg",
  "paper-flower-window": "/api/plugin-samples/samples/scene-paper-flower-window-v12-30fdfec0586a.jpg",
  "mountain-cable-car": "/api/plugin-samples/samples/scene-mountain-cable-car-v12-d4ce85e8500f.jpg",
  "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v12-d97924684584.jpg",
  "museum-curator": "/api/plugin-samples/samples/scene-museum-curator-v12-3fddae388a05.jpg",
  "poolside-vacation": "/api/plugin-samples/samples/scene-poolside-vacation-v12-5961fb055876.jpg",
  "post-office": "/api/plugin-samples/samples/scene-post-office-v12-d4011c411fc2.jpg",
  "shorthair-armchair": "/api/plugin-samples/samples/scene-shorthair-armchair-v12-3c3a01e5eed5.jpg",
  "shorthair-books": "/api/plugin-samples/samples/scene-shorthair-books-v12-cb1d4a329723.jpg",
  "shorthair-paper-bag": "/api/plugin-samples/samples/scene-shorthair-paper-bag-v12-db73ac5910f5.jpg",
  "corgi-sploot": "/api/plugin-samples/samples/scene-corgi-sploot-v12-74c030fd5fbe.jpg",
  "corgi-sweater": "/api/plugin-samples/samples/scene-corgi-sweater-v12-8161a640b11b.jpg",
  "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v12-8b54761f8139.jpg",
};
const previousV12SceneOptions = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松" },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇" },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容" },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想" },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑" },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察" },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视" },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视" },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸" },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视" },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步" },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带" },
  { id: "railway-traveler", title: "肉垫贴玻璃", description: "隔着玻璃 · 粉嫩肉垫" },
  { id: "tennis-champion", title: "喷嚏前一秒", description: "蒲公英飘过 · 皱鼻挤眼" },
  { id: "greenhouse-gardener", title: "生日偷袭", description: "派对帽歪了 · 偷舔奶油" },
  { id: "sailboat-holiday", title: "快递箱之王", description: "箱子太小 · 硬要坐进去" },
  { id: "berry-pastry-chef", title: "半空接球", description: "腾空一跃 · 张嘴接住" },
  { id: "paper-flower-window", title: "零食袋的声音", description: "歪头 · 竖起耳朵听" },
  { id: "mountain-cable-car", title: "刚洗完澡", description: "裹着浴巾 · 一脸不服" },
  { id: "laundry-day", title: "晒衣篮午睡", description: "睡进衣服堆 · 袜子盖头" },
  { id: "museum-curator", title: "镜子里的我", description: "对镜举爪 · 一脸疑惑" },
  { id: "poolside-vacation", title: "四脚朝天", description: "翻肚皮睡 · 肉垫朝天" },
  { id: "post-office", title: "花瓣落鼻尖", description: "对眼 · 盯着花瓣" },
  { id: "ballet-backstage", title: "气球派对", description: "抬头望气球 · 眼睛亮晶晶" },
  { id: "shorthair-armchair", title: "拆家现场", description: "纸巾雪 · 理直气壮" },
  { id: "shorthair-books", title: "奶油胡子", description: "舔完奶油杯 · 白胡子" },
  { id: "shorthair-night-rim", title: "黑金礼服", description: "昂首睥睨 · 礼服绅士" },
  { id: "shorthair-paper-bag", title: "围巾只露眼睛", description: "大围巾裹住 · 只剩眼睛" },
  { id: "corgi-denim", title: "机车先生", description: "皮衣回眸 · 酷感气场" },
  { id: "corgi-crate", title: "丝绒王座", description: "端坐高背椅 · 贵族气质" },
  { id: "corgi-sploot", title: "拍泡泡", description: "站起来 · 双爪拍泡泡" },
  { id: "corgi-sweater", title: "门后偷看", description: "探出半张脸 · 偷偷观察" },
  { id: "calico-silk", title: "抱着玩偶睡", description: "搂紧玩偶 · 睡到吐舌" },
  { id: "calico-bowl", title: "冰淇淋舔舔", description: "伸舌头够 · 专注对眼" },
  { id: "calico-rain-window", title: "窗台监工", description: "趴窗看鸟 · 玻璃倒影" },
  { id: "calico-cane-stool", title: "墨镜风衣", description: "立领风衣 · 墨镜压低" },
];

const manifestSchema: z.ZodType<PluginManifest> = z.object({
  id: z.string().min(1).max(80),
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  category: z.enum(["layout", "ai-image", "interactive", "video", "memorial", "report"]),
  tagline: z.string().max(160),
  description: z.string().max(1000),
  accent: z.enum(["orange", "blue", "yellow"]),
  input: z.object({ photos: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }).refine((value) => value.max >= value.min), profileFields: z.array(z.enum(["name", "species", "birthday", "gender"])) }),
  generator: z.object({ type: z.enum(["html-template", "image-api", "h5-theme", "ffmpeg", "report"]), template: z.string().min(1).max(120) }),
  pricing: z.object({ unlockPrice: z.number().nonnegative(), label: z.string().min(1).max(80) }),
  output: z.object({ formats: z.array(z.enum(["image", "pdf", "h5", "video"])).min(1) }),
  // 样例图。必须与 models.ts 的 PluginManifest 同步 —— 缺了这条 schema 会把新字段直接剥掉，
  // 后台存进去也读不出来。上限 8 张，避免入口 rail 无限拉长。
  // 存站内相对路径而非绝对 URL：绝对 URL 会把部署域名写进仓库，测试与生产就得各留一份。
  // 小程序需要的绝对地址由 /api/plugins 出口按 PUBLIC_APP_URL 拼装（见该路由）。
  samples: z.object({
    heroUrl: z.string().max(500).regex(/^\/api\/plugin-samples\//).optional(),
    thumbUrls: z.array(z.string().max(500).regex(/^\/api\/plugin-samples\//)).max(8).optional(),
    sceneUrls: z.record(z.string().max(40), z.string().max(500).regex(/^\/api\/plugin-samples\//)).optional(),
    sceneOptions: z.array(z.object({ id: z.string().min(1).max(40), title: z.string().min(1).max(80), description: z.string().max(180) })).max(48).optional(),
    // 旧 AI 风格对照字段，仅供历史 manifest 和回滚读取。
    styleUrls: z.record(z.string().max(40), z.string().max(500).regex(/^\/api\/plugin-samples\//)).optional(),
  }).optional(),
  // 生命阶段调性覆盖。同 samples：必须与 models.ts 的 PluginManifest 同步 ——
  // 缺了这条 schema 会把字段直接剥掉，registry 里写了也读不出来。
  toneVariants: z.object({
    senior: toneVariantSchema.optional(),
    memorial: toneVariantSchema.optional(),
  }).optional(),
  status: z.enum(["idea", "testing", "live", "archived"]),
});

/**
 * 按生命阶段解析 manifest 的文案与定价。
 *
 * **任务入库时快照的必须是解析后的结果**（见 platform-service 的 plugin_snapshot）：
 * 存含全部 variants 的原始件会让历史作品在用户改了宠物生命阶段后换一副面孔，
 * 而作品是既成事实，不该回头变样。
 */
export function resolveManifestTone(manifest: PluginManifest, lifeStage?: string): PluginManifest {
  const variant = lifeStage === "memorial" ? manifest.toneVariants?.memorial : lifeStage === "senior" ? manifest.toneVariants?.senior : undefined;
  if (!variant) return manifest;
  return {
    ...manifest,
    name: variant.name ?? manifest.name,
    tagline: variant.tagline ?? manifest.tagline,
    description: variant.description ?? manifest.description,
    pricing: {
      unlockPrice: variant.unlockPrice ?? manifest.pricing.unlockPrice,
      label: variant.label ?? manifest.pricing.label,
    },
  };
}

function decodeJsonValue(value: unknown) {
  let decoded = value;
  for (let depth = 0; depth < 2 && typeof decoded === "string"; depth += 1) {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      break;
    }
  }
  return decoded;
}

function asRecord(value: unknown): Record<string, unknown> {
  const decoded = decodeJsonValue(value);
  return decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : {};
}

function matchesArtSceneOptions(value: unknown, options: typeof previousV2ArtSceneOptions) {
  return Array.isArray(value) && value.length === options.length
    && value.every((item, index) => {
      const current = asRecord(item);
      const previous = options[index];
      return current.id === previous.id && current.title === previous.title && current.description === previous.description;
    });
}

function matchesPreviousArtScenes(value: unknown) {
  return matchesArtSceneOptions(value, previousArtSceneOptions) || matchesArtSceneOptions(value, previousV2ArtSceneOptions);
}

async function ensurePluginConfigs() {
  const database = await getDatabase();
  // 值可以是单个旧默认串或多个：只有仍等于某个旧默认值的字段才升级，后台改过的文案保留。
  const previousDefaultCopy: Record<string, Partial<Record<"tagline" | "description", string | string[]>>> = {
    "pet-id-card": { tagline: "今天起，它也是有证的小朋友" },
    "pet-movie-poster": { tagline: "年度巨制，领衔主演是它" },
    "pl-10": {
      tagline: "换一个场景，看见它不一样的神态",
      description: ["选择宠物身份照和写真场景，生成两张保留它真实身份的艺术写真候选。", "选择宠物身份照和写真场景，生成两张保留我真实模样的艺术写真候选。"],
    },
  };
  for (const plugin of plugins) {
    await database.query("INSERT INTO plugin_configs (id,manifest,version,active,updated_at) VALUES ($1,$2::jsonb,1,true,$3) ON CONFLICT (id) DO NOTHING", [plugin.id, JSON.stringify(plugin), new Date()]);
    if (plugin.id === "pet-movie-poster") {
      const stored = (await database.query<{ manifest: unknown }>("SELECT manifest FROM plugin_configs WHERE id=$1", [plugin.id]))[0];
      const current = asRecord(stored?.manifest);
      const generator = asRecord(current.generator);
      const input = asRecord(current.input);
      const photos = asRecord(input.photos);
      const next = { ...current };
      let changed = false;
      if (generator.type === "html-template" && generator.template === "movie-poster-v1") {
        next.generator = plugin.generator;
        changed = true;
      }
      if (photos.min === 1 && photos.max === 3) {
        next.input = { ...input, photos: plugin.input.photos };
        changed = true;
      }
      if (current.description === "把日常照片排成一张有片名、有短评的竖版电影海报。") {
        next.description = plugin.description;
        changed = true;
      }
      if (changed) await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify(next), new Date()]);
    }
    const oldDefault = previousDefaultCopy[plugin.id];
    if (oldDefault) {
      const storedCopy = (await database.query<{ manifest: unknown }>("SELECT manifest FROM plugin_configs WHERE id=$1", [plugin.id]))[0];
      const currentCopy = asRecord(storedCopy?.manifest);
      let changedCopy = false;
      for (const key of Object.keys(oldDefault) as Array<"tagline" | "description">) {
        if (([] as string[]).concat(oldDefault[key] ?? []).includes(String(currentCopy[key]))) {
          currentCopy[key] = plugin[key];
          changedCopy = true;
        }
      }
      if (changedCopy) await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify(currentCopy), new Date()]);
    }
    // 样例图回填：老库里的 manifest 按旧结构写入，而上面的 DO NOTHING 不会更新它们。
    // 只在「库里没有 samples 而代码里有」时补一次，不整体覆盖 —— 后台发布过的配置属于
    // 运营决策，不能被一次部署重置。
    //
    // 走 JS 而不用 jsonb_set：manifest 列可能存的是 JSON 字符串而非 jsonb 对象
    // （decodeJsonValue 要循环解两层就是为此），那种行上 `manifest ? 'samples'` 会误判。
    if (plugin.samples) {
      const stored = (await database.query<{ manifest: unknown }>("SELECT manifest FROM plugin_configs WHERE id=$1", [plugin.id]))[0];
      if (stored) {
        const manifest = asRecord(stored.manifest);
        if (manifest.id) {
          // 仅替换上一版代码的默认 URL；不同值视为后台人工配置，保持原样。
          const storedSamples = asRecord(manifest.samples);
          const merged = { ...storedSamples };
          let changed = false;
          for (const [key, value] of Object.entries(plugin.samples)) {
            if (key === "styleUrls" || key === "sceneUrls") {
              const currentStyles = asRecord(merged[key]);
              const nextStyles = { ...currentStyles };
              const oldStyles = previousSampleDefaults[plugin.id]?.[key] || {};
              const v2Styles = key === "sceneUrls" ? previousV2SampleDefaults[plugin.id]?.sceneUrls || {} : {};
              for (const [style, url] of Object.entries(value as Record<string, string>)) {
                if (nextStyles[style] === undefined || nextStyles[style] === oldStyles[style] || nextStyles[style] === v2Styles[style] ||
                    (plugin.id === "pl-10" && key === "sceneUrls" && (nextStyles[style] === previousV4ArtSceneUrls[style] || nextStyles[style] === previousV5ArtSceneUrls[style] || nextStyles[style] === previousV6ArtSceneUrls[style] || nextStyles[style] === previousV7ArtSceneUrls[style] || nextStyles[style] === previousV8ArtSceneUrls[style] || nextStyles[style] === previousV9ArtSceneUrls[style] || nextStyles[style] === previousV10ArtSceneUrls[style] || nextStyles[style] === previousV11ArtSceneUrls[style] || nextStyles[style] === previousV12ArtSceneUrls[style]))) {
                  if (nextStyles[style] !== url) { nextStyles[style] = url; changed = true; }
                }
              }
              merged[key] = nextStyles;
            } else if (key === "sceneOptions") {
              const previousTwelve = (value as typeof previousV2ArtSceneOptions).slice(0, 12);
              const previousV4 = [...previousTwelve, ...previousV4ExtendedSceneOptions];
              const previousV5 = [...previousTwelve, ...previousV5ExtendedSceneOptions];
              if (merged[key] === undefined || matchesPreviousArtScenes(merged[key]) || matchesArtSceneOptions(merged[key], previousTwelve) || matchesArtSceneOptions(merged[key], previousV4) || matchesArtSceneOptions(merged[key], previousV5) || matchesArtSceneOptions(merged[key], (value as typeof previousV2ArtSceneOptions).slice(0, 24)) || matchesArtSceneOptions(merged[key], previousV7SceneOptions) || matchesArtSceneOptions(merged[key], previousV7SceneOptions.slice(0, 24)) || matchesArtSceneOptions(merged[key], previousV8SceneOptions) || matchesArtSceneOptions(merged[key], previousV9SceneOptions) || matchesArtSceneOptions(merged[key], previousV10SceneOptions) || matchesArtSceneOptions(merged[key], previousV11SceneOptions) || matchesArtSceneOptions(merged[key], previousV12SceneOptions)) { merged[key] = value; changed = true; }
            } else if (value !== undefined && (merged[key] === undefined || merged[key] === previousSampleDefaults[plugin.id]?.[key as "heroUrl"] || merged[key] === previousV2SampleDefaults[plugin.id]?.[key as "heroUrl"])) {
              if (merged[key] !== value) { merged[key] = value; changed = true; }
            }
          }
          if (changed) {
            await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify({ ...manifest, samples: merged }), new Date()]);
          }
        }
      }
    }
    if (plugin.id === "pl-10") {
      const stored = (await database.query<{ manifest: unknown }>("SELECT manifest FROM plugin_configs WHERE id=$1", [plugin.id]))[0];
      if (stored) {
        const manifest = asRecord(stored.manifest);
        const oldCopy: Record<string, string> = {
          name: "AI 宠物肖像",
          tagline: "四张候选，只留下最像它的一张",
          description: "选择宠物照片、风格与提示词，生成四张带 AI 标识的候选肖像。",
        };
        const next = { ...manifest };
        let changed = false;
        for (const key of Object.keys(oldCopy)) {
          if (next[key] === oldCopy[key]) {
            next[key] = plugin[key as "name" | "tagline" | "description"];
            changed = true;
          }
        }
        if (next.description === "选择宠物身份照和写真场景，生成四张保留它真实身份的艺术写真候选。") {
          next.description = plugin.description;
          changed = true;
        }
        if (changed) await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify(next), new Date()]);
      }
    }
    await database.query("INSERT INTO plugin_config_versions (id,plugin_id,version,manifest,template_version,created_at) VALUES ($1,$2,1,$3::jsonb,$4,$5) ON CONFLICT (plugin_id,version) DO NOTHING", [crypto.randomUUID(), plugin.id, JSON.stringify(plugin), plugin.generator.template, new Date()]);
  }
  return database;
}

export async function listRuntimePlugins() {
  const database = await ensurePluginConfigs();
  const rows = await database.query("SELECT manifest FROM plugin_configs WHERE active=true ORDER BY id");
  const variants = await database.query("SELECT DISTINCT ON (plugin_id) plugin_id,status,config FROM experiment_variants WHERE status='live' ORDER BY plugin_id,updated_at DESC,created_at DESC");
  const byPlugin = new Map(variants.map((row) => [String(row.plugin_id), row]));
  return rows.map((row) => manifestSchema.parse(decodeJsonValue(row.manifest))).flatMap((manifest) => {
    const variant = byPlugin.get(manifest.id);
    if (!variant) return [manifest];
    const config = asRecord(variant.config);
    return [manifestSchema.parse(config.manifest || { ...manifest, ...(config.manifestPatch as object || {}) })];
  });
}

export async function getRuntimePlugin(id: string) {
  return (await listRuntimePlugins()).find((plugin) => plugin.id === id);
}

export async function listRuntimePluginVersions(id: string) {
  const database = await ensurePluginConfigs();
  const rows = await database.query("SELECT id,plugin_id,version,manifest,template_version,created_by,created_at FROM plugin_config_versions WHERE plugin_id=$1 ORDER BY version DESC", [id]);
  return rows.map((row) => ({ ...row, manifest: manifestSchema.parse(decodeJsonValue(row.manifest)) }));
}

export async function updateRuntimePlugin(id: string, input: unknown, actorId?: string, reason = "发布玩法配置") {
  const manifest = manifestSchema.parse(input);
  if (manifest.id !== id) throw new AppError("PLUGIN_ID_MISMATCH", "插件 ID 与路由不一致", 422);
  const database = await ensurePluginConfigs();
  const before = (await database.query("SELECT manifest,version FROM plugin_configs WHERE id=$1", [id]))[0];
  const rows = await database.query("INSERT INTO plugin_configs (id,manifest,version,active,updated_at) VALUES ($1,$2::jsonb,1,true,$3) ON CONFLICT (id) DO UPDATE SET manifest=$2::jsonb,version=plugin_configs.version+1,updated_at=$3 RETURNING version", [id, JSON.stringify(manifest), new Date()]);
  const version = Number(rows[0].version);
  await database.query("INSERT INTO plugin_config_versions (id,plugin_id,version,manifest,template_version,created_by,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)", [crypto.randomUUID(), id, version, JSON.stringify(manifest), manifest.generator.template, actorId || null, new Date()]);
  if (actorId) await recordAdminAudit({ actorId, action: "plugin_publish", targetType: "plugin", targetId: id, reason, before, after: { manifest, version } });
  return { manifest, version };
}

export async function rollbackRuntimePlugin(id: string, version: number, actorId: string, reason = "回滚玩法配置") {
  const database = await ensurePluginConfigs();
  const rows = await database.query("SELECT manifest FROM plugin_config_versions WHERE plugin_id=$1 AND version=$2", [id, version]);
  if (!rows[0]) throw new AppError("PLUGIN_VERSION_NOT_FOUND", "插件历史版本不存在", 404);
  return updateRuntimePlugin(id, decodeJsonValue(rows[0].manifest), actorId, reason);
}
