const config = window.TRAVEL_AMAP_CONFIG || {};
const mapConfig = document.querySelector('#travelpack-map-config')?.textContent || '{}';
try { Object.assign(config, JSON.parse(mapConfig)); } catch {}
config.webKey = config.webKey || (config.amapWebKey && !config.amapWebKey.startsWith("{{") ? config.amapWebKey : "");
config.securityCode = config.securityCode || (config.amapSecurityCode && !config.amapSecurityCode.startsWith("{{") ? config.amapSecurityCode : "");

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

function withTimeout(promise, delay, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), delay);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function mount({ element, days, selectedDayId }) {
  const visibleDays = selectedDayId === "all"
    ? days
    : days.filter((day) => day.id === selectedDayId);
  const AMap = await withTimeout(loadAmap(), 8000, "Gaode JS API load timed out");
  const stops = visibleDays.flatMap((day) => day.stops
    .filter((stop) => stop.location?.coordinateSystem === "WGS84")
    .map((stop) => ({ day, stop })));
  const positions = new Map(stops.map((stop) => [stop.stop.id, [stop.stop.location.longitude, stop.stop.location.latitude]]));
  const firstPosition = stops.length ? positions.get(stops[0].stop.id) : [119.3, 26.1];
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
      const position = positions.get(stop.id);
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
