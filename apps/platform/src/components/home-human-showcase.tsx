import Image from "next/image";
import Link from "next/link";

const coverNumbers = [31, 32, 5, 8, 7, 36, 37, 20];

export function HomeHumanShowcase() {
  return <section className="home-human" aria-labelledby="home-human-title">
    <div className="home-human-heading">
      <div><span className="eyebrow">40 款人像造型</span><h2 id="home-human-title">人类转生计划</h2></div>
      <Link className="home-human-action" href="/ai/create?entryId=human">立即去玩 <b>→</b></Link>
    </div>
    <div className="home-human-track" aria-label="人类转生计划造型预览">
      {coverNumbers.map((number) => <Link className="home-human-image" href="/ai/create?entryId=human" key={number} aria-label={`查看人类转生计划造型 ${number}`}>
        <Image alt={`人类转生计划造型 ${number}`} fill sizes="(max-width: 520px) 180px, 200px" src={`/api/image-templates/human-effect-${String(number).padStart(2, "0")}/sample`} unoptimized />
      </Link>)}
    </div>
  </section>;
}
