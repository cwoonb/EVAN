import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import Header from "@/components/Header";
import { Suspense } from "react";
import FloatingAssistant from "@/components/FloatingAssistant";
import AccountDialog from "@/components/AccountDialog";
import "./globals.css";
import "./header.css";
import "./secondary.css";
import "./news/news.css";
import "./assistant.css";

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: { default: "EVAN — AI Research Workspace", template: "%s | EVAN" },
  description:
    "실제 AI 뉴스의 사건별 통합 분석, 원문 출처와 기술 리서치를 함께 탐색하는 EVAN 작업공간.",
  applicationName: "EVAN",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>
        <a className="skip-link" href="#main-content">
          본문으로 건너뛰기
        </a>
        <Header />
        <AccountDialog />
        {children}
        <Suspense fallback={null}><FloatingAssistant /></Suspense>
        <footer className="site-footer">
          <Link className="footer-brand" href="/">
            EVAN<span>AI Research Workspace</span>
          </Link>
          <p>변화를 읽고, 가능성을 만듭니다.</p>
          <span className="footer-note">
            © 2026 EVAN · Built with curiosity
          </span>
        </footer>
      </body>
    </html>
  );
}
