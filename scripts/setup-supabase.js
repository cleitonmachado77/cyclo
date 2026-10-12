const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ausente");
  }

  const sqlPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260316143000_tempoops_schema.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    const tables = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('activities', 'activity_videos')
      order by table_name
    `);
    const bucket = await client.query(`
      select id, public, file_size_limit
      from storage.buckets
      where id = 'activity-videos'
    `);
    console.log(JSON.stringify({ tables: tables.rows, bucket: bucket.rows }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
