import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible,
  IBM_Plex_Mono,
  Syne,
} from "next/font/google";
import { SiteHeader } from "@/app/components/site-header";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Poke-Binder",
    template: "%s — Poke-Binder",
  },
  description: "Local Pokémon TCG collection",
  icons: {
    icon: [{ url: "/master_ball.png?v=3", type: "image/png" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${atkinson.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
