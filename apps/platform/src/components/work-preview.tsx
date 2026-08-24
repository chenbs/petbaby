import Image from "next/image";

import type { PublicWork } from "@/domain/models";

const speciesLabel = { cat: "猫", dog: "犬", other: "宠物" } as const;

export function WorkPreview({ work }: { work: PublicWork }) {
  const isPoster = work.pluginId === "pet-movie-poster";
  return (
    <article className={isPoster ? "work-preview poster-preview" : "work-preview id-preview"}>
      <div className="preview-kicker">{work.plugin.code} · PETBABY ORIGINAL</div>
      <div className="preview-photo">
        {work.assetKind === "video" && work.outputUrl
          ? <video controls playsInline poster={work.photo.url} src={work.outputUrl} />
          /*
           * PDF 不能进 <Image>：浏览器不会把它当图片解，结果是一个碎图占位。
           * 纪念册这类多页文件用封面照片做预览，实际内容走下载。
           */
          : <Image src={work.assetKind === "pdf" ? work.photo.url : (work.outputUrl || work.photo.url)} alt={`${work.pet.name}的照片`} fill sizes="320px" unoptimized />}
      </div>
      <div className="preview-copy">
        <span>{isPoster ? "NOW SHOWING" : "居民姓名"}</span>
        <h2>{work.title}</h2>
        <p>{work.subtitle}</p>
      </div>
      <dl className="preview-meta">
        <div><dt>类别</dt><dd>{speciesLabel[work.pet.species]}</dd></div>
        <div><dt>编号</dt><dd>{work.serialNumber}</dd></div>
        <div><dt>签发</dt><dd>{work.authority}</dd></div>
      </dl>
      <div className="preview-seal" aria-hidden="true">已认证<br />GOOD PET</div>
      {work.locked ? <div className="preview-watermark">免费预览 · PETBABY</div> : null}
    </article>
  );
}
