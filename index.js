
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { GoogleSpreadsheet } from "google-spreadsheet";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

async function accessSheet() {
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  return rows;
}

function buscarInmueblePorCodigo(rows, codigoBuscado) {
  return rows.find(row => {
    const codigo = String(row.codigo || "").trim();
    const estado = String(row.ESTADO || "").trim().toUpperCase();
    return codigo === codigoBuscado && estado === "YES";
  });
}

app.post("/api/chat", async (req, res) => {
  try {
    const { userId, pregunta } = req.body;

    const regex = /\b(\d{1,4})\b/;
    const match = pregunta.match(regex);

    if (match) {
      const codigo = match[1];
      const rows = await accessSheet();
      const inmueble = buscarInmueblePorCodigo(rows, codigo);

      if (inmueble) {
        const respuesta = `🏠 Inmueble disponible con código ${codigo}:
- Habitaciones: ${inmueble["numero habitaciones"]}
- Baños: ${inmueble["numero banos"]}
- Parqueadero: ${inmueble["parqueadero"]}
- Valor canon: ${inmueble["valor canon"]}
🎥 Video: ${inmueble["enlace youtube"]}`;
        return res.json({ respuesta });
      } else {
        return res.json({ respuesta: `El inmueble con código ${codigo} actualmente no está disponible.` });
      }
    }

    return res.json({ respuesta: "No entendí el valor. ¿Podrías escribir solo el número?" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ respuesta: "Ocurrió un error interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
