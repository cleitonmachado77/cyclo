# Cyclo.ia

Sistema para cronometrar funções operacionais a partir de vídeos, usando **Gemini Agentic Video Understanding**.

## Fluxo

1. Criar atividade
2. Enviar um ou vários vídeos
3. Descrever no prompt os movimentos a reconhecer
4. Analisar com Gemini e visualizar os tempos

## Setup

```bash
npm install
cp .env.example .env.local
# preencha Gemini + Supabase em .env.local
npm run db:setup
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Variáveis

- `GEMINI_API_KEY` / `GEMINI_MODEL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (somente servidor)
- `DATABASE_URL` (somente para `npm run db:setup`)
- `CYCLO_COMPANY_ID` (empresa padrão)

## Esteira de análise

- Upload de vários vídeos
- Processamento **um por vez** (fila)
- Relatório consolidado ao final
- Retenção padrão: `VIDEO_RETENTION_HOURS` (72h)
- Limpeza: `POST /api/cron/cleanup-videos` (header `Authorization: Bearer CRON_SECRET`)
- Preparado para fonte `camera` no futuro
