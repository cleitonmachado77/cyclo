const fs = require("fs");
const { Client } = require("pg");

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
  await client.query(`
    update storage.buckets
    set file_size_limit = 52428800
    where id = 'activity-videos'
  `);
  const result = await client.query(`
    select id, file_size_limit from storage.buckets where id = 'activity-videos'
  `);
  console.log(result.rows);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
