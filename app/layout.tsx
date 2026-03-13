import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ForgeLab",
  description: "Discover endless elements with predefined recipes, Supabase sharing, and OpenAI generation."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
