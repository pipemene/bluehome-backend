import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(bodyParser.json());

const SHEET_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vTe5bAfaAIJDsDj6Hgz43yQ7gQ9TSm77Pp-g-3zBby_PuCknOfOta_3KsQX0-ofmG7hY6zDcxU3qBcS/pub?gid=0&single=true&output=csv";

app.post("/api/chat", async (req, res) => {
  try {
    const { pregunta } = req.body;

    // Detectar tipo y presupuesto
    const tipoMatch = pregunta.match(/(apartamento|casa|apartaestudio|local)/i);
    const presupuestoMatch = pregunta.replace(/[.,]/g, "").match(/\d{6,}/);

    if (!tipoMatch || !presupuestoMatch) {
      return res.json({
        respuesta:
          "¿Podrías decirme el tipo de inmueble que buscas (casa, apartamento, apartaestudio o local) y tu presupuesto máximo?",
      });
    }

    const tipoBuscado = tipoMatch[1].toLowerCase();
    const presupuestoMax = parseInt(presupuestoMatch[0]);

    // Descargar CSV
    const response = await fetch(SHEET_CSV_URL);
    const data = await response.text();

    const rows = [];
    await new Promise((resolve, reject) => {
      Readable.from(data)
        .pipe(csv())
        .on("data", (row) => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    // Filtrar por tipo, estado y presupuesto
    const disponibles = rows.filter((row) => {
      const tipo = (row.tipo || "").toLowerCase();
      const estado = (row.ESTADO || "").toLowerCase();
      const canon = parseInt((row["valor canon"] || "0").replace(/[.,\$]/g, ""));
      return (
        tipo.includes(tipoBuscado) &&
        estado.includes("yes") &&
        !isNaN(canon) &&
        canon <= presupuestoMax
      );
    });

    if (disponibles.length === 0) {
      return res.json({
        respuesta: "No encontré inmuebles disponibles que coincidan con tu búsqueda.",
      });
    }

    const respuestas = disponibles.slice(0, 3).map((row) => {
      return `Código ${row.codigo}: ${row.tipo}, ${row["numero habitaciones"]} hab., ${row["numero banos"]} baños, canon ${row["valor canon"]}.
${row["enlace youtube"]}`;
    });

    return res.json({
      respuesta: respuestas.join("\n\n"),
    });
  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.listen(8080, () => {
  console.log("Servidor corriendo en puerto 8080");
});