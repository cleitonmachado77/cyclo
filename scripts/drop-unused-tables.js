const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const sql = fs.readFileSync(
    path.join("supabase", "migrations", "20260316150000_drop_unused_tables.sql"),
    "utf8",
  );
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(sql);

  const tables = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);

  const counts = [];
  for (const row of tables.rows) {
    const exact = await client.query(
      `select count(*)::int as n from public."${row.table_name}"`,
    );
    counts.push({ table: row.table_name, rows: exact.rows[0].n });
  }

  console.log(JSON.stringify(counts, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
