
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const MANYCHAT_CUSTOMER_FIELD = process.env.MANYCHAT_CUSTOMER_FIELD || 'usuario';

const PORT = process.env.PORT || 3000;

function cleanNumber(value) {
  if (!value) return null;
  const number = parseInt(value.toString().replace(/[^0-9]/g, ''));
  return isNaN(number) ? null : number;
}

function buildResponseFromRow(row) {
  const enlace = row['enlace youtube']?.trim();
  const ficha = row['ENLACE FICHA TECNICA']?.trim();
  return `🏠 *${row['tipo']?.toUpperCase() || 'INMUEBLE'}*

- Habitaciones: ${row['numero habitaciones']}
- Baños: ${row['numero banos']}
- Parqueadero: ${row['parqueadero']}
- Canon: ${row['valor canon']}

📄 [Ficha técnica](${ficha})
🎥 [Ver video](${enlace})`;
}

async function fetchSheetData() {
  const res = await fetch(GOOGLE_SHEET_URL);
  const csv = await res.text();
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
  return records;
}

function findMatchingRow(records, code) {
  return records.find(r => r.codigo?.toString().trim() === code.toString().trim());
}

function findSuggestions(records, tipo, presupuesto, habitaciones) {
  const disponibles = records.filter(r => (r.ESTADO?.trim().toLowerCase() === 'disponible'));
  return disponibles.filter(r => {
    const canon = cleanNumber(r['valor canon']);
    const tipoOk = r.tipo?.toLowerCase().trim() === tipo.toLowerCase().trim();
    const canonOk = canon && presupuesto >= canon;
    const habOk = !habitaciones || parseInt(r['numero habitaciones']) >= parseInt(habitaciones);
    return tipoOk && canonOk && habOk;
  }).slice(0, 3);
}

async function sendToManyChat(userId, message) {
  try {
    await axios.post('https://api.manychat.com/fb/sending/sendContent', {
      subscriber_id: userId,
      message: { text: message },
    }, {
      headers: {
        Authorization: `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });
  } catch (error) {
    console.error('Error al enviar a ManyChat:', error?.response?.data || error.message);
  }
}

app.post('/api/chat', async (req, res) => {
  const { messages, [MANYCHAT_CUSTOMER_FIELD]: userId } = req.body;

  res.json({ reply: "🔍 Dame un momento mientras consulto la información..." });

  const records = await fetchSheetData();
  const lastMessage = messages[messages.length - 1]?.content || "";
  const possibleCode = lastMessage.match(/\b\d{1,4}\b/);
  const code = possibleCode?.[0];

  if (code) {
    const inmueble = findMatchingRow(records, code);
    const estado = inmueble?.ESTADO?.trim().toLowerCase();
    if (!inmueble || estado !== 'disponible') {
      await sendToManyChat(userId, "Este inmueble ya no se encuentra disponible.");
    } else {
      const respuesta = buildResponseFromRow(inmueble);
      await sendToManyChat(userId, respuesta);
    }
  } else {
    await sendToManyChat(userId, "Por favor, indícame el tipo de inmueble que buscas: *casa*, *apartamento*, *apartaestudio* o *local*.");
  }
});

app.listen(PORT, () => console.log(`Servidor BlueHome funcionando en el puerto ${PORT}`));
