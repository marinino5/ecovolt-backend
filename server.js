// server.js (versión ES Module para Node con type: "module")

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ----- Estado simulado (igual que en el front) -----
const state = {
  temp: 27.3,
  power: 1.47,
  voltage: 220,
  battery: 77,
  lastChargeMinutes: 41
};

const history = {
  temperature: [],
  power: [],
  voltage: [],
  battery: [],
  lastChargeMinutes: []
};

const HISTORY_LIMIT = 7 * 24 * 6; // 7 días

function pushHistorySample(timestamp = Date.now()) {
  history.temperature.push({ t: timestamp, v: state.temp });
  history.power.push({ t: timestamp, v: state.power });
  history.voltage.push({ t: timestamp, v: state.voltage });
  history.battery.push({ t: timestamp, v: state.battery });
  history.lastChargeMinutes.push({ t: timestamp, v: state.lastChargeMinutes });

  Object.keys(history).forEach((key) => {
    const arr = history[key];
    if (arr.length > HISTORY_LIMIT) {
      arr.splice(0, arr.length - HISTORY_LIMIT);
    }
  });
}

// Inicializamos con un día de datos simulados
for (let i = 0; i < 24 * 6; i++) {
  state.temp += (Math.random() - 0.5) * 0.4;
  state.power += (Math.random() - 0.5) * 0.1;
  state.voltage += (Math.random() - 0.5) * 1.5;
  state.battery += (Math.random() - 0.7) * 2;
  state.lastChargeMinutes += 10;

  pushHistorySample(Date.now() - (24 * 60 * 60 * 1000) + i * 10 * 60 * 1000);
}

// Cada 5 segundos → 10 minutos simulados
setInterval(() => {
  state.temp += (Math.random() - 0.5) * 0.4;
  state.power += (Math.random() - 0.5) * 0.1;
  state.voltage += (Math.random() - 0.5) * 1.5;
  state.battery += (Math.random() - 0.7) * 2;
  state.lastChargeMinutes += 10;

  if (state.temp < 20) state.temp = 20;
  if (state.temp > 40) state.temp = 40;
  if (state.power < 0.4) state.power = 0.4;
  if (state.power > 3.0) state.power = 3.0;
  if (state.voltage < 210) state.voltage = 210;
  if (state.voltage > 240) state.voltage = 240;
  if (state.battery < 5) state.battery = 5;
  if (state.battery > 100) state.battery = 100;

  pushHistorySample();
}, 5000);

// ----- ENDPOINTS -----

// Health para Coolify y el frontend
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Ecovolt backend operativo" });
});

// Estado actual de los sensores
app.get("/api/state", (req, res) => {
  res.json({
    temperature: state.temp,
    power: state.power,
    voltage: state.voltage,
    battery: state.battery,
    lastChargeMinutes: state.lastChargeMinutes
  });
});

// Historial de un sensor
app.get("/api/history/:sensor", (req, res) => {
  const sensor = req.params.sensor;
  if (!history[sensor]) {
    return res.status(400).json({ error: "Sensor desconocido" });
  }
  res.json(history[sensor]);
});

// Comandos de "retroceso"
app.post("/api/command", (req, res) => {
  const { deviceId, action, targetBattery } = req.body || {};
  console.log("Comando recibido:", req.body);

  if (action === "force_charge") {
    if (typeof targetBattery === "number") {
      state.battery = Math.min(100, Math.max(state.battery, targetBattery));
    } else {
      state.battery = 100;
    }
    state.lastChargeMinutes = 0;
    pushHistorySample();

    return res.json({
      ok: true,
      message: "Carga forzada aplicada en el digital twin"
    });
  }

  res.json({ ok: true, message: "Comando recibido (sin acción específica)" });
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`Ecovolt backend escuchando en puerto ${PORT}`);
});
