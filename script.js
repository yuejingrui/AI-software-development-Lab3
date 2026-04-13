const DEFAULT_JS_KEY = "Default_JS_Key";
const amapKeys = window.AMAP_KEYS || {};
const inputJsKey = (amapKeys.jsKey || "").trim();
const inputWebServiceKey = (amapKeys.webServiceKey || "").trim();
const mapJsKey = inputJsKey && !inputJsKey.startsWith("YOUR_") ? inputJsKey : DEFAULT_JS_KEY;
const webServiceKey = inputWebServiceKey && !inputWebServiceKey.startsWith("YOUR_") ? inputWebServiceKey : "";

const resultText = document.getElementById("result-text");
const placeInput = document.getElementById("place-input");
const searchBtn = document.getElementById("search-btn");
const weatherLocation = document.getElementById("weather-location");
const weatherTemp = document.getElementById("weather-temp");
const weatherStatus = document.getElementById("weather-status");
const weatherWind = document.getElementById("weather-wind");
const weatherHumidity = document.getElementById("weather-humidity");
const weatherUpdate = document.getElementById("weather-update");
const forecastBody = document.getElementById("forecast-body");
const tempChart = document.getElementById("temp-chart");
const contextContent = document.getElementById("context-content");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatShell = document.querySelector(".chat-shell");
const historyToggleBtn = document.getElementById("history-toggle-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const contentLayout = document.querySelector(".content");
const chatPanel = document.querySelector(".chat-panel");
const forecastTitle = document.querySelector(".forecast-title");

const glmConfig = window.GLM_CONFIG || {};
const glmKey = (glmConfig.key || "").trim();
const glmSecret = (glmConfig.secret || "").trim();
const CHAT_MODEL = "glm-4-flash";
const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const FOCUS_ZOOM = 12;
const FUTURE_FORECAST_DAYS = 3;
const FORECAST_DAYS = FUTURE_FORECAST_DAYS + 1;
const CHAT_STORAGE_KEY = "weather_chat_sessions_v1";
const ACTIVE_CHAT_STORAGE_KEY = "weather_chat_active_session_v1";
const DEFAULT_SESSION_TITLE = "新对话";
const RED_PIN_CONTENT = `
  <div style="position: relative; width: 22px; height: 22px; background: #ff4d4f; border-radius: 50% 50% 50% 0; transform: translate(-50%, -100%) rotate(-45deg); box-shadow: 0 2px 8px rgba(255, 77, 79, 0.35);">
    <div style="position: absolute; width: 8px; height: 8px; background: #ffffff; border-radius: 50%; top: 7px; left: 7px;"></div>
  </div>
`;
const BEAUFORT_MPS = [0.1, 0.9, 2.4, 4.4, 6.7, 9.4, 12.3, 15.5, 19.0, 22.6, 26.5, 30.5, 34.0];

let map;
let marker;
let infoWindow;
let mapReady = false;
let pendingLocateSession = null;
let titleGenerating = false;
let lastPoiSelectAt = 0;
let chatToggleBtn = null;
let chatResizeHandle = null;
let chatPanelOpen = true;
let chatPanelWidth = 380;
let isChatResizing = false;
let chatResizeStartX = 0;
let chatResizeStartWidth = 0;
let chatResizeMinWidth = 320;
let latestLocationContext = {
  name: "未选择地点",
  city: "--",
  district: "--",
  adcode: "",
  lng: null,
  lat: null
};
let latestWeatherContext = {
  current: null,
  forecast: []
};
let chatSessions = [];
let activeSessionId = "";

function updateResult(name, lng, lat) {
  const placeName = name && name.trim() ? name : "未知地点";
  resultText.textContent = `地点：${placeName} | 经度：${lng.toFixed(6)} | 纬度：${lat.toFixed(6)}`;
}

function showInfoWindow(name, lng, lat) {
  const placeName = name && name.trim() ? name : "未知地点";
  const content = `
    <div style="padding: 6px 8px; line-height: 1.6;">
      <div style="font-weight: 600;">${placeName}</div>
      <div>经度：${lng.toFixed(2)}</div>
      <div>纬度：${lat.toFixed(2)}</div>
    </div>
  `;
  infoWindow.setContent(content);
  infoWindow.open(map, [lng, lat]);
}

function setMarkerAndFocus(position) {
  if (!marker) {
    marker = new AMap.Marker({
      map,
      content: RED_PIN_CONTENT,
      offset: new AMap.Pixel(0, 0)
    });
  }
  marker.setPosition(position);
  const currentZoom = map.getZoom();
  if (currentZoom < FOCUS_ZOOM) {
    map.setZoomAndCenter(FOCUS_ZOOM, position);
    return;
  }
  map.setCenter(position);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseWindSpeed(windPowerText) {
  if (!windPowerText) {
    return null;
  }
  const raw = String(windPowerText).trim();
  const mpsMatch = raw.match(/(\d+(?:\.\d+)?)\s*(m\/s|米\/秒)/i);
  if (mpsMatch) {
    return Number(mpsMatch[1]);
  }
  const levels = (raw.match(/\d+/g) || []).map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!levels.length) {
    return null;
  }
  const mapped = levels
    .map((level) => {
      const index = Math.max(0, Math.min(level, BEAUFORT_MPS.length - 1));
      return BEAUFORT_MPS[index];
    })
    .filter((item) => Number.isFinite(item));
  if (!mapped.length) {
    return null;
  }
  const avg = mapped.reduce((sum, value) => sum + value, 0) / mapped.length;
  return Number(avg.toFixed(1));
}

function formatDateLabel(dateText, index) {
  if (!dateText) {
    return `第${index + 1}天`;
  }
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

function resolveCityName(cityValue, provinceValue) {
  if (Array.isArray(cityValue)) {
    return cityValue[0] || provinceValue || "--";
  }
  return cityValue || provinceValue || "--";
}

function getLocationLabel(city, district) {
  const safeCity = city || "--";
  const safeDistrict = district || "--";
  return `${safeCity} ${safeDistrict}`;
}

function createAiContextPayload() {
  const address = latestLocationContext.name || "--";
  const city = latestLocationContext.city || "--";
  const district = latestLocationContext.district || "--";
  const current = latestWeatherContext.current;
  const currentWeatherText = current
    ? `天气${current.weather || "--"}，温度${current.temperature === null ? "--" : current.temperature}℃，风速${current.windSpeed === null ? "--" : current.windSpeed}米/秒，湿度${current.humidity === null ? "--" : current.humidity}%`
    : "暂无";
  const forecastList = (latestWeatherContext.forecast || []).map((item) => ({
    日期: item.date,
    天气: item.weather,
    最低温: item.low === null ? "--" : `${item.low}℃`,
    最高温: item.high === null ? "--" : `${item.high}℃`
  }));
  return {
    位置: {
      详细地址: address,
      城市: city,
      行政区: district
    },
    当前天气: currentWeatherText,
    天气预报: forecastList
  };
}

function renderContextPanel() {
  const payload = createAiContextPayload();
  contextContent.textContent = JSON.stringify(payload, null, 2);
}

function cloneLocationContext(source) {
  return {
    name: source && source.name ? source.name : "未选择地点",
    city: source && source.city ? source.city : "--",
    district: source && source.district ? source.district : "--",
    adcode: source && source.adcode ? source.adcode : "",
    lng: source && Number.isFinite(source.lng) ? source.lng : null,
    lat: source && Number.isFinite(source.lat) ? source.lat : null
  };
}

function nowIsoString() {
  return new Date().toISOString();
}

function createSessionBase() {
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = nowIsoString();
  return {
    id,
    title: DEFAULT_SESSION_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
    contextSnapshots: [],
    lastLocation: cloneLocationContext(latestLocationContext)
  };
}

function parseStoredSessions(rawText) {
  if (!rawText) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || ""),
        title: String(item.title || DEFAULT_SESSION_TITLE),
        createdAt: item.createdAt || nowIsoString(),
        updatedAt: item.updatedAt || item.createdAt || nowIsoString(),
        messages: Array.isArray(item.messages)
          ? item.messages
              .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant"))
              .map((msg) => ({
                role: msg.role,
                content: String(msg.content || ""),
                timestamp: msg.timestamp || nowIsoString(),
                locationSnapshot: msg.locationSnapshot
                  ? {
                      city: msg.locationSnapshot.city || "--",
                      district: msg.locationSnapshot.district || "--"
                    }
                  : null
              }))
          : [],
        contextSnapshots: Array.isArray(item.contextSnapshots)
          ? item.contextSnapshots
              .filter((snapshot) => snapshot && typeof snapshot === "object")
              .map((snapshot) => ({
                timestamp: snapshot.timestamp || nowIsoString(),
                location: cloneLocationContext(snapshot.location || {}),
                currentWeather: snapshot.currentWeather
                  ? {
                      temperature: toNumber(snapshot.currentWeather.temperature),
                      weather: snapshot.currentWeather.weather || "--",
                      windSpeed: toNumber(snapshot.currentWeather.windSpeed),
                      humidity: toNumber(snapshot.currentWeather.humidity)
                    }
                  : null,
                forecast: Array.isArray(snapshot.forecast)
                  ? snapshot.forecast.slice(0, FORECAST_DAYS).map((row) => ({
                      date: row.date || "--",
                      weather: row.weather || "--",
                      low: toNumber(row.low),
                      high: toNumber(row.high)
                    }))
                  : []
              }))
          : [],
        lastLocation: cloneLocationContext(item.lastLocation || {})
      }))
      .filter((item) => item.id);
  } catch (error) {
    console.warn("历史会话解析失败，将重置本地会话数据。", error);
    return [];
  }
}

