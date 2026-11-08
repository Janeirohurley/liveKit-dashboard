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
  // Emit `.next/standalone`: a self-contained server with only the traced
  // dependencies. The Docker runner stage copies it instead of reinstalling
  // node_modules, which is what keeps the runtime image small.
  output: "standalone",
}

export default nextConfig
