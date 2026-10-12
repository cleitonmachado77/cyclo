const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const sql = fs.readFileSync(
    path.join("supabase", "migrations", "20260316144500_tempoops_integrate_existing.sql"),
    "utf8",
  );
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(sql);
  const cols = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema='public' and table_name='activities'
      and column_name like 'gemini%'
    order by column_name
  `);
  console.log(cols.rows);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
