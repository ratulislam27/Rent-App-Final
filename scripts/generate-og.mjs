import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../assets/og-background.png", import.meta.url));
const output = fileURLToPath(new URL("../public/og.png", import.meta.url));

const overlay = Buffer.from(`
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(76 88) scale(.71875)">
    <rect width="64" height="64" rx="14" fill="#f7f8fa" stroke="#dde0e5" stroke-width="1.4"/>
    <path d="M21 46V18.5h12.25c6.5 0 10.75 3.85 10.75 9.75S39.75 38 33.25 38H21M33.5 38 44.5 46.5" fill="none" stroke="#1d2a3d" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="45" cy="18.5" r="1.8" fill="#3478e5"/>
  </g>
  <text x="140" y="122" fill="#17191d" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" letter-spacing="-1.2">Rento</text>
  <text x="76" y="255" fill="#17191d" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" letter-spacing="-2.5">
    <tspan x="76" dy="0">Rental management,</tspan>
    <tspan x="76" dy="66">made clear.</tspan>
  </text>
  <text x="80" y="395" fill="#686d77" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="400">A private mobile workspace for landlords.</text>
  <line x1="80" y1="475" x2="450" y2="475" stroke="#d7dbe1" stroke-width="1"/>
  <text x="80" y="520" fill="#4f5560" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="600" letter-spacing="0.2">PROPERTIES  ·  RENT  ·  EXPENSES  ·  REPORTS</text>
</svg>`);

await sharp(source)
  .resize(1200, 630, { fit: "cover" })
  .composite([{ input: overlay, top: 0, left: 0 }])
  .png({ compressionLevel: 9, palette: true, quality: 92 })
  .toFile(output);

console.log(`Generated ${output}`);
