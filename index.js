import express from "express";
import bodyParser from "body-parser";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { config } from "dotenv";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PromptTemplate } from "langchain/prompts";
import axios from "axios";
import fs from "fs";
import csv from "csv-parser";

config();

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

const contextStore = new Map();

const SYSTEM_PROMPT = process.env.BLUEHOME_PROMPT;

function getUserContext(userId) {
  return contextStore.get(userId) || [];
}

function updateUserContext(userId, newMessage) {
  const context = getUserContext(userId);
  context.push(newMessage);
  if (context.length > 10) context.shift();
  contextStore.set(userId, context);
}

function resetUserContext(userId) {
  contextStore.set(userId, []);
}

async function fetchInmuebleData(codigo) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream("inmuebles.csv")
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => {
        const inmueble = results.find((row) => row.codigo === codigo);
        resolve(inmueble);
      })
      .on("error", reject);
  });
}

app.post("/api/async-chat", async (req, res) => {
  const { message, user_id } = req.body;

  if (!message || !user_id) return res.sendStatus(400);
  if (message.toLowerCase() === "test") {
    resetUserContext(user_id);
    return res.send({ text: "✅ Contexto reiniciado exitosamente." });
  }

  res.sendStatus(200); // Respuesta inmediata a ManyChat

  try {
    const inmuebleData = await fetchInmuebleData(message.trim());
    let responseText = "";

    if (inmuebleData) {
      if (inmuebleData.ESTADO === "no_disponible") {
        responseText = "Este inmueble ya no se encuentra disponible.";
      } else {
        responseText = `🏠 Código ${inmuebleData.codigo}:
- ${inmuebleData["numero habitaciones"]} habitaciones
- ${inmuebleData["numero banos"]} baños
- Parqueadero: ${inmuebleData.parqueadero}
- Valor: ${inmuebleData["valor canon"]}

🎥 Mira el video aquí:
${inmuebleData["enlace youtube"]}`;
      }
    } else {
      const history = getUserContext(user_id);
      const chat = new ChatOpenAI({
        temperature: 0.4,
        modelName: "gpt-4",
        openAIApiKey: process.env.OPENAI_API_KEY,
      });

      const fullPrompt = `${SYSTEM_PROMPT}

Historial:
${history.map(m => m.role + ": " + m.content).join("\n")}

Usuario: ${message}
Asistente:`;

      const result = await chat.call([
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ]);

      responseText = result.content;
      updateUserContext(user_id, { role: "user", content: message });
      updateUserContext(user_id, { role: "assistant", content: responseText });
    }

    await axios.post(process.env.MANYCHAT_API_URL, {
      messages: [{ type: "text", text: responseText }],
    });
  } catch (error) {
    console.error("Error:", error);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
