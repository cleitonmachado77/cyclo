# Relatório de Compliance e Privacidade — Cyclo.ia

**Produto:** Cyclo.ia (cronometragem operacional Time & Motion por vídeo)  
**Data do relatório:** 2 de outubro de 2026  
**Escopo:** funcionamento técnico, fluxo de dados, modelos de IA utilizados e evidências documentais de que os dados do cliente **não são usados para treinamento de modelos** (quando as condições comerciais corretas são atendidas)  
**Público-alvo:** áreas de Compliance, Jurídico, Segurança da Informação e TI da empresa cliente  

---

## 1. Sumário executivo

O Cyclo.ia **não é um software de monitoramento contínuo de funcionários**. Não captura tela, não instala agente de desktop, não grava teclado, não escuta áudio do computador e não opera em background no endpoint do colaborador.

O sistema recebe **vídeos operacionais enviados manualmente** (ex.: filmagem de posto de trabalho / linha de produção), analisa movimentos com IA generativa e devolve **tempos e relatório de cronometragem**. O objetivo é medir o processo, não vigiar o colaborador.

Sobre o risco de uso dos dados para treinamento de modelos de terceiros:

| Provedor | Papel no Cyclo.ia | Uso para treinamento (política oficial) | Condição obrigatória |
|----------|-------------------|-----------------------------------------|----------------------|
| **Google Gemini API (pago)** | Análise principal de vídeo | **Não** usa prompts, arquivos (vídeos/imagens) nem respostas para melhorar produtos | Conta com **billing ativo** (Paid Services) |
| **OpenAI API** | Fallback opcional (frames) | **Não** usa inputs/outputs da API para treinar por padrão | Sem opt-in de sharing; idealmente ZDR contratual |
| **Supabase** | Armazenamento de vídeos e resultados | **Não** usa Customer Data para treinar modelos sem consentimento escrito | Conta comercial / ToS vigentes |

**Conclusão para compliance:** o risco de os vídeos industriais serem usados para treinar modelos de Google/OpenAI/Supabase é **contratualmente excluído** no uso pago/API empresarial padrão. Isso **não elimina** o fato de que o conteúdo é **processado temporariamente** por esses provedores para gerar a análise — e exige controles adicionais (conta paga, DPA, retenção, eventual Vertex AI / Zero Data Retention) conforme a política interna da empresa.

---

## 2. O que a ferramenta faz (e o que não faz)

### 2.1 Faz

1. Criação de uma “atividade” de cronometragem (título, descrição, prompt dos movimentos a medir).
2. Upload manual de um ou mais arquivos de vídeo (mp4, webm, mov, etc.).
3. Envio do vídeo + instruções a um modelo de compreensão de vídeo (Gemini Agentic).
4. Extração estruturada de tempos por movimento e relatório consolidado.
5. Retenção configurável do vídeo (padrão **72 horas**) e limpeza automática.

### 2.2 Não faz

- Captura de tela do desktop do funcionário.
- Gravação contínua / agent silencioso no endpoint.
- Keylogging, clipboard monitoring ou similar.
- Envio automático de webcam sem ação do usuário (fonte `camera` está prevista no schema futuro, mas **não implementada** no fluxo atual; hoje só upload `manual`).

Essa distinção é relevante para políticas internas do tipo “proibido IA/monitoramento de colaboradores”: o Cyclo.ia se enquadra como **ferramenta de análise de processo com mídia fornecida**, não como spyware ou RPA de observação contínua.

---

## 3. Arquitetura e fluxo de dados

```
Operador / engenheiro industrial (browser)
        │
        │ 1. Cria atividade + define movimentos a medir
        │ 2. Faz upload do(s) vídeo(s)
        ▼
Supabase Storage (bucket activity-videos)
        │  metadados em Postgres (activity_videos, analysis_*)
        │
        │ 3. Usuário solicita análise
        ▼
Servidor Next.js (Cyclo.ia)
        │  baixa vídeo para disco temporário do servidor
        │
        ├──────────────► Google Gemini Files API
        │                 (upload do vídeo completo)
        │                 + generateContentStream
        │                   MediaProcessing.AGENTIC
        │                 → JSON de tempos / movimentos
        │                 → DELETE do arquivo no Gemini (finally)
        │
        └─ (somente se Gemini falhar e OPENAI_API_KEY existir)
                          OpenAI gpt-4o
                          (frames JPEG extraídos localmente via ffmpeg)
        │
        ▼
Resultados salvos no Postgres da conta Supabase do cliente
(vídeo original expira em VIDEO_RETENTION_HOURS, padrão 72h)
```

