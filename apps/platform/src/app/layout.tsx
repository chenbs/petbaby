import type { Metadata } from "next";

import { BottomNav } from "@/components/bottom-nav";

import "./globals.css";

export const metadata: Metadata = {
  title: "宠物造物局",
  description: "上传宠物照片，一分钟生成值得晒、值得珍藏的作品。",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>
        <div className="page-backdrop">
          <div className="app-frame">
            {children}
            <BottomNav />
          </div>
        </div>
      </body>
    </html>
  );
}
