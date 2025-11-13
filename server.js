// server.js - VERSIÓN COMPLETA IOT
import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";
import mqtt from "mqtt";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===== 1. PROTOCOLOS DE COMUNICACIÓN =====
// WebSocket Server para tiempo real
const wss = new WebSocketServer({ noServer: true });

const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log('🔌 Cliente WebSocket conectado');
  
  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log('🔌 Cliente WebSocket desconectado');
  });
});

// MQTT Client para dispositivo real
const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

mqttClient.on('connect', () => {
  console.log('✅ Conectado a broker MQTT público');
  mqttClient.subscribe('ecovolt/sensors/real');
  mqttClient.subscribe('ecovolt/control/+/status');
});

mqttClient.on('message', (topic, message) => {
  console.log(`📨 MQTT [${topic}]:`, message.toString());
  
  try {
    const data = JSON.parse(message.toString());
    
    if (topic === 'ecovolt/sensors/real') {
      // Procesar datos del dispositivo real
      processRealDeviceData(data);
    }
    
    // Broadcast a clientes WebSocket
    broadcastToWebSockets({
      type: 'mqtt_message',
      topic,
      data
    });
  } catch (error) {
    console.error('Error procesando mensaje MQTT:', error);
  }
});

// ===== 2. 5 DISPOSITIVOS DISTRIBUIDOS =====
const devices = {
  // 1. DISPOSITIVO REAL (via MQTT)
  real: {
    id: "esp32_station_01",
    type: "real",
    status: "online",
    protocol: "MQTT",
    description: "Estación de carga física ESP32",
    lastData: null,
    controls: ['restart', 'calibrate', 'adjust_power']
  },
  
  // 2. DIGITAL TWIN (tu simulación actual)
  digitalTwin: {
    id: "ecovolt_digital_twin", 
    type: "simulation",
    status: "online",
    protocol: "HTTP/WebSocket",
    description: "Simulación en tiempo real",
    controls: ['reset', 'speed', 'calibrate_all']
  },
  
  // 3. API EXTERNA (OpenWeatherMap)
  weatherAPI: {
    id: "openweathermap_api",
    type: "api",
    status: "online", 
    protocol: "HTTP",
    description: "Datos climáticos en tiempo real",
    lastData: null,
    controls: ['refresh', 'change_location']
  },
  
  // 4. DATASET HISTÓRICO
  historicalData: {
    id: "energy_dataset",
    type: "dataset",
    status: "online",
    protocol: "HTTP",
    description: "Dataset histórico de consumo energético",
    controls: ['load', 'export', 'analyze']
  },
  
  // 5. DISPOSITIVO ADICIONAL (Smart Plug)
  smartPlug: {
    id: "smart_plug_01",
    type: "additional",
    status: "online",
    protocol: "MQTT/HTTP",
    description: "Enchufe inteligente controlable",
    lastData: null,
    controls: ['toggle', 'schedule', 'power_off']
  }
};

// ===== 3. DATOS Y SIMULACIÓN (MANTENIENDO TU CÓDIGO) =====
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

const HISTORY_LIMIT = 7 * 24 * 6;

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

// Inicializar con datos históricos
for (let i = 0; i < 24 * 6; i++) {
  state.temp += (Math.random() - 0.5) * 0.4;
  state.power += (Math.random() - 0.5) * 0.1;
  state.voltage += (Math.random() - 0.5) * 1.5;
  state.battery += (Math.random() - 0.7) * 2;
  state.lastChargeMinutes += 10;
  pushHistorySample(Date.now() - (24 * 60 * 60 * 1000) + i * 10 * 60 * 1000);
}

// ===== 4. FUNCIONES AUXILIARES =====
function broadcastToWebSockets(data) {
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function processRealDeviceData(data) {
  devices.real.lastData = {
    ...data,
    timestamp: new Date().toISOString()
  };
  
  // Actualizar estado si viene del dispositivo real
  if (data.temperature) state.temp = data.temperature;
  if (data.power) state.power = data.power;
  if (data.voltage) state.voltage = data.voltage;
  if (data.battery) state.battery = data.battery;
}

// ===== 5. ENDPOINTS EXPANDIDOS =====

// Health para Coolify
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Ecovolt IoT Backend operativo",
    protocols: ["HTTP", "WebSocket", "MQTT"],
    devices: Object.keys(devices).length
  });
});

// Estado actual de sensores
app.get("/api/state", (req, res) => {
  res.json({
    temperature: state.temp,
    power: state.power,
    voltage: state.voltage,
    battery: state.battery,
    lastChargeMinutes: state.lastChargeMinutes,
    timestamp: new Date().toISOString()
  });
});

// Historial de sensor
app.get("/api/history/:sensor", (req, res) => {
  const sensor = req.params.sensor;
  if (!history[sensor]) {
    return res.status(400).json({ error: "Sensor desconocido" });
  }
  res.json(history[sensor]);
});

