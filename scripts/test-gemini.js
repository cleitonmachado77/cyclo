const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY ausente no .env.local");
  }

  console.log("Modelo:", model);
  console.log("Chave:", `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);

  const ai = new GoogleGenAI({ apiKey });

  const started = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: "Responda apenas com a palavra: CONECTADO",
  });
  const elapsed = Date.now() - started;

  const text = response.text?.trim() || "";
  console.log("Latência:", `${elapsed}ms`);
  console.log("Resposta:", text);

  if (!text) {
    throw new Error("Resposta vazia da API Gemini");
  }

  console.log("Status: OK");
}

main().catch((error) => {
  console.error("Status: FALHA");
  console.error(error?.message || error);
  if (error?.status) console.error("HTTP status:", error.status);
  if (error?.error) console.error(JSON.stringify(error.error, null, 2));
  process.exit(1);
});
