import express from 'express';
import { config } from 'dotenv';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';

config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Memoria temporal por usuario
const contextMap = {}; // userId -> historial de mensajes

app.post('/api/chat', async (req, res) => {
  try {
    const { pregunta, userId = 'anon' } = req.body;

    if (!pregunta) return res.status(400).json({ error: 'No hay pregunta' });

    if (!contextMap[userId]) {
      contextMap[userId] = [
        {
          role: 'system',
          content:
            process.env.SYSTEM_PROMPT ||
            'Eres asesor de Blue Home Inmobiliaria. Siempre responde en español con claridad.',
        },
      ];
    }

    contextMap[userId].push({ role: 'user', content: pregunta });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: contextMap[userId],
    });

    const respuesta = completion.choices[0]?.message?.content || 'Sin respuesta';
    contextMap[userId].push({ role: 'assistant', content: respuesta });

    if (contextMap[userId].length > 20) {
      contextMap[userId] = contextMap[userId].slice(-20);
    }

    res.json({ respuesta });
  } catch (err) {
    console.error('Error en /api/chat:', err.message);
    res.status(500).json({ error: 'Error procesando la solicitud', detalle: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});