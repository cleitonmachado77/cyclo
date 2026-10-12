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

  const tables = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  console.log("TABLES", tables.rows.map((r) => r.table_name));

  for (const { table_name } of tables.rows) {
    const cols = await client.query(
      `
      select column_name, data_type, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position
    `,
      [table_name],
    );
    console.log(`\n## ${table_name}`);
    for (const col of cols.rows) {
      console.log(
        `  - ${col.column_name}: ${col.data_type}${col.udt_name && col.data_type === "USER-DEFINED" ? `(${col.udt_name})` : ""} nullable=${col.is_nullable}`,
      );
    }
  }

  const enums = await client.query(`
    select t.typname, e.enumlabel
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder
  `);
  console.log("\nENUMS");
  console.log(enums.rows);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
