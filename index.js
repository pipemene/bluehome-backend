import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { GoogleAuth } from 'google-auth-library';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Inicializa OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Función para enviar mensaje a ManyChat
async function sendToManyChat(userId, message) {
  await fetch(\`https://api.manychat.com/fb/sendContent\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.MANYCHAT_API_KEY}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subscriber_id: userId,
      data: { version: 'v2', content: { messages: [{ type: 'text', text: message }] } }
    })
  });
}

// Procesamiento asincrónico
async function processMessage(userId, message) {
  try {
    if (message.trim().toLowerCase() === 'test') {
      await sendToManyChat(userId, 'Contexto reiniciado.');
      return;
    }

    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: process.env.BLUEHOME_PROMPT },
        { role: "user", content: message }
      ]
    });

    const responseText = chatResponse.choices[0].message.content;
    await sendToManyChat(userId, responseText);
  } catch (error) {
    console.error(error);
    await sendToManyChat(userId, 'Hubo un error procesando tu solicitud. Intenta nuevamente.');
  }
}

// Endpoint principal asincrónico
app.post('/api/async-chat', async (req, res) => {
  const { userId, message } = req.body;

  // Responde inmediatamente a Railway/ManyChat
  res.status(200).json({ status: 'ok', message: 'Procesando' });

  // Procesa en segundo plano
  processMessage(userId, message);
});

app.get('/', (req, res) => {
  res.send('Backend Blue Home corriendo correctamente.');
});

app.listen(PORT, () => {
  console.log(\`Servidor corriendo en puerto \${PORT}\`);
});