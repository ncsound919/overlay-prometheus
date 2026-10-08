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

export const metadata: Metadata = {
  title: "PROMETHEUS // Autonomous Discovery Engine",
  description:
    "Mission-control dashboard for an autonomous scientific discovery engine — 8-layer inference stack, breakthrough synthesis, governance and live telemetry.",
  keywords: ["autonomous discovery", "breakthrough engine", "mission control", "scientific inference", "PROMETHEUS"],
  authors: [{ name: "AURORA-KERNEL" }],
  icons: {
    icon: "/prometheus-icon.svg",
  },
  openGraph: {
    title: "PROMETHEUS // Autonomous Discovery Engine",
    description: "Live 8-layer scientific inference stack — discovery, breakthroughs, governance.",
    url: "https://chat.z.ai",
    siteName: "PROMETHEUS",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PROMETHEUS // Autonomous Discovery Engine",
    description: "Live 8-layer scientific inference stack — discovery, breakthroughs, governance.",
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
