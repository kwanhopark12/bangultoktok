/* ============================================================
   방울톡톡 설정 파일
   ★ 처음 한 번만: 아래 SHEET_ID 와 SHEET_NAME 두 줄을 채우세요. ★
   이 파일 하나만 고치면 모든 화면(홈/나의 식물/기록/설정)에 적용됩니다.
   ============================================================ */
const CONFIG = {
  // 구글시트 주소에서 /d/ 와 /edit 사이의 긴 문자열
  // 예) https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK123/edit#gid=0  →  1AbCdEfGhIjK123
  SHEET_ID: "1ytdnAIT13a8i6_F9ETjcXemG2uP22TuH1FxzUCKCZLA",

  // 센서 데이터가 쌓이는 탭 이름 (시트 아래쪽 탭에 보이는 이름 그대로)
  SHEET_NAME: "env_log",

  // 나의 식물 화면: 시트 맨 끝에서 몇 줄을 읽어 최신값을 찾을지
  LATEST_ROWS: 400,
  // 기록 화면: 시간별 평균 계산이 안 될 때 대신 읽을 최근 줄 수
  HISTORY_ROWS: 6000,

  // 마지막 측정 후 이 시간(분)이 지나도 새 데이터가 없으면 "센서 확인" 경고를 띄움
  // (펌웨어 0.5.x 부터 10분마다 올라와요)
  STALE_MINUTES: 30,

  // 급수 기록이 쌓이는 탭 이름 (ESP32 펌웨어가 씀, 대시보드는 읽기만)
  PUMP_LOG_SHEET: "pump_log",

  // ★ 급수 명령 서버(Apps Script) 웹 앱 주소 — "급수명령서버_설치방법.txt" 5단계에서 복사한 주소
  //   이 주소는 공개돼도 괜찮아요(비밀번호가 있어야 물을 줄 수 있음).
  //   ⚠️ 센서 데이터를 올리는 기존 Apps Script 주소를 여기에 넣으면 절대 안 돼요!
  WATER_API_URL: "https://script.google.com/macros/s/AKfycbymJRKVdWgc_Y0S51TLAVoX0jJDcpGbuetIYYFfYuEVpjz2usabG42SSTZhsdSC_HUW/exec",
};

// 펌프가 실제로 연결된 화분 (여기 있는 화분만 "물 주기" 버튼이 켜져요)
// 펌프를 더 달면 여기에 추가하세요.  예) ["A1", "A2", "B1", "B2"]
const PUMP_INSTALLED = ["A1", "A2"];

// 펌프 1초에 나오는 물 양 (ml). 재 보면 적어 주세요 → 화면에 "약 몇 ml" 로 같이 보여줘요.
//   재는 법: 5초·15초 돌려서 컵 무게(g) 재기 → (15초 무게 − 5초 무게) ÷ 10
const PUMP_ML_PER_SEC = { A1: null, A2: null };

// 화분별 고정 실험 설정 (2×2: LED 보광 × 급수 방식)
//   A/B = LED 보광 구역, C/D = 자연광 구역
//   A/C = 센서 기반 급수(흙이 마르면), B/D = 정적 급수(정해진 시각·정해진 양)
const POT_CONFIG = {
  A1: { group: "보광 + 센서", led: true,  waterMode: "센서 기반" },
  A2: { group: "보광 + 센서", led: true,  waterMode: "센서 기반" },
  B1: { group: "보광 + 정적", led: true,  waterMode: "정해진 시각" },
  B2: { group: "보광 + 정적", led: true,  waterMode: "정해진 시각" },
  C1: { group: "자연광 + 센서", led: false, waterMode: "센서 기반" },
  C2: { group: "자연광 + 센서", led: false, waterMode: "센서 기반" },
  D1: { group: "자연광 + 정적", led: false, waterMode: "정해진 시각" },
  D2: { group: "자연광 + 정적", led: false, waterMode: "정해진 시각" },
};
const POT_IDS = Object.keys(POT_CONFIG);

