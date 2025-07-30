
import express from 'express';
import bodyParser from 'body-parser';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const contextHistory = new Map();

function resetContextForUser(userId) {
  contextHistory.set(userId, []);
}

app.post('/api/chat', async (req, res) => {
  const { message, user_id } = req.body;

  if (!message || !user_id) {
    return res.status(400).json({ error: 'Missing message or user_id' });
  }

  if (message.trim().toLowerCase() === "test") {
    resetContextForUser(user_id);
    return res.status(200).json({ message: "Se reinició el contexto de la conversación." });
  }

  res.status(200).json({ message: "Procesando tu solicitud..." });

  try {
    const history = contextHistory.get(user_id) || [];
    history.push({ role: 'user', content: message });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: "system", content: "Eres el asistente de Blue Home Inmobiliaria..." },
        ...history,
      ],
    });

    const reply = completion.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
    contextHistory.set(user_id, history);

    await fetch(process.env.MANYCHAT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, message: reply })
    });

  } catch (error) {
    console.error("Error en el backend:", error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
