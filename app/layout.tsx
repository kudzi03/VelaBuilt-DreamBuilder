import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SHARE_DESCRIPTION, SHARE_TITLE, SITE_URL } from "@/lib/config";
import "./globals.css";
import "./ui.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  axes: ["wdth"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const title = `${SHARE_TITLE} — Interactive Demo by VelaBuilt`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description: SHARE_DESCRIPTION,
  applicationName: "VelaBuilt",
  authors: [{ name: "VelaBuilt", url: "https://velabuilt.com" }],
  creator: "VelaBuilt",
  publisher: "VelaBuilt",
  category: "technology",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "VelaBuilt",
    locale: "en_US",
    title: SHARE_TITLE,
    description:
      "Interactive demo by VelaBuilt. Choose a business and see what your customers could do before they ever call you.",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: "A house at golden hour with its roof being configured — The Future of Contractor Sales, an interactive demo by VelaBuilt",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
    description: "Interactive demo by VelaBuilt. See what your customers could do before they ever call you.",
    images: ["/og.jpg"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#f4f1ec",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${geistMono.variable}`}>
      <body>
        <a className="skip-link" href="#panel">
          Skip to controls
        </a>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
