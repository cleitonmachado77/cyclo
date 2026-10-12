const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const FIFTY_GB = 50 * 1024 * 1024 * 1024;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { error: updateError } = await supabase.storage.updateBucket("activity-videos", {
    public: true,
    fileSizeLimit: FIFTY_GB,
    allowedMimeTypes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
      "video/mpeg",
      "video/3gpp",
    ],
  });
  if (updateError) throw updateError;
  console.log("bucket limit => 50 GB");

  // Testa se o global liberou acima de 50 MB
  const buf = Buffer.alloc(60 * 1024 * 1024, 1);
  const path = `probe/60mb-${Date.now()}.mp4`;
  const { error } = await supabase.storage.from("activity-videos").upload(path, buf, {
    contentType: "video/mp4",
    upsert: true,
  });

  if (error) {
    console.log("60MB test => FALHOU:", error.message);
    process.exitCode = 1;
  } else {
    console.log("60MB test => OK (limite global liberado)");
    await supabase.storage.from("activity-videos").remove([path]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
