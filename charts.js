/* ============================================================
   기록 화면의 화분별 토양수분 추이 그래프 (외부 라이브러리 없이 SVG로 그림)
   - 세로축은 항상 0~100% 고정 → 화분끼리 바로 비교 가능
   - 연한 초록 띠 = 적정 범위 (설정의 건조 기준 ~ 과습 기준)
   - 그래프 위를 손가락/마우스로 훑으면 그 시점의 값과 시간이 보임
   ============================================================ */
const CHART = { W: 300, H: 120, L: 26, R: 8, T: 8, B: 20 };

// 점이 너무 많으면 구간 평균으로 줄여서 휴대폰에서도 가볍게
function downsample(points, max = 120) {
  if (points.length <= max) return points;
  const size = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) {
    const slice = points.slice(Math.floor(i * size), Math.max(Math.floor((i + 1) * size), Math.floor(i * size) + 1));
    const avg = slice.reduce((a, p) => a + p.soil, 0) / slice.length;
    const last = slice[slice.length - 1];
    out.push({ ...last, soil: avg });
  }
  return out;
}

function chartX(i, n) {
  const plotW = CHART.W - CHART.L - CHART.R;
  return CHART.L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
}

function chartY(v) {
  const plotH = CHART.H - CHART.T - CHART.B;
  return CHART.T + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH;
}

function renderTrendChart(history) {
  const s = getSettings();
  const pts = downsample((history || []).filter((h) => h.soil != null && !isNaN(h.soil)));
  if (pts.length === 0) return { html: `<div class="chart-empty">이 기간에는 기록이 없어요</div>`, points: [] };

  const { W, H, L, R, B } = CHART;
  const n = pts.length;
  const coords = pts.map((p, i) => [chartX(i, n), chartY(p.soil)]);
  const line = coords.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const base = chartY(0);
  const area = `${line} L${coords[n - 1][0].toFixed(1)},${base} L${coords[0][0].toFixed(1)},${base} Z`;
  const last = coords[n - 1];

  const bandTop = chartY(s.wetMin), bandBottom = chartY(s.dryMax);
  const grid = [0, 50, 100].map((v) => `
      <line x1="${L}" x2="${W - R}" y1="${chartY(v)}" y2="${chartY(v)}" stroke="${v === 0 ? "#c3c2b7" : "#ecebe6"}" stroke-width="1"/>
      <text x="${L - 5}" y="${chartY(v) + 3}" text-anchor="end" class="axis-label">${v}</text>`).join("");

  const firstLabel = pts[0].time ? formatTime(pts[0].time) : "";
  const lastLabel = pts[n - 1].time ? formatTime(pts[n - 1].time) : "";

  const html = `
    <svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="토양수분 추이 그래프">
      <rect x="${L}" y="${bandTop}" width="${W - L - R}" height="${bandBottom - bandTop}" fill="#0ca30c" opacity="0.08"/>
      ${grid}
      <path d="${area}" fill="#2a78d6" opacity="0.10"/>
      <path d="${line}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="#2a78d6" stroke="#fcfcfb" stroke-width="2"/>
      <text x="${L}" y="${H - 5}" class="axis-label">${escapeHtml(firstLabel)}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" class="axis-label">${escapeHtml(lastLabel)}</text>
      <line class="hover-line" x1="0" x2="0" y1="${CHART.T}" y2="${base}" stroke="#898781" stroke-width="1" visibility="hidden"/>
      <circle class="hover-dot" r="5" fill="#2a78d6" stroke="#fcfcfb" stroke-width="2" visibility="hidden"/>
      <rect class="hover-hit" x="${L}" y="0" width="${W - L - R}" height="${H - B}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div>`;

  return { html, points: pts };
}

