const fs = require("fs");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const buckets = await client.query(`
    select id, name, public, file_size_limit, allowed_mime_types
    from storage.buckets
    order by id
  `);
  console.log("buckets", buckets.rows);
  await client.end();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Probe with a tiny upload
  const tiny = Buffer.from("test");
  const { error: tinyError } = await supabase.storage
    .from("activity-videos")
    .upload(`probe/tiny-${Date.now()}.txt`, tiny, { contentType: "text/plain", upsert: true });
  console.log("tiny upload", tinyError ? tinyError.message : "ok");

  // Probe ~51MB to see if 50MB hard limit applies
  const big = Buffer.alloc(51 * 1024 * 1024, 1);
  const { error: bigError } = await supabase.storage
    .from("activity-videos")
    .upload(`probe/big-${Date.now()}.bin`, big, {
      contentType: "application/octet-stream",
      upsert: true,
    });
  console.log("51MB upload", bigError ? bigError.message : "ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
