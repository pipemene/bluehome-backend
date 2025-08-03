import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { GoogleSpreadsheet } from "google-spreadsheet";
import pkg from "openai";
import prompt from "./prompt.js";

dotenv.config();

const { OpenAI } = pkg;
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.json());

const sheetsURL = process.env.GOOGLE_SHEETS_CSV;

async function getSheetData(code) {
  const response = await fetch(sheetsURL);
  const csv = await response.text();
  const lines = csv.split("\n");
  const headers = lines[0].split(",");
  const entries = lines.slice(1).map(line => {
    const data = {};
    line.split(",").forEach((value, index) => {
      data[headers[index]] = value;
    });
    return data;
  });

  return entries.find(row => row.codigo === code && row.ESTADO !== "no_disponible");
}

app.post("/api/chat", async (req, res) => {
  const { message, user } = req.body;

  if (!message) return res.status(400).json({ error: "No message provided" });

  const codeMatch = message.match(/\b\d{1,4}\b/);
  if (codeMatch) {
    const code = codeMatch[0];
    const property = await getSheetData(code);
    if (property) {
      const response = `🏡 Inmueble ${code}:
📍 Dirección: ${property["ENLACE FICHA TECNICA"]}
💰 Canon: ${property["valor canon"]}
🛏️ Habitaciones: ${property["numero habitaciones"]}
🚿 Baños: ${property["numero banos"]}
🚗 Parqueadero: ${property["parqueadero"]}
🎥 Video: ${property["enlace youtube"]}`;
      return res.json({ response });
    } else {
      return res.json({ response: `El inmueble con código ${code} no está disponible actualmente.` });
    }
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "system", content: prompt }, { role: "user", content: message }],
  });

  res.json({ response: completion.choices[0].message.content });
});

app.listen(3000, () => {
  console.log("Servidor iniciado en puerto 3000");
});
