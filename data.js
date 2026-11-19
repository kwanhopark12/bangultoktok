/* ============================================================
   구글시트에서 데이터를 읽어오는 부분 (config.js 다음에 로드)

   시트의 "첫 줄(제목 줄)" 이름을 보고 열을 자동으로 찾아냅니다.
   그래서 열 순서가 어떻게 되어 있든 대부분 그대로 동작합니다.

   지원하는 시트 모양 두 가지:
   ① 한 줄 = 화분 하나   예) 시간 | 보드 | 화분 | 토양수분 | 온도 | 습도 | 조도 | 펌프
   ② 한 줄 = 화분 전체   예) 시간 | A1 | A2 | B1 | ... | D2 | 온도 | 습도 | 조도
   ============================================================ */

/* ---------- 값 변환 ---------- */
function toNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) && String(v).match(/\d/) ? n : null;
}

function toBool(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "on", "1", "yes", "켜짐", "가동", "작동", "급수"].includes(s);
}

// 시트에서 오는 여러 가지 날짜 모양을 Date로 변환
function parseTimestamp(v, formatted) {
  if (v == null || v === "") return formatted ? parseTimestamp(formatted) : null;

  if (typeof v === "number") {
    if (v > 1e12) return new Date(v);                 // 밀리초
    if (v > 1e9) return new Date(v * 1000);           // 초
    if (v > 20000 && v < 80000) {                     // 구글시트 날짜 일련번호
      return new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
    }
    return null;
  }

  const s = String(v).trim();

  // gviz 날짜 형식: Date(2026,10,5,14,3,0)  ← 월은 0부터 시작
  let m = s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+))?(?:,(\d+))?(?:,(\d+))?/);
  if (m) return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

  // ISO 형식 (2026-11-05T14:03:00Z)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }

  // "2026. 11. 5 오후 2:03:00" / "2026-11-05 14:03" / "2026/11/05 14:03:00"
  m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*?(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let hour = +m[5];
    const ampm = (m[4] || m[8] || "").toUpperCase();
    if ((ampm === "오후" || ampm === "PM") && hour < 12) hour += 12;
    if ((ampm === "오전" || ampm === "AM") && hour === 12) hour = 0;
    return new Date(+m[1], +m[2] - 1, +m[3], hour, +m[6], +(m[7] || 0));
  }

  // 날짜만 있는 경우 "2026. 11. 5"
  m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  return null;
}

// "A-1", "a1", " A1 " → "A1" / 숫자 1~8 → A1~D2
function normalizePotId(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v >= 1 && v <= POT_IDS.length) return POT_IDS[v - 1];
  const s = String(v).toUpperCase().replace(/[\s\-_.]/g, "");
  const m = s.match(/([A-D])([12])/);
  if (m) return m[1] + m[2];
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= POT_IDS.length) return POT_IDS[n - 1];
  return s;
}

/* ---------- 시트 화분 이름 → 실제 화분 (config.js 의 POT_NAME_FIX) ---------- */
// 그 줄의 fw_ver 가 "0.4" 로 시작하면(옛 펌웨어) 실제 화분 이름으로 바꿈. 0.5.x 이상은 그대로.
// fw_ver 가 비어 있는 줄은 옛 펌웨어 줄로 봄 (새 펌웨어는 항상 fw_ver 를 적어요)
function isOldFw(fw) {
  const v = fw == null ? "" : String(fw).trim();
  if (!v) return true;
  return v.startsWith(POT_NAME_FIX.oldFwPrefix || "0.4");
}

// fw 가 undefined 면(시트에 fw_ver 열 자체가 없음) 바꾸지 않음
function fixPotName(pot, fw) {
  if (!isPotFixActive() || !pot || fw === undefined) return pot;
  return isOldFw(fw) ? (POT_NAME_FIX.map[pot] || pot) : pot;
}

function isPotFixActive() {
  return typeof POT_NAME_FIX !== "undefined" && POT_NAME_FIX.enabled !== false;
}

