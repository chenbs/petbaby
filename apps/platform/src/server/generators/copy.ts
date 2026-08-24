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
    };
    const subtitles = {
      classic: "本年度最难预测的居家动作片",
      arthouse: "有些陪伴，安静得像一束光",
      hongkong: "江湖很大，饭点一定要回家",
    };
    return { title: customTitle || titles[style as keyof typeof titles] || titles.classic, subtitle: customSubtitle || subtitles[style as keyof typeof subtitles] || subtitles.classic };
  }
  if (pluginId === "pet-time-album") {
    return {
      title: customTitle || option(task, "coverTitle") || `${pet.name}的闪光日常`,
      subtitle: customSubtitle || (option(task, "voice") === "owner" ? "谢谢你，把普通日子变成值得收藏的生活" : "这是我认真陪你生活过的证据"),
    };
  }
  return { title: customTitle || `${pet.name}居民身份证`, subtitle: customSubtitle || "允许在任何有阳光的地方长期居住" };
}
