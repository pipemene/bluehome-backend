
import express from 'express';
import fetch from 'node-fetch';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let conversations = {};

function resetContext(userId) {
  conversations[userId] = [];
}

app.post('/api/chat', async (req, res) => {
  const { message, userId } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ error: 'userId and message are required' });
  }

  // Reiniciar contexto si se escribe "test"
  if (message.toLowerCase().trim() === 'test') {
    resetContext(userId);
    return res.json({ reply: '✅ Conversación reiniciada. ¿En qué puedo ayudarte?' });
  }

  // Consulta a Google Sheets
  let sheetResponse = null;
  if (!isNaN(message.trim())) {
    try {
      const response = await fetch(process.env.GOOGLE_SHEET_CSV_URL);
      const text = await response.text();
      const rows = text.split('\n').map(row => row.split(','));
      const headers = rows[0];
      const dataRows = rows.slice(1);
      const found = dataRows.find(row => row[0].trim() === message.trim());

      if (found) {
        const estadoIndex = headers.indexOf('ESTADO');
        const tipoIndex = headers.indexOf('tipo');
        const enlaceIndex = headers.indexOf('enlace youtube');
        const canonIndex = headers.indexOf('valor canon');
        const habIndex = headers.indexOf('numero habitaciones');
        const banoIndex = headers.indexOf('numero banos');
        const parqueaderoIndex = headers.indexOf('parqueadero');

        if (found[estadoIndex] && found[estadoIndex].toLowerCase() === 'no_disponible') {
          return res.json({ reply: '🚫 Este inmueble ya no se encuentra disponible.' });
        }

        let info = `🏠 Inmueble disponible:\n`;
        if (found[tipoIndex]) info += `Tipo: ${found[tipoIndex]}\n`;
        if (found[canonIndex]) info += `Canon: ${found[canonIndex]}\n`;
        if (found[habIndex]) info += `Habitaciones: ${found[habIndex]}\n`;
        if (found[banoIndex]) info += `Baños: ${found[banoIndex]}\n`;
        if (found[parqueaderoIndex]) info += `Parqueadero: ${found[parqueaderoIndex]}\n`;
        if (found[enlaceIndex]) info += `Video: ${found[enlaceIndex]}`;

        return res.json({ reply: info });
      }
    } catch (err) {
      console.error('Error con Google Sheets:', err);
    }
  }

  // Agregar mensaje al historial
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: 'user', content: message });

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: process.env.SYSTEM_PROMPT },
        ...conversations[userId],
      ],
    });

    const reply = chatCompletion.choices[0].message.content;
    conversations[userId].push({ role: 'assistant', content: reply });

    res.json({ reply });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor backend corriendo en el puerto 3000');
});
