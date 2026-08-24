import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";

export const metadata: Metadata = {
  title: "VERDICT — Put money behind your version of reality",
  description:
    "VERDICT is a collateralized, evidence-based dispute-resolution platform. Claimants and respondents lock collateral, submit evidence, and receive a verdict grounded in a versioned constitution.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans text-body-md text-on-background antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