/* ------------------------------------------------------------
   ★ 예전 기록의 화분 이름 바로잡기 (자동)
   펌웨어 0.4.x 로 찍힌 줄은 화분 이름이 뒤바뀌어 있어요. 0.5.x 부터는 시트 이름 = 실제 화분.
   → 각 줄의 fw_ver 를 보고 "0.4" 로 시작하는 줄만 아래 표대로 바꿔서 보여줘요.

     0.4.x 시트 이름        →   실제 화분
     C1, C2, D1, D2        →   A1, A2, B1, B2
     A1, A2, B2, B1        →   C1, C2, D1, D2   (D1/D2 순서는 현우 확인 전 — 바뀌면 아래 두 줄만 고치기)
------------------------------------------------------------- */
const POT_NAME_FIX = {
  enabled: true,
  oldFwPrefix: "0.4",
  map: {
    C1: "A1", C2: "A2", D1: "B1", D2: "B2",
    A1: "C1", A2: "C2",
    B2: "D1",
    B1: "D2",
  },
};

/* ------------------------------------------------------------
   토양수분 센서 보정값 (soil_raw → % 로 바꿀 때 사용) — "실제 화분 이름" 기준
   ★ 시트에 soil_pct 값이 있으면(서버가 calib 탭으로 계산) 그 값을 먼저 써요.
     soil_pct 가 비어 있는 줄만 아래 값으로 계산해요.

   dry = 0% 기준 soil_raw, wet = 100% 기준 soil_raw
   아래는 2026-11-05 공기/물 측정값이에요 (calib 탭의 흙 기준값과는 달라서 % 가 높게 나올 수 있어요).
   D1/D2 는 센서 순서 확인 전이라 바뀔 수 있어요.
------------------------------------------------------------- */
const SOIL_CALIBRATION_DEFAULT = { dry: 2600, wet: 900 };
const SOIL_CALIBRATION = {
  A1: { dry: 3205, wet: 1136 },
  A2: { dry: 2595, wet: 1202 },
  B1: { dry: 3205, wet: 1153 },
  B2: { dry: 3108, wet: 1047 },
  C1: { dry: 3035, wet: 917 },
  C2: { dry: 3035, wet: 982 },
  D1: { dry: 3019, wet: 973 },
  D2: { dry: 2774, wet: 971 },
};

function rawToPercent(pot, raw) {
  if (raw == null || isNaN(raw)) return null;
  const c = SOIL_CALIBRATION[pot] || SOIL_CALIBRATION_DEFAULT;
  if (c.dry === c.wet) return null;
  const pct = ((c.dry - raw) / (c.dry - c.wet)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
}

function isCalibrated(pot) {
  return Boolean(SOIL_CALIBRATION[pot]);
}

/* ------------------------------------------------------------
   사용자 설정 (설정 화면에서 바꾸는 값). 기기(휴대폰/컴퓨터)마다 따로 저장됩니다.
------------------------------------------------------------- */
const DEFAULT_SETTINGS = {
  dryMax: 35,      // 이 값(%) 미만이면 "물이 필요해요"
  wetMin: 65,      // 이 값(%) 초과면 "너무 많아요"
  refreshSec: 30,  // 자동 새로고침 간격(초)
};
const SETTINGS_KEY = "bangultoktok-settings";

function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return true;
  } catch (e) {
    return false;
  }
}

function resetSettings() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
}

/* ------------------------------------------------------------
   상태(건조/촉촉/과습) 판정과 색상
------------------------------------------------------------- */
const STATUS_INFO = {
  dry:     { color: "#d03b3b", label: "🌵 물이 필요해요" },
  optimal: { color: "#0ca30c", label: "🌱 촉촉해요" },
  wet:     { color: "#ec835a", label: "💧 물이 너무 많아요" },
  unknown: { color: "#898781", label: "데이터 없음" },
};

function classifyMoisture(value) {
  const s = getSettings();
  if (value == null || isNaN(value)) return "unknown";
  if (value < s.dryMax) return "dry";
  if (value > s.wetMin) return "wet";
  return "optimal";
}

function isConfigured() {
  return Boolean(CONFIG.SHEET_ID) && CONFIG.SHEET_ID !== "여기에_시트ID_붙여넣기";
}

/* ------------------------------------------------------------
   작은 도우미 함수들
------------------------------------------------------------- */
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function formatAgo(date) {
  if (!date) return "";
  const min = Math.round((Date.now() - date.getTime()) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function formatTime(date, fallback) {
  if (!date) return fallback ?? "-";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
