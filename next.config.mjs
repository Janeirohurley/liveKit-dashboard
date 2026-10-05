/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors now fail the build. `ignoreBuildErrors` was hiding real problems:
  // it let a component ship while calling a hook with the wrong prop name, and a
  // token form grant the server silently ignored.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
