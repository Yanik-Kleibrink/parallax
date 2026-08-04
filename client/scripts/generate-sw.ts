import workboxBuild from "workbox-build";
import type { GenerateSWOptions } from "workbox-build";

const { generateSW } = workboxBuild;

async function buildSW(): Promise<void> {
  try {
    const options: GenerateSWOptions = {
      globDirectory: "build/client",
      globPatterns: [
        "**/*.{js,css,html,svg,png,ico,json,wasm,webmanifest,woff,woff2,tff}",
      ],
      swDest: "build/client/sw.js",
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
    };

    const { count, size, warnings } = await generateSW(options);

    if (warnings.length > 0) {
      console.warn("Workbox Warnings:", warnings);
    }

    console.log(`\n🎉 Service worker updated!`);
    console.log(
      `Precaching ${count} files, totaling ${(size / 1024 / 1024).toFixed(2)} MB.\n`
    );
  } catch (error) {
    console.error("Failed to generate service worker:", error);
    process.exit(1);
  }
}

buildSW();
