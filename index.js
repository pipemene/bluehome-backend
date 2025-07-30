import express from 'express';
import cors from 'cors';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { readCSV } from './utils/readCSV.js';
import { handleChat } from './utils/handleChat.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

let conversations = {};

app.post('/api/chat', async (req, res) => {
  const { message, user } = req.body;
  if (!message || !user) return res.status(400).send('Faltan parámetros');

  if (message.trim().toLowerCase() === 'test') {
    conversations[user] = [];
    return res.send({ reply: '¡Conversación reiniciada!' });
  }

  res.send({ reply: 'Procesando...' });

  try {
    const db = await readCSV(process.env.GSHEET_CSV_URL);
    const reply = await handleChat(message, user, conversations, db);
    // Aquí deberías hacer POST a ManyChat webhook con el reply si es necesario
  } catch (e) {
    console.error('Error:', e);
  }
});

app.listen(3000, () => {
  console.log('Servidor iniciado en puerto 3000');
});