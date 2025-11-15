// server.js - VERSIÓN COMPLETA IOT CORREGIDA
import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";
import mqtt from "mqtt";

const AZURE_WEATHER_API_KEY = "ALiJMCBbx5dzDWgHHKrAgTCchjUSKmAP10UmYlMvBqZn15dqwOEUJQQJ99BJACYeBjFa4UkmAAAgAZMP2Fii";
const AZURE_WEATHER_BASE_URL = "https://atlas.microsoft.com/weather";

// Función para obtener clima real
async function getRealWeatherData() {
  try {
    const response = await fetch(
      `${AZURE_WEATHER_BASE_URL}/currentConditions/json?api-version=2025-01-01&query=4.601455,-74.071747&subscription-key=${AZURE_WEATHER_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const weather = data.results[0];
      return {
        temperature: weather.temperature.value,
        humidity: weather.relativeHumidity,
        pressure: weather.pressure.value,
        description: weather.phrase,
        windSpeed: weather.wind.speed.value,
        windDirection: weather.wind.direction.degrees,
        timestamp: new Date().toISOString(),
        source: "Azure Maps Weather API"
      };
    }
    
    throw new Error("No weather data received");
    
  } catch (error) {
    console.error("Error fetching weather data:", error);
    // Fallback a datos simulados si la API falla
    return {
      temperature: 25 + (Math.random() - 0.5) * 5,
      humidity: 60 + (Math.random() - 0.5) * 20,
      pressure: 1013 + (Math.random() - 0.5) * 10,
      description: "Datos simulados - API no disponible",
      windSpeed: 3 + Math.random() * 5,
      timestamp: new Date().toISOString(),
      source: "fallback_simulation"
    };
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: [
        'https://marinino5.github.io',
        'http://localhost:3000',
        'http://localhost:5000',
        'https://lotumab.eastus2.cloudapp.azure.com:30081'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    optionsSuccessStatus: 200
}));


app.use((req, res, next) => {
    const allowedOrigins = [
        'https://marinino5.github.io',
        'http://localhost:3000', 
        'http://localhost:5000'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});
app.use(express.json());

// ===== 1. PROTOCOLOS DE COMUNICACIÓN =====
// WebSocket Server para tiempo real
const wss = new WebSocketServer({ noServer: true });

const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log('🔌 Cliente WebSocket conectado');
  
  // Enviar estado inicial al conectar
  ws.send(JSON.stringify({
    type: 'connection_established',
    message: 'Conectado al servidor IoT',
    timestamp: new Date().toISOString()
  }));
  
  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log('🔌 Cliente WebSocket desconectado');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// MQTT Client para dispositivo real
const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
  clientId: `ecovolt_backend_${Math.random().toString(16).slice(3)}`,
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000,
});

mqttClient.on('connect', () => {
  console.log('✅ Conectado a broker MQTT público');
  mqttClient.subscribe('ecovolt/sensors/real', (err) => {
    if (!err) console.log('📡 Suscrito a ecovolt/sensors/real');
  });
  mqttClient.subscribe('ecovolt/control/+/status', (err) => {
    if (!err) console.log('📡 Suscrito a ecovolt/control/+/status');
  });
});

mqttClient.on('error', (error) => {
  console.error('❌ Error MQTT:', error);
});

mqttClient.on('message', (topic, message) => {
  console.log(`📨 MQTT [${topic}]:`, message.toString());
  
  try {
    const data = JSON.parse(message.toString());
    
    if (topic === 'ecovolt/sensors/real') {
      processRealDeviceData(data);
    }
    
    // Broadcast a clientes WebSocket
    broadcastToWebSockets({
      type: 'mqtt_message',
      topic,
      data,
      timestamp: new Date().toISOString()
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
    lastUpdate: null,
    controls: ['restart', 'calibrate', 'adjust_power']
  },
  
  // 2. DIGITAL TWIN (tu simulación actual)
  digitalTwin: {
    id: "ecovolt_digital_twin", 
    type: "simulation",
    status: "online",
    protocol: "HTTP/WebSocket",
    description: "Simulación en tiempo real",
    lastUpdate: new Date().toISOString(),
    controls: ['reset', 'speed', 'calibrate_all']
  },
  
  // 3. API EXTERNA (Azure Maps Weather)
  weatherAPI: {
    id: "azure_maps_weather",
    type: "api",
    status: "online", 
    protocol: "HTTP",
    description: "Datos climáticos en tiempo real desde Azure Maps",
    lastData: null,
    lastUpdate: null,
    controls: ['refresh', 'change_location']
  },
  
  // 4. DATASET HISTÓRICO
  historicalData: {
    id: "energy_dataset",
    type: "dataset",
    status: "online",
    protocol: "HTTP",
    description: "Dataset histórico de consumo energético",
    lastUpdate: new Date().toISOString(),
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
    lastUpdate: null,
    controls: ['toggle', 'schedule', 'power_off']
  }
};

// ===== 3. DATOS Y SIMULACIÓN =====
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

const HISTORY_LIMIT = 7 * 24 * 6; // 7 días de datos

function pushHistorySample(timestamp = Date.now()) {
  history.temperature.push({ t: timestamp, v: state.temp });
  history.power.push({ t: timestamp, v: state.power });
  history.voltage.push({ t: timestamp, v: state.voltage });
  history.battery.push({ t: timestamp, v: state.battery });
  history.lastChargeMinutes.push({ t: timestamp, v: state.lastChargeMinutes });

  // Mantener límite de datos
  Object.keys(history).forEach((key) => {
    const arr = history[key];
    if (arr.length > HISTORY_LIMIT) {
      arr.splice(0, arr.length - HISTORY_LIMIT);
    }
  });
}

// Inicializar con datos históricos de 7 días
console.log('📊 Generando datos históricos de 7 días...');
for (let i = 0; i < 7 * 24 * 6; i++) { // 7 días * 24 horas * 6 (cada 10 min)
  const baseTemp = 25 + Math.sin(i / 24) * 3;
  const basePower = 1.5 + Math.sin(i / 12) * 0.5;
  
  state.temp = baseTemp + (Math.random() - 0.5) * 2;
  state.power = basePower + (Math.random() - 0.5) * 0.3;
  state.voltage = 220 + (Math.random() - 0.5) * 8;
  state.battery = Math.max(15, 80 - i/10 + (Math.random() - 0.5) * 5);
  
  // LÓGICA CORREGIDA PARA HISTORIAL
  if (i % 144 === 0) { // Reset cada ~24 puntos (4 horas)
    state.lastChargeMinutes = 0;
  } else {
    state.lastChargeMinutes = (i * 10) % 240; // Ciclo de 4 horas máximo
  }
  
  pushHistorySample(Date.now() - (7 * 24 * 60 * 60 * 1000) + i * 10 * 60 * 1000);
}
console.log('✅ Datos históricos generados');

// ===== 4. FUNCIONES AUXILIARES =====
function broadcastToWebSockets(data) {
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error enviando WebSocket:', error);
      }
    }
  });
}

function processRealDeviceData(data) {
  devices.real.lastData = {
    ...data,
    timestamp: new Date().toISOString()
  };
  devices.real.lastUpdate = new Date().toISOString();
  
  // Actualizar estado si viene del dispositivo real
  if (data.temperature !== undefined) state.temp = data.temperature;
  if (data.power !== undefined) state.power = data.power;
  if (data.voltage !== undefined) state.voltage = data.voltage;
  if (data.battery !== undefined) state.battery = data.battery;
  
  console.log('📡 Datos actualizados desde dispositivo real:', data);
}

// ===== 5. ENDPOINTS EXPANDIDOS =====

// Health para Coolify
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Ecovolt IoT Backend operativo",
    timestamp: new Date().toISOString(),
    protocols: ["HTTP", "WebSocket", "MQTT"],
    devices: Object.keys(devices).length,
    version: "2.0.0"
  });
});

// Estado actual de sensores
app.get("/api/state", (req, res) => {
  res.json({
    temperature: parseFloat(state.temp.toFixed(2)),
    power: parseFloat(state.power.toFixed(2)),
    voltage: parseFloat(state.voltage.toFixed(1)),
    battery: parseFloat(state.battery.toFixed(1)),
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
  
  // Opcional: filtrar por rango de tiempo
  const { hours = 24 } = req.query;
  const cutoffTime = Date.now() - (parseInt(hours) * 60 * 60 * 1000);
  
  const filteredData = history[sensor].filter(entry => entry.t >= cutoffTime);
  
  res.json({
    sensor,
    data: filteredData,
    totalPoints: filteredData.length,
    timeRange: `${hours} horas`
  });
});

// Lista de dispositivos conectados
app.get("/api/devices", (req, res) => {
  res.json({
    devices,
    total: Object.keys(devices).length,
    online: Object.values(devices).filter(d => d.status === 'online').length
  });
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

// ===== 6. WEATHER API REAL =====
app.get("/api/weather", async (req, res) => {
  try {
    const weatherData = await getRealWeatherData();
    
    // Actualizar dispositivo API
    devices.weatherAPI.lastData = weatherData;
    devices.weatherAPI.lastUpdate = new Date().toISOString();
    
    // Broadcast a WebSockets
    broadcastToWebSockets({
      type: 'weather_update',
      data: weatherData,
      device: 'weatherAPI',
      timestamp: new Date().toISOString()
    });
    
    res.json(weatherData);
  } catch (error) {
    console.error("Error in weather endpoint:", error);
    res.status(500).json({ 
      error: "Error obteniendo datos climáticos",
      details: error.message 
    });
  }
});

// Pronóstico del tiempo
app.get("/api/weather/forecast", async (req, res) => {
  try {
    const response = await fetch(
      `${AZURE_WEATHER_BASE_URL}/forecast/daily/json?api-version=2025-01-01&query=4.601455,-74.071747&subscription-key=${AZURE_WEATHER_API_KEY}&duration=3`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    console.error("Error fetching forecast:", error);
    res.status(500).json({ 
      error: "Error obteniendo pronóstico",
      details: error.message 
    });
  }
});

// ===== 7. RETROCESO COMPLETO =====
app.post("/api/control", (req, res) => {
  const { deviceId, action, value, sensor } = req.body || {};
  console.log("🔄 Comando de retroceso recibido:", { deviceId, action, value, sensor });

  let response = { ok: true, message: "Comando ejecutado" };

  try {
    switch (action) {
      case "force_charge":
        if (typeof value === "number") {
          state.battery = Math.min(100, Math.max(0, value));
        } else {
          state.battery = 100;
        }
        state.lastChargeMinutes = 0;
        response.message = `Carga forzada a ${state.battery}%`;
        break;

      case "calibrate":
        if (sensor && typeof value === "number") {
          // Aplicar offset de calibración a datos históricos
          const offset = value;
          if (history[sensor]) {
            history[sensor] = history[sensor].map(item => ({
              ...item,
              v: item.v + offset
            }));
          }
          // También ajustar estado actual
          if (state[sensor] !== undefined) {
            state[sensor] += offset;
          }
          response.message = `Sensor ${sensor} calibrado con offset ${offset}`;
        }
        break;

      case "adjust":
        if (sensor && typeof value === "number") {
          if (state[sensor] !== undefined) {
            state[sensor] = value;
            response.message = `${sensor} ajustado a ${value}`;
          } else {
            response = { ok: false, message: `Sensor ${sensor} no existe` };
          }
        }
        break;

      case "reset":
        // Resetear simulación a valores iniciales
        state.temp = 27.3;
        state.power = 1.47;
        state.voltage = 220;
        state.battery = 77;
        state.lastChargeMinutes = 41;
        response.message = "Simulación reseteada a valores iniciales";
        break;

      case "toggle":
        if (deviceId === "smart_plug_01") {
          // Simular toggle de smart plug via MQTT
          mqttClient.publish('ecovolt/control/smartplug', JSON.stringify({
            action: 'toggle',
            timestamp: new Date().toISOString()
          }));
          response.message = "Comando toggle enviado a Smart Plug";
        }
        break;

      case "refresh":
        if (deviceId === "weatherAPI") {
          // Forzar actualización de datos climáticos
          getRealWeatherData().then(weatherData => {
            devices.weatherAPI.lastData = weatherData;
            devices.weatherAPI.lastUpdate = new Date().toISOString();
          });
          response.message = "Actualización de clima forzada";
        }
        break;

      default:
        response = { ok: false, message: "Acción no reconocida" };
    }

    // Guardar muestra después de cada comando
    pushHistorySample();
    
    // Broadcast a WebSockets
    broadcastToWebSockets({
      type: 'control_update',
      deviceId,
      action,
      value,
      sensor,
      result: response,
      timestamp: new Date().toISOString()
    });

    res.json(response);

  } catch (error) {
    console.error("Error en comando de control:", error);
    res.status(500).json({ 
      ok: false, 
      message: "Error ejecutando comando",
      error: error.message 
    });
  }
});

// ===== 8. WEBHOOK PARA GRAFANA =====
app.post("/webhook/grafana", (req, res) => {
  // Endpoint para que Grafana consuma datos
  const grafanaData = {
    temperature: parseFloat(state.temp.toFixed(2)),
    power: parseFloat(state.power.toFixed(2)), 
    voltage: parseFloat(state.voltage.toFixed(1)),
    battery: parseFloat(state.battery.toFixed(1)),
    lastChargeMinutes: state.lastChargeMinutes,
    timestamp: new Date().toISOString()
  };
  
  console.log("📊 Datos enviados a Grafana:", grafanaData);
  res.json(grafanaData);
});

// Endpoint específico para Grafana (formato compatible)
app.get("/api/grafana", (req, res) => {
  const grafanaData = {
    targets: [
      {
        target: "temperature",
        datapoints: history.temperature.slice(-100).map(item => [item.v, item.t])
      },
      {
        target: "power", 
        datapoints: history.power.slice(-100).map(item => [item.v, item.t])
      },
      {
        target: "voltage",
        datapoints: history.voltage.slice(-100).map(item => [item.v, item.t])
      },
      {
        target: "battery",
        datapoints: history.battery.slice(-100).map(item => [item.v, item.t])
      }
    ]
  };
  
  res.json(grafanaData);
});

// ===== 9. SIMULACIÓN EN TIEMPO REAL =====
setInterval(() => {
  // Actualizar valores de simulación con lógica realista
  state.temp += (Math.random() - 0.5) * 0.4;
  state.power += (Math.random() - 0.5) * 0.1;
  state.voltage += (Math.random() - 0.5) * 1.5;
  state.battery += (Math.random() - 0.7) * 2;
  
  // LÓGICA CORREGIDA PARA ÚLTIMA CARGA
  if (state.battery < 20 && Math.random() > 0.95) {
    // Simular carga cuando la batería está baja (5% de probabilidad)
    state.lastChargeMinutes = 0;
    state.battery = Math.min(100, state.battery + 30 + Math.random() * 40);
  } else {
    // Incrementar tiempo desde última carga normalmente
    state.lastChargeMinutes += 10;
    
    // Resetear después de 4 horas (240 min) o si pasa mucho tiempo
    if (state.lastChargeMinutes > 240 || Math.random() > 0.98) {
      state.lastChargeMinutes = 0;
    }
  }

  // Limitar rangos
  state.temp = Math.max(20, Math.min(40, state.temp));
  state.power = Math.max(0.4, Math.min(3.0, state.power));
  state.voltage = Math.max(210, Math.min(240, state.voltage));
  state.battery = Math.max(5, Math.min(100, state.battery));
  state.lastChargeMinutes = Math.max(0, Math.min(480, state.lastChargeMinutes)); // Máximo 8 horas

  pushHistorySample();

  // Broadcast a WebSockets
  broadcastToWebSockets({
    type: 'sensor_update',
    data: { 
      temperature: parseFloat(state.temp.toFixed(2)),
      power: parseFloat(state.power.toFixed(2)),
      voltage: parseFloat(state.voltage.toFixed(1)),
      battery: parseFloat(state.battery.toFixed(1)),
      lastChargeMinutes: Math.round(state.lastChargeMinutes) // Redondear a minutos enteros
    },
    timestamp: new Date().toISOString()
  });

}, 5000);

// ===== 10. CONFIGURACIÓN WEBSOCKET =====
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Ecovolt IoT Backend ejecutándose en puerto ${PORT}`);
  console.log(`📡 Protocolos: HTTP, WebSocket, MQTT`);
  console.log(`🔧 Dispositivos: ${Object.keys(devices).length} configurados`);
  console.log(`💾 Datos históricos: ${history.temperature.length} puntos por sensor`);
  console.log(`🌤️  Weather API: Azure Maps integrado`);
  console.log(`🔄 Retroceso: Comandos de control activos\n`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Manejo graceful de shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Recibido SIGTERM, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});
