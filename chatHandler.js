
import axios from 'axios';
import { parse } from 'csv-parse/sync';

const csvUrl = process.env.GOOGLE_SHEET_CSV_URL;
const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

export async function handleChat(req, res) {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Faltan campos requeridos." });

  let sheetData = "";
  try {
    const csv = await axios.get(csvUrl);
    const records = parse(csv.data, { columns: true });
    const match = records.find(row => pregunta.includes(row.codigo));
    if (match) {
      return res.json({
        respuesta: `🏡 Inmueble ${match.codigo}: ${match.habitaciones} habitaciones, ${match.banos} baños, parqueadero: ${match.parqueadero}, canon: $${match.canon}. 🎥 Video: ${match.youtube}`
      });
    }
  } catch (error) {
    console.error("Error leyendo Google Sheets:", error.message);
  }

  const context = `Usuario ${userId}: ${pregunta}`;
  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt },
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
}
