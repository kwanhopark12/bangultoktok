/* ============================================================
   급수 명령 서버와 이야기하는 부분 (config.js 다음에 로드)
   서버 주소: config.js 의 CONFIG.WATER_API_URL
   급수 비밀번호: 코드에 쓰지 않고, 휴대폰/컴퓨터마다 한 번 입력해서 그 기기에만 저장
   ============================================================ */
const WATER_KEY_STORE = "bangultoktok-water-key";

const WaterAPI = {
  url() {
    return String((typeof CONFIG !== "undefined" && CONFIG.WATER_API_URL) || "").trim();
  },

  isConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(this.url());
  },

  getKey() {
    try { return localStorage.getItem(WATER_KEY_STORE) || ""; } catch (e) { return ""; }
  },

  setKey(k) {
    try {
      if (k) localStorage.setItem(WATER_KEY_STORE, k);
      else localStorage.removeItem(WATER_KEY_STORE);
      return true;
    } catch (e) { return false; }
  },

  async status() {
    if (!this.isConfigured()) throw new Error("config.js 에 WATER_API_URL(급수 서버 주소)을 아직 넣지 않았어요");
    let res;
    try {
      res = await fetch(`${this.url()}?a=status&t=${Date.now()}`, { cache: "no-store" });
    } catch (e) {
      throw new Error("급수 서버에 접속하지 못했어요 (주소 또는 인터넷 확인)");
    }
    return this._read(res);
  },

  // 본문을 "글자"로 보내면 브라우저가 사전 확인(CORS preflight)을 안 해서 Apps Script 와 잘 맞아요
  async post(body, keyOverride) {
    if (!this.isConfigured()) throw new Error("config.js 에 WATER_API_URL(급수 서버 주소)을 아직 넣지 않았어요");
    const key = keyOverride ?? this.getKey();
    if (!key) throw new Error("급수 비밀번호를 먼저 저장해 주세요");
    let res;
    try {
      res = await fetch(this.url(), { method: "POST", body: JSON.stringify({ ...body, key }) });
    } catch (e) {
      throw new Error("급수 서버에 접속하지 못했어요 (인터넷 확인)");
    }
    return this._read(res);
  },

  async _read(res) {
    if (!res.ok) throw new Error(`급수 서버 응답 오류 (${res.status})`);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch (e) {
      throw new Error("급수 서버 응답을 읽지 못했어요 — 배포할 때 '액세스: 모든 사용자'로 했는지 확인하세요");
    }
    if (!json.ok) throw new Error(json.error || "급수 서버가 거절했어요");
    return json;
  },

  checkKey(k) { return this.post({ a: "checkkey" }, k); },
  water(pot, sec) { return this.post({ a: "water", pot, sec }); },
  cancel(id) { return this.post({ a: "cancel", id }); },
  addSchedule(pot, kind, days, at, sec) { return this.post({ a: "schedule_add", pot, kind, days, at, sec }); },
  toggleSchedule(id, enabled) { return this.post({ a: "schedule_toggle", id, enabled: Boolean(enabled) }); },
  deleteSchedule(id) { return this.post({ a: "schedule_delete", id }); },
  saveSwitch(pot, patch) { return this.post({ a: "switch", pot, ...patch }); },
  saveSetting(pot, s) {
    return this.post({
      a: "settings", pot,
      user_auto: Boolean(s.user_auto),
      threshold_pct: Number(s.threshold_pct),
      dose_sec: Number(s.dose_sec),
      min_gap_min: Number(s.min_gap_min),
    });
  },
};

const CMD_STATUS_LABEL = {
  pending: { text: "⏳ 장치가 가져가길 기다리는 중", cls: "wait" },
  sent:    { text: "🚿 장치가 물 주는 중", cls: "wait" },
  done:    { text: "✅ 물 줬어요", cls: "done" },
  skip:    { text: "⏭️ 장치가 건너뜀", cls: "warn" },
  fail:    { text: "❌ 실패", cls: "bad" },
  expired: { text: "⌛ 시간 초과로 취소", cls: "warn" },
  unknown: { text: "❓ 결과를 못 받음", cls: "warn" },
  cancel:  { text: "↩️ 취소함", cls: "muted" },
};

const CMD_MODE_LABEL = { manual: "👆 버튼", schedule: "⏰ 예약", threshold: "🤖 수분 기준" };
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function describeSchedule(x) {
  const when = x.kind === "weekly"
    ? "매주 " + String(x.days || "").split(",").filter((d) => d !== "").map((d) => WEEKDAY_NAMES[+d]).join("·")
    : "매일";
  return `${when} ${x.at}`;
}
