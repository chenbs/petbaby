import type { Metadata } from "next";
import Link from "next/link";

import "./(app)/globals.css";

/*
 * 2026-10-11 起 app 下有两个根布局（消费端 (app) 与运营后台 admin），
 * 不匹配任何路由的 URL 没有单一布局可以套，由这里直接输出整页 404（next.config 的 globalNotFound）。
 */

export const metadata: Metadata = { title: "页面不存在 · 麻麻抱我" };

export default function GlobalNotFound() {
  return (
    <html lang="zh-CN">
      <body>
        <div className="page-backdrop">
          <div className="app-frame">
            <main className="screen">
              <div className="page-heading">
                <span className="eyebrow">404</span>
                <h1>这一页走丢了</h1>
                <p>链接可能已经失效，回到首页继续吧。</p>
              </div>
              <Link className="primary-button" href="/">回到首页</Link>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
