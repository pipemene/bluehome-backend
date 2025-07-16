import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import multer from "multer";
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";

dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.json());

const sessions = {};
const upload = multer({ dest: "uploads/" });

app.post("/api/chat", async (req, res) => {
  try {
    const { pregunta, session_id = "default" } = req.body;

    if (!sessions[session_id]) {
      sessions[session_id] = [
        {
          role: "system",
          content:
            "Eres Blue, el asistente virtual de Blue Home Inmobiliaria. Tu labor es responder profesionalmente pero de forma cercana sobre arriendos, contratos de mandato, tarifas, códigos de inmuebles y más. Estás conectado a Google Sheets y a una API inmobiliaria.",
        },
      ];
    }

    sessions[session_id].push({ role: "user", content: pregunta });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: sessions[session_id],
    });

    const respuesta = completion.choices[0].message.content;
    sessions[session_id].push({ role: "assistant", content: respuesta });

    res.json({ respuesta });
  } catch (err) {
    console.error("Error en /api/chat:", err.message);
    res.status(500).json({ error: "Fallo al generar respuesta" });
  }
});

app.post("/api/audio", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file.path),
      model: "whisper-1",
    });
    fs.unlinkSync(file.path);
    res.json({ texto: transcription.text });
  } catch (err) {
    console.error("Error en /api/audio:", err.message);
    res.status(500).json({ error: "Fallo al procesar audio" });
  }
});

app.get("/api/sheet", async (req, res) => {
  try {
    const sheetUrl = process.env.GOOGLE_SHEET_URL;
    const response = await axios.get(sheetUrl);
    res.send(response.data);
  } catch (err) {
    console.error("Error en /api/sheet:", err.message);
    res.status(500).json({ error: "Fallo al consultar hoja" });
  }
});

app.get("/api/simi/:codigo", async (req, res) => {
  try {
    const token = process.env.SIMI_TOKEN;
    const { codigo } = req.params;
    const simiURL = `https://www.simi-api.com/inmueble/${codigo}?token=${token}`;
    const simiRes = await axios.get(simiURL);
    res.json(simiRes.data);
  } catch (err) {
    console.error("Error en /api/simi:", err.message);
    res.status(500).json({ error: "Fallo al consultar SIMI" });
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor activo en http://localhost:${port}`);
});