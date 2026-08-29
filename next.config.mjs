/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        // Projeto de DEV
        protocol: "https",
        hostname: "nrjbkcniuyvdailmqcta.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        // Projeto de PRODUÇÃO
        protocol: "https",
        hostname: "qarydpctwdzsagwmtady.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
