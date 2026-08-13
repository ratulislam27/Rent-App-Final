import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../assets/og-background.png", import.meta.url));
const output = fileURLToPath(new URL("../public/og.png", import.meta.url));

const overlay = Buffer.from(`
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect x="76" y="88" width="46" height="46" rx="9" fill="#1265e8"/>
  <path d="M89 119V103h20v16M95 119v-10h8v10M86 119h26" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="140" y="122" fill="#17191d" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" letter-spacing="-1.2">Rentwise</text>
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
