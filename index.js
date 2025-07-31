import express from 'express';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import csv from 'csvtojson';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const contextMap = {};

function resetContext(userId) {
  contextMap[userId] = [];
}

app.post('/api/chat', async (req, res) => {
  const { message, userId } = req.body;

  if (!message || !userId) {
    return res.status(400).json({ error: 'Faltan datos en la solicitud.' });
  }

  if (message.trim().toLowerCase() === 'test') {
    resetContext(userId);
    return res.json({ reply: 'Contexto reiniciado correctamente.' });
  }

  const context = contextMap[userId] || [];

  context.push({ role: 'user', content: message });

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: process.env.SYSTEM_PROMPT || 'Eres un asistente útil de una inmobiliaria.' },
      ...context,
    ],
  });

  const reply = response.choices[0].message.content;
  context.push({ role: 'assistant', content: reply });

  contextMap[userId] = context.slice(-10); // mantener solo los últimos 10 mensajes

  res.json({ reply });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en puerto ${port}`);
});
