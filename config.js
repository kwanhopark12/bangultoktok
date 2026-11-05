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
  STALE_MINUTES: 30,
};

// 화분별 고정 실험 설정 (계획서 기준: A/B = LED 보강조명 구역, C/D = 자연광 구역
//                                   A/C = 스마트 자동급수, B/D = 관행/타이머 급수)
const POT_CONFIG = {
  A1: { group: "완전 스마트형", led: true,  waterMode: "자동" },
  A2: { group: "완전 스마트형", led: true,  waterMode: "자동" },
  B1: { group: "조명 관행형",   led: true,  waterMode: "타이머" },
  B2: { group: "조명 관행형",   led: true,  waterMode: "타이머" },
  C1: { group: "관수 스마트형", led: false, waterMode: "자동" },
  C2: { group: "관수 스마트형", led: false, waterMode: "자동" },
  D1: { group: "완전 관행형",   led: false, waterMode: "타이머" },
  D2: { group: "완전 관행형",   led: false, waterMode: "타이머" },
};
const POT_IDS = Object.keys(POT_CONFIG);

/* ------------------------------------------------------------
   토양수분 센서 보정값 (soil_raw 센서값 → % 로 바꿀 때 사용)
   시트의 soil_pct 열이 비어 있으면 soil_raw 를 아래 값으로 % 계산합니다.

   dry = 센서를 흙에서 빼서 "공기 중"에 들고 있을 때의 soil_raw 값 (0%)
   wet = 센서를 물컵에 "선 높이까지" 담갔을 때의 soil_raw 값      (100%)

   ★ 화분마다 측정해서 null 대신 넣어주세요. 예)  A1: { dry: 2650, wet: 1020 },
   null 이면 아래 기본값(DEFAULT)을 쓰는데, 정확하지 않아요.
------------------------------------------------------------- */
const SOIL_CALIBRATION_DEFAULT = { dry: 2600, wet: 900 };
const SOIL_CALIBRATION = {
  A1: { dry: 3035, wet: 917 },
  A2: { dry: 3035, wet: 982 },
  B1: { dry: 2774, wet: 971 },
  B2: { dry: 3019, wet: 973 },
  C1: { dry: 3205, wet: 1136 },
  C2: { dry: 2595, wet: 1202 },
  D1: { dry: 3205, wet: 1153 },
  D2: { dry: 3108, wet: 1047 },
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
