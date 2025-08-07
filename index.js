
import express from "express";
import bodyParser from "body-parser";
import { config } from "dotenv";
import fetch from "node-fetch";
import csv from "csv-parser";
import https from "https";
import http from "http";
import fs from "fs";

config();
const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json());

// Descargar y leer el CSV
async function loadCSVData() {
  return new Promise((resolve, reject) => {
    const results = [];
    const url = process.env.GOOGLE_SHEET_CSV_URL;
    const protocol = url.startsWith("https") ? https : http;

    protocol.get(url, (res) => {
      res.pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => resolve(results))
        .on("error", reject);
    }).on("error", reject);
  });
}

// Buscar propiedades disponibles
function filtrarInmuebles(data, tipo, presupuesto) {
  const cleanPresupuesto = parseInt(presupuesto.toString().replace(/[^0-9]/g, ""));

  return data.filter((row) => {
    const estado = (row.ESTADO || "").toLowerCase().trim();
    const tipoRow = (row.tipo || "").toLowerCase().trim();
    const canon = parseInt((row["valor canon"] || "").replace(/[^0-9]/g, ""));

    return estado === "yes" &&
           tipoRow.includes(tipo.toLowerCase()) &&
           !isNaN(canon) &&
           canon <= cleanPresupuesto;
  });
}

app.post("/api/chat", async (req, res) => {
  try {
    const { userId, pregunta } = req.body;
    const preguntaLower = pregunta.toLowerCase();

    // Detectar tipo de inmueble
    const tipos = ["apartamento", "casa", "apartaestudio", "local"];
    const tipoDetectado = tipos.find((tipo) => preguntaLower.includes(tipo));

    // Detectar presupuesto (número más grande del mensaje)
    const numeros = preguntaLower.match(/[0-9.]+/g);
    const presupuestoDetectado = numeros ? Math.max(...numeros.map(n => parseInt(n.replace(/\./g, "")))) : null;

    if (!tipoDetectado || !presupuestoDetectado) {
      return res.json({ respuesta: "¿Qué tipo de inmueble buscas y cuál es tu presupuesto máximo de arriendo?" });
    }

    const datos = await loadCSVData();
    const sugerencias = filtrarInmuebles(datos, tipoDetectado, presupuestoDetectado);

    if (sugerencias.length === 0) {
      return res.json({ respuesta: `No tengo ${tipoDetectado}s disponibles por ese presupuesto en este momento.` });
    }

    const top3 = sugerencias.slice(0, 3).map((item) => {
      return `✅ Código ${item.codigo}: ${item["valor canon"]} - ${item["numero habitaciones"]} hab, ${item["numero banos"]} baños. [Video](${item["enlace youtube"]})`;
    }).join("

");

    return res.json({ respuesta: `Estas son algunas opciones disponibles:

${top3}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
