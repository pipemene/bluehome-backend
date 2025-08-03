import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const SHEETS_URL = process.env.SHEETS_CSV_URL;

async function buscarInmueble(codigo) {
  try {
    const res = await fetch(SHEETS_URL);
    const data = await res.text();
    const rows = data.split("\n").slice(1);
    const headers = data.split("\n")[0].split(",");
    for (const row of rows) {
      const cols = row.split(",");
      if (cols[0] && cols[0].trim() === codigo.trim()) {
        const inmueble = {};
        headers.forEach((h, i) => {
          inmueble[h.trim().toLowerCase()] = cols[i]?.trim();
        });
        return inmueble;
      }
    }
    return null;
  } catch (e) {
    console.error("Error leyendo Google Sheets:", e);
    return null;
  }
}

app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Mensaje requerido" });

  // Revisar si es un código
  if (/^\d{1,4}$/.test(message.trim())) {
    const inmueble = await buscarInmueble(message.trim());
    if (!inmueble) {
      return res.json({ reply: "Ese código no está disponible en este momento. ¿Quieres que te muestre otras opciones?" });
    }
    return res.json({
      reply: \`📍 Dirección: \${inmueble.direccion || "No registrada"}
💰 Canon: \${inmueble["valor canon"] || "N/A"}
🛏 Habitaciones: \${inmueble["numero habitaciones"] || "N/A"}
🛁 Baños: \${inmueble["numero banos"] || "N/A"}
🚗 Parqueadero: \${inmueble.parqueadero || "N/A"}
🎥 Video: \${inmueble["enlace youtube"] || "No disponible"}\`
    });
  }

  // Otros mensajes
  if (message.toLowerCase().includes("pse")) {
    return res.json({
      reply: "Puedes hacer tu pago por PSE aquí: https://gateway1.ecollect.co/eCollectPlus/SignIn.aspx. Solo necesitas tu número de cédula."
    });
  }

  if (message.toLowerCase().includes("estado de cuenta") || message.toLowerCase().includes("certificado")) {
    return res.json({
      reply: `Puedes descargar tu estado de cuenta, factura o certificado en nuestra oficina virtual: https://simidocs.siminmobiliarias.com/base/simired/simidocsapi1.0/index.php?inmo=901&tipo=1
Usuario: tu cédula
Contraseña inicial: 0000
Video tutorial: https://www.youtube.com/watch?v=pzdBniZ9e4o`
    });
  }

  return res.json({ reply: "Gracias por tu mensaje. ¿Quieres ver inmuebles disponibles? Envíame el tipo de inmueble o tu presupuesto." });
});

app.listen(port, () => {
  console.log(\`Servidor corriendo en puerto \${port}\`);
});