### 3.1 Onde cada tipo de dado fica

| Dado | Onde | Duração típica |
|------|------|----------------|
| Arquivo de vídeo | Supabase Storage | Padrão 72h (`VIDEO_RETENTION_HOURS`), depois cron de limpeza |
| Cópia temporária no servidor | `os.tmpdir()` | Só durante a análise; removida no `finally` |
| Cópia no Gemini Files API | Google | Removida explicitamente após análise (`ai.files.delete`) |
| Frames enviados à OpenAI (fallback) | Request HTTP | Não persistidos pelo app; retenção sujeita à política OpenAI |
| Relatório / tempos / JSON da análise | Postgres (Supabase) | Persiste além do vídeo (sem expiração automática no código atual) |

---

## 4. Modelo de IA utilizado — análise técnica

### 4.1 Provedor principal: Google Gemini

| Item | Valor no produto |
|------|------------------|
| SDK | `@google/genai` (`GoogleGenAI`) |
| Modelo padrão | `gemini-3.8-flash` (`GEMINI_MODEL`) |
| Fallbacks | `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash` |
| Modo de mídia | `MediaProcessing.AGENTIC` (Agentic Video Understanding) |
| Entrada | Arquivo de vídeo completo via Files API + prompt de cronometragem |
| Saída | Texto/JSON com movimentos, tempos e observações |

O modo **Agentic** permite ao modelo navegar a timeline do vídeo (explorar frames/segmentos) para reconhecer movimentos operacionais descritos no prompt — não é um modelo treinado pelo Cyclo.ia com os vídeos do cliente.

### 4.2 Provedor de contingência: OpenAI

| Item | Valor no produto |
|------|------------------|
| SDK | `openai` |
| Modelo padrão | `gpt-4o` (`OPENAI_MODEL`) |
| Quando é usado | Somente se a análise Gemini falhar **e** existir `OPENAI_API_KEY` |
| Entrada | Até `OPENAI_MAX_FRAMES` (padrão 24) frames JPEG + prompt |
| Saída | Mesma estrutura de análise (tempos / movimentos) |

Para ambientes com política “zero envio a múltiplos provedores”, o fallback OpenAI pode ser **desabilitado** simplesmente não configurando `OPENAI_API_KEY`.

---

## 5. Evidências oficiais: dados não são usados para treinamento

As afirmações abaixo vêm da **documentação pública vigente dos provedores** (consultada em outubro/2026). Não são alegações do Cyclo.ia — são cláusulas/políticas dos processadores.

### 5.1 Google Gemini API — Paid Services

**Fonte:** [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) (efetivos 23 de março de 2026; página atualizada 28 de abril de 2026).

Trecho relevante (tradução livre + sentido jurídico):

> Quando você usa **Paid Services** (incluindo a cota paga da Gemini API), a Google **não usa** seus prompts (incluindo system instructions, conteúdo em cache e **arquivos como imagens, vídeos ou documentos**) **nem as respostas** para melhorar seus produtos, e processa prompts/respostas conforme o **Data Processing Addendum** (Google como Data Processor).

Complementos oficiais:

