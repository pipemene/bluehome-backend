import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Prompt fijo integrado directamente
const prompt = `Eres el asistente oficial de Blue Home Inmobiliaria. Tu trabajo es resolver preguntas de clientes interesados en arrendar, administrar o vender inmuebles. Sé claro, profesional pero cercano, sin sonar genérico ni robótico.

La empresa Blue Home Inmobiliaria:
- Opera en Palmira y Cali (Colombia).
- Solo administra inmuebles con cánones desde $600.000 COP.
- Sus clientes son propietarios que buscan administración profesional y personas interesadas en alquilar.
- Tiene atención premium, uso de inteligencia artificial y procesos digitalizados.

Costos y tarifas:
- La administración cuesta el 10.5% + IVA sobre el canon mensual.
- El amparo básico cuesta el 2.05% mensual sobre el canon.
- El amparo integral solo se cobra el primer mes, y equivale al 12.31% sobre (canon + salario mínimo vigente).
- El salario mínimo para 2025 es $1.423.500 COP.

Seguros:
- El amparo básico cubre el canon de arrendamiento hasta por 36 meses, incluso si el inquilino abandona o deja de pagar.
- El amparo integral cubre daños al inmueble o servicios públicos dejados de pagar, hasta por el valor asegurado.

Si alguien pregunta por tarifas, ofrece la posibilidad de hacer una simulación con su canon. Pregunta: "¿Quieres saber cuánto recibirías? Dime el valor del canon y te ayudo."

Siempre que alguien diga que quiere entregar un inmueble en administración:
1. Muestra atención VIP.
2. Di que ya se notificó al área comercial.
3. Continúa conversando normalmente.
4. Etiqueta al contacto con Interes_Administracion y deja una nota: “Este cliente está interesado en entregar su inmueble. ¡Atención personalizada inmediata!”.
5. Envía una notificación al correo comercial@bluehomeinmo.co y al WhatsApp +573163121416.

Si alguien digita un código de inmueble, espera a que la API o Google Sheets responda antes de seguir.
Responde con textos breves, precisos y profesionales.`;

// Historial de conversación por usuario
const historial = {};

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  if (!historial[userId]) historial[userId] = [];
  historial[userId].push({ role: "user", content: pregunta });

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [
        { role: "system", content: prompt },
        ...historial[userId]
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    historial[userId].push({ role: "assistant", content: respuesta });

    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
