
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import csv from 'csv-parser';
import { Readable } from 'stream';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

// Historial de mensajes por usuario
const historial = {};

const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTe5bAfaAIJDsDj6Hgz43yQ7gQ9TSm77Pp-g-3zBby_PuCknOfOta_3KsQX0-ofmG7hY6zDcxU3qBcS/pub?gid=0&single=true&output=csv';

async function consultarInmueblePorCodigo(codigoBuscado) {
  try {
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    const csvText = await response.text();
    const rows = [];
    const readable = Readable.from([csvText]);
    await new Promise((resolve, reject) => {
      readable
        .pipe(csv())
        .on('data', (data) => rows.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    const encontrado = rows.find(row => row.Codigo === codigoBuscado);
    if (encontrado) {
      return `📌 Información del inmueble ${codigoBuscado}:

🏠 Habitaciones: ${encontrado.Habitaciones}
🛁 Baños: ${encontrado.Baños}
💰 Valor: ${encontrado.Valor}
🎥 Video: ${encontrado.YouTube}`;
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  const codigoMatch = pregunta.match(/\b\d{3,}\b/);
  if (codigoMatch) {
    const info = await consultarInmueblePorCodigo(codigoMatch[0]);
    if (info) {
      return res.json({ respuesta: info });
    }
  }

  const userHistorial = historial[userId] || [];
  userHistorial.push({ role: "user", content: pregunta });

  const mensajes = [
    { role: "system", content: prompt },
    ...userHistorial
  ];

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: mensajes
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    userHistorial.push({ role: "assistant", content: respuesta });
    historial[userId] = userHistorial;
    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
