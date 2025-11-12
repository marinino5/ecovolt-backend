import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

// ----- Config -----
const PORT = process.env.PORT || 3000;
const ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// ----- App -----
const app = express();
app.use(express.json());
app.use(cors({
  origin: ORIGINS.length ? ORIGINS : true,
  credentials: true
}));

// Salud
app.get('/health', (_req, res) => res.status(200).send('OK'));

// Estado en memoria para demo IoT
let latestReadings = {}; // { topic: { value, ts } }

// Endpoint REST para obtener últimos datos
app.get('/iot/latest', (_req, res) => res.json({ data: latestReadings }));

// (Opcional) PostgreSQL ejemplo de conexión
// Solo si defines DATABASE_URL en Coolify (p.ej. postgres://user:pass@host:5432/db)
let pgClient = null;
if (process.env.DATABASE_URL) {
  const { Client } = await import('pg');
  pgClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  pgClient.connect().catch(console.error);
}

// WebSocket para push en tiempo real al front
const server = app.listen(PORT, () => console.log('API on :' + PORT));
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { try { c.send(msg); } catch {} });
}

// (Opcional) MQTT → recibe datos y los reenvía por WS + guarda en DB/memoria
if (process.env.MQTT_URL) {
  const mqtt = await import('mqtt');
  const client = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: process.env.MQTT_CLIENT_ID || 'ecovolt-' + Math.random().toString(16).slice(2)
  });

  const topics = (process.env.MQTT_TOPICS || 'ecovolt/+/telemetry').split(',').map(t => t.trim());

  client.on('connect', () => {
    console.log('MQTT connected');
    topics.forEach(t => client.subscribe(t, { qos: 0 }, err => err && console.error(err)));
  });

  client.on('message', async (topic, payload) => {
    let data = null;
    try { data = JSON.parse(payload.toString()); } catch { data = { raw: payload.toString() }; }
    const row = { topic, data, ts: Date.now() };
    latestReadings[topic] = { value: data, ts: row.ts };

    // Guardar en DB (opcional)
    if (pgClient) {
      try {
        await pgClient.query(
          'CREATE TABLE IF NOT EXISTS telemetry (id bigserial primary key, topic text, payload jsonb, ts timestamptz default now());'
        );
        await pgClient.query('INSERT INTO telemetry(topic, payload) VALUES ($1, $2)', [topic, data]);
      } catch (e) { console.error('DB insert error', e); }
    }

    // Notificar al front en tiempo real
    broadcast({ type: 'telemetry', topic, data, ts: row.ts });
  });
}
