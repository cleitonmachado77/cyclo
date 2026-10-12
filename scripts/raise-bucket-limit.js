const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // 500 MB no bucket (abaixo do teto Pro de 500 GB)
  const { data, error } = await supabase.storage.updateBucket("activity-videos", {
    public: true,
    fileSizeLimit: 524288000,
    allowedMimeTypes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
      "video/mpeg",
      "video/3gpp",
    ],
  });

  if (error) throw error;
  console.log("bucket updated", data);

  const { data: buckets } = await supabase.storage.listBuckets();
  console.log(
    buckets?.find((b) => b.id === "activity-videos") ||
      buckets?.find((b) => b.name === "activity-videos"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
