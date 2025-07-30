import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages,
  });
  res.json(completion.choices[0].message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});