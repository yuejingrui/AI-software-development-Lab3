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

const glmConfig = window.GLM_CONFIG || {};
const glmKey = (glmConfig.key || "").trim();
const glmSecret = (glmConfig.secret || "").trim();
const CHAT_MODEL = "glm-4-flash";
const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const FOCUS_ZOOM = 12;
const RED_PIN_CONTENT = `
  <div style="position: relative; width: 22px; height: 22px; background: #ff4d4f; border-radius: 50% 50% 50% 0; transform: translate(-50%, -100%) rotate(-45deg); box-shadow: 0 2px 8px rgba(255, 77, 79, 0.35);">
    <div style="position: absolute; width: 8px; height: 8px; background: #ffffff; border-radius: 50%; top: 7px; left: 7px;"></div>
  </div>
`;
const BEAUFORT_MPS = [0.1, 0.9, 2.4, 4.4, 6.7, 9.4, 12.3, 15.5, 19.0, 22.6, 26.5, 30.5, 34.0];

let map;
let marker;
let infoWindow;
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

function escapeHtml(rawText) {
  return String(rawText || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function appendChatMessage(role, content, locationSnapshot) {
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
  const normalized = (casts || []).slice(0, 5).map((item, index) => {
    const low = toNumber(item.nighttemp);
    const high = toNumber(item.daytemp);
    return {
      label: formatDateLabel(item.date, index),
      weather: item.dayweather || item.nightweather || "--",
      low,
      high
    };
  });
  while (normalized.length < 5) {
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
  const bottom = height - 24;
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
    updateResult(fallbackName || "未知地点", lng, lat);
    showInfoWindow(fallbackName || "未知地点", lng, lat);
    resetWeatherPanel(`逆地理编码失败：${error.message}`);
  }
}

function selectByPosition(position, fallbackName) {
  setMarkerAndFocus(position);
  reverseGeocodeAndLoadWeather(position, fallbackName);
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

function buildAiPrompt(contextPayload, userQuestion) {
  const promptContext = JSON.stringify(contextPayload, null, 2);
  return `你是天气与出行助手。请结合上下文给出准确、简洁、可执行的建议。\n\n上下文信息：\n${promptContext}\n\n用户问题：${userQuestion}`;
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

async function requestGlmAnswer(question, contextPayload) {
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
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: buildAiPrompt(contextPayload, question)
        }
      ]
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
    const answer = await requestGlmAnswer(question, contextPayload);
    appendChatMessage("assistant", answer, locationSnapshot);
  } catch (error) {
    appendChatMessage("assistant", `回答失败：${error.message}`, locationSnapshot);
  } finally {
    chatSendBtn.disabled = false;
  }
}

renderContextPanel();
appendChatMessage("assistant", "我会基于你当前选中的地点与天气数据回答问题。请先点击地图或搜索地点，再提问。", {
  city: latestLocationContext.city,
  district: latestLocationContext.district
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

    map.on("click", (event) => {
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
