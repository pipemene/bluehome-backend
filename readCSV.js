import fetch from 'node-fetch';

export async function readCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const data = lines.slice(1).map(row => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i]?.trim());
    return obj;
  });
  return data.filter(x => x.codigo); // filtra vacíos
}