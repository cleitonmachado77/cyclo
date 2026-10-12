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

  const { data, error } = await supabase
    .from("activities")
    .insert({
      company_id: "912bf6f8-e676-462e-8e9a-f44cf7534b34",
      name: "Cyclo.ia Verify",
      code: "CYCLO-VERIFY-01",
      description: "teste integracao",
      unit: "ciclo",
      status: "DRAFT",
      gemini_prompt: "medir pegar e encaixar",
      gemini_status: "draft",
    })
    .select("id, name, gemini_prompt, gemini_status")
    .single();

  if (error) throw error;
  console.log("created", data);

  const { error: del } = await supabase.from("activities").delete().eq("id", data.id);
  if (del) throw del;
  console.log("deleted ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
