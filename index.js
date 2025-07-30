// index.js
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
let sheetData = [];

async function loadSheet() {
  try {
    await doc.useApiKey(process.env.GOOGLE_API_KEY);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    sheetData = rows.map(row => Object.fromEntries(sheet.headerValues.map(key => [key, row[key]])));
  } catch (err) {
    console.error('Error loading sheet:', err);
  }
}

await loadSheet();

const userHistories = {};

function resetUser(userId) {
  userHistories[userId] = [];
}

app.post('/api/chat', async (req, res) => {
  const { message, user_id } = req.body;

  if (!user_id || !message) return res.status(400).json({ error: 'Missing parameters' });

  if (message.toLowerCase().trim() === 'test') {
    resetUser(user_id);
    return res.json({ reply: '✅ Contexto reiniciado exitosamente.' });
  }

  res.status(200).json({ reply: '⏳ Procesando tu solicitud...' });

  const userMessages = userHistories[user_id] || [];

  let extra = '';
  const codeMatch = message.match(/\b\d{1,4}\b/);
  if (codeMatch) {
    const code = codeMatch[0];
    const match = sheetData.find(row => row.codigo === code);
    if (match) {
      if (match.ESTADO?.toLowerCase() === 'no_disponible') {
        extra = `El inmueble con código ${code} no está disponible actualmente. ¿Deseas ver otras opciones?`;
      } else {
        extra = `Información del inmueble con código ${code}:
📍 Dirección: ${match['ENLACE FICHA TECNICA']}
💰 Canon: ${match['valor canon']}
🛏️ Habitaciones: ${match['numero habitaciones']}
🛁 Baños: ${match['numero banos']}
🚗 Parqueadero: ${match['parqueadero']}
🎥 Video: ${match['enlace youtube']}`;
      }
    }
  }

  const history = userMessages.map(m => `Usuario: ${m.user}\nBlueBot: ${m.bot}`).join('\n');
  const prompt = `
Eres BlueBot, asistente oficial de Blue Home Inmobiliaria. Tu rol es responder dudas sobre arriendos, administración de inmuebles y seguros. Solo trabajas con inmuebles desde $600.000 en adelante. Si no sabes algo, indica que lo consultarán con un asesor.

Tarifas de administración: 10.45% + IVA sobre el canon. Seguro de arrendamiento: 2.05% canon (amparo básico) + 12.31% sobre (canon + 1 SMLV) para amparo integral. El estudio es 100% digital y gratis.

Historial:
${history}
Usuario: ${message}
${extra ? '\n' + extra : ''}
BlueBot:`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    });
    const botReply = completion.choices[0].message.content;
    userHistories[user_id] = [...userMessages.slice(-6), { user: message, bot: botReply }];

    await fetch(process.env.MANYCHAT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id,
        message: botReply,
      }),
    });
  } catch (error) {
    console.error('Error con OpenAI:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
