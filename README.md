# BlueHome Backend v11 (MarianAI: contexto + intents + simulación de canon)

- Mantiene contexto por contacto (Redis opcional).
- Intents: saludo, quiénes somos, horarios, ubicación, servicios, financiación, hablar con asesor, vender inmueble (mini-form), habeas data, ver inmuebles (código/filtros).
- **Simulación automática** cuando el mensaje menciona "canon" y un valor: 
  - Administración: 10.5% + IVA (10.5% * 1.19)
  - Amparo básico: 2.05%
  - Primer mes: Amparo integral 12.31% sobre (canon + SMMLV). SMMLV=1,423,500 por defecto (configurable).
- Personaliza respuestas con el nombre del usuario si viene desde ManyChat.

Endpoints:
- POST /api/chat  → { "respuesta": "..." } (compatible ManyChat)
- GET /api/property?code=1135
- POST /api/search  (tipo/presupuesto/habitaciones)
- Debug: /api/debug/env, /api/debug/raw?refresh=1, /api/debug/codes, /api/debug/peek?code=1135, /health
