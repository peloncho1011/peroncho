import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ぺろんちょOS",
  description: "行動に集中するための、個人専用AI秘書アプリ",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
