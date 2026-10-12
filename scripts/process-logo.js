const sharp = require("sharp");
const path = require("path");

const src = path.join(
  process.env.USERPROFILE,
  ".cursor/projects/c-Users-Cleiton-Machado-Desktop-PROJETOS-IA-VC/assets/cyclo-ia-logo-source.png",
);
const outPublic = path.join(process.cwd(), "public", "cyclo-ia-logo.png");
const outIcon = path.join(process.cwd(), "src", "app", "icon.png");

async function main() {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.from(data);

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    // remove near-black background
    if (r < 28 && g < 32 && b < 28) {
      px[i + 3] = 0;
      continue;
    }
    // soft edge for dark teal fringes that are almost black
    if (r < 40 && g < 50 && b < 45 && Math.max(r, g, b) < 55) {
      px[i + 3] = 0;
    }
  }

  const transparent = await sharp(px, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  const trimmed = await sharp(transparent).trim({ threshold: 10 }).png().toBuffer();

  await sharp(trimmed)
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outPublic);

  await sharp(outPublic).resize(256, 256).png().toFile(outIcon);
  console.log("saved", outPublic);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
