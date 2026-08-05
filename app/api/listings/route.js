// 노션 매물장을 읽어 지도용 데이터로 내려주는 API
// 좌표는 노션 "좌표" 칸에서 읽고, 비어 있으면 "주소"로 지오코딩해 채웁니다.
// 공개 모드(기본)에서는 연락처를 서버에서부터 제거합니다.


// 매 요청마다 노션을 새로 읽습니다.
// (노션을 고치면 재배포 없이 바로 반영됩니다. 캐시를 걸면 안 됩니다 —
//  아래 지오코딩 결과를 노션에 되써서 캐싱하므로 반복 호출 비용은 없습니다.)
export const dynamic = 'force-dynamic';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DB_ID;
const ADMIN_KEY = process.env.ADMIN_KEY;

// 한 요청에서 지오코딩할 최대 건수.
// 새 매물이 한꺼번에 여러 건 들어와도 첫 접속자가 오래 기다리지 않도록 제한합니다.
// 넘친 건은 다음 요청에서 처리되고, 한 번 성공하면 노션에 저장되어 다시 호출되지 않습니다.
const MAX_GEOCODE_PER_REQUEST = 10;

// ---------------------------------------------------------------------------
// 카카오 로컬 API 지오코딩 (서버 전용)
//
// 주소 문자열 -> { lat, lng }. 실패하면 null 을 돌려줍니다.
//   1차: /v2/local/search/address.json  (지번·도로명 주소 정식 검색)
//   2차: /v2/local/search/keyword.json  (상호명·건물명 등 키워드 검색)
//   3차: 동·호수를 뗀 건물 주소로 주소 검색 재시도
//
// !! 중요 !!
// KAKAO_REST_API_KEY 에는 절대 NEXT_PUBLIC_ 접두어를 붙이지 마세요.
// 붙이는 순간 브라우저 번들에 키가 그대로 실려 외부에 노출됩니다.
// 이 파일은 서버에서만 실행됩니다 (라우트 핸들러).
// ---------------------------------------------------------------------------

const ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

// 한국 영역 대략 검증 (route.js 의 parseCoord 와 같은 기준)
function inKorea(lat, lng) {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

async function callKakao(url, query) {
  const res = await fetch(`${url}?query=${encodeURIComponent(query)}&size=1`, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`카카오 API ${res.status} ${body.slice(0, 200)}`.trim());
  }

  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return null;

  // 카카오는 x=경도, y=위도 로 내려줍니다 (순서 주의)
  const lat = parseFloat(doc.y);
  const lng = parseFloat(doc.x);
  if (isNaN(lat) || isNaN(lng) || !inKorea(lat, lng)) return null;

  return { lat, lng };
}

// "... 101동 202호" 같은 동·호수 꼬리표를 떼어낸 건물 주소.
// 동·호수는 건물 안의 위치라 좌표가 어차피 건물과 같으므로, 정식 주소
// 검색이 실패했을 때 건물 단위로 한 번 더 시도하기 위한 보조 수단입니다.
//
// 단어 단위로만 잘라냅니다. 정규식으로 문자열 중간을 자르면
// "웅신타워 109호" 가 "웅신타" 가 되는 식으로 건물명이 망가집니다.
const UNIT_HO = /^[0-9]+(-[0-9]+)?호$/;              // 402호, 109-1호
const UNIT_DONG = /^[0-9A-Za-z가-힣]+동$/;           // 101동, B동, 가동
const UNIT_FLOOR = /^[0-9]+층$/;                     // 3층

