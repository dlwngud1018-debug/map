
5_page.js (덮어쓰기 - app 폴더)

페이지
1
/
1
100%
'use client';

import { useEffect, useRef, useState } from 'react';

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || '';

const COLOR = { 매매: '#16a34a', 월세: '#7c3aed', 전세: '#2563eb', 완료: '#9ca3af' };
const colorOf = it => (it.status === '계약 완료' ? COLOR.완료 : COLOR[it.deal] || '#64748b');

const KIND_GROUPS = { '상가/사무실': ['상가', '사무실'] };

function kindMatch(itemKind, filterKind) {
  if (filterKind === 'all') return true;
  const group = KIND_GROUPS[filterKind];
  if (group) return group.includes(itemKind);
  return itemKind === filterKind;
}

const norm = s => String(s || '').toLowerCase().replace(/[\s-]/g, '');

const pinHtml = (c, big) => {
  const w = big ? 22 : 18;
  return `<div style="width:${w}px;height:${w}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer"></div>`;
};

const popupHtml = it => {
  const c = colorOf(it);
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:9px 11px;box-shadow:0 4px 14px rgba(0,0,0,.15);font-size:13px;max-width:240px;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;line-height:1.45">
    <div style="font-weight:700;color:#1b2a4a;margin-bottom:3px">${it.name}</div>
    <div style="color:${c};font-weight:700">${it.deal}${it.status === '계약 완료' ? ' · 완료' : ''} · ${it.kind}</div>
    <div>${it.price || ''}</div>
    <div style="color:#6b7280">${it.address || ''}</div>
  </div>`;
};

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

export default function Page() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({ deal: 'all', kind: 'all', done: false });
  const [q, setQ] = useState('');
  const [engine, setEngine] = useState(null);

  const isMobile = useIsMobile();

  const mapEl = useRef(null);
  const map = useRef(null);
  const overlays = useRef([]);
  const popup = useRef(null);

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key');
    fetch('/api/listings' + (key ? `?key=${encodeURIComponent(key)}` : ''))
      .then(r => r.json())
      .then(d => (d.error ? setErr(d.error) : setData(d)))
      .catch(e => setErr(e.message));
  }, []);

  // 지도 로드: 카카오 우선, 실패 시 OSM
  useEffect(() => {
    if (!data || map.current) return;

    const startOSM = () => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = () => {
        map.current = window.L.map(mapEl.current).setView([37.6195, 126.716], 15);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap',
        }).addTo(map.current);
        overlays.current = window.L.layerGroup().addTo(map.current);
        setEngine('osm');
      };
      document.head.appendChild(s);
    };

    if (!KAKAO_KEY) { startOSM(); return; }

    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`;
    s.onerror = startOSM;
    s.onload = () => {
      if (!window.kakao?.maps) { startOSM(); return; }
      window.kakao.maps.load(() => {
        try {
          map.current = new window.kakao.maps.Map(mapEl.current, {
            center: new window.kakao.maps.LatLng(37.6195, 126.716),
            level: 5,
          });
          setEngine('kakao');
        } catch (e) {
          startOSM();
        }
      });
    };
    document.head.appendChild(s);
  }, [data]);

  useEffect(() => { if (engine) draw(); }, [engine, f, q]);

  // 화면 크기가 바뀌면 지도 크기 갱신
  useEffect(() => {
    if (!engine || !map.current) return;
    const t = setTimeout(() => {
      if (engine === 'kakao') map.current.relayout();
      else map.current.invalidateSize();
      draw();
    }, 250);
    return () => clearTimeout(t);
  }, [isMobile, engine]);

  const matchQuery = it => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hay = [
      it.name, it.address, it.price, it.kind, it.deal, it.note,
      it.area, it.floor, it.ownerName, it.lessorPhone, it.tenantPhone,
    ].filter(Boolean).join(' ');
    return hay.toLowerCase().includes(needle) || norm(hay).includes(norm(needle));
  };

  const visible = it => {
    if (!it.geocoded) return false;
    if (f.deal !== 'all' && it.deal !== f.deal) return false;
    if (!kindMatch(it.kind, f.kind)) return false;
    if (!f.done && it.status === '계약 완료') return false;
    if (!matchQuery(it)) return false;
    return true;
  };

  const spread = list => {
    const seen = {};
    return list.map(it => {
      const k = `${it.lat.toFixed(5)},${it.lng.toFixed(5)}`;
      seen[k] = (seen[k] || 0) + 1;
      const n = seen[k] - 1;
      const r = n === 0 ? 0 : 0.00012 * Math.sqrt(n);
      const ang = n * 2.4;
      return { it, lat: it.lat + r * Math.cos(ang), lng: it.lng + r * Math.sin(ang) };
    });
  };

  function draw() {
    if (!data || !map.current) return;
    const list = spread(data.items.filter(visible));

    if (engine === 'kakao') {
      const kakao = window.kakao;
      overlays.current.forEach(o => o.setMap(null));
      overlays.current = [];
      if (popup.current) { popup.current.setMap(null); popup.current = null; }
      const bounds = new kakao.maps.LatLngBounds();

      list.forEach(({ it, lat, lng }) => {
        const pos = new kakao.maps.LatLng(lat, lng);
        const el = document.createElement('div');
        el.innerHTML = pinHtml(colorOf(it), isMobile);
        el.onclick = () => showPopup(it, lat, lng);
        const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1 });
        ov.setMap(map.current);
        overlays.current.push(ov);
        bounds.extend(pos);
      });

      if (list.length) map.current.setBounds(bounds);
      return;
    }

    const L = window.L;
    overlays.current.clearLayers();
    const pts = [];
    list.forEach(({ it, lat, lng }) => {
      const w = isMobile ? 22 : 18;
      const icon = L.divIcon({
        className: '', html: pinHtml(colorOf(it), isMobile),
        iconSize: [w, w], iconAnchor: [w / 2, w], popupAnchor: [0, -w],
      });
      const m = L.marker([lat, lng], { icon }).addTo(overlays.current);
      m.bindPopup(popupHtml(it));
      m.on('click', () => setSel(it));
      pts.push([lat, lng]);
    });
    if (pts.length) map.current.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
  }

  function showPopup(it, lat, lng) {
    setSel(it);
    const kakao = window.kakao;
    if (popup.current) popup.current.setMap(null);
    popup.current = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lng),
      content: popupHtml(it),
      yAnchor: 1.3,
    });
    popup.current.setMap(map.current);
  }

  function select(it) {
    setSel(it);
    if (!map.current) return;
    if (engine === 'kakao') {
      map.current.panTo(new window.kakao.maps.LatLng(it.lat, it.lng));
      showPopup(it, it.lat, it.lng);
    } else {
      map.current.flyTo([it.lat, it.lng], 17, { duration: 0.6 });
      overlays.current.eachLayer(m => {
        const p = m.getLatLng();
        if (Math.abs(p.lat - it.lat) < 0.0005 && Math.abs(p.lng - it.lng) < 0.0005) m.openPopup();
      });
    }
  }

  if (err) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>오류: {err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>매물 불러오는 중…</div>;

  const shown = data.items.filter(visible);
  const unmapped = data.items.filter(i => !i.geocoded);

  const rawKinds = [...new Set(data.items.map(i => i.kind).filter(Boolean))];
  const kinds = [];
  let grouped = false;
  rawKinds.forEach(k => {
    if (k === '상가' || k === '사무실') {
      if (!grouped) { kinds.push('상가/사무실'); grouped = true; }
    } else {
      kinds.push(k);
    }
  });

  const font = "-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";

  const header = (
    <div style={{ padding: isMobile ? '10px 14px' : '14px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
      <div style={{ fontSize: isMobile ? 15 : 16, fontWeight: 700, color: '#1b2a4a' }}>진솔공인중개사사무소</div>
      <div style={{ fontSize: isMobile ? 11 : 12, color: '#6b7280', marginTop: 2, lineHeight: 1.45 }}>
        {isMobile ? (
          <>대표 이주형 공인중개사 · <a href="tel:01027099781" style={{ color: '#1b2a4a', fontWeight: 700, textDecoration: 'none' }}>010-2709-9781</a></>
        ) : (
          <>대표 이주형 공인중개사 · 등록번호 41570-2026-00003<br />
            경기도 김포시 사우동 관순로6 1층 · 010-2709-9781</>
        )}
      </div>
      {data.admin && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4, fontWeight: 700 }}>내부용 모드 · 연락처 표시</div>}
    </div>
  );

  const controls = (
    <div style={{ background: '#f7f8fa', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ padding: '10px 10px 0' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={data.admin ? '매물명, 주소, 가격, 연락처 검색' : '매물명, 주소, 가격 검색'}
            style={{
              width: '100%', padding: isMobile ? '10px 32px 10px 12px' : '8px 30px 8px 10px',
              fontSize: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff',
              boxSizing: 'border-box',
            }}
          />
          {q && (
            <span onClick={() => setQ('')} title="검색어 지우기"
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1, padding: 4,
              }}>×</span>
          )}
        </div>
      </div>
      <div style={{ padding: 10 }}>
        <Row m={isMobile} val={f.deal} set={v => setF({ ...f, deal: v })}
          opts={[['all', '전체'], ['매매', '매매'], ['월세', '월세'], ['전세', '전세']]} />
        <Row m={isMobile} val={f.kind} set={v => setF({ ...f, kind: v })}
          opts={[['all', '전체종류'], ...kinds.map(k => [k, k])]} />
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <input type="checkbox" checked={f.done} onChange={e => setF({ ...f, done: e.target.checked })}
            style={{ width: 16, height: 16 }} />
          계약완료 매물 포함
        </label>
      </div>
    </div>
  );

  const countBar = (
    <div style={{ padding: '8px 14px', fontSize: 12, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
      표시 <b style={{ color: '#1b2a4a' }}>{shown.length}</b>건
      {q.trim() && <span> · &ldquo;{q.trim()}&rdquo;</span>}
      {unmapped.length > 0 && <span style={{ color: '#d97706' }}> · 좌표없음 {unmapped.length}건</span>}
    </div>
  );

  const list = (
    <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
      {shown.length === 0 && (
        <div style={{ padding: '24px 16px', fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>
          조건에 맞는 매물이 없습니다.
        </div>
      )}
      {shown.map(it => (
        <div key={it.id} onClick={() => select(it)}
          style={{
            padding: isMobile ? '14px 14px' : '12px 16px',
            borderBottom: '1px solid #e5e7eb', cursor: 'pointer',
            background: sel?.id === it.id ? '#eef2ff' : '#fff',
          }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: colorOf(it), padding: '2px 7px', borderRadius: 4 }}>
              {it.deal}{it.status === '계약 완료' ? '·완료' : ''}
            </span>
            <span style={{ fontSize: 11, color: '#6b7280' }}>{it.kind}</span>
          </div>
          <div style={{ fontSize: isMobile ? 15 : 14, fontWeight: 600, marginBottom: 3 }}>{it.name}</div>
          <div style={{ fontSize: isMobile ? 14 : 13, color: '#1b2a4a', fontWeight: 700 }}>{it.price}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
            {[it.address, it.area, it.floor].filter(Boolean).join(' · ')}
          </div>
          {data.admin && (it.lessorPhone || it.tenantPhone) && (
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>
              {it.lessorPhone && <a href={`tel:${it.lessorPhone}`} onClick={e => e.stopPropagation()} style={{ color: '#b45309' }}>임대인 {it.lessorPhone}</a>}
              {it.lessorPhone && it.tenantPhone && ' · '}
              {it.tenantPhone && <a href={`tel:${it.tenantPhone}`} onClick={e => e.stopPropagation()} style={{ color: '#b45309' }}>임차인 {it.tenantPhone}</a>}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const legal = !data.admin && (
    <div style={{ padding: '10px 14px', fontSize: 10, color: '#9ca3af', borderTop: '1px solid #e5e7eb', lineHeight: 1.5, background: '#fff' }}>
      「공인중개사법」 제18조의2 및 시행령 제17조의2에 따른 표시·광고입니다. 게재 시점 기준 거래 가능한 매물이며, 확인 시점에 따라 거래가 완료되었을 수 있습니다.
      {isMobile && <> 등록번호 41570-2026-00003 · 경기도 김포시 사우동 관순로6 1층.</>} 문의 010-2709-9781.
    </div>
  );

  // 모바일: 위아래로 쌓기
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: font, color: '#1f2937' }}>
        {header}
        {controls}
        <div ref={mapEl} style={{ height: '38vh', minHeight: 220, flexShrink: 0 }} />
        {countBar}
        {list}
        {legal}
      </div>
    );
  }

  // 데스크톱: 좌우 분할
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: font, color: '#1f2937' }}>
      <div style={{ width: 380, maxWidth: '42%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', background: '#fff' }}>
        {header}
        {controls}
        {countBar}
        {list}
        {legal}
      </div>
      <div ref={mapEl} style={{ flex: 1 }} />
    </div>
  );
}

function Row({ val, set, opts, m }) {
  return (
    <div style={{
      display: 'flex', gap: 6, marginBottom: 6,
      flexWrap: m ? 'nowrap' : 'wrap',
      overflowX: m ? 'auto' : 'visible',
      paddingBottom: m ? 2 : 0,
      WebkitOverflowScrolling: 'touch',
    }}>
      {opts.map(([v, label]) => (
        <span key={v} onClick={() => set(v)}
          style={{
            fontSize: 12, padding: m ? '7px 12px' : '5px 10px', borderRadius: 999,
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            border: '1px solid ' + (val === v ? '#1b2a4a' : '#e5e7eb'),
            background: val === v ? '#1b2a4a' : '#fff',
            color: val === v ? '#fff' : '#1f2937',
          }}>{label}</span>
      ))}
    </div>
  );
}
5_page.js (덮어쓰기 - app 폴더) 표시 중입니다.