// 그래프 위를 훑을 때 값 보여주기 (마우스·터치 모두)
function attachChartHover(box, points) {
  const svg = box.querySelector("svg.trend");
  if (!svg || !points.length) return;
  const hit = svg.querySelector(".hover-hit");
  const vline = svg.querySelector(".hover-line");
  const dot = svg.querySelector(".hover-dot");
  const tip = box.querySelector(".chart-tip");
  const n = points.length;

  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * CHART.W;
    const plotW = CHART.W - CHART.L - CHART.R;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - CHART.L) / plotW) * (n - 1))));
    const p = points[i];
    const cx = chartX(i, n), cy = chartY(p.soil);
    vline.setAttribute("x1", cx); vline.setAttribute("x2", cx);
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    vline.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<b>${p.soil.toFixed(1)}%</b> · ${escapeHtml(formatTime(p.time, p.timestamp))}`;
    const left = (cx / CHART.W) * rect.width;
    tip.style.left = Math.max(0, Math.min(rect.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + "px";
  };
  const hide = () => {
    vline.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };

  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerdown", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);
}

function calcStats(history) {
  const values = (history || []).map((h) => h.soil).filter((v) => v != null && !isNaN(v));
  if (!values.length) return null;
  return {
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    waterings: (history || []).filter((h) => h.pump).length,
  };
}

/* ============================================================
   온도 · 습도 · 햇빛 같은 환경 값 그래프 (선 1개 또는 여러 개)
   rows   : [{ time, temp, humidity, lightLed, lightNatural }, ...]
   series : [{ key: "temp", name: "온도", color: "#2a78d6" }, ...]
   opts   : { min, max, unit, decimals }  (min/max 를 안 주면 값에 맞춰 자동)
   ============================================================ */
function downsampleRows(rows, keys, max = 120) {
  if (rows.length <= max) return rows;
  const size = rows.length / max;
  const out = [];
  for (let i = 0; i < max; i++) {
    const slice = rows.slice(Math.floor(i * size), Math.max(Math.floor((i + 1) * size), Math.floor(i * size) + 1));
    const row = { time: slice[slice.length - 1].time };
    keys.forEach((k) => {
      const v = slice.map((r) => r[k]).filter((x) => x != null);
      row[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });
    out.push(row);
  }
  return out;
}

function niceStep(span) {
  const raw = span / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function renderSeriesChart(rows, series, opts = {}) {
  const keys = series.map((s) => s.key);
  const data = downsampleRows((rows || []).filter((r) => keys.some((k) => r[k] != null)), keys);
  if (!data.length) return { html: `<div class="chart-empty">이 기간에는 기록이 없어요</div>`, data: [] };

  // 세로축 범위
  const values = data.flatMap((r) => keys.map((k) => r[k])).filter((v) => v != null);
  let lo = opts.min ?? Math.min(...values);
  let hi = opts.max ?? Math.max(...values);
  if (opts.min == null || opts.max == null) {
    const step = niceStep(Math.max(hi - lo, opts.minSpan || 1));
    if (opts.min == null) lo = Math.floor(lo / step) * step;
    if (opts.max == null) hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
  }
  const { W, H, L, R, T, B } = CHART;
  const n = data.length;
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const mid = (lo + hi) / 2;
  const fmtTick = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));

  const grid = [lo, mid, hi].map((v, i) => `
      <line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${i === 0 ? "#c3c2b7" : "#ecebe6"}" stroke-width="1"/>
      <text x="${L - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="axis-label">${fmtTick(v)}</text>`).join("");

  const lines = series.map((s, si) => {
    let d = "", pen = false, last = null;
    data.forEach((r, i) => {
      const v = r[s.key];
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true; last = [x(i), y(v)];
    });
    const area = series.length === 1 && d
      ? `<path d="${d} L${last[0].toFixed(1)},${y(lo).toFixed(1)} L${x(data.findIndex((r) => r[s.key] != null)).toFixed(1)},${y(lo).toFixed(1)} Z" fill="${s.color}" opacity="0.10"/>`
      : "";
    return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${last ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${s.color}" stroke="#fcfcfb" stroke-width="2"/>` : ""}
      <circle class="hover-dot hd-${si}" r="5" fill="${s.color}" stroke="#fcfcfb" stroke-width="2" visibility="hidden"/>`;
  }).join("");

  const html = `
    <svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="${escapeHtml(series.map((s) => s.name).join(", "))} 그래프">
      ${grid}
      ${lines}
      <text x="${L}" y="${H - 5}" class="axis-label">${escapeHtml(formatTime(data[0].time))}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" class="axis-label">${escapeHtml(formatTime(data[n - 1].time))}</text>
      <line class="hover-line" x1="0" x2="0" y1="${T}" y2="${y(lo)}" stroke="#898781" stroke-width="1" visibility="hidden"/>
      <rect class="hover-hit" x="${L}" y="0" width="${W - L - R}" height="${H - B}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div>`;

  return { html, data, series, x, y, opts };
}

function attachSeriesHover(box, chart) {
  const svg = box.querySelector("svg.trend");
  if (!svg || !chart.data || !chart.data.length) return;
  const { data, series, x, y, opts } = chart;
  const hit = svg.querySelector(".hover-hit");
  const vline = svg.querySelector(".hover-line");
  const tip = box.querySelector(".chart-tip");
  const n = data.length;
  const fmt = (v) => (v == null ? "-" : `${v.toFixed(opts.decimals ?? 1)}${opts.unit || ""}`);

  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * CHART.W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - CHART.L) / (CHART.W - CHART.L - CHART.R)) * (n - 1))));
    const r = data[i];
    vline.setAttribute("x1", x(i)); vline.setAttribute("x2", x(i)); vline.setAttribute("visibility", "visible");
    series.forEach((s, si) => {
      const dot = svg.querySelector(`.hd-${si}`);
      if (r[s.key] == null) { dot.setAttribute("visibility", "hidden"); return; }
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(r[s.key])); dot.setAttribute("visibility", "visible");
    });
    tip.hidden = false;
    tip.innerHTML = series.map((s) =>
      `<span class="tip-key" style="background:${s.color}"></span>${series.length > 1 ? escapeHtml(s.name) + " " : ""}<b>${fmt(r[s.key])}</b>`
    ).join("<br>") + `<br><span class="tip-time">${escapeHtml(formatTime(r.time))}</span>`;
    const left = (x(i) / CHART.W) * rect.width;
    tip.style.left = Math.max(0, Math.min(rect.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + "px";
  };
  const hide = () => {
    vline.setAttribute("visibility", "hidden");
    svg.querySelectorAll(".hover-dot").forEach((d) => d.setAttribute("visibility", "hidden"));
    tip.hidden = true;
  };
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerdown", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);
}
