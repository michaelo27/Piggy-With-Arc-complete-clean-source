import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import Providers from "@/components/Providers";

import "./globals.css";

/**
 * Inter is fetched and self-hosted by next/font at build time, so the running
 * app never depends on a third-party CDN at request time. `--font-inter` is
 * wired into tailwind.config.ts -> theme.extend.fontFamily.sans.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const TITLE = "Piggy With Arc — Save with purpose. Grow together.";
const DESCRIPTION =
  "Save USDC toward optional goals, top up any active jar, and unlock principal at the target or maturity. Multi-jar rewards, bonuses, and points on Arc Mainnet.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Piggy With Arc",
  keywords: [
    "Arc",
    "Arc Mainnet",
    "USDC",
    "savings",
    "piggy savings",
    "savings goals",
    "time lock",
    "stablecoin",
    "Circle",
    "Web3",
    "dApp",
  ],
  authors: [{ name: "Piggy With Arc" }],
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Piggy With Arc",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0F1E",
  width: "device-width",
  initialScale: 1,
};

const THEME_BOOTSTRAP = `
  try {
    const stored = localStorage.getItem("piggy-with-arc:theme");
    const dark = stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (_) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="app-bg min-h-screen bg-[#f4f9fc] font-sans text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
