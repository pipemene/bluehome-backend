import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handleChat(message, user, conversations, db) {
  const inmueble = db.find(d => d.codigo === message.trim());

  if (inmueble) {
    if (inmueble.estado?.toLowerCase() === 'no_disponible') {
      return 'Este inmueble ya no se encuentra disponible.';
    }

    const info = \`📍 Dirección: \${inmueble.direccion || 'N/A'}
💰 Canon: \$\${inmueble['valor canon']}
🛏️ Habitaciones: \${inmueble['numero habitaciones']}
🛁 Baños: \${inmueble['numero banos']}
🚗 Parqueadero: \${inmueble.parqueadero || 'N/A'}
🎥 Video: \${inmueble['enlace youtube'] || 'No disponible'}\`;

    conversations[user] = [...(conversations[user] || []), { role: 'user', content: message }];
    return info;
  }

  conversations[user] = [...(conversations[user] || []), { role: 'user', content: message }];
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'Eres un asesor inmobiliario de Blue Home. Siempre responde con información concreta, y si no hay datos no inventes. Si el cliente no ha dado un código, primero pregúntale por el tipo de inmueble (casa, apartamento, apartaestudio o local), luego presupuesto, luego habitaciones si aplica. El archivo de inmuebles ya fue cargado.' },
      ...conversations[user]
    ]
  });

  const reply = completion.choices[0].message.content;
  conversations[user].push({ role: 'assistant', content: reply });
  return reply;
}