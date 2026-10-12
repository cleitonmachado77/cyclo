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

  const companies = await client.query(`select id, name, code, status from companies limit 10`);
  console.log("companies", companies.rows);

  const activities = await client.query(`select id, name, code, status, company_id from activities limit 5`);
  console.log("activities sample", activities.rows);

  const videos = await client.query(`select count(*)::int as n from activity_videos`);
  console.log("activity_videos count", videos.rows[0]);

  const fks = await client.query(`
    select
      tc.table_name, kcu.column_name, ccu.table_name as foreign_table, ccu.column_name as foreign_column
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_name in ('activity_videos', 'activities')
  `);
  console.log("fks", fks.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
