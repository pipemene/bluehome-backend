# BlueHome — Prompt update (friendly costos)

Este ZIP trae **solo** la actualización de textos para costos en `PROMPT.json`.
Úsalo sobre tu backend v12.8.16 (o superior) sin tocar nada de lógica.

## Opción A — Reemplazar directamente en PROMPT.json
1) Abre tu `PROMPT.json` del backend.
2) Asegúrate de tener un objeto `messages` (si ya existe, mantenlo).
3) Copia la clave **admin_chunk_costos** de `PROMPT_delta.json` y pégala dentro de `messages`,
   reemplazando la que tengas.

## Opción B — Sobrescribir con línea de comando (si trabajas local)
- Fusiona el campo `messages.admin_chunk_costos` con tu `PROMPT.json`.

## Texto nuevo
Está en `PROMPT_delta.json`.

> No modifica Google Sheets, intents ni endpoints. Solo cambia la redacción para que sea más amable y explicativa.

