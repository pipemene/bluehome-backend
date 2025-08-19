# Blue Home Backend v12.7 (Full)
Actualizado: 2025-08-19T04:01:32.273843Z

## Qué hace
- Mantiene contexto por contacto (opcional Redis).
- Lee catálogo desde **Google Sheets en CSV** (no se toca tu integración).
- Intenciones principales:
  - **Administración**: explica por qué dejar el inmueble con Blue Home (QR→chat 24/7 con ficha+video 4K, estudio gratis digital 24/7, Oficina Virtual, operación fuerte y disponibilidad Lun-Dom excepto festivos) + **comisión 10.5% + IVA**.
  - **Cuánto cobran / comisión / tarifa**: explica fórmula. Si detecta un valor de canon → **simula**.
  - **Simular**: con número → simula; sin número → pide canon.
  - **Código de inmueble**: consulta el Google Sheets y retorna ficha + video si hay.
  - **Búsqueda por filtros**: tipo → presupuesto → habitaciones.

## Variables de entorno
Crea en Railway las envs de `.env.example` (copiar/pegar):
```
PORT=3000
SHEETS_CSV_URL=<TU_CSV_PUBLICO_output=csv>
DEBUG_YT=true
PROMPT_FILE=./PROMPT.json
PROMPT_AUTO_RELOAD=true
# Opcional:
# REDIS_URL=rediss://...
# SESSION_TTL_SECONDS=86400
# PROMPT_URL=https://...
```

## Endpoints
- `POST /api/chat`  → body recomendado desde ManyChat:
  ```json
  { "userId": "{{contact.id}}", "pregunta": "{{last_input_text}}", "user_name": "{{contact.name}}" }
  ```
  Responde: `{ "respuesta": "..." }`

- `GET /api/property?code=1135` → consulta por código.
- `POST /api/search` → filtros (tipo/presupuesto/habitaciones).
- `GET /api/debug/prompt` → ver prompt cargado.
- `POST /api/debug/prompt/reload` → recargar prompt.
- `GET /api/debug/env` → ver configuración activa.
- `GET /api/debug/codes` / `GET /api/debug/peek?code=...` → depuración de catálogo.
- `GET /health` → ping.

## Despliegue en Railway
1. Crear nuevo servicio **Node.js** y subir este ZIP.
2. Configurar variables de entorno (arriba).
3. Deploy.
4. Probar:
   - `GET /health` debe devolver `{"ok":true}`.
   - `GET /api/debug/prompt` muestra el JSON con tu pitch + comisión.
   - En ManyChat, la **Solicitud externa** a `/api/chat` y mapea `respuesta` → variable que envías de vuelta en el mensaje.
