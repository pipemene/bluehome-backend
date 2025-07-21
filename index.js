const express = require("express");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");
const { parse } = require("csv-parse/sync");
const https = require("https");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

// Load and parse Google Sheets CSV on demand
async function getGoogleSheetsData() {
  const res = await axios.get(process.env.GOOGLE_SHEETS_CSV_URL, {
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
  const records = parse(res.data, { columns: true, skip_empty_lines: true });
  return records;
}

app.post("/api/chat", async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  // Detectar si hay un código
  const codeMatch = pregunta.match(/\b\d{3,}\b/);
  let propiedadInfo = null;

  if (codeMatch) {
    const code = codeMatch[0];
    const sheetData = await getGoogleSheetsData();
    const inmueble = sheetData.find(row => row.codigo && row.codigo.trim() === code);

    if (inmueble) {
      propiedadInfo = `Este inmueble tiene ${inmueble.habitaciones} habitaciones, ${inmueble.banos} baños, parqueadero: ${inmueble.parqueadero}, canon: ${inmueble.valor}. Mira el video aquí: ${inmueble.youtube}`;
    }
  }

  const context = `Usuario ${userId}: ${pregunta}`;

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt },
        ...(propiedadInfo ? [{ role: "system", content: propiedadInfo }] : []),
        { role: "user", content: context }
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
