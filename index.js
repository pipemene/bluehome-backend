
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

function calcularIngresos(canon) {
  const canonNum = Number(canon);
  if (isNaN(canonNum) || canonNum <= 0) return null;

  const porcentajeAdmin = 0.105;
  const iva = 0.19;
  const porcentajeAmparoBasico = 0.0205;
  const smmlv = 1423500;
  const porcentajeAmparoIntegral = 0.1231;

  const admin = canonNum * porcentajeAdmin;
  const adminConIVA = admin + admin * iva;
  const amparoBasico = canonNum * porcentajeAmparoBasico;
  const amparoIntegral = (canonNum + smmlv) * porcentajeAmparoIntegral;

  const totalPrimerMes = canonNum - (adminConIVA + amparoBasico + amparoIntegral);
  const totalMesesSiguientes = canonNum - (adminConIVA + amparoBasico);

  return {
    canon: canonNum,
    admin: adminConIVA.toFixed(0),
    amparoBasico: amparoBasico.toFixed(0),
    amparoIntegral: amparoIntegral.toFixed(0),
    totalPrimerMes: totalPrimerMes.toFixed(0),
    totalMesesSiguientes: totalMesesSiguientes.toFixed(0)
  };
}

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  const context = `Usuario ${userId}: ${pregunta}`;

  // Buscar canon en texto
  const canonMatch = pregunta.match(/\$?\s?(\d{6,9})/);
  const datosCanon = canonMatch ? calcularIngresos(canonMatch[1]) : null;

  let extraPrompt = "";
  if (datosCanon) {
    extraPrompt = `
✅ Sobre un canon de ${datosCanon.canon} COP:

• Administración (10.5% + IVA): ${datosCanon.admin} COP
• Amparo básico (2.05% mensual): ${datosCanon.amparoBasico} COP
• Amparo integral (solo primer mes): ${datosCanon.amparoIntegral} COP

💰 Propietario recibe:
• Primer mes: ${datosCanon.totalPrimerMes} COP
• Meses siguientes: ${datosCanon.totalMesesSiguientes} COP

Recuerda que este es un cálculo estimado. Un asesor puede ayudarte con más detalle.
`;
  }

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: context + extraPrompt }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
