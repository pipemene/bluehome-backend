import express from "express";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const HISTORY = {};

const sendReply = async (apiKey, subscriberId, message) => {
  try {
    const res = await fetch("https://api.manychat.com/fb/sending/sendContent", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        message: { text: message },
      }),
    });
    const data = await res.json();
    console.log("✅ Respuesta enviada a ManyChat:", data);
  } catch (err) {
    console.error("❌ Error enviando respuesta a ManyChat:", err);
  }
};

app.post("/api/chat", async (req, res) => {
  res.sendStatus(200);
  console.log("🔹 Entrada recibida en /api/chat");

  const { message, subscriberId, name } = req.body;

  if (!HISTORY[name]) HISTORY[name] = [];
  if (message.toLowerCase() === "test") {
    HISTORY[name] = [];
    await sendReply(process.env.MANYCHAT_API_KEY, subscriberId, "🌀 Contexto reiniciado.");
    return;
  }

  HISTORY[name].push({ role: "user", content: message });
  if (HISTORY[name].length > 10) HISTORY[name] = HISTORY[name].slice(-10);

  const promptSistema = process.env.SYSTEM_PROMPT || "Eres un asistente de Blue Home Inmobiliaria. Responde breve y útil.";

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: promptSistema },
        ...HISTORY[name],
      ],
    });

    const respuestaFinal = chatCompletion.choices[0].message.content;
    HISTORY[name].push({ role: "assistant", content: respuestaFinal });

    await sendReply(process.env.MANYCHAT_API_KEY, subscriberId, respuestaFinal);
  } catch (error) {
    console.error("❌ Error en OpenAI:", error);
    await sendReply(process.env.MANYCHAT_API_KEY, subscriberId, "❌ Hubo un error al generar la respuesta.");
  }
});

app.get("/", (req, res) => {
  res.send("Backend Blue Home Inmobiliaria activo.");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});