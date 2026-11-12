import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Village",
  description: "Your cozy village of AI agents that bring you your work.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f6e7cf",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* Clerk Core 3 with Cache Components: provider goes inside <body>. */}
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
