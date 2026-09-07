import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "الأخ الكبير | Big Brother — معلومات قانونية عامة للقضايا الكويتية",
  description:
    "منصة معلومات قانونية تعليمية لمساعدة المتقاضين ذاتيًا والجهات المساندة في الكويت: جدول زمني بلغة مبسطة، تنبيهات إجرائية محايدة، ومسودات نقاش تعليمية — ليست استشارة قانونية.",
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" }
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