function saveSessionsToStorage() {
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatSessions));
  if (activeSessionId) {
    localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeSessionId);
  }
}

function getActiveSession() {
  return chatSessions.find((item) => item.id === activeSessionId) || null;
}

function getSessionPreview(session) {
  const firstUser = session.messages.find((msg) => msg.role === "user" && msg.content.trim());
  if (firstUser) {
    return firstUser.content;
  }
  return "暂无提问内容";
}

function hasUserDialogue(session) {
  return session.messages.some((msg) => msg.role === "user" && msg.content.trim());
}

function getLastAnswerTimestamp(session) {
  const assistantMessages = session.messages.filter((msg) => msg.role === "assistant" && msg.timestamp);
  if (!assistantMessages.length) {
    return "";
  }
  const latest = assistantMessages.reduce((best, current) => {
    const bestTime = new Date(best.timestamp).getTime();
    const currentTime = new Date(current.timestamp).getTime();
    if (Number.isNaN(currentTime)) {
      return best;
    }
    if (Number.isNaN(bestTime) || currentTime > bestTime) {
      return current;
    }
    return best;
  }, assistantMessages[0]);
  return latest.timestamp || "";
}

function getLastAnswerSortValue(session) {
  const iso = getLastAnswerTimestamp(session);
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatHistoryTime(isoText) {
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  if (isToday) {
    return `${hour}:${minute}`;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderHistoryList() {
  historyList.innerHTML = "";
  const visibleSessions = chatSessions
    .filter((session) => hasUserDialogue(session))
    .sort((a, b) => getLastAnswerSortValue(b) - getLastAnswerSortValue(a));
  if (!visibleSessions.length) {
    historyEmpty.style.display = "block";
    return;
  }
  historyEmpty.style.display = "none";
  visibleSessions.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${session.id === activeSessionId ? " active" : ""}`;
    button.dataset.sessionId = session.id;
    button.innerHTML = `
      <div class="history-item-title">${escapeHtml(session.title || DEFAULT_SESSION_TITLE)}</div>
      <div class="history-item-time">最后回答：${formatHistoryTime(getLastAnswerTimestamp(session))}</div>
      <div class="history-item-preview">${escapeHtml(getSessionPreview(session))}</div>
    `;
    historyList.appendChild(button);
  });
}

function setHistoryDrawerOpen(open) {
  const isOpen = Boolean(open);
  chatShell.classList.toggle("history-open", isOpen);
  historyToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function updateActiveSessionLocation() {
  const active = getActiveSession();
  if (!active) {
    return;
  }
  active.lastLocation = cloneLocationContext(latestLocationContext);
  active.updatedAt = nowIsoString();
  saveSessionsToStorage();
  renderHistoryList();
}

function appendContextSnapshotToActiveSession() {
  const active = getActiveSession();
  if (!active) {
    return;
  }
  const snapshot = {
    timestamp: nowIsoString(),
    location: cloneLocationContext(latestLocationContext),
    currentWeather: latestWeatherContext.current
      ? {
          temperature: toNumber(latestWeatherContext.current.temperature),
          weather: latestWeatherContext.current.weather || "--",
          windSpeed: toNumber(latestWeatherContext.current.windSpeed),
          humidity: toNumber(latestWeatherContext.current.humidity)
        }
      : null,
    forecast: (latestWeatherContext.forecast || []).slice(0, FORECAST_DAYS).map((item) => ({
      date: item.date || "--",
      weather: item.weather || "--",
      low: toNumber(item.low),
      high: toNumber(item.high)
    }))
  };
  active.contextSnapshots = Array.isArray(active.contextSnapshots) ? active.contextSnapshots : [];
  active.contextSnapshots.push(snapshot);
  active.updatedAt = nowIsoString();
  saveSessionsToStorage();
}

function getWelcomeMessage() {
  return "我会基于你当前选中的地点与天气数据回答问题。请先点击地图或搜索地点，再提问。";
}

function createWelcomeRecord() {
  return {
    role: "assistant",
    content: getWelcomeMessage(),
    timestamp: nowIsoString(),
    locationSnapshot: {
      city: latestLocationContext.city,
      district: latestLocationContext.district
    }
  };
}

function renderSessionMessages(session) {
  chatMessages.innerHTML = "";
  if (!session.messages.length) {
    return;
  }
  session.messages.forEach((msg) => {
    renderChatMessage(msg.role, msg.content, msg.locationSnapshot || null);
  });
}

function restoreSessionContext(session) {
  latestLocationContext = cloneLocationContext(session.lastLocation || {});
  renderContextPanel();
  if (!Number.isFinite(latestLocationContext.lng) || !Number.isFinite(latestLocationContext.lat)) {
    resetWeatherPanel("请选择地点查看天气");
  }
}

function locateToSessionLastLocation(session) {
  const lastLocation = cloneLocationContext(session.lastLocation || {});
  if (!Number.isFinite(lastLocation.lng) || !Number.isFinite(lastLocation.lat)) {
    return;
  }
  if (!mapReady) {
    pendingLocateSession = session.id;
    return;
  }
  selectByPosition([lastLocation.lng, lastLocation.lat], lastLocation.name || "历史会话地点");
}

function switchSession(sessionId, options = {}) {
  const target = chatSessions.find((item) => item.id === sessionId);
  if (!target) {
    return;
  }
  activeSessionId = target.id;
  saveSessionsToStorage();
  renderSessionMessages(target);
  restoreSessionContext(target);
  renderHistoryList();
  if (options.locate !== false) {
    locateToSessionLastLocation(target);
  }
}

function createNewSession() {
  const session = createSessionBase();
  session.messages.push(createWelcomeRecord());
  chatSessions.push(session);
  activeSessionId = session.id;
  saveSessionsToStorage();
  renderHistoryList();
  renderSessionMessages(session);
}

function initChatSessions() {
  chatSessions = parseStoredSessions(localStorage.getItem(CHAT_STORAGE_KEY));
  const storedActiveId = localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) || "";
  if (!chatSessions.length) {
    createNewSession();
    return;
  }
  const fallbackSession = chatSessions[0];
  const targetSession = chatSessions.find((item) => item.id === storedActiveId) || fallbackSession;
  if (!targetSession.messages.length) {
    targetSession.messages.push(createWelcomeRecord());
  }
  switchSession(targetSession.id, { locate: false });
}

function escapeHtml(rawText) {
  return String(rawText || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderChatMessage(role, content, locationSnapshot) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${role}`;
  if (role === "assistant" && locationSnapshot) {
    const locationLine = document.createElement("div");
    locationLine.className = "chat-location";
    locationLine.textContent = `问题地点：${getLocationLabel(locationSnapshot.city, locationSnapshot.district)}`;
    wrapper.appendChild(locationLine);
  }
  const textNode = document.createElement("div");
  textNode.innerHTML = escapeHtml(content).replaceAll("\n", "<br>");
  wrapper.appendChild(textNode);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatMessage(role, content, locationSnapshot, options = {}) {
  const shouldPersist = options.persist !== false;
  renderChatMessage(role, content, locationSnapshot);
  if (!shouldPersist) {
    return;
  }
  const active = getActiveSession();
  if (!active) {
    return;
  }
  active.messages.push({
    role,
    content,
    timestamp: nowIsoString(),
    locationSnapshot: locationSnapshot || null
  });
  active.updatedAt = nowIsoString();
  active.lastLocation = cloneLocationContext(latestLocationContext);
  saveSessionsToStorage();
  renderHistoryList();
}

function resetWeatherPanel(message) {
  weatherLocation.textContent = message || "未获取到天气信息";
  weatherTemp.textContent = "--℃";
  weatherStatus.textContent = "--";
  weatherWind.textContent = "风速：-- m/s";
  weatherHumidity.textContent = "湿度：--%";
  weatherUpdate.textContent = "更新时间：--";
  forecastBody.innerHTML = `<tr><td colspan="4">${message || "暂无天气预测数据"}</td></tr>`;
  drawTempChart([]);
  latestWeatherContext = {
    current: null,
    forecast: []
  };
  renderContextPanel();
}

function renderCurrentWeather(live, displayName) {
  const currentTemp = toNumber(live.temperature);
  const windSpeed = parseWindSpeed(live.windpower);
  const humidity = toNumber(live.humidity);
  weatherLocation.textContent = displayName || live.city || "未知地区";
  weatherTemp.textContent = currentTemp !== null ? `${currentTemp}℃` : "--℃";
  weatherStatus.textContent = live.weather || "--";
  weatherWind.textContent = `风速：${windSpeed !== null ? windSpeed : "--"} m/s`;
  weatherHumidity.textContent = `湿度：${humidity !== null ? humidity : "--"}%`;
  weatherUpdate.textContent = `更新时间：${live.reporttime || "--"}`;
}

function getForecastRows(casts) {
  const normalized = (casts || []).slice(0, FORECAST_DAYS).map((item, index) => {
    const low = toNumber(item.nighttemp);
    const high = toNumber(item.daytemp);
    return {
      label: formatDateLabel(item.date, index),
      weather: item.dayweather || item.nightweather || "--",
      low,
      high
    };
  });
  while (normalized.length < FORECAST_DAYS) {
    normalized.push({
      label: `第${normalized.length + 1}天`,
      weather: "--",
      low: null,
      high: null
    });
  }
  return normalized;
}

function renderForecastTable(rows) {
  if (!rows.length) {
    forecastBody.innerHTML = '<tr><td colspan="4">暂无天气预测数据</td></tr>';
    return;
  }
  const html = rows
    .map((row) => {
      const lowText = row.low !== null ? `${row.low}℃` : "--";
      const highText = row.high !== null ? `${row.high}℃` : "--";
      return `<tr><td>${row.label}</td><td>${row.weather}</td><td>${lowText}</td><td>${highText}</td></tr>`;
    })
    .join("");
  forecastBody.innerHTML = html;
}

function drawLine(ctx, points, color) {
  if (points.length < 2) {
    return;
  }
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
      return;
    }
    ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

function drawDots(ctx, points, color) {
  ctx.fillStyle = color;
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawWeatherGlyph(ctx, weatherText, x, y) {
  const text = String(weatherText || "");
  ctx.save();
  ctx.lineWidth = 1.5;
  if (text.includes("晴")) {
    ctx.strokeStyle = "#faad14";
    ctx.fillStyle = "#faad14";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI / 4) * i;
      const sx = x + Math.cos(angle) * 9;
      const sy = y + Math.sin(angle) * 9;
      const ex = x + Math.cos(angle) * 12;
      const ey = y + Math.sin(angle) * 12;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (text.includes("雨")) {
    ctx.fillStyle = "#91b9ff";
    ctx.beginPath();
    ctx.arc(x - 4, y - 1, 4, Math.PI, Math.PI * 2);
    ctx.arc(x + 1, y - 3, 5, Math.PI, Math.PI * 2);
    ctx.arc(x + 6, y - 1, 4, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4a9fff";
    [-5, 0, 5].forEach((dx) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + 5);
      ctx.lineTo(x + dx - 2, y + 9);
      ctx.stroke();
    });
    ctx.restore();
    return;
  }
  if (text.includes("雪")) {
    ctx.fillStyle = "#d6e4ff";
    ctx.beginPath();
    ctx.arc(x - 4, y - 1, 4, Math.PI, Math.PI * 2);
    ctx.arc(x + 1, y - 3, 5, Math.PI, Math.PI * 2);
    ctx.arc(x + 6, y - 1, 4, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8c8f94";
    [-4, 1, 6].forEach((dx) => {
      ctx.beginPath();
      ctx.moveTo(x + dx - 2, y + 7);
      ctx.lineTo(x + dx + 2, y + 11);
      ctx.moveTo(x + dx + 2, y + 7);
      ctx.lineTo(x + dx - 2, y + 11);
      ctx.stroke();
    });
    ctx.restore();
    return;
  }
  ctx.fillStyle = text.includes("阴") || text.includes("云") ? "#9aa5b1" : "#c0c4cc";
  ctx.beginPath();
  ctx.arc(x - 4, y, 4, Math.PI, Math.PI * 2);
  ctx.arc(x + 1, y - 2, 5, Math.PI, Math.PI * 2);
  ctx.arc(x + 7, y, 4, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTempChart(rows) {
  const ctx = tempChart.getContext("2d");
  const width = tempChart.width;
  const height = tempChart.height;
  ctx.clearRect(0, 0, width, height);

  const values = rows
    .flatMap((row) => [row.low, row.high])
    .filter((item) => Number.isFinite(item));
  if (!values.length) {
    ctx.fillStyle = "#8c8f94";
    ctx.font = "14px sans-serif";
    ctx.fillText("暂无温度曲线数据", 16, 84);
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const left = 20;
  const right = width - 20;
  const top = 16;
  const bottom = height - 66;
  const weatherRowY = height - 34;
  const dateRowY = height - 12;
  const stepX = (right - left) / Math.max(1, rows.length - 1);

  const toY = (temp) => bottom - ((temp - min) / range) * (bottom - top);
  const lowPoints = rows
    .map((row, index) => {
      if (!Number.isFinite(row.low)) {
        return null;
      }
      return { x: left + index * stepX, y: toY(row.low), temp: row.low };
    })
    .filter(Boolean);
  const highPoints = rows
    .map((row, index) => {
      if (!Number.isFinite(row.high)) {
        return null;
      }
      return { x: left + index * stepX, y: toY(row.high), temp: row.high };
    })
    .filter(Boolean);

  ctx.strokeStyle = "#edf0f2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  drawLine(ctx, lowPoints, "#4a9fff");
  drawLine(ctx, highPoints, "#ff7a45");
  drawDots(ctx, lowPoints, "#4a9fff");
  drawDots(ctx, highPoints, "#ff7a45");

  ctx.fillStyle = "#2f3640";
  ctx.font = "12px sans-serif";
  highPoints.forEach((point) => {
    ctx.fillText(`${point.temp}℃`, point.x - 14, point.y - 8);
  });
  lowPoints.forEach((point) => {
    const labelY = Math.min(weatherRowY - 10, point.y + 15);
    ctx.fillText(`${point.temp}℃`, point.x - 14, labelY);
  });
  rows.forEach((row, index) => {
    const x = left + index * stepX;
    drawWeatherGlyph(ctx, row.weather, x, weatherRowY - 6);
    ctx.fillStyle = "#5b6270";
    ctx.fillText(row.label, x - 20, dateRowY);
  });
}

async function fetchAmapJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("天气接口请求失败");
  }
  const data = await response.json();
  if (data.status !== "1") {
    const info = data.info || "请求失败";
    const infocode = data.infocode || "未知错误码";
    throw new Error(`${info}(${infocode})`);
  }
  return data;
}

function buildServiceUrl(path, params) {
  const query = new URLSearchParams({
    ...params,
    key: webServiceKey
  });
  return `https://restapi.amap.com${path}?${query.toString()}`;
}

function ensureServiceKey() {
  if (webServiceKey) {
    return true;
  }
  resetWeatherPanel("请先配置 Web 服务 Key");
  resultText.textContent = "请在 index.html 的 AMAP_KEYS.webServiceKey 中配置高德 Web 服务 Key";
  return false;
}

async function loadWeatherByAdcode(adcode, displayName) {
  if (!adcode) {
    resetWeatherPanel("当前地点缺少 adcode，无法查询天气");
    return;
  }
  if (!ensureServiceKey()) {
    return;
  }
  try {
    const baseUrl = buildServiceUrl("/v3/weather/weatherInfo", {
      city: adcode,
      extensions: "base"
    });
    const allUrl = buildServiceUrl("/v3/weather/weatherInfo", {
      city: adcode,
      extensions: "all"
    });
    const [liveData, forecastData] = await Promise.all([fetchAmapJson(baseUrl), fetchAmapJson(allUrl)]);
    const live = liveData.lives && liveData.lives[0];
    const forecast = forecastData.forecasts && forecastData.forecasts[0];
    if (!live || !forecast) {
      resetWeatherPanel("天气接口返回异常，请检查 Key 配置");
      return;
    }
    const finalName = displayName || forecast.city || live.city || "未知地区";
    renderCurrentWeather(live, finalName);
    const rows = getForecastRows(forecast.casts || []);
    renderForecastTable(rows);
    drawTempChart(rows);
    latestWeatherContext = {
      current: {
        temperature: toNumber(live.temperature),
        weather: live.weather || "--",
        windSpeed: parseWindSpeed(live.windpower),
        humidity: toNumber(live.humidity)
      },
      forecast: rows.map((row) => ({
        date: row.label,
        weather: row.weather,
        low: row.low,
        high: row.high
      }))
    };
    renderContextPanel();
    appendContextSnapshotToActiveSession();
  } catch (error) {
    resetWeatherPanel(`天气加载失败：${error.message}`);
    console.error(error);
  }
}

async function reverseGeocode(position) {
  if (!ensureServiceKey()) {
    return null;
  }
  const [lng, lat] = position;
  const url = buildServiceUrl("/v3/geocode/regeo", {
    location: `${lng},${lat}`,
    extensions: "base",
    radius: "1000"
  });
  const data = await fetchAmapJson(url);
  return data.regeocode || null;
}

async function reverseGeocodeAndLoadWeather(position, fallbackName) {
  const [lng, lat] = position;
  try {
    const regeocode = await reverseGeocode(position);
    if (regeocode) {
      const formattedAddress = regeocode.formatted_address || fallbackName || "未知地点";
      const addressComponent = regeocode.addressComponent || {};
      const adcode = addressComponent.adcode;
      const city = resolveCityName(addressComponent.city, addressComponent.province);
      const district = addressComponent.district || "--";
      latestLocationContext = {
        name: formattedAddress,
        city,
        district,
        adcode: adcode || "",
        lng,
        lat
      };
      renderContextPanel();
      updateActiveSessionLocation();
      updateResult(formattedAddress, lng, lat);
      showInfoWindow(formattedAddress, lng, lat);
      loadWeatherByAdcode(adcode, formattedAddress);
      return;
    }
    latestLocationContext = {
      name: fallbackName || "未知地点",
      city: "--",
      district: "--",
      adcode: "",
      lng,
      lat
    };
    renderContextPanel();
    updateActiveSessionLocation();
    updateResult(fallbackName || "未知地点", lng, lat);
    showInfoWindow(fallbackName || "未知地点", lng, lat);
    resetWeatherPanel("逆地理编码失败，无法查询天气");
  } catch (error) {
    latestLocationContext = {
      name: fallbackName || "未知地点",
      city: "--",
      district: "--",
      adcode: "",
      lng,
      lat
    };
    renderContextPanel();
    updateActiveSessionLocation();
    updateResult(fallbackName || "未知地点", lng, lat);
    showInfoWindow(fallbackName || "未知地点", lng, lat);
    resetWeatherPanel(`逆地理编码失败：${error.message}`);
  }
}

function selectByPosition(position, fallbackName) {
  setMarkerAndFocus(position);
  reverseGeocodeAndLoadWeather(position, fallbackName);
}

function getLngLatFromUnknownLocation(locationLike) {
  if (!locationLike) {
    return null;
  }
  if (typeof locationLike.getLng === "function" && typeof locationLike.getLat === "function") {
    const lng = Number(locationLike.getLng());
    const lat = Number(locationLike.getLat());
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  if (typeof locationLike.lng === "number" && typeof locationLike.lat === "number") {
    return [locationLike.lng, locationLike.lat];
  }
  if (typeof locationLike === "string") {
    const [lngText, latText] = locationLike.split(",");
    const lng = Number(lngText);
    const lat = Number(latText);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  return null;
}

function trySelectFromPoiEvent(event) {
  if (!event) {
    return false;
  }
  const poi = event.poi || {};
  const poiName = poi.name || event.name || "地图地标";
  const poiPosition =
    getLngLatFromUnknownLocation(poi.location) ||
    getLngLatFromUnknownLocation(event.lnglat) ||
    null;
  if (!poiPosition) {
    return false;
  }
  selectByPosition(poiPosition, poiName);
  return true;
}

function selectPoi(poi, fallbackKeyword) {
  if (!poi || !poi.location) {
    resultText.textContent = "未找到可定位的地点，请尝试更换关键词";
    return;
  }
  const locationText = String(poi.location);
  const [lngText, latText] = locationText.split(",");
  const lng = Number(lngText);
  const lat = Number(latText);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    resultText.textContent = "地点坐标解析失败，请尝试更换关键词";
    return;
  }
  const placeName = poi.name || poi.address || fallbackKeyword || "未知地点";
  selectByPosition([lng, lat], placeName);
}

async function searchPlaceByKeyword(keyword) {
  if (!ensureServiceKey()) {
    return null;
  }
  const url = buildServiceUrl("/v3/place/text", {
    keywords: keyword,
    offset: "10",
    page: "1",
    extensions: "base"
  });
  const data = await fetchAmapJson(url);
  return (data.pois || []).filter((item) => item.location);
}

async function doSearch() {
  const keyword = placeInput.value.trim();
  if (!keyword) {
    resultText.textContent = "请输入要搜索的地名";
    return;
  }
  try {
    const pois = await searchPlaceByKeyword(keyword);
    if (!pois || !pois.length) {
      resultText.textContent = "未找到匹配地点，请尝试其他关键词";
      return;
    }
    selectPoi(pois[0], keyword);
  } catch (error) {
    resultText.textContent = `搜索失败：${error.message}`;
  }
}

function uint8ToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function textToBase64Url(text) {
  return uint8ToBase64Url(new TextEncoder().encode(text));
}

async function signHmacSha256(raw, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return uint8ToBase64Url(new Uint8Array(signatureBuffer));
}

async function createGlmToken(key, secret) {
  const now = Date.now();
  const header = {
    alg: "HS256",
    sign_type: "SIGN"
  };
  const payload = {
    api_key: key,
    exp: Math.floor(now / 1000) + 300,
    timestamp: now
  };
  const encodedHeader = textToBase64Url(JSON.stringify(header));
  const encodedPayload = textToBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHmacSha256(unsignedToken, secret);
  return `${unsignedToken}.${signature}`;
}

function ensureGlmConfig() {
  if (!glmKey || !glmSecret || glmKey.startsWith("YOUR_") || glmSecret.startsWith("YOUR_")) {
    throw new Error("请先在 index.html 的 GLM_CONFIG 中配置 key 与 secret");
  }
}

function buildSessionContextForPrompt(session, currentContextPayload) {
  const snapshots = Array.isArray(session && session.contextSnapshots) ? session.contextSnapshots : [];
  const locationWeatherHistory = snapshots.map((snapshot) => ({
    时间: snapshot.timestamp || "--",
    地点: {
      详细地址: snapshot.location && snapshot.location.name ? snapshot.location.name : "--",
      城市: snapshot.location && snapshot.location.city ? snapshot.location.city : "--",
      行政区: snapshot.location && snapshot.location.district ? snapshot.location.district : "--",
      adcode: snapshot.location && snapshot.location.adcode ? snapshot.location.adcode : "--",
      经度: snapshot.location && Number.isFinite(snapshot.location.lng) ? snapshot.location.lng : "--",
      纬度: snapshot.location && Number.isFinite(snapshot.location.lat) ? snapshot.location.lat : "--"
    },
    当前天气: snapshot.currentWeather
      ? {
          天气: snapshot.currentWeather.weather || "--",
          温度: snapshot.currentWeather.temperature === null ? "--" : `${snapshot.currentWeather.temperature}℃`,
          风速: snapshot.currentWeather.windSpeed === null ? "--" : `${snapshot.currentWeather.windSpeed}米/秒`,
          湿度: snapshot.currentWeather.humidity === null ? "--" : `${snapshot.currentWeather.humidity}%`
        }
      : "暂无",
    天气预报: (snapshot.forecast || []).map((item) => ({
      日期: item.date || "--",
      天气: item.weather || "--",
      最低温: item.low === null ? "--" : `${item.low}℃`,
      最高温: item.high === null ? "--" : `${item.high}℃`
    }))
  }));
  const questionHistory = (session && Array.isArray(session.messages) ? session.messages : [])
    .filter((msg) => msg.role === "user" && msg.content.trim())
    .map((msg) => msg.content.trim());
  return {
    当前地图选点信息: currentContextPayload,
    当前会话历史地点与天气: locationWeatherHistory,
    当前会话提问历史: questionHistory
  };
}

function buildAiPrompt(promptContextPayload, userQuestion) {
  const promptContext = JSON.stringify(promptContextPayload, null, 2);
  return [
    "以下是隐藏上下文（不要逐字复述给用户，只用于推理）：",
    promptContext,
    "",
    "请结合上下文和会话历史回答用户最新问题，明确区分“现在出发”和“稍后出发”的差异，给出可执行建议。",
    `用户最新问题：${userQuestion}`
  ].join("\n");
}

function formatHistoryMessageForModel(msg) {
  if (msg.role === "assistant" && msg.locationSnapshot) {
    const locationLine = `问题地点：${getLocationLabel(msg.locationSnapshot.city, msg.locationSnapshot.district)}`;
    return `${locationLine}\n${msg.content}`;
  }
  return msg.content;
}

function buildConversationMessages(session, hiddenPrompt) {
  const history = (session && Array.isArray(session.messages) ? session.messages : [])
    .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant") && msg.content && msg.content.trim())
    .slice(-20)
    .map((msg) => ({
      role: msg.role,
      content: formatHistoryMessageForModel(msg)
    }));
  return [
    {
      role: "system",
      content: "你是天气与出行助手。你必须结合当前会话历史进行连续对话，不要把每个问题当作全新会话。"
    },
    {
      role: "user",
      content: hiddenPrompt
    },
    ...history
  ];
}

function normalizeAssistantContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter((item) => item)
      .join("\n");
  }
  return "";
}

async function requestGlmAnswer(question, promptContextPayload, session) {
  const hiddenPrompt = buildAiPrompt(promptContextPayload, question);
  const messages = buildConversationMessages(session, hiddenPrompt);
  return requestGlmCompletion(messages, 0.7);
}

async function requestGlmCompletion(messages, temperature) {
  ensureGlmConfig();
  const token = await createGlmToken(glmKey, glmSecret);
  const response = await fetch(GLM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature,
      messages
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`大模型请求失败(${response.status}) ${errorText || ""}`.trim());
  }
  const data = await response.json();
  const firstChoice = data.choices && data.choices[0];
  const assistantText = firstChoice && firstChoice.message ? normalizeAssistantContent(firstChoice.message.content) : "";
  if (!assistantText) {
    throw new Error("大模型返回为空");
  }
  return assistantText;
}

function buildFallbackSessionTitle(session) {
  const location = session.lastLocation || {};
  const locationLabel = `${location.city || ""}${location.district || ""}`.trim();
  const firstUser = session.messages.find((msg) => msg.role === "user" && msg.content.trim());
  const questionPart = firstUser ? firstUser.content.replace(/\s+/g, "").slice(0, 12) : "";
  if (locationLabel && questionPart) {
    return `${locationLabel}：${questionPart}`;
  }
  if (locationLabel) {
    return `${locationLabel}天气对话`;
  }
  if (questionPart) {
    return `对话：${questionPart}`;
  }
  return DEFAULT_SESSION_TITLE;
}

async function generateSessionTitle(session) {
  const fallbackTitle = buildFallbackSessionTitle(session);
  const usableMessages = session.messages.filter((msg) => msg.content && msg.content.trim()).slice(0, 6);
  if (!usableMessages.length) {
    return fallbackTitle;
  }
  if (!glmKey || !glmSecret || glmKey.startsWith("YOUR_") || glmSecret.startsWith("YOUR_")) {
    return fallbackTitle;
  }
  try {
    const compactMessages = usableMessages
      .map((msg) => `${msg.role === "user" ? "用户" : "助手"}：${msg.content}`)
      .join("\n");
    const prompt = [
      "请为这段天气相关对话生成一个简短中文标题。",
      "要求：不超过14个汉字，不加引号，不使用句号。",
      `地点信息：${(session.lastLocation && `${session.lastLocation.city || "--"} ${session.lastLocation.district || "--"}`) || "--"}`,
      `对话内容：\n${compactMessages}`
    ].join("\n");
    const title = await requestGlmCompletion(
      [
        {
          role: "user",
          content: prompt
        }
      ],
      0.3
    );
    const cleaned = title.replace(/["'“”‘’。]/g, "").trim().slice(0, 18);
    return cleaned || fallbackTitle;
  } catch (error) {
    console.warn("会话命名失败，使用本地命名。", error);
    return fallbackTitle;
  }
}

async function maybeRenameActiveSession() {
  const active = getActiveSession();
  if (!active || titleGenerating) {
    return;
  }
  const hasQuestion = active.messages.some((msg) => msg.role === "user" && msg.content.trim());
  if (!hasQuestion) {
    return;
  }
  titleGenerating = true;
  try {
    const newTitle = await generateSessionTitle(active);
    const latestActive = getActiveSession();
    if (!latestActive) {
      return;
    }
    latestActive.title = newTitle || DEFAULT_SESSION_TITLE;
    latestActive.updatedAt = nowIsoString();
    saveSessionsToStorage();
    renderHistoryList();
  } finally {
    titleGenerating = false;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getChatPanelMaxWidth() {
  return Math.max(320, Math.floor(window.innerWidth / 2));
}

function updateChatToggleButton() {
  if (!chatToggleBtn) {
    return;
  }
  chatToggleBtn.textContent = chatPanelOpen ? ">" : "<";
  chatToggleBtn.setAttribute("aria-label", chatPanelOpen ? "关闭聊天栏" : "展开聊天栏");
}

function applyChatPanelLayout() {
  if (!contentLayout || !chatPanel) {
    return;
  }
  const maxWidth = getChatPanelMaxWidth();
  chatPanelWidth = clamp(chatPanelWidth, 320, maxWidth);
  contentLayout.style.setProperty("--chat-panel-width", `${chatPanelWidth}px`);
  contentLayout.classList.toggle("chat-panel-collapsed", !chatPanelOpen);
  updateChatToggleButton();
}

function toggleChatPanel() {
  chatPanelOpen = !chatPanelOpen;
  applyChatPanelLayout();
}

function handleChatResizeStart(event) {
  if (!chatPanelOpen) {
    return;
  }
  isChatResizing = true;
  chatResizeStartX = event.clientX;
  chatResizeStartWidth = chatPanelWidth;
  chatResizeMinWidth = chatPanelWidth;
  document.body.classList.add("chat-resizing");
  event.preventDefault();
}

function handleChatResizeMove(event) {
  if (!isChatResizing) {
    return;
  }
  const delta = chatResizeStartX - event.clientX;
  const maxWidth = getChatPanelMaxWidth();
  chatPanelWidth = clamp(chatResizeStartWidth + delta, chatResizeMinWidth, maxWidth);
  applyChatPanelLayout();
}

function handleChatResizeEnd() {
  if (!isChatResizing) {
    return;
  }
  isChatResizing = false;
  document.body.classList.remove("chat-resizing");
}

function initChatPanelLayout() {
  if (!contentLayout || !chatPanel) {
    return;
  }
  chatPanelWidth = clamp(chatPanel.getBoundingClientRect().width || 380, 320, getChatPanelMaxWidth());

  chatToggleBtn = document.createElement("button");
  chatToggleBtn.type = "button";
  chatToggleBtn.className = "chat-panel-toggle";
  chatToggleBtn.addEventListener("click", toggleChatPanel);

  chatResizeHandle = document.createElement("div");
  chatResizeHandle.className = "chat-resize-handle";
  chatResizeHandle.addEventListener("mousedown", handleChatResizeStart);

  contentLayout.appendChild(chatToggleBtn);
  chatPanel.appendChild(chatResizeHandle);
  applyChatPanelLayout();

  window.addEventListener("mousemove", handleChatResizeMove);
  window.addEventListener("mouseup", handleChatResizeEnd);
  window.addEventListener("resize", applyChatPanelLayout);
}

async function doChat() {
  const question = chatInput.value.trim();
  if (!question) {
    return;
  }
  const contextPayload = createAiContextPayload();
  const locationSnapshot = {
    city: contextPayload.位置.城市,
    district: contextPayload.位置.行政区
  };
  appendChatMessage("user", question);
  chatInput.value = "";
  chatSendBtn.disabled = true;
  try {
    const activeSession = getActiveSession();
    const promptContextPayload = buildSessionContextForPrompt(activeSession, contextPayload);
    const answer = await requestGlmAnswer(question, promptContextPayload, activeSession);
    appendChatMessage("assistant", answer, locationSnapshot);
  } catch (error) {
    appendChatMessage("assistant", `回答失败：${error.message}`, locationSnapshot);
  } finally {
    maybeRenameActiveSession();
    chatSendBtn.disabled = false;
  }
}

renderContextPanel();
initChatSessions();
setHistoryDrawerOpen(false);
if (forecastTitle) {
  forecastTitle.textContent = `未来${FUTURE_FORECAST_DAYS}天天气预测`;
}
initChatPanelLayout();

historyToggleBtn.addEventListener("click", () => {
  const isOpen = chatShell.classList.contains("history-open");
  setHistoryDrawerOpen(!isOpen);
});

newChatBtn.addEventListener("click", () => {
  createNewSession();
  setHistoryDrawerOpen(false);
});

historyList.addEventListener("click", (event) => {
  const target = event.target.closest(".history-item");
  if (!target) {
    return;
  }
  const sessionId = target.dataset.sessionId;
  if (!sessionId) {
    return;
  }
  switchSession(sessionId);
  setHistoryDrawerOpen(false);
});

AMapLoader.load({
  key: mapJsKey,
  version: "2.0"
})
  .then((AMap) => {
    map = new AMap.Map("map-container", {
      zoom: 11,
      center: [121.4737, 31.2304]
    });
    infoWindow = new AMap.InfoWindow({
      offset: new AMap.Pixel(0, -24),
      autoMove: true
    });
    mapReady = true;
    if (pendingLocateSession) {
      const target = chatSessions.find((item) => item.id === pendingLocateSession);
      if (target) {
        locateToSessionLastLocation(target);
      }
      pendingLocateSession = null;
    } else {
      const active = getActiveSession();
      if (active) {
        locateToSessionLastLocation(active);
      }
    }

    map.on("hotspotclick", (event) => {
      if (trySelectFromPoiEvent(event)) {
        lastPoiSelectAt = Date.now();
      }
    });

    map.on("click", (event) => {
      if (Date.now() - lastPoiSelectAt < 250) {
        return;
      }
      if (trySelectFromPoiEvent(event)) {
        lastPoiSelectAt = Date.now();
        return;
      }
      const lng = event.lnglat.getLng();
      const lat = event.lnglat.getLat();
      selectByPosition([lng, lat], "地图选点");
    });

    searchBtn.addEventListener("click", doSearch);
    placeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        doSearch();
      }
    });
    chatSendBtn.addEventListener("click", doChat);
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        doChat();
      }
    });
  })
  .catch((error) => {
    resultText.textContent = "地图加载失败，请检查 Key 或网络设置";
    resetWeatherPanel("地图加载失败");
    console.error(error);
  });
