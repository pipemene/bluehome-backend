
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN || "bluehome123";

const promptBase = `Eres el asistente virtual de Blue Home Inmobiliaria, una empresa con sede en Palmira, Valle, en la Calle 31 #22-07 del barrio Trinidad. El gerente es Andrés Felipe Meneses y el NIT de la empresa es 1113664827. Fue fundada en enero de 2016. El teléfono fijo es 6022806940 y el correo es info@bluehomeinmo.co. Tu misión es responder de forma clara, precisa y profesional, manteniendo una conversación fluida con los clientes. Si un cliente menciona que quiere entregar su inmueble en administración, notifícalo inmediatamente al correo comercial@bluehomeinmo.co y al WhatsApp +573163121416, pero sigue con la atención normalmente en el chat, no te desligues. Si pregunta por las tarifas, ofrece hacerle una simulación pidiéndole el canon de arrendamiento. Calcula automáticamente el 10.5% + IVA sobre el canon, más el 2.05% mensual del amparo básico y un único descuento inicial del amparo integral (12.31% sobre canon + 1 SMLV). El amparo básico cubre hasta 36 meses de canon si el inquilino deja de pagar. El amparo integral cubre daños y servicios públicos hasta el valor asegurado. Usa un tono VIP para estos clientes.`;

const historial = {};

function calcularValores(canon) {
    const canonNum = Number(canon);
    const admin = canonNum * 0.105;
    const iva = admin * 0.19;
    const amparoBasico = canonNum * 0.0205;
    const amparoIntegral = (canonNum + 1423500) * 0.1231;
    const primerPago = canonNum - (admin + iva + amparoBasico + amparoIntegral);
    const siguientePagos = canonNum - (admin + iva + amparoBasico);
    return {
        admin: admin.toFixed(0),
        iva: iva.toFixed(0),
        amparoBasico: amparoBasico.toFixed(0),
        amparoIntegral: amparoIntegral.toFixed(0),
        primerPago: primerPago.toFixed(0),
        siguientePagos: siguientePagos.toFixed(0)
    };
}

app.post('/api/chat', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: "No autorizado" });
    }

    const { userId, pregunta } = req.body;
    if (!userId || !pregunta) return res.status(400).json({ error: "Faltan campos" });

    const preguntaLimpia = String(pregunta).replace(/\n/g, ' ').replace(/"/g, "'");

    historial[userId] = historial[userId] || [];
    historial[userId].push({ role: "user", content: preguntaLimpia });

    const prompt = [
        { role: "system", content: promptBase },
        ...historial[userId]
    ];

    try {
        const completion = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-3.5-turbo",
            messages: prompt
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });

        const respuesta = completion.data.choices[0].message.content;
        historial[userId].push({ role: "assistant", content: respuesta });

        res.json({ respuesta });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error en OpenAI", detail: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
