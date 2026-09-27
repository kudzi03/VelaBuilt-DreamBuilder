import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { CONTACT_EMAIL, INSTAGRAM_URL, SHARE_DESCRIPTION, SHARE_TITLE, SITE_URL, VELABUILT_URL } from "@/lib/config";
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
        alt: "A house split down the middle: the old mossy roof on one side, the new standing-seam roof and its estimate on the other — The Future of Contractor Sales, an interactive demo by VelaBuilt",
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
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
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

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: title,
  description: SHARE_DESCRIPTION,
  url: SITE_URL,
  image: `${SITE_URL}/og.jpg`,
  inLanguage: "en",
  isPartOf: { "@type": "WebSite", name: "VelaBuilt", url: VELABUILT_URL },
  publisher: {
    "@type": "Organization",
    name: "VelaBuilt",
    url: VELABUILT_URL,
    email: CONTACT_EMAIL,
    logo: `${SITE_URL}/icon-512.png`,
    sameAs: [INSTAGRAM_URL],
    description: "A creative technology studio that designs and builds premium websites, AI agents, business automation and operational systems such as CRMs and dashboards.",
  },
  about: ["Contractor websites", "3D product configurators", "Lead qualification", "CRM", "Automated follow-up", "Online booking"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${geistMono.variable}`}>
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
