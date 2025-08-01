import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { OpenAI } from 'openai';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
await doc.useApiKey(process.env.GOOGLE_API_KEY);
await doc.loadInfo();
const sheet = doc.sheetsByIndex[0];

let sessionMemory = {};

app.post("/api/async-chat", async (req, res) => {
  const { pregunta, userId } = req.body;

  res.sendStatus(200); // Respuesta inmediata para evitar timeout en ManyChat

  try {
    if (pregunta.toLowerCase() === "test") {
      sessionMemory[userId] = "";
      return;
    }

    // Leer hoja de Google Sheets
    await sheet.loadCells();

    const rows = await sheet.getRows();
    const matched = rows.find(r => r.codigo?.toLowerCase() === pregunta.toLowerCase());

    let respuestaSheets = "";
    if (matched) {
      if (matched.ESTADO === "no_disponible") {
        respuestaSheets = "Ese inmueble no está disponible en este momento.";
      } else {
        respuestaSheets = `📍 Dirección: ${matched.direccion}
💰 Canon: ${matched["valor canon"]}
🛏️ Habitaciones: ${matched["numero habitaciones"]}
🚽 Baños: ${matched["numero banos"]}
🚗 Parqueadero: ${matched["parqueadero"]}
🎥 Video: ${matched["enlace youtube"]}`;
      }
    }

    const mensaje = respuestaSheets || pregunta;

    if (!sessionMemory[userId]) sessionMemory[userId] = "";
    sessionMemory[userId] += `Usuario: ${pregunta}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: process.env.BLUEHOME_PROMPT },
        { role: "user", content: sessionMemory[userId] + `Asistente:` },
      ],
    });

    const respuesta = completion.choices[0].message.content.trim();
    sessionMemory[userId] += `Asistente: ${respuesta}
`;

    await fetch(process.env.MANYCHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MANYCHAT_TOKEN}`,
      },
      body: JSON.stringify({
        user_id: userId,
        message: { text: respuesta },
      }),
    });
  } catch (error) {
    console.error(error);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor corriendo");
});