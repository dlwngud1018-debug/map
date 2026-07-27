// 노션 매물장을 읽어 지도용 데이터로 내려주는 API
// 좌표는 노션 "좌표" 칸에서 그대로 읽습니다 (외부 지도 API 불필요)
// 공개 모드(기본)에서는 연락처를 서버에서부터 제거합니다.

export const revalidate = 60; // 60초 캐시

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DB_ID;
const ADMIN_KEY = process.env.ADMIN_KEY;

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

  return Response.json({
    admin: isAdmin,
    total: items.length,
    mapped: items.filter(i => i.geocoded).length,
    items,
    updatedAt: new Date().toISOString(),
  });
}