/* ---------- 열 자동 인식 ---------- */
// 각 항목을 찾는 규칙. avoid 에 걸리는 제목은 건너뜀, prefer 에 맞는 제목을 먼저 고름
const COLUMN_RULES = [
  { key: "fw",       re: /^fw|firmware|펌웨어/i },
  { key: "time",     re: /time|date|stamp|^ts\b|^ts_|_ts$|타임|시간|시각|일시|날짜/i, prefer: /server|서버/i },
  { key: "board",    re: /board|보드|device_id|esp/i },
  { key: "soilPct",  re: /(soil|moist|토양|수분).*(pct|percent|%|퍼센트|율)|(pct|percent|%|퍼센트|율).*(soil|moist|토양|수분)/i },
  { key: "soilRaw",  re: /(soil|moist|토양|수분).*(raw|adc|원시|센서값)|(raw|adc|원시).*(soil|moist|토양|수분)/i },
  { key: "soil",     re: /soil|moist|토양|수분/i },
  { key: "pot",      re: /pot|화분|plant|번호|채널|^ch|channel/i },
  { key: "temp",     re: /temp|온도/i },
  { key: "humidity", re: /hum|습도/i },
  { key: "light",    re: /lux|light|조도|광/i, prefer: /lux|조도/i },
  { key: "pump",     re: /pump|펌프|급수|관수|relay|릴레이/i },
];
const AVOID_LABEL = /treat|처리구|실험/i;   // treat_light / treat_water 같은 실험 표시 열은 무시
const DEFAULT_ORDER = ["time", "board", "pot", "soil", "temp", "humidity", "light", "pump"];
const KEY_LABELS = {
  time: "측정 시간", board: "보드", pot: "화분 번호", soil: "토양수분",
  soilPct: "토양수분 (%)", soilRaw: "토양수분 (센서 원시값)",
  temp: "온도", humidity: "습도", light: "조도", pump: "펌프", fw: "펌웨어 버전",
};

function potFromLabel(label) {
  const m = String(label || "").toUpperCase().match(/(?:^|[^A-Z])([A-D])\s*[-_]?\s*([12])(?![0-9])/);
  return m ? m[1] + m[2] : null;
}

function detectColumns(cols) {
  const labels = cols.map((c) => (c.label || "").trim());
  const ids = cols.map((c, i) => c.id || columnLetter(i));
  const map = {};
  const used = new Set();

  // ② "한 줄 = 화분 전체" 형식인지 먼저 확인 (제목에 A1, B-2 같은 이름이 2개 이상)
  const wide = {};
  labels.forEach((label, i) => {
    const pot = potFromLabel(label);
    if (pot && !AVOID_LABEL.test(label) && !/온도|습도|조도|temp|hum|light|lux|pump|펌프/i.test(label)) wide[pot] = i;
  });
  const isWide = Object.keys(wide).length >= 2;
  if (isWide) Object.values(wide).forEach((i) => used.add(i));

  COLUMN_RULES.forEach(({ key, re, prefer }) => {
    if (isWide && ["pot", "soil", "soilPct", "soilRaw", "fw"].includes(key)) return;
    if (key === "soil" && (map.soilPct != null || map.soilRaw != null)) return;
    const candidates = labels
      .map((label, idx) => ({ label, idx }))
      .filter(({ label, idx }) => !used.has(idx) && label && !AVOID_LABEL.test(label) && re.test(label));
    if (!candidates.length) return;
    const pick = (prefer && candidates.find((c) => prefer.test(c.label))) || candidates[0];
    map[key] = pick.idx;
    used.add(pick.idx);
  });

  // 제목 줄을 못 찾았으면 → 기본 순서로 가정
  const hasSoil = map.soil != null || map.soilPct != null || map.soilRaw != null;
  if (!isWide && (!hasSoil || map.pot == null)) {
    const hasAnyLabel = labels.some((l) => l);
    if (!hasAnyLabel || Object.keys(map).length <= 1) {
      DEFAULT_ORDER.forEach((key, i) => { if (i < cols.length) map[key] = i; });
    }
  }
  if (map.time == null) {
    const i = cols.findIndex((c) => c.type === "datetime" || c.type === "date");
    if (i >= 0) map.time = i;
  }

  return { format: isWide ? "wide" : "long", map, wide, labels, ids, types: cols.map((c) => c.type) };
}

