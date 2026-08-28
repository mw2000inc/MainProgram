import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MW2000 — Customer, Sales & Inventory Management",
  description: "Monitoring and management system for a water purification company",
  // iOS has no manifest support of its own — these are the equivalent
  // "make Safari's Add to Home Screen behave like an installed app" tags.
  // The manifest itself (app/manifest.ts) already covers Chrome/Edge/Android
  // and is picked up automatically without needing anything here.
  appleWebApp: {
    capable: true,
    title: "MW2000",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0077B6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
