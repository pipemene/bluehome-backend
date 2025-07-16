
import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import fs from "fs";
import { google } from "googleapis";
import { OpenAI } from "openai";
import axios from "axios";

const app = express();
const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({ dest: "uploads/" });

app.use(bodyParser.json());

const sessions = {};

app.post("/api/chat", async (req, res) => {
  const { message, session_id } = req.body;
  if (!message || !session_id) return res.status(400).send("Missing fields");

  const PROMPT = process.env.PROMPT || "Eres Blue, el asistente virtual de Blue Home Inmobiliaria...";

  if (!sessions[session_id]) {
    sessions[session_id] = [{ role: "system", content: PROMPT }];
  }

  sessions[session_id].push({ role: "user", content: message });

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: sessions[session_id],
  });

  const reply = completion.choices[0].message.content;
  sessions[session_id].push({ role: "assistant", content: reply });

  res.json({ reply });
});

// API para consultar Google Sheets
app.get("/api/sheet", async (req, res) => {
  const sheets = google.sheets("v4");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const client = await auth.getClient();
  const response = await sheets.spreadsheets.values.get({
    auth: client,
    spreadsheetId: process.env.SHEET_ID,
    range: "Hoja1",
  });

  res.json(response.data);
});

// API para consultar Simi por código
app.get("/api/simi/:code", async (req, res) => {
  const code = req.params.code;
  try {
    const simiUrl = `${process.env.SIMI_API_URL}/inmuebles/${code}`;
    const response = await axios.get(simiUrl, {
      headers: {
        Authorization: `Bearer ${process.env.SIMI_API_TOKEN}`,
      },
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "No se pudo obtener información del inmueble" });
  }
});

app.listen(port, () => {
  console.log(`Servidor iniciado en el puerto ${port}`);
});