function buildingOnly(address) {
  const tokens = address
    .replace(/\([^)]*\)/g, ' ') // 괄호 주석 제거: "(연산동)", "(노랑통닭)"
    .replace(/[,·]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // 뒤에서부터 호수를 떼어냅니다.
  let removedHo = false;
  while (tokens.length > 1 && (UNIT_HO.test(tokens[tokens.length - 1]) || UNIT_FLOOR.test(tokens[tokens.length - 1]))) {
    if (UNIT_HO.test(tokens[tokens.length - 1])) removedHo = true;
    tokens.pop();
  }

  // "동" 은 호수와 짝을 이룰 때만 건물 내 동으로 봅니다.
  // 그렇지 않으면 "경기도 김포시 사우동" 의 행정동까지 잘라내게 됩니다.
  if (removedHo) {
    while (tokens.length > 1 && UNIT_DONG.test(tokens[tokens.length - 1])) tokens.pop();
  }

  const trimmed = tokens.join(' ');
  return trimmed && trimmed !== address.replace(/\s+/g, ' ').trim() ? trimmed : null;
}

async function geocodeAddress(address) {
  if (!process.env.KAKAO_REST_API_KEY) {
    throw new Error('KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const query = String(address || '').trim();
  if (!query) return null;

  // 1차 · 주소 검색
  const byAddress = await callKakao(ADDRESS_URL, query);
  if (byAddress) return byAddress;

  // 2차 · 키워드 검색 (상호명·건물명이 섞인 주소에 강함)
  const byKeyword = await callKakao(KEYWORD_URL, query);
  if (byKeyword) return byKeyword;

  // 3차 · 동·호수를 뗀 건물 주소로 주소 검색 재시도
  const fallback = buildingOnly(query);
  if (fallback) {
    const byBuilding = await callKakao(ADDRESS_URL, fallback);
    if (byBuilding) return byBuilding;
  }

  return null;
}

// 노션 "좌표" 칸에 기록할 문자열. 기존 데이터와 같은 형식으로 맞춥니다.
function formatCoord(lat, lng) {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

// ---------------------------------------------------------------------------

function txt(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return prop.rich_text.map(t => t.plain_text).join('');
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'status') return prop.status?.name || '';
  if (prop.type === 'phone_number') return prop.phone_number || '';
  if (prop.type === 'number') return prop.number ?? '';
  if (prop.type === 'checkbox') return prop.checkbox;
  if (prop.type === 'date') return prop.date?.start || '';
  if (prop.type === 'multi_select') return prop.multi_select.map(s => s.name).join(', ');
  return '';
}

function parseCoord(s) {
  if (!s) return null;
  const m = String(s).split(',').map(v => parseFloat(v.trim()));
  if (m.length < 2 || isNaN(m[0]) || isNaN(m[1])) return null;
  // 한국 범위 대략 검증
  if (m[0] < 33 || m[0] > 39 || m[1] < 124 || m[1] > 132) return null;
  return { lat: m[0], lng: m[1] };
}

// 구한 좌표를 노션 "좌표" 칸에 되써서 캐싱합니다.
// 다음 요청부터는 이 값을 그대로 읽으므로 카카오 API를 다시 부르지 않습니다.
async function saveCoordToNotion(pageId, lat, lng) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        좌표: { rich_text: [{ text: { content: formatCoord(lat, lng) } }] },
      },
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`노션 ${res.status} ${body.slice(0, 200)}`.trim());
  }
}

