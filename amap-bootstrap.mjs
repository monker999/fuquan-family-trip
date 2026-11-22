const config = window.TRAVEL_AMAP_CONFIG || {};
const mapConfig = document.querySelector('#travelpack-map-config')?.textContent || '{}';
try { Object.assign(config, JSON.parse(mapConfig)); } catch {}
config.webKey = config.webKey || (config.amapWebKey && !config.amapWebKey.startsWith("{{") ? config.amapWebKey : "");
config.securityCode = config.securityCode || (config.amapSecurityCode && !config.amapSecurityCode.startsWith("{{") ? config.amapSecurityCode : "");

function wgs84ToGcj02(longitude, latitude) {
  const pi = Math.PI;
  const a = 6378245;
  const ee = 0.00669342162296594323;
  const outOfChina = (lon, lat) => lon < 73.66 || lon > 135.05 || lat < 3.86 || lat > 53.55;
  const transformLat = (lon, lat) => {
    let value = -100 + 2 * lon + 3 * lat + 0.2 * lat * lat + 0.1 * lon * lat + 0.2 * Math.sqrt(Math.abs(lon));
    value += (20 * Math.sin(6 * lon * pi) + 20 * Math.sin(2 * lon * pi)) * 2 / 3;
    value += (20 * Math.sin(lat * pi) + 40 * Math.sin(lat / 3 * pi)) * 2 / 3;
    value += (160 * Math.sin(lat / 12 * pi) + 320 * Math.sin(lat * pi / 30)) * 2 / 3;
    return value;
  };
  const transformLon = (lon, lat) => {
    let value = 300 + lon + 2 * lat + 0.1 * lon * lon + 0.1 * lon * lat + 0.1 * Math.sqrt(Math.abs(lon));
    value += (20 * Math.sin(6 * lon * pi) + 20 * Math.sin(2 * lon * pi)) * 2 / 3;
    value += (20 * Math.sin(lon * pi) + 40 * Math.sin(lon / 3 * pi)) * 2 / 3;
    value += (150 * Math.sin(lon / 12 * pi) + 300 * Math.sin(lon / 30 * pi)) * 2 / 3;
    return value;
  };
  if (outOfChina(longitude, latitude)) return [longitude, latitude];
  let dLat = transformLat(longitude - 105, latitude - 35);
  let dLon = transformLon(longitude - 105, latitude - 35);
  const radLat = latitude / 180 * pi;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi);
  dLon = (dLon * 180) / (a / sqrtMagic * Math.cos(radLat) * pi);
  return [longitude + dLon, latitude + dLat];
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Gaode JS API failed to load"));
    document.head.appendChild(script);
  });
}

function loadAmap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!config.webKey) return Promise.reject(new Error("Gaode web key is not configured"));
  if (!window.__travelAmapPromise) {
    if (config.securityCode) {
      window._AMapSecurityConfig = {
        ...(window._AMapSecurityConfig || {}),
        securityJsCode: config.securityCode,
      };
    }
    const plugins = "AMap.Polyline,AMap.Marker,AMap.ToolBar,AMap.Scale";
    const url = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.webKey)}&plugin=${plugins}`;
    window.__travelAmapPromise = loadScript(url).then(() => {
      if (!window.AMap) throw new Error("Gaode JS API did not initialize");
      return window.AMap;
    });
  }
  return window.__travelAmapPromise;
}

function stopPropagation(event) {
  event.stopPropagation();
}

async function mount({ element, days, selectedDayId }) {
  const visibleDays = selectedDayId === "all"
    ? days
    : days.filter((day) => day.id === selectedDayId);
  const AMap = await loadAmap();
  const stops = visibleDays.flatMap((day) => day.stops
    .filter((stop) => stop.location?.coordinateSystem === "WGS84")
    .map((stop) => ({ day, stop })));
  const firstPosition = stops.length
    ? wgs84ToGcj02(stops[0].stop.location.longitude, stops[0].stop.location.latitude)
    : [119.3, 26.1];
  const map = new AMap.Map(element, {
    zoom: stops.length ? 12 : 10,
    center: firstPosition,
    viewMode: "2D",
  });
  map.addControl(new AMap.ToolBar({ position: "RB" }));
  map.addControl(new AMap.Scale());
  const overlays = [];
  const bounds = [];
  let number = 0;
  visibleDays.forEach((day, dayIndex) => {
    let previous = null;
    day.stops.forEach((stop) => {
      number += 1;
      const location = stop.location;
      if (!location || location.coordinateSystem !== "WGS84") {
        previous = null;
        return;
      }
      const position = wgs84ToGcj02(location.longitude, location.latitude);
      bounds.push(position);
      const markerContent = document.createElement("div");
      markerContent.className = "route-amap-pin";
      markerContent.textContent = String(number);
      const marker = new AMap.Marker({
        map,
        position,
        title: stop.name,
        content: markerContent,
        anchor: "center",
        zIndex: 100 + number,
      });
      marker.on("click", () => element.dispatchEvent(new CustomEvent("travel:select-stop", {
        detail: stop.id,
        bubbles: true,
      })));
      overlays.push(marker);
      if (previous) {
        overlays.push(new AMap.Polyline({
          map,
          path: [previous, position],
          strokeColor: dayIndex % 2 ? "#8a58c7" : "#1766e3",
          strokeWeight: 3,
          strokeStyle: "dashed",
          strokeOpacity: 0.9,
        }));
      }
      previous = position;
    });
  });
  if (bounds.length === 1) map.setZoom(14);
  if (bounds.length > 1) {
    map.setBounds(new AMap.Bounds(
      [Math.min(...bounds.map((point) => point[0])), Math.min(...bounds.map((point) => point[1]))],
      [Math.max(...bounds.map((point) => point[0])), Math.max(...bounds.map((point) => point[1]))],
    ), false, [40, 40, 40, 40]);
  }
  element.addEventListener("mousedown", stopPropagation);
  element.addEventListener("touchstart", stopPropagation, { passive: true });
  return {
    remove() {
      overlays.forEach((overlay) => overlay.setMap(null));
      map.destroy();
      element.removeEventListener("mousedown", stopPropagation);
      element.removeEventListener("touchstart", stopPropagation);
    },
  };
}

window.TRAVEL_MAP_ADAPTER = { provider: "高德", mount };
