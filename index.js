
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import bodyParser from 'body-parser';
import { config } from 'dotenv';
import { OpenAI } from 'openai';

config();

const app = express();
const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.json());

let chatHistory = {};

function getContextWithPrompt(userId, pregunta) {
  const history = chatHistory[userId] || [];
  const prompt = process.env.PROMPT || "Responde como asistente de Blue Home Inmobiliaria.";
  return [
    { role: 'system', content: prompt },
    ...history,
    { role: 'user', content: pregunta }
  ];
}

app.post('/api/chat', async (req, res) => {
  try {
    const { userId, pregunta } = req.body;
    if (!userId || !pregunta) {
      return res.status(400).json({ error: 'Faltan campos requeridos: userId o pregunta' });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: getContextWithPrompt(userId, pregunta),
    });

    const respuesta = response.choices[0].message.content;

    chatHistory[userId] = [...(chatHistory[userId] || []), { role: 'user', content: pregunta }, { role: 'assistant', content: respuesta }];

    res.json({ respuesta });
  } catch (error) {
    console.error('Error procesando /api/chat', error.message);
    res.status(500).json({ error: 'Error interno en /api/chat' });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});
