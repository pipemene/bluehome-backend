import express from 'express';
import bodyParser from 'body-parser';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
async function loadGoogleSheet() {
  await doc.useApiKey(process.env.GOOGLE_SHEET_API_KEY);
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

let userContexts = {};

function resetContext(userId) {
  userContexts[userId] = [];
}

function addToContext(userId, role, content) {
  if (!userContexts[userId]) userContexts[userId] = [];
  userContexts[userId].push({ role, content });
  if (userContexts[userId].length > 20) userContexts[userId].shift(); // limit history
}

app.post('/api/chat', async (req, res) => {
  const { message, user_id } = req.body;
  if (!message || !user_id) return res.status(400).send('Missing params');

  if (message.toLowerCase() === 'test') {
    resetContext(user_id);
    return res.json({ reply: 'Contexto reiniciado. ¿En qué puedo ayudarte hoy?' });
  }

  addToContext(user_id, 'user', message);

  const sheet = await loadGoogleSheet();
  const rows = await sheet.getRows();

  const found = rows.find(row => row.codigo === message.trim());
  if (found && found.ESTADO !== 'no_disponible') {
    const info = `✅ Inmueble encontrado:
- Canon: ${found['valor canon']}
- Habitaciones: ${found['numero habitaciones']}
- Baños: ${found['numero banos']}
- Parqueadero: ${found['parqueadero']}
🎥 Video: ${found['enlace youtube']}`;
    addToContext(user_id, 'assistant', info);
    return res.json({ reply: info });
  }

  const prompt = [
    { role: 'system', content: process.env.BLUEHOME_PROMPT },
    ...userContexts[user_id],
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: prompt,
    });
    const reply = completion.choices[0].message.content;
    addToContext(user_id, 'assistant', reply);
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).send('Error generando respuesta');
  }
});

app.listen(3000, () => console.log('✅ Servidor corriendo en puerto 3000'));