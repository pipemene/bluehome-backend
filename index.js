import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.json());

// Historial de sesiones por usuario
const sessions = {};

app.post("/api/chat", async (req, res) => {
  try {
    const { pregunta, session_id = "default" } = req.body;

    if (!sessions[session_id]) {
      sessions[session_id] = [
        {
          role: "system",
          content:
            "Eres Blue, el asistente virtual de Blue Home Inmobiliaria. Respondes de forma profesional pero cercana. Puedes consultar inmuebles disponibles, explicar cómo funciona el proceso de arrendamiento, qué requisitos existen, cómo son los contratos de mandato, etc. Si el usuario te da un código de letrero, puedes buscarlo. Siempre responde con claridad y enfócate en lo que el usuario necesita.",
        },
      ];
    }

    sessions[session_id].push({ role: "user", content: pregunta });

    const respuestaIA = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: sessions[session_id],
    });

    const respuestaTexto = respuestaIA.choices[0].message.content;
    sessions[session_id].push({ role: "assistant", content: respuestaTexto });

    res.json({ respuesta: respuestaTexto });
  } catch (error) {
    console.error("Error generando respuesta:", error.message);
    res.status(500).json({ error: "Error generando respuesta de ChatGPT" });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});