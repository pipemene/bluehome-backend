
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function buscarInmueblePorCodigo(codigo) {
  await doc.useJwtAuth(auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  const row = rows.find((r) => r.codigo === codigo.toString());
  if (!row) return null;
  const estado = row.ESTADO?.toLowerCase() === "yes";
  if (!estado) return "no_disponible";
  return {
    enlace_youtube: row["enlace youtube"],
    habitaciones: row["numero habitaciones"],
    banos: row["numero banos"],
    parqueadero: row["parqueadero"],
    canon: row["valor canon"],
  };
}

app.post("/api/chat", async (req, res) => {
  const { userId, pregunta } = req.body;
  const codigo = pregunta.match(/\d+/)?.[0];
  if (codigo) {
    const inmueble = await buscarInmueblePorCodigo(codigo);
    if (!inmueble || inmueble === "no_disponible") {
      return res.json({
        respuesta: `El inmueble con código ${codigo} actualmente no está disponible.`,
      });
    }
    return res.json({
      respuesta: `El inmueble con código ${codigo} está disponible.\nHabitaciones: ${inmueble.habitaciones}, Baños: ${inmueble.banos}, Parqueadero: ${inmueble.parqueadero}, Canon: ${inmueble.canon}.\nVideo: ${inmueble.enlace_youtube}`,
    });
  }

  return res.json({
    respuesta:
      "No entendí el valor. ¿Podrías escribir solo el número o decirme qué necesitas?",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
