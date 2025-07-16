
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import cors from "cors";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanMessage, SystemMessage } from "langchain/schema";

dotenv.config();
const app = express();
app.use(bodyParser.json());
app.use(cors());

const chatModel = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  temperature: 0.4,
  modelName: "gpt-4o",
});

const historial = {};

app.post("/api/chat", async (req, res) => {
  try {
    const { pregunta, userId } = req.body;

    if (!pregunta || !userId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const promptFinal = process.env.PROMPT_BASE;

    if (!promptFinal) {
      return res.status(400).json({ error: "No hay prompt definido" });
    }

    if (!historial[userId]) {
      historial[userId] = [new SystemMessage(promptFinal)];
    }

    historial[userId].push(new HumanMessage(pregunta));
    const respuesta = await chatModel.call(historial[userId]);

    historial[userId].push(respuesta);

    res.json({ respuesta: respuesta.content });
  } catch (error) {
    console.error("Error procesando la solicitud:", error.message);
    res.status(500).json({ error: "Error generando respuesta de ChatGPT" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
