import express from 'express';
import { config } from 'dotenv';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import tmp from 'tmp';

config(); // cargar .env

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post('/api/chat', async (req, res) => {
  try {
    let pregunta = req.body.pregunta;
    const audioUrl = req.body.audioUrl;

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

      pregunta = transcription.text;
    }

    if (!pregunta) {
      return res.status(400).json({ error: 'No se encontró pregunta ni audio' });
    }

    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Eres un asistente de una inmobiliaria en Palmira. Responde claro y directo.' },
        { role: 'user', content: pregunta }
      ],
      model: 'gpt-4o'
    });

    const respuesta = completion.choices[0]?.message?.content || 'Sin respuesta';
    res.json({ respuesta, pregunta });

  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Error procesando audio o generando respuesta', detalle: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});