// Lista de dispositivos conectados
app.get("/api/devices", (req, res) => {
  res.json(devices);
});

// Datos de dispositivo específico
app.get("/api/devices/:deviceId", (req, res) => {
  const deviceId = req.params.deviceId;
  const device = devices[deviceId];
  
  if (!device) {
    return res.status(404).json({ error: "Dispositivo no encontrado" });
  }
  
  res.json(device);
});

// ===== 6. RETROCESO COMPLETO =====
app.post("/api/control", (req, res) => {
  const { deviceId, action, value, sensor } = req.body || {};
  console.log("🔄 Comando de retroceso:", req.body);

  let response = { ok: true, message: "Comando ejecutado" };

  switch (action) {
    case "force_charge":
      if (typeof value === "number") {
        state.battery = Math.min(100, Math.max(state.battery, value));
      } else {
        state.battery = 100;
      }
      state.lastChargeMinutes = 0;
      response.message = `Carga forzada a ${state.battery}%`;
      break;

    case "calibrate":
      if (sensor && typeof value === "number") {
        // Aplicar offset de calibración
        const offset = value;
        history[sensor] = history[sensor].map(item => ({
          ...item,
          v: item.v + offset
        }));
        response.message = `Sensor ${sensor} calibrado con offset ${offset}`;
      }
      break;

    case "adjust":
      if (sensor && typeof value === "number") {
        state[sensor] = value;
        response.message = `${sensor} ajustado a ${value}`;
      }
      break;

    case "reset":
      // Resetear simulación a valores iniciales
      state.temp = 27.3;
      state.power = 1.47;
      state.voltage = 220;
      state.battery = 77;
      state.lastChargeMinutes = 41;
      response.message = "Simulación reseteada";
      break;

    case "toggle":
      if (deviceId === "smart_plug_01") {
        // Simular toggle de smart plug
        mqttClient.publish('ecovolt/control/smartplug', JSON.stringify({
          action: 'toggle',
          timestamp: new Date().toISOString()
        }));
        response.message = "Smart Plug toggleado";
      }
      break;

    default:
      response = { ok: false, message: "Acción no reconocida" };
  }

  pushHistorySample();
  
  // Broadcast a WebSockets
  broadcastToWebSockets({
    type: 'control_update',
    deviceId,
    action,
    value,
    sensor,
    result: response
  });

  res.json(response);
});

// ===== 7. INTEGRACIÓN CON APIS EXTERNAS =====
app.get("/api/weather", async (req, res) => {
  try {
    // Simulación de datos climáticos (en producción usar API real)
    const weatherData = {
      temperature: 25 + (Math.random() - 0.5) * 5,
      humidity: 60 + (Math.random() - 0.5) * 20,
      pressure: 1013 + (Math.random() - 0.5) * 10,
      description: "Parcialmente nublado",
      timestamp: new Date().toISOString()
    };
    
    devices.weatherAPI.lastData = weatherData;
    res.json(weatherData);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo datos climáticos" });
  }
});

// ===== 8. WEBHOOK PARA GRAFANA =====
app.post("/webhook/grafana", (req, res) => {
  // Endpoint para que Grafana consuma datos
  const grafanaData = {
    temperature: state.temp,
    power: state.power, 
    voltage: state.voltage,
    battery: state.battery,
    timestamp: new Date().toISOString()
  };
  
  console.log("📊 Datos enviados a Grafana:", grafanaData);
  res.json(grafanaData);
});

// ===== 9. SIMULACIÓN EN TIEMPO REAL =====
setInterval(() => {
  state.temp += (Math.random() - 0.5) * 0.4;
  state.power += (Math.random() - 0.5) * 0.1;
  state.voltage += (Math.random() - 0.5) * 1.5;
  state.battery += (Math.random() - 0.7) * 2;
  state.lastChargeMinutes += 10;

  // Limitar rangos
  if (state.temp < 20) state.temp = 20;
  if (state.temp > 40) state.temp = 40;
  if (state.power < 0.4) state.power = 0.4;
  if (state.power > 3.0) state.power = 3.0;
  if (state.voltage < 210) state.voltage = 210;
  if (state.voltage > 240) state.voltage = 240;
  if (state.battery < 5) state.battery = 5;
  if (state.battery > 100) state.battery = 100;

  pushHistorySample();

  // Broadcast a WebSockets
  broadcastToWebSockets({
    type: 'sensor_update',
    data: { ...state },
    timestamp: new Date().toISOString()
  });

}, 5000);

// ===== 10. CONFIGURACIÓN WEBSOCKET =====
const server = app.listen(PORT, () => {
  console.log(`🚀 Ecovolt IoT Backend ejecutándose en puerto ${PORT}`);
  console.log(`📡 Protocolos: HTTP, WebSocket, MQTT`);
  console.log(`🔧 Dispositivos: ${Object.keys(devices).length} configurados`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
