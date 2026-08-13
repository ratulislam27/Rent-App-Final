import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../public/favicon-v3.svg", import.meta.url));
const outputs = [
  [192, fileURLToPath(new URL("../public/icon-192-v3.png", import.meta.url))],
  [512, fileURLToPath(new URL("../public/icon-512-v3.png", import.meta.url))],
  [180, fileURLToPath(new URL("../public/apple-touch-icon-v3.png", import.meta.url))],
];

await Promise.all(outputs.map(([size, destination]) => sharp(source).resize(size, size).png().toFile(destination)));
console.log("Generated Rento PWA icons.");
