import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
let sheetData = [];

async function loadSheetData() {
  try {
    await doc.useApiKey(process.env.GOOGLE_API_KEY);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    sheetData = rows.map(row => row._rawData);
  } catch (err) {
    console.error('Error loading Google Sheet:', err);
  }
}
await loadSheetData();

const userContexts = {};

function resetContext(name) {
  userContexts[name] = [];
}

function getContext(name) {
  return userContexts[name] || [];
}

function addToContext(name, role, content) {
  if (!userContexts[name]) userContexts[name] = [];
  userContexts[name].push({ role, content });
  if (userContexts[name].length > 10) userContexts[name].shift();
}

app.post('/api/chat', async (req, res) => {
  const { message, name } = req.body;

  res.status(200).send({ status: 'Procesando...' });

  if (!name || !message) return;

  if (message.trim().toLowerCase() === 'test') {
    resetContext(name);
    return;
  }

  const match = message.match(/^\d{1,4}$/);
  if (match) {
    const code = match[0];
    const headers = sheetData[0];
    const idx = sheetData.findIndex(r => r[0] === code && r[headers.indexOf('ESTADO')] === 'disponible');
    if (idx !== -1) {
      const row = sheetData[idx];
      const response = `🏡 Inmueble ${code} disponible:
- Habitaciones: ${row[headers.indexOf('numero habitaciones')]}
- Baños: ${row[headers.indexOf('numero banos')]}
- Parqueadero: ${row[headers.indexOf('parqueadero')]}
- Valor: ${row[headers.indexOf('valor canon')]}
🎥 Video: ${row[headers.indexOf('enlace youtube')]}`;
      return await fetch(process.env.MANYCHAT_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: response, name }),
      });
    }
  }

  addToContext(name, 'user', message);
  const context = getContext(name);
  const systemPrompt = { role: 'system', content: process.env.BLUEHOME_PROMPT };
  const messages = [systemPrompt, ...context];

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
    });

    const reply = chatCompletion.choices[0].message.content;
    addToContext(name, 'assistant', reply);

    await fetch(process.env.MANYCHAT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: reply, name }),
    });
  } catch (error) {
    console.error(error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
