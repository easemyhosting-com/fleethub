import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FleetHub · Personal fleet inventory",
  description: "Read-only account and resource inventory with Infisical credential references and agent context.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[#09090b] text-[#f4f4f5] antialiased selection:bg-zinc-700 selection:text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
