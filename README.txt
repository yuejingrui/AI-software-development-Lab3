Lab3 地图页面 API Key 配置说明

1) 需要配置的 Key
- 高德 Web 端安全密钥 securityJsCode：0b3a29dd2c8de139381b13566e4a033e
- 高德 Web 端 Key：e7d63bfc30870838ca2f0a8c74db7bb0
- 高德 Web 服务 Key：8b5caefd85b6781250f33b3e34c6bab0

2) 配置位置
- 在 index.html 中，将 window._AMapSecurityConfig.securityJsCode 的占位符替换为你的真实安全密钥
- 在 index.html 中，将 window.AMAP_KEYS.jsKey 与 window.AMAP_KEYS.webServiceKey 的占位符替换为真实值