function columnLetter(i) {
  let s = "";
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* ---------- 구글시트 호출 ---------- */
function gvizUrl(query, sheet) {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CONFIG.SHEET_ID)}/gviz/tq`;
  const params = new URLSearchParams({ tqx: "out:json", headers: "1", sheet: sheet || CONFIG.SHEET_NAME, t: String(Date.now()) });
  if (query) params.set("tq", query);
  return `${base}?${params.toString()}`;
}

async function gvizFetch(query, sheet) {
  let res;
  try {
    res = await fetch(gvizUrl(query, sheet), { cache: "no-store" });
  } catch (e) {
    throw new Error("구글시트에 접속하지 못했어요 (인터넷 연결 또는 시트 공유 설정을 확인하세요)");
  }
  if (!res.ok) throw new Error(`구글시트 응답 오류 (${res.status}) — 시트 ID와 공유 설정을 확인하세요`);
  const text = await res.text();
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end < 0) {
    throw new Error("시트를 읽을 수 없어요 — 공유를 '링크가 있는 모든 사용자 - 뷰어'로 바꿔주세요");
  }
  const json = JSON.parse(text.substring(start + 1, end));
  if (json.status === "error") {
    const msg = (json.errors && json.errors[0] && (json.errors[0].detailed_message || json.errors[0].message)) || "알 수 없는 오류";
    const err = new Error("시트 오류: " + msg + " (탭 이름을 확인하세요)");
    err.gviz = true;
    throw err;
  }
  return json.table;
}

// 시트에서 "마지막 limit 줄"만 가져오기 (줄 수를 먼저 센 다음 끝부분만 요청)
async function fetchTable(limit, sheet) {
  if (limit) {
    try {
      const countTable = await gvizFetch("select count(A)", sheet);
      const total = countTable.rows?.[0]?.c?.[0]?.v ?? 0;
      const offset = Math.max(0, total - limit);
      const table = await gvizFetch(`select * limit ${limit} offset ${offset}`, sheet);
      table.totalRows = total;
      return table;
    } catch (e) {
      if (!e.gviz) throw e;
      // 부분 조회가 안 되는 시트면 전체를 읽음
    }
  }
  return gvizFetch(null, sheet);
}

// 한 줄 → 토양수분 % (soil_pct 가 있으면 그대로, 없으면 soil_raw 를 보정값으로 변환)
function soilFrom(pot, pct, raw) {
  if (pct != null) return { soil: pct, soilRaw: raw, soilSource: "pct" };
  if (raw != null) return { soil: rawToPercent(pot, raw), soilRaw: raw, soilSource: "raw" };
  return { soil: null, soilRaw: null, soilSource: null };
}

function rowsToRecords(table, detected) {
  const { format, map, wide } = detected;
  const records = [];
  const cell = (r, i) => (i == null || !r.c || !r.c[i] ? null : r.c[i].v);
  const cellF = (r, i) => (i == null || !r.c || !r.c[i] ? null : r.c[i].f);

  (table.rows || []).forEach((r) => {
    const raw = cell(r, map.time);
    const common = {
      board: cell(r, map.board),
      fw: map.fw == null ? undefined : cell(r, map.fw),
      temp: toNumber(cell(r, map.temp)),
      humidity: toNumber(cell(r, map.humidity)),
      light: toNumber(cell(r, map.light)),
      time: parseTimestamp(raw, cellF(r, map.time)),
      timestamp: cellF(r, map.time) ?? raw,
    };

    if (format === "wide") {
      Object.entries(wide).forEach(([sheetPot, i]) => {
        const soil = toNumber(cell(r, i));
        if (soil == null) return;
        const pot = fixPotName(sheetPot, common.fw);
        records.push({ ...common, pot, sheetPot, soil, soilSource: "pct", pump: false });
      });
    } else {
      const sheetPot = normalizePotId(cell(r, map.pot));
      if (!sheetPot) return;
      const pot = fixPotName(sheetPot, common.fw);
      const pct = toNumber(cell(r, map.soilPct ?? map.soil));
      const rawV = toNumber(cell(r, map.soilRaw));
      const s = soilFrom(pot, pct, rawV);
      if (s.soil == null) return;
      records.push({ ...common, pot, sheetPot, ...s, pump: toBool(cell(r, map.pump)) });
    }
  });
  return records;
}

// 시트 읽기 + 열 인식 + 변환을 한 번에
async function fetchRecords(limit) {
  if (!isConfigured()) throw new Error("config.js 에 SHEET_ID 를 아직 넣지 않았어요");
  const table = await fetchTable(limit);
  const detected = detectColumns(table.cols || []);
  const records = rowsToRecords(table, detected);
  return { records, detected, rowCount: (table.rows || []).length, totalRows: table.totalRows };
}

function byTime(a, b) {
  if (a.time && b.time) return a.time - b.time;
  return 0;
}

// 나의 식물 화면용: 화분별 "가장 최근 값" 하나씩 (+ result._env 에 최신 온도·습도·햇빛)
async function fetchLatestByPot() {
  const { records } = await fetchRecords(CONFIG.LATEST_ROWS);
  const result = latestByPot(records);
  result._env = computeEnv(records);
  return result;
}

// 최신 온도·습도·햇빛. 햇빛은 LED 구역(A·B)과 자연광 구역(C·D)을 따로 계산
function computeEnv(records) {
  const env = { temp: null, humidity: null, lightLed: null, lightNatural: null, time: null };
  const latestLight = {};
  [...records].sort(byTime).forEach((r) => {
    if (r.temp != null) { env.temp = r.temp; env.time = r.time; }
    if (r.humidity != null) env.humidity = r.humidity;
    if (r.light != null) latestLight[r.pot] = r.light;
  });
  const avgOf = (ids) => {
    const v = ids.map((id) => latestLight[id]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  env.lightLed = avgOf(POT_IDS.filter((id) => POT_CONFIG[id].led));
  env.lightNatural = avgOf(POT_IDS.filter((id) => !POT_CONFIG[id].led));
  return env;
}

// 기록 화면용: 화분별 기록 → 시간대별 온도·습도·햇빛(구역별) 묶음
function buildEnvSeries(history) {
  const buckets = new Map();
  POT_IDS.forEach((id) => (history[id] || []).forEach((r) => {
    if (!r.time) return;
    const key = r.time.getTime();
    if (!buckets.has(key)) buckets.set(key, { time: r.time, temp: [], humidity: [], led: [], natural: [] });
    const b = buckets.get(key);
    if (r.temp != null) b.temp.push(r.temp);
    if (r.humidity != null) b.humidity.push(r.humidity);
    if (r.light != null) (POT_CONFIG[id].led ? b.led : b.natural).push(r.light);
  }));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .map((b) => ({ time: b.time, temp: avg(b.temp), humidity: avg(b.humidity), lightLed: avg(b.led), lightNatural: avg(b.natural) }));
}

function latestByPot(records) {
  const result = {};
  records.forEach((r) => {
    const prev = result[r.pot];
    if (!prev || !prev.time || !r.time || r.time >= prev.time) result[r.pot] = r;
  });
  return result;
}

function emptyByPot() {
  const result = {};
  POT_IDS.forEach((id) => (result[id] = []));
  return result;
}

/* ------------------------------------------------------------
   기록 화면용: 시트에 줄이 아주 많아도(수십만 줄) 빠르게 보도록
   구글 쪽에서 "화분별 · 시간별(또는 하루별) 평균"을 계산해서 받아옵니다.
   rangeHours: 24, 168(7일), 720(30일), null(전체)
------------------------------------------------------------- */
function gvizDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function fetchHistoryByPot(rangeHours) {
  if (!isConfigured()) throw new Error("config.js 에 SHEET_ID 를 아직 넣지 않았어요");

  // 1) 마지막 몇 줄로 열 구조를 확인
  const sample = await fetchTable(50);
  const detected = detectColumns(sample.cols || []);
  const { map, ids, format } = detected;
  // soil_pct(서버 계산)와 soil_raw 가 둘 다 있으면 둘 다 평균 → 칸마다 pct 우선, 없으면 raw 를 보정값으로
  const pctIdx = map.soilPct ?? (map.soilRaw == null ? map.soil : null);
  const rawIdx = map.soilRaw ?? null;

  // 2) 구글 쪽 평균 계산 (시간 열이 날짜 형식일 때만 가능)
  if (format === "long" && map.time != null && map.pot != null && (pctIdx != null || rawIdx != null)) {
    const T = ids[map.time], P = ids[map.pot];
    const F = map.fw != null ? ids[map.fw] : null;   // 옛 펌웨어 줄을 구분하려고 fw_ver 로도 묶음
    const daily = !rangeHours || rangeHours > 24 * 31;
    const groupCols = daily
      ? `year(${T}), month(${T}), day(${T})`
      : `year(${T}), month(${T}), day(${T}), hour(${T})`;
    const soilCols = [pctIdx, rawIdx].filter((i) => i != null).map((i) => ids[i]);
    const where = [`(${soilCols.map((c) => `${c} is not null`).join(" or ")})`];
    if (rangeHours) where.push(`${T} >= datetime '${gvizDateTime(new Date(Date.now() - rangeHours * 3600 * 1000))}'`);

    const extraKeys = ["pump", "temp", "humidity", "light"].filter((k) => map[k] != null);
    const tryQuery = async (keys, withFw) => {
      const lead = withFw && F ? [P, F] : [P];
      const parts = soilCols.map((c) => `avg(${c})`)
        .concat(keys.map((k) => (k === "pump" ? `max(${ids[map[k]]})` : `avg(${ids[map[k]]})`)));
      const q = `select ${lead.join(", ")}, ${groupCols}, ${parts.join(", ")} where ${where.join(" and ")} group by ${lead.join(", ")}, ${groupCols}`;
      return { table: await gvizFetch(q), keys, withFw: withFw && Boolean(F) };
    };

    try {
      let got = null;
      const attempts = [[extraKeys, true], [[], true], [extraKeys, false], [[], false]];
      for (const [keys, withFw] of attempts) {
        try { got = await tryQuery(keys, withFw); break; }
        catch (e) { if (!e.gviz) throw e; }
      }
      if (!got) throw Object.assign(new Error("집계 실패"), { gviz: true });

      // 같은 화분·같은 시간칸이 fw 별로 나뉘어 오면 합침
      const merged = new Map();
      const nLead = got.withFw ? 2 : 1;
      const nTime = daily ? 3 : 4;
      (got.table.rows || []).forEach((r) => {
        const v = r.c.map((c) => (c ? c.v : null));
        const time = new Date(v[nLead], v[nLead + 1], v[nLead + 2], daily ? 12 : v[nLead + 3], 0, 0); // gviz month()는 0부터
        const fw = got.withFw ? v[1] : null;
        const pot = got.withFw ? fixPotName(normalizePotId(v[0]), fw) : normalizePotId(v[0]);
        if (!POT_IDS.includes(pot)) return;
        let k = nLead + nTime;
        const pctAvg = pctIdx != null ? toNumber(v[k++]) : null;
        const rawAvg = rawIdx != null ? toNumber(v[k++]) : null;
        const s = soilFrom(pot, pctAvg, rawAvg);
        if (s.soil == null) return;
        const extra = {};
        got.keys.forEach((key, j) => { extra[key] = toNumber(v[k + j]); });
        const id = pot + "|" + time.getTime();
        const prev = merged.get(id);
        const rec = {
          pot, ...s, time, timestamp: time.toISOString(),
          temp: extra.temp ?? null, humidity: extra.humidity ?? null, light: extra.light ?? null,
          pump: (extra.pump ?? 0) > 0, aggregated: daily ? "day" : "hour",
        };
        if (!prev) merged.set(id, rec);
        else {   // 펌웨어가 바뀐 시간칸: 단순 평균으로 합침
          const mix = (a, b) => (a == null ? b : b == null ? a : (a + b) / 2);
          merged.set(id, { ...prev, soil: mix(prev.soil, rec.soil), temp: mix(prev.temp, rec.temp),
            humidity: mix(prev.humidity, rec.humidity), light: mix(prev.light, rec.light), pump: prev.pump || rec.pump });
        }
      });
      const result = emptyByPot();
      merged.forEach((rec) => result[rec.pot].push(rec));
      POT_IDS.forEach((id) => result[id].sort(byTime));
      result._meta = { mode: daily ? "day" : "hour", totalRows: sample.totalRows, fwSplit: got.withFw };
      return result;
    } catch (e) {
      if (!e.gviz) throw e;
      // 시간 열이 날짜 형식이 아니면 평균 계산이 안 됨 → 최근 줄을 직접 읽음
    }
  }

  // 3) 대신 최근 HISTORY_ROWS 줄을 직접 읽기
  const { records, totalRows } = await fetchRecords(CONFIG.HISTORY_ROWS);
  const result = emptyByPot();
  records.forEach((r) => { if (result[r.pot]) result[r.pot].push(r); });
  POT_IDS.forEach((id) => result[id].sort(byTime));
  result._meta = { mode: "raw", totalRows, limited: totalRows > CONFIG.HISTORY_ROWS };
  return result;
}

// 기록 화면 "표로 보기"용: 시트 맨 끝의 실제 측정값
async function fetchRecentRows(limit = 300) {
  const { records } = await fetchRecords(limit);
  return records.sort((a, b) => (b.time?.getTime() || 0) - (a.time?.getTime() || 0));
}

/* ============================================================
   급수 기록 (pump_log 탭) — ESP32 펌웨어가 쓰고, 대시보드는 읽기만
   열: ts_server, pot_id, mode, trigger_soil_pct, duration_ms, result, fw_ver,
       board_id, trigger_soil_raw, ml, ts_event, uptime_s
   ============================================================ */
const PUMP_MODE_LABEL = {
  sensor: "실험: 센서", static: "실험: 정해진 시각", manual: "버튼(수동)",
  schedule: "예약", user_threshold: "수분 기준", threshold: "수분 기준", user: "수분 기준",
  shadow: "판단만(시험)",
};
const PUMP_RESULT_LABEL = {
  ok: "급수함", ok_manual: "급수함", would_water: "줄 뻔함(시험)", fail_reset: "실패(재부팅)",
};
function pumpResultLabel(r) {
  if (!r) return "-";
  if (PUMP_RESULT_LABEL[r]) return PUMP_RESULT_LABEL[r];
  if (String(r).startsWith("skip")) return "건너뜀 (" + String(r).replace(/^skip_?/, "") + ")";
  return String(r);
}

async function fetchPumpLog(limit = 100) {
  if (!isConfigured()) throw new Error("config.js 에 SHEET_ID 를 아직 넣지 않았어요");
  const sheet = CONFIG.PUMP_LOG_SHEET || "pump_log";
  let table;
  try { table = await fetchTable(limit, sheet); }
  catch (e) {
    if (e.gviz) return { missing: true, rows: [] };   // 아직 pump_log 탭이 없음
    throw e;
  }
  const labels = (table.cols || []).map((c) => String(c.label || "").trim().toLowerCase());
  const idx = (name) => labels.indexOf(name);
  const I = {
    time: idx("ts_server"), pot: idx("pot_id"), mode: idx("mode"), pct: idx("trigger_soil_pct"),
    ms: idx("duration_ms"), result: idx("result"), fw: idx("fw_ver"), board: idx("board_id"),
    raw: idx("trigger_soil_raw"), ml: idx("ml"), event: idx("ts_event"),
  };
  const cell = (r, i) => (i < 0 || !r.c || !r.c[i] ? null : r.c[i].v);
  const cellF = (r, i) => (i < 0 || !r.c || !r.c[i] ? null : r.c[i].f);
  const rows = (table.rows || []).map((r) => {
    const tEvent = parseTimestamp(cell(r, I.event), cellF(r, I.event));
    const tServer = parseTimestamp(cell(r, I.time), cellF(r, I.time));
    return {
      time: tEvent || tServer,
      pot: normalizePotId(cell(r, I.pot)),
      mode: String(cell(r, I.mode) ?? ""),
      result: String(cell(r, I.result) ?? ""),
      soilPct: toNumber(cell(r, I.pct)),
      soilRaw: toNumber(cell(r, I.raw)),
      ms: toNumber(cell(r, I.ms)),
      ml: toNumber(cell(r, I.ml)),
      fw: cell(r, I.fw),
      board: cell(r, I.board),
    };
  }).filter((r) => r.pot);
  rows.sort((a, b) => (b.time?.getTime() || 0) - (a.time?.getTime() || 0));
  return { missing: false, rows };
}

/* ============================================================
   데모(가짜) 데이터 — SHEET_ID 가 없거나 연결이 안 될 때 화면을 보여주기 위함
   (3일 동안 30분 간격으로, 마르고 → 급수되는 흐름을 흉내 냄)
   ============================================================ */
let demoHistoryCache = null;

function buildDemoHistory() {
  const now = Date.now();
  const step = 30 * 60 * 1000;
  const points = 3 * 48;
  const start = [52, 48, 61, 40, 55, 50, 44, 39];
  const result = {};
  POT_IDS.forEach((id, idx) => {
    let v = start[idx];
    const auto = POT_CONFIG[id].waterMode === "자동";
    const arr = [];
    for (let i = points; i >= 0; i--) {
      const t = new Date(now - i * step);
      const hour = t.getHours();
      const dayLoss = hour >= 9 && hour <= 18 ? 0.55 : 0.2;  // 낮에 더 빨리 마름
      v -= dayLoss + Math.random() * 0.25;
      let pump = false;
      if (auto && v < 36) { v += 18; pump = true; }                 // 센서 기반 자동 급수
      if (!auto && hour === 9 && t.getMinutes() < 30) { v += 22; pump = true; } // 매일 아침 타이머
      v = Math.max(8, Math.min(90, v));
      arr.push({
        pot: id, soil: Math.round(v * 10) / 10, pump,
        temp: 23 + 3 * Math.sin(((hour - 8) / 24) * Math.PI * 2),
        humidity: 55 - 8 * Math.sin(((hour - 8) / 24) * Math.PI * 2),
        light: hour >= 7 && hour <= 19 ? (POT_CONFIG[id].led ? 9000 : 4000) : (POT_CONFIG[id].led ? 6000 : 0),
        time: t, timestamp: t.toISOString(),
      });
    }
    result[id] = arr;
  });
  return result;
}

function getDemoHistory() {
  if (!demoHistoryCache) demoHistoryCache = buildDemoHistory();
  return demoHistoryCache;
}

function getDemoLatest() {
  const hist = getDemoHistory();
  const result = {};
  const all = [];
  POT_IDS.forEach((id) => {
    const last = hist[id][hist[id].length - 1];
    result[id] = { ...last, soil: Math.round((last.soil + (Math.random() - 0.5) * 0.6) * 10) / 10, time: new Date() };
    all.push(result[id]);
  });
  result._env = computeEnv(all);
  return result;
}

/* ============================================================
   자동 새로고침 도우미: 정해진 간격 + 휴대폰에서 앱으로 돌아왔을 때 바로 새로고침
   ============================================================ */
function startAutoRefresh(fn, minSec = 5) {
  let running = false, pending = false;
  const run = async () => {
    if (running) { pending = true; return; }   // 진행 중이면 끝난 뒤 한 번 더
    running = true;
    try { await fn(); } finally {
      running = false;
      if (pending) { pending = false; run(); }
    }
  };
  run();
  setInterval(run, Math.max(minSec, getSettings().refreshSec) * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  return run;
}

function setStatus(mode, extra) {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  if (!dot || !text) return;
  dot.className = "status-dot " + mode;
  if (mode === "live") text.textContent = "구글시트 실시간 연결됨";
  else if (mode === "demo") text.textContent = "데모 모드 (config.js 에 시트 ID를 넣으면 실제 데이터가 나와요)";
  else text.textContent = "연결 실패 — 데모 데이터로 표시 중" + (extra ? ` (${extra})` : "");
}
