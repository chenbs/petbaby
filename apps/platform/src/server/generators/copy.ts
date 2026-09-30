import type { GenerationTask, Pet } from "@/domain/models";

function option(task: GenerationTask, key: string) {
  return typeof task.options[key] === "string" ? task.options[key] as string : undefined;
}

export function localCopy(pluginId: string, pet: Pet, task: GenerationTask) {
  const customTitle = option(task, "title");
  const customSubtitle = option(task, "subtitle");
  if (pluginId === "pet-movie-poster") {
    const style = option(task, "style") || "classic";
    const titles = {
      classic: `《${pet.name}不在家》`,
      arthouse: `《和${pet.name}虚度的下午》`,
      hongkong: `《${pet.name}风云》`,
      rooftop: `《${pet.name}，天生主角》`,
      highseas: `《${pet.name}的远海航线》`,
      musical: `《和${pet.name}在落日下起舞》`,
      webcity: `《${pet.name}的云端巡游》`,
      starvoyage: `《${pet.name}，向星海出发》`,
    };
    const subtitles = {
      classic: "本年度最难预测的居家动作片",
      arthouse: "有些陪伴，安静得像一束光",
      hongkong: "江湖很大，饭点一定要回家",
      rooftop: "每个平凡日子，都值得开场",
      highseas: "风吹向哪里，我们就去哪里",
      musical: "下一支舞，留给最会陪伴的你",
      webcity: "城市很大，冒险从今天开始",
      starvoyage: "宇宙这么大，先一起出发",
    };
    return { title: customTitle || titles[style as keyof typeof titles] || titles.classic, subtitle: customSubtitle || subtitles[style as keyof typeof subtitles] || subtitles.classic };
  }
  if (pluginId === "pet-time-album") {
    const theme = option(task, "theme") || "growth";
    const themeTitles: Record<string, string> = {
      growth: `${pet.name}的成长记录`,
      birthday: `${pet.name}的生日画册`,
      healing: `${pet.name}的治愈日常`,
      holiday: `${pet.name}的节日相册`,
    };
    return {
      title: customTitle || option(task, "coverTitle") || themeTitles[theme] || themeTitles.growth,
      subtitle: customSubtitle || (option(task, "voice") === "owner" ? "谢谢你，把普通日子变成值得收藏的生活" : "这是我认真陪你生活过的证据"),
    };
  }
  return { title: customTitle || `${pet.name}居民身份证`, subtitle: customSubtitle || "允许在任何有阳光的地方长期居住" };
}
