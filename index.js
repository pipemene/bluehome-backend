import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { ChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
let rows = [];

async function loadSheet() {
  try {
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, "
"),
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    rows = await sheet.getRows();
    console.log("Google Sheet cargado con", rows.length, "filas.");
  } catch (error) {
    console.error("Error cargando Google Sheet:", error);
  }
}
loadSheet();

const memoryMap = new Map();

function getMemoryForUser(userId) {
  if (!memoryMap.has(userId)) {
    memoryMap.set(userId, new BufferMemory({ returnMessages: true, memoryKey: "chat_history" }));
  }
  return memoryMap.get(userId);
}

const model = new ChatOpenAI({
  temperature: 0.4,
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4o",
});

const systemPrompt = `
Eres un asistente de Blue Home Inmobiliaria, experto en arrendamientos en Palmira y Cali.
- Si te preguntan por un inmueble, consulta el código en la hoja de cálculo cargada.
- Si el inmueble no está disponible, informa que no está disponible.
- Si el inmueble está disponible, responde con habitaciones, baños, parqueadero, canon y link de YouTube.
- Si no dan código, pregunta tipo de inmueble, presupuesto y habitaciones, y luego sugiere 3 disponibles.
- Tarifas: 10.45% + IVA por administración. Seguro básico 2.05%. Amparo integral 12.31% sobre canon + 1 SMMLV.
`;

app.post("/api/chat", async (req, res) => {
  const { mensaje, usuario } = req.body;

  try {
    const memoria = getMemoryForUser(usuario);

    // Revisión de código de inmueble
    const codigo = mensaje.trim().match(/^\d{1,4}$/)?.[0];
    if (codigo) {
      const row = rows.find(r => r.codigo === codigo);
      if (!row) {
        return res.json({ respuesta: `No encontré ningún inmueble con el código ${codigo}.` });
      }
      if (row.ESTADO === "no_disponible") {
        return res.json({ respuesta: `El inmueble con código ${codigo} actualmente no está disponible.` });
      }

      const respuesta = `🏠 Inmueble disponible:
- Habitaciones: ${row["numero habitaciones"]}
- Baños: ${row["numero banos"]}
- Parqueadero: ${row["parqueadero"]}
- Valor del canon: ${row["valor canon"]}
🎥 Mira el video: ${row["enlace youtube"]}`;
      return res.json({ respuesta });
    }

    const chain = new ConversationChain({
      llm: model,
      memory: memoria,
      prompt: systemPrompt,
    });

    const resultado = await chain.call({ input: mensaje });
    res.json({ respuesta: resultado.response });
  } catch (error) {
    console.error("Error procesando /api/chat:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.get("/", (_, res) => {
  res.send("Backend de Blue Home Inmobiliaria operativo.");
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});