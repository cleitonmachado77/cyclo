const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const configRes = await fetch(`${url}/storage/v1/config`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  console.log("config status", configRes.status);
  console.log("config body", await configRes.text());

  // Try set global limit to 50MB (max free)
  const patchRes = await fetch(`${url}/storage/v1/config`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileSizeLimit: 52428800 }),
  });
  console.log("patch status", patchRes.status);
  console.log("patch body", await patchRes.text());

  const supabase = createClient(url, key);
  const sizes = [1, 5, 20, 45, 51];
  for (const mb of sizes) {
    const buf = Buffer.alloc(mb * 1024 * 1024, 1);
    const path = `probe/size-${mb}mb-${Date.now()}.mp4`;
    const { error } = await supabase.storage.from("activity-videos").upload(path, buf, {
      contentType: "video/mp4",
      upsert: true,
    });
    console.log(`${mb}MB =>`, error ? error.message : "ok");
    if (!error) {
      await supabase.storage.from("activity-videos").remove([path]);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
