import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SWRegister from "@/components/SWRegister";
import { LanguageProvider } from "@/lib/i18n";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ProfTokoOnline Dashboard",
  description: "Multi-client Shopee sales dashboard",
  // manifest link is auto-injected by the app/manifest.ts route convention
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Prof Toko Online" },
};

// navy status-bar / browser-chrome tint + splash background (no white flash)
export const viewport: Viewport = {
  themeColor: "#091732",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><SWRegister /><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
