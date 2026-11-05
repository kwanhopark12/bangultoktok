/* ============================================================
   화분 하나의 토양수분을 원형 게이지(링)로 그려주는 함수
   - 회색 링: 0~100%
   - 색깔 링: 현재 값 (빨강=물 필요 / 초록=촉촉 / 주황=너무 많음)
   - 작은 눈금 2개: 설정한 "건조 기준"과 "과습 기준" 위치
   ============================================================ */
function renderGauge(value) {
  const s = getSettings();
  const statusKey = classifyMoisture(value);
  const color = STATUS_INFO[statusKey].color;

  const size = 120;
  const stroke = 11;
  const r = size / 2 - stroke;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = value == null || isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circumference;

  const tick = (p) => {
    const rad = ((p / 100) * 360 - 90) * (Math.PI / 180);
    const x1 = c + (r - 8) * Math.cos(rad), y1 = c + (r - 8) * Math.sin(rad);
    const x2 = c + (r + 8) * Math.cos(rad), y2 = c + (r + 8) * Math.sin(rad);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#52514e" stroke-width="2" stroke-linecap="round"/>`;
  };

  const text = value != null && !isNaN(value) ? value.toFixed(1) : "-";

  return `
    <svg viewBox="0 0 ${size} ${size}" class="gauge" role="img" aria-label="토양수분 ${text}%">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e8e7e1" stroke-width="${stroke}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"
        transform="rotate(-90 ${c} ${c})"/>
      ${tick(s.dryMax)}
      ${tick(s.wetMin)}
      <text x="${c}" y="${c + 2}" text-anchor="middle" class="gauge-value">${text}<tspan class="gauge-unit">%</tspan></text>
      <text x="${c}" y="${c + 20}" text-anchor="middle" class="gauge-sub">토양수분</text>
    </svg>`;
}
