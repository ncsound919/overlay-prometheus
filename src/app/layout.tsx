import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "PROMETHEUS // Autonomous Discovery Engine",
  description:
    "Mission-control dashboard for an autonomous scientific discovery engine — 8-layer inference stack, breakthrough synthesis, governance and live telemetry.",
  keywords: ["autonomous discovery", "breakthrough engine", "mission control", "scientific inference", "PROMETHEUS"],
  authors: [{ name: "AURORA-KERNEL" }],
  icons: {
    icon: [
      { url: "/prometheus-icon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "PROMETHEUS // Autonomous Discovery Engine",
    description: "Live 8-layer scientific inference stack — discovery, breakthroughs, governance.",
    url: SITE_URL,
    siteName: "PROMETHEUS",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PROMETHEUS — Autonomous Discovery Engine",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PROMETHEUS // Autonomous Discovery Engine",
    description: "Live 8-layer scientific inference stack — discovery, breakthroughs, governance.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