- Em **Unpaid Services** (cota gratuita / AI Studio sem billing), a Google **pode** usar o conteúdo para melhorar produtos e tecnologias de ML — **por isso o uso empresarial deve ser estritamente em conta paga**.
- Para Paid Services, a Google pode registrar prompts/respostas por **período limitado**, **somente** para detectar violações da Prohibited Use Policy / obrigações legais — **não para treinar o modelo**.
- Documentação de [Zero Data Retention](https://ai.google.dev/gemini-api/docs/zdr): reforça a restrição de treinamento em Paid Services; para **garantia absoluta de zero retenção** ou DPA enterprise mais rígido, a Google recomenda **Vertex AI** (Gemini Enterprise Agent Platform).
- A própria página de ZDR deixa claro que o **File API** armazena arquivos até exclusão ou expiração; o Cyclo.ia **exclui** esses arquivos após a análise (`ai.files.delete` no bloco `finally`).

**Requisito operacional para a empresa cliente:**

1. Projeto Google Cloud / Gemini API com **billing ativo** (Paid Service).
2. Não usar cota free / AI Studio unpaid para produção.
3. Não ativar sharing voluntário de logs para melhoria de modelo ([Data logging and sharing](https://ai.google.dev/gemini-api/docs/logs-policy)).
4. Avaliar migração para **Vertex AI + ZDR** se a política interna exigir retenção zero no provedor.

### 5.2 OpenAI API (fallback)

**Fontes:**

- [Business data privacy](https://openai.com/business-data/)
- [Data controls / Your data](https://developers.openai.com/api/docs/guides/your-data)
- [Enterprise privacy](https://openai.com/enterprise-privacy/)

Pontos oficiais:

- Por padrão, a OpenAI **não treina** modelos com dados da API Platform (inputs/outputs), salvo **opt-in explícito**.
- Retenção padrão de conteúdo da API para abuse monitoring: tipicamente até **30 dias** (DPA); organizações elegíveis podem solicitar **Zero Data Retention (ZDR)**.
- O endpoint usado pelo Cyclo.ia (`chat.completions` com imagens) é elegível a controles de retenção conforme documentação de data controls.

**Requisito operacional:**

1. Conta API (não ChatGPT consumer free).
2. Confirmar no dashboard que **não** há opt-in de “share data for training”.
3. Se a política interna exigir, solicitar **ZDR** à OpenAI ou **desligar o fallback** no Cyclo.ia.

### 5.3 Supabase (armazenamento)

**Fonte:** [Supabase Terms of Service](https://supabase.com/terms)

> Na medida em que a Supabase utiliza IA para fornecer features, **não usará** Customer Data, AI Input ou AI Output para **treinar, fine-tune ou melhorar** qualquer modelo de IA/ML **sem consentimento prévio por escrito** do cliente.

A Supabase atua como **processador** dos Customer Data (vídeos e metadados da conta do cliente), com DPA disponível: [Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum).

---

## 6. Controles implementados no próprio Cyclo.ia

| Controle | Implementação | Evidência no código |
|----------|---------------|---------------------|
| Exclusão do vídeo no Gemini após análise | `ai.files.delete` no `finally` | `src/lib/gemini.ts` |
| Exclusão de arquivos temporários no servidor | `fs.unlink` no `finally` | `src/lib/gemini.ts` |
| Retenção de vídeo no storage | `VIDEO_RETENTION_HOURS` (default 72) + `expires_at` | `src/lib/pipeline.ts`, `src/lib/store.ts` |
| Limpeza automática | `POST /api/cron/cleanup-videos` | `src/app/api/cron/cleanup-videos/route.ts` |
| Fallback OpenAI opcional | Só se `OPENAI_API_KEY` existir | `src/lib/gemini.ts` |
| Processamento sob demanda | Análise só após ação do usuário | Fluxo `/analyze` |
| Sem treino próprio | Não há pipeline de fine-tuning com vídeos do cliente | Tabelas legadas de training removidas |

---

## 7. Matriz de riscos e mitigação (para o comitê de compliance)

| Risco percebido | Realidade técnica | Mitigação recomendada |
|-----------------|-------------------|------------------------|
| “A IA vai treinar com nossos vídeos” | Em Gemini **pago** e OpenAI **API**, políticas oficiais proíbem uso para treinamento por padrão | Billing pago + sem opt-in de sharing + DPA |
| “Vamos gravar tudo o que o funcionário faz no PC” | Não há captura de desktop; só upload de vídeo de processo | Comunicar escopo; política de filmagem operacional com ciência do colaborador (LGPD) |
| “Dados ficam para sempre na nuvem da IA” | Arquivo Gemini é apagado após análise; logs de abuse monitoring podem existir por período limitado | Conta paga; avaliar Vertex AI / ZDR; desligar OpenAI se necessário |
| “Vídeo industrial vaza publicamente” | Bucket `activity-videos` hoje está marcado como **público** no schema | **Tornar bucket privado** + signed URLs antes do go-live corporativo |
| “Qualquer um acessa as APIs” | App atual não possui autenticação de usuário final nas rotas | Implementar Auth (SSO/SAML) + RLS por empresa |
| “Resultados sensíveis ficam eternamente” | Relatório JSON permanece no Postgres após o vídeo expirar | Política de retenção também para `analysis_*` |
| “IA dentro da empresa” | O modelo **não roda on-prem**; roda nos data centers do provedor (Google/OpenAI) | Decidir: (a) aceitar API paga com DPA, ou (b) exigir deploy privado/Vertex em região contratada, ou (c) não usar |

### Esclarecimento importante sobre “não aceitamos nenhuma IA dentro da empresa”

Se a política for **literalmente zero processamento por modelo de IA** (mesmo como processador contratado), o Cyclo.ia **não atende** sem mudança de arquitetura (ex.: modelo self-hosted on-prem).  

Se a política for **“não queremos que nossos dados treinem modelos de terceiros / não queremos ChatGPT consumer na rede”**, o Cyclo.ia **pode ser compatível**, desde que:

1. Use apenas Gemini API **Paid** (ou Vertex AI).
2. OpenAI desligado ou com ZDR.
3. Controles de acesso, bucket privado e DPA/contratos assinados.
4. Base legal LGPD para filmagem de postos (interesse legítimo / consentimento / obrigação trabalhista — a critério jurídico do cliente).

---

## 8. Recomendações para implantação em ambiente corporativo rígido

### Obrigatórias antes do go-live

1. **Gemini com billing ativo** (Paid Services) — sem isso, a proteção “não treina” **não se aplica**.
2. **Bucket de vídeos privado** + URLs assinadas (corrigir `public: true` atual).
3. **Autenticação corporativa** (SSO) e isolamento por empresa (`CYCLO_COMPANY_ID` / multi-tenant).
4. **Assinar DPA** com Google (e OpenAI/Supabase se usados).
5. **Desabilitar fallback OpenAI** se a política permitir um único processador.
6. Documentar **ciência dos colaboradores** sobre filmagem de posto para cronometragem (LGPD + normas internas).
7. Ativar cron de limpeza com `CRON_SECRET` e retenção alinhada à política do cliente.

### Fortemente recomendadas

8. Migrar análise para **Vertex AI** com Zero Data Retention, se o cliente exigir retenção zero no provedor.
9. Política de retenção também para relatórios estruturados (não só o blob de vídeo).
10. Registro de processamento (ROPA) listando Google/OpenAI/Supabase como operadores/processadores.
11. Região de processamento (data residency) alinhada ao contrato Cloud do cliente.

---

## 9. Fontes oficiais consultadas

| Documento | URL |
|-----------|-----|
| Gemini API Additional Terms | https://ai.google.dev/gemini-api/terms |
| Gemini API Zero Data Retention | https://ai.google.dev/gemini-api/docs/zdr |
| Gemini API Data logging and sharing | https://ai.google.dev/gemini-api/docs/logs-policy |
| Gemini API Pricing (Paid: content not used to improve products) | https://ai.google.dev/gemini-api/docs/pricing |
| OpenAI Business data privacy | https://openai.com/business-data/ |
| OpenAI API data controls | https://developers.openai.com/api/docs/guides/your-data |
| OpenAI Enterprise privacy | https://openai.com/enterprise-privacy/ |
| Supabase Terms of Service | https://supabase.com/terms |
| Supabase DPA | https://supabase.com/legal/customer-resources/data-processing-addendum |

---

## 10. Declaração de limitações deste relatório

- Este documento descreve o comportamento do **código do Cyclo.ia** na data acima e as **políticas públicas** dos provedores na mesma data.
- Políticas de provedores podem mudar; o contrato/DPA assinado prevalece sobre este resumo.
- Este relatório **não constitui parecer jurídico**. A área jurídica do cliente deve validar enquadramento LGPD, bases legais de filmagem e cláusulas contratuais finais.
- Controles ainda pendentes no produto (auth, bucket privado) devem ser tratados como **pré-requisitos de implantação**, não como já garantidos em produção.

---

## 11. Mensagem objetiva para o comitê

> O Cyclo.ia analisa vídeos de processo enviados sob demanda para gerar cronometragem operacional. Não monitora o desktop do funcionário. Com Gemini API em conta **paga**, a Google declara contratualmente que **não usa vídeos, prompts nem respostas para treinar ou melhorar seus modelos**; o OpenAI API e a Supabase possuem compromissos equivalentes por padrão. O vídeo é apagado do provedor de IA após a análise e retido no storage do cliente por prazo curto (padrão 72h). O uso da IA é como **processador contratado**, não como ingestão para treinamento — desde que a implantação siga as condições e controles listados neste relatório.
