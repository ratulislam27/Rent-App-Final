import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const themeBootScript = `(function(){var preference="system";try{preference=localStorage.getItem("rentwise-theme")||"system";}catch(error){}var dark=preference==="dark"||(preference==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var theme=dark?"dark":"light";document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;})();`;

export const metadata: Metadata = {
  metadataBase: new URL("https://rentratul.vercel.app"),
  applicationName: "Rento",
  title: { default: "Rento", template: "%s · Rento" },
  description: "Mobile-first rent management for landlords.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Rento" },
  formatDetection: { telephone: false },
  icons: { icon: "/favicon-v3.svg", shortcut: "/favicon-v3.svg", apple: "/apple-touch-icon-v3.png" },
  openGraph: {
    type: "website",
    title: "Rento — Rental management, made clear",
    description: "A private mobile workspace for landlords.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Rento landlord rent management" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d0f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head><body className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>{children}</body></html>;
}
