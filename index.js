import express from 'express';
import { config } from 'dotenv';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import axios from 'axios';
import fs from 'fs';
import tmp from 'tmp';
import { GoogleSpreadsheet } from 'google-spreadsheet';

config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const contextMap = {}; // Memoria simple por sesión (idUsuario)

app.post('/api/chat', async (req, res) => {
  try {
    const { pregunta, audioUrl, userId = 'anon' } = req.body;
    let textoPregunta = pregunta;

    if (audioUrl) {
      const response = await axios.get(audioUrl, { responseType: 'stream' });
      const tmpFile = tmp.fileSync({ postfix: '.mp3' });
      const writer = fs.createWriteStream(tmpFile.name);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile.name),
        model: 'whisper-1'
      });
      textoPregunta = transcription.text;
    }

    if (!textoPregunta) {
      return res.status(400).json({ error: 'No se recibió pregunta ni audio' });
    }

    // Construir historial
    const historial = contextMap[userId] || [];

    historial.push({ role: 'user', content: textoPregunta });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Eres asesor de Blue Home Inmobiliaria, responde con claridad en español' },
        ...historial
      ]
    });

    const respuesta = completion.choices[0]?.message?.content || 'Sin respuesta';
    historial.push({ role: 'assistant', content: respuesta });

    // Guardar historial de nuevo
    contextMap[userId] = historial.slice(-10); // mantener últimas 10 interacciones

    res.json({ pregunta: textoPregunta, respuesta });

  } catch (err) {
    console.error('Error en /api/chat:', err.message);
    res.status(500).json({ error: 'Error procesando la solicitud', detalle: err.message });
  }
});

// Test conexión con Google Sheets
app.get('/api/test-sheets', async (req, res) => {
  try {
    const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
    await doc.useApiKey(process.env.SHEETS_API_KEY);
    await doc.loadInfo();
    res.json({ sheetTitle: doc.title });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo conectar con Google Sheets', detalle: err.message });
  }
});

// Test conexión con API de Simi
app.get('/api/test-simi', async (req, res) => {
  try {
    const simiUrl = process.env.SIMI_API_URL;
    const token = process.env.SIMI_TOKEN;
    const response = await axios.get(simiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json({ status: 'OK', data: response.data });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo conectar a Simi CRM', detalle: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});