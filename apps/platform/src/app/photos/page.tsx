import Link from "next/link";
import { PhotoLibraryClient } from "@/components/photo-library-client";
export default function PhotosPage(){return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">PHOTO LIBRARY</span><h1>照片库</h1><p>按宠物浏览、排序和删除照片。玩法生成会遵循所选照片顺序。</p></div><PhotoLibraryClient/></main>}
