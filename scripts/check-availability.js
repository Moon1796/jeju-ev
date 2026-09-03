// 제주 충전소 빈자리 감시 스크립트
// GitHub Actions가 주기적으로 이 파일을 실행합니다.
// 1) 공공데이터포털에서 제주 충전소 현재 상태를 가져오고
// 2) 직전 실행 때 저장해둔 snapshot.json과 비교해서
// 3) "이용가능 0 -> 1대 이상"으로 바뀐 충전소가 있으면
// 4) 그 충전소에 태그(station_<id>)를 걸어둔 사용자에게 OneSignal 푸시를 보냅니다.

const fs = require("fs");

const EVCHARGER_KEY = process.env.EVCHARGER_KEY;
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;
const SNAPSHOT_PATH = "snapshot.json";
const JEJU_ZCODE = "50";

function mapStat(stat) {
  if (stat === "2") return "available";
  if (stat === "3") return "charging";
  return "broken";
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : "";
}

async function fetchStations() {
  // GitHub Secret에 Encoding 값이 들어왔든 Decoding 값이 들어왔든 안전하게 처리:
  // 이미 인코딩된 값이면 한 번 풀어준 뒤, 요청 시 다시 정확히 인코딩합니다.
  let rawKey = EVCHARGER_KEY;
  try { rawKey = decodeURIComponent(EVCHARGER_KEY); } catch (e) { /* 디코딩 불가하면 원본 그대로 사용 */ }

  const url =
    `https://apis.data.go.kr/B552584/EvCharger/getChargerInfo` +
    `?ServiceKey=${encodeURIComponent(rawKey)}&pageNo=1&numOfRows=999&zcode=${JEJU_ZCODE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API 응답 오류: HTTP ${res.status}`);
  const text = await res.text();

  const codeMatch = text.match(/<resultCode>([^<]*)<\/resultCode>/);
  if (codeMatch && codeMatch[1] !== "00") {
    const msgMatch = text.match(/<resultMsg>([^<]*)<\/resultMsg>/);
    throw new Error(`API 오류 (${codeMatch[1]}): ${msgMatch ? msgMatch[1] : "알 수 없는 오류"}`);
  }

  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const block = m[1];
    return { statId: xmlTag(block, "statId"), statNm: xmlTag(block, "statNm"), stat: xmlTag(block, "stat") };
  });

  const byStation = {};
  items.forEach((it) => {
    if (!it.statId) return;
    if (!byStation[it.statId]) byStation[it.statId] = { name: it.statNm, available: 0 };
    if (mapStat(it.stat) === "available") byStation[it.statId].available += 1;
  });
  return byStation;
}

async function notify(stationId, stationName) {
  const res = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Key ${ONESIGNAL_REST_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      filters: [{ field: "tag", key: `station_${stationId}`, relation: "=", value: "1" }],
      headings: { ko: "빈자리 알림" },
      contents: { ko: `${stationName || "신청하신 충전소"}에 자리가 났어요!` },
    }),
  });
  if (!res.ok) {
    console.error("OneSignal 전송 실패", res.status, await res.text());
  } else {
    console.log("알림 전송:", stationId, stationName);
  }
}

(async () => {
  if (!EVCHARGER_KEY || !ONESIGNAL_APP_ID || !ONESIGNAL_REST_KEY) {
    console.error("환경변수(EVCHARGER_KEY / ONESIGNAL_APP_ID / ONESIGNAL_REST_KEY)가 비어있어요. GitHub Secrets를 확인해주세요.");
    process.exit(1);
  }

  const current = await fetchStations();

  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch (e) {
    console.log("이전 스냅샷이 없어요 (첫 실행). 이번엔 알림 없이 기록만 남길게요.");
  }

  const hasPrev = Object.keys(prev).length > 0;
  if (hasPrev) {
    for (const statId of Object.keys(current)) {
      const before = prev[statId]?.available ?? 0;
      const after = current[statId].available;
      if (before === 0 && after > 0) {
        await notify(statId, current[statId].name);
      }
    }
  }

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2));
  console.log(`체크 완료: 충전소 ${Object.keys(current).length}곳`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
