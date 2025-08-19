# Blue Home Backend (v12.8.16 - MenuFix Full)

Backend Express listo para Railway con:
- Menús **numerados en el texto** (WhatsApp-friendly).
- **Simulación de canon** (admin + amparos; SMMLV 1.423.500).
- Flujo **seguros** (prefacio + ejemplos) antes de costos.
- Lookup de inmuebles por código desde **CSV publicado** (`SHEETS_CSV_URL`).
- Endpoints de debug: `/health`, `/api/debug/prompt`, `/api/debug/prompt/reload`, `/api/debug/llm`, `/api/debug/menu/admin|entry`.

## Variables de entorno
- `PORT` (opcional)
- `SHEETS_CSV_URL` → URL pública del CSV de Google Sheets (Archivo → Compartir → Publicar en la web → CSV).

## Despliegue
```bash
npm i
npm start
```
En Railway: crea servicio Node, sube ZIP, configura `SHEETS_CSV_URL`.

## Pruebas
- `GET /health` → `{ok:true}`
- `GET /api/debug/menu/admin` → verás el menú numerado en `messages[0].text`
- `POST /api/chat` body:
```json
{ "session":"test", "name":"Pipe", "text":"quiero que administren mi inmueble" }
```
Luego: `1`, `2`, `3` o `4` / “simular 2000000” / “costos” / “ver ejemplos”.

> Nota: Si ya tienes una integración diferente de Google Sheets, puedes ignorar `SHEETS_CSV_URL` y adaptar `/api/property`.