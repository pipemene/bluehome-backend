
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { config } from "dotenv";
import csv from "csvtojson";

config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const SHEETS_URL = process.env.SHEETS_URL;

const promptBase = `Eres el asistente virtual de Blue Home Inmobiliaria, una empresa con sede en Palmira, Valle, en la Calle 31 #22-07 del barrio Trinidad. El gerente es Andrés Felipe Meneses y el NIT de la empresa es 1113664827. Fue fundada en enero de 2016. El teléfono fijo es 6022806940 y el correo es info@bluehomeinmo.co. Tu misión es responder de forma clara, precisa y profesional, manteniendo una conversación fluida con los clientes. Si un cliente menciona que quiere entregar su inmueble en administración, notifícalo inmediatamente al correo comercial@bluehomeinmo.co y al WhatsApp +573163121416, pero sigue con la atención normalmente en el chat, no te desligues. Si pregunta por las tarifas, ofrece hacerle una simulación pidiéndole el canon de arrendamiento. Calcula automáticamente el 10.5% + IVA sobre el canon, más el 2.05% mensual del amparo básico y un único descuento inicial del amparo integral (12.31% sobre canon + 1 SMLV). El amparo básico cubre hasta 36 meses de canon si el inquilino deja de pagar. El amparo integral cubre daños y servicios públicos hasta el valor asegurado. Usa un tono VIP para estos clientes.`;

async function cargarDatosDesdeSheets() {
  const response = await fetch(SHEETS_URL);
  const text = await response.text();
  const json = await csv().fromString(text);

  json.forEach((fila) => {
    console.log(`Cargando inmueble ${fila.codigo} con estado: "${fila.ESTADO}"`);
  });

  return json;
}

app.post("/api/chat", async (req, res) => {
  const { userId, pregunta } = req.body;

  try {
    const inmuebles = await cargarDatosDesdeSheets();
    const codigoDetectado = pregunta.match(/\b\d{3,4}\b/);
    const codigo = codigoDetectado?.[0];

    if (codigo) {
      const inmueble = inmuebles.find(
        (item) => item.codigo.trim() === codigo && item.ESTADO?.trim().toLowerCase() === "disponible"
      );
      if (inmueble) {
        return res.json({
          respuesta: `Este inmueble tiene ${inmueble["numero habitaciones"]} habitaciones, ${inmueble["numero banos"]} baños, parqueadero: ${inmueble.parqueadero}, canon: ${inmueble["valor canon"]}. Video: ${inmueble["enlace youtube"] ?? "No disponible"}`,
        });
      } else {
        return res.json({
          respuesta: `El inmueble con código ${codigo} actualmente no está disponible.`,
        });
      }
    }

    return res.json({ respuesta: "¿Cuál es tu presupuesto máximo de arriendo?" });
  } catch (e) {
    console.error("Error en /api/chat:", e);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
