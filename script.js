// 高德地图 Web 端 Key（请在本地替换为真实值，不要提交真实密钥）
const webKey = "e7d63bfc30870838ca2f0a8c74db7bb0";

// 页面结果展示区域
const resultText = document.getElementById("result-text");
// 地点搜索输入框
const placeInput = document.getElementById("place-input");
// 地点搜索按钮
const searchBtn = document.getElementById("search-btn");
// 选点聚焦缩放级别（约 10km 量级）
const FOCUS_ZOOM = 12;
// 红色水滴状标记内容
const RED_PIN_CONTENT = `
  <div style="position: relative; width: 22px; height: 22px; background: #ff4d4f; border-radius: 50% 50% 50% 0; transform: translate(-50%, -100%) rotate(-45deg); box-shadow: 0 2px 8px rgba(255, 77, 79, 0.35);">
    <div style="position: absolute; width: 8px; height: 8px; background: #ffffff; border-radius: 50%; top: 7px; left: 7px;"></div>
  </div>
`;

// 地图实例
let map;
// 选中点标记实例
let marker;
// 逆地理编码实例
let geocoder;
// 地点搜索实例
let placeSearch;
// 信息浮窗实例
let infoWindow;

// 更新顶部文本中的地点名和经纬度
function updateResult(name, lng, lat) {
  const placeName = name && name.trim() ? name : "未知地点";
  resultText.textContent = `地点：${placeName} | 经度：${lng.toFixed(6)} | 纬度：${lat.toFixed(6)}`;
}

// 显示地点信息浮窗（经纬度保留 2 位小数）
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

// 设置红色水滴标记并聚焦到选中位置
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

// 根据经纬度执行逆地理编码并回填地点信息
function reverseGeocode(position) {
  geocoder.getAddress(position, (status, result) => {
    const [lng, lat] = position;
    if (status === "complete" && result.regeocode) {
      const formattedAddress = result.regeocode.formattedAddress || "未知地点";
      updateResult(formattedAddress, lng, lat);
      showInfoWindow(formattedAddress, lng, lat);
      return;
    }
    updateResult("未知地点", lng, lat);
    showInfoWindow("未知地点", lng, lat);
  });
}

// 处理地点搜索选中结果
function selectPoi(poi) {
  if (!poi || !poi.location) {
    resultText.textContent = "未找到可定位的地点，请尝试更换关键词";
    return;
  }
  const lng = poi.location.lng;
  const lat = poi.location.lat;
  const placeName = poi.name || poi.address || "未知地点";
  setMarkerAndFocus([lng, lat]);
  updateResult(placeName, lng, lat);
  showInfoWindow(placeName, lng, lat);
}

// 执行关键词搜索并选中首个地点
function doSearch() {
  const keyword = placeInput.value.trim();
  if (!keyword) {
    resultText.textContent = "请输入要搜索的地名";
    return;
  }
  placeSearch.search(keyword, (status, result) => {
    if (status !== "complete" || !result.poiList || !result.poiList.pois.length) {
      resultText.textContent = "未找到匹配地点，请尝试其他关键词";
      return;
    }
    selectPoi(result.poiList.pois[0]);
  });
}

AMapLoader.load({
  key: webKey,
  version: "2.0",
  plugins: ["AMap.AutoComplete", "AMap.PlaceSearch", "AMap.Geocoder"]
})
  .then((AMap) => {
    map = new AMap.Map("map-container", {
      zoom: 11,
      center: [121.4737, 31.2304]
    });

    geocoder = new AMap.Geocoder();
    placeSearch = new AMap.PlaceSearch({ pageSize: 10, pageIndex: 1 });
    infoWindow = new AMap.InfoWindow({
      offset: new AMap.Pixel(0, -24),
      autoMove: true
    });

    const autoComplete = new AMap.AutoComplete({
      input: "place-input"
    });

    autoComplete.on("select", (event) => {
      selectPoi(event.poi);
    });

    map.on("click", (event) => {
      const lng = event.lnglat.getLng();
      const lat = event.lnglat.getLat();
      const position = [lng, lat];
      setMarkerAndFocus(position);
      reverseGeocode(position);
    });

    searchBtn.addEventListener("click", doSearch);
    placeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        doSearch();
      }
    });
  })
  .catch((error) => {
    resultText.textContent = "地图加载失败，请检查 Key 或网络设置";
    console.error(error);
  });
