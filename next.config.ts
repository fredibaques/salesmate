import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "exceljs", "unpdf", "mammoth", "postgres"],
  experimental: {
    serverActions: {
      // Knowledge uploads (spreadsheets, PDFs) go through server actions.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