// 좌표가 비어 있는 매물을 주소로 지오코딩해 채웁니다.
// 실패한 매물은 geocoded:false 로 남아 지도에서 조용히 빠지고, 서버 로그에만 주소가 남습니다.
async function fillMissingCoords(items) {
  const pending = items.filter(it => !it.geocoded && it.address);
  if (!pending.length) return;

  if (!process.env.KAKAO_REST_API_KEY) {
    console.warn(
      `[geocode] KAKAO_REST_API_KEY 미설정 — 좌표 없는 매물 ${pending.length}건을 건너뜁니다.`
    );
    return;
  }

  const batch = pending.slice(0, MAX_GEOCODE_PER_REQUEST);
  if (pending.length > batch.length) {
    console.warn(
      `[geocode] 좌표 없는 매물 ${pending.length}건 중 ${batch.length}건만 처리합니다. 나머지는 다음 요청에서 처리됩니다.`
    );
  }

  const memo = new Map(); // 같은 주소가 여러 건이면 API 호출 1회로

  for (const it of batch) {
    try {
      let geo = memo.get(it.address);
      if (geo === undefined) {
        geo = await geocodeAddress(it.address);
        memo.set(it.address, geo);
      }

      if (!geo) {
        console.warn(`[geocode] 실패 · "${it.name}" · 주소: ${it.address}`);
        continue;
      }

      it.lat = geo.lat;
      it.lng = geo.lng;
      it.geocoded = true;

      // 노션 저장에 실패해도 이번 요청의 지도 표시는 그대로 진행합니다.
      try {
        await saveCoordToNotion(it.id, geo.lat, geo.lng);
        console.log(
          `[geocode] 성공 · "${it.name}" · ${it.address} -> ${formatCoord(geo.lat, geo.lng)} (노션 저장 완료)`
        );
      } catch (e) {
        console.warn(
          `[geocode] 좌표는 구했으나 노션 저장 실패 · "${it.name}" · 주소: ${it.address} · ${e.message}`
        );
      }
    } catch (e) {
      console.warn(`[geocode] 오류 · "${it.name}" · 주소: ${it.address} · ${e.message}`);
    }
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const isAdmin = ADMIN_KEY && searchParams.get('key') === ADMIN_KEY;

  if (!NOTION_TOKEN || !DB_ID) {
    return Response.json({ error: '환경변수(NOTION_TOKEN, NOTION_DB_ID)가 설정되지 않았습니다.' }, { status: 500 });
  }

  let results = [];
  let cursor = undefined;
  try {
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.object === 'error') {
        return Response.json({ error: data.message }, { status: 500 });
      }
      results = results.concat(data.results || []);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  } catch (e) {
    return Response.json({ error: '노션 조회 실패: ' + e.message }, { status: 500 });
  }

  const items = [];
  for (const page of results) {
    const p = page.properties;
    const name = txt(p['매물명']);
    if (!name) continue;
    if (name.includes('삭제요망')) continue; // 템플릿/폐기 행 제외

    const deal = txt(p['거래 유형']);
    const sale = txt(p['매매가액']);
    const dep = txt(p['보증금']);
    const rent = txt(p['월세']);
    const key = txt(p['권리금']);

    let price = '';
    if (deal === '매매' && sale) price = `매매 ${sale}`;
    else if (dep || rent) price = `보 ${dep || '-'}${rent ? ` / 월 ${rent}` : ''}`;
    else if (sale) price = `매매 ${sale}`;
    if (key && key !== '0' && key !== '없음') price += ` · 권리 ${key}`;
    const vat = txt(p['vat']);
    if (vat) price += ` (VAT ${vat})`;

    const geo = parseCoord(txt(p['좌표']));

    const item = {
      id: page.id,
      name,
      address: txt(p['주소']),
      kind: txt(p['매물 종류']),
      deal,
      status: txt(p['매물 상태']),
      price,
      area: txt(p['면적']),
      floor: txt(p['층수']),
      rooms: txt(p['방 개수']),
      baths: txt(p['화장실 개수']),
      parking: txt(p['주차가능여부']),
      fee: txt(p['관리비/세부']),
      moveIn: txt(p['입주가능일']),
      approvedAt: txt(p['사용승인일']),
      facing: txt(p['향']),
      note: txt(p['특이사항']),
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      geocoded: !!geo,
    };

    if (isAdmin) {
      item.lessorPhone = txt(p['임대인 전화번호']) || txt(p['임대인 전화번호 ']) || txt(p['임대인 전화번호 1']);
      item.tenantPhone = txt(p['임차인 전화번호']) || txt(p['임차인 전화번호 ']);
      item.ownerName = txt(p['매도/임대인 성함']);
    }

    items.push(item);
  }

  // 좌표 비어 있는 매물 채우기 (성공하면 노션에 저장되어 다음부터는 건너뜁니다)
  await fillMissingCoords(items);

  return Response.json({
    admin: isAdmin,
    total: items.length,
    mapped: items.filter(i => i.geocoded).length,
    items,
    updatedAt: new Date().toISOString(),
  });
}
