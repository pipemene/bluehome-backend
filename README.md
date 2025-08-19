# BlueHome Backend v12 (PROMPT externo + contexto + simulación)

Esta versión carga un **PROMPT.json** editable (sin tocar código).
- Puedes editar `PROMPT.json` y redeploy.
- También puedes poner `PROMPT_URL` (un JSON alojado) para traerlo remoto.
- Con `PROMPT_AUTO_RELOAD=true`, el servidor recarga el archivo automáticamente si cambia (detecta mtime).
- Endpoints: `GET /api/debug/prompt`, `POST /api/debug/prompt/reload`.

## Variables
```
PORT=3000
SHEETS_CSV_URL=<CSV público>
DEBUG_YT=true

# Persistencia sesiones (opcional)
REDIS_URL=
SESSION_TTL_SECONDS=86400

# PROMPT
PROMPT_FILE=./PROMPT.json
PROMPT_AUTO_RELOAD=true
PROMPT_URL=
```
