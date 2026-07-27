'use client';

import { useEffect, useRef, useState } from 'react';

const COLOR = { 매매: '#16a34a', 월세: '#7c3aed', 전세: '#2563eb', 완료: '#9ca3af' };
const colorOf = it => (it.status === '계약 완료' ? COLOR.완료 : COLOR[it.deal] || '#64748b');

export default function Page() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({ deal: 'all', kind: 'all', done: false });
  const mapEl = useRef(null);
  const lmap = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key');
    fetch('/api/listings' + (key ? `?key=${encodeURIComponent(key)}` : ''))
      .then(r => r.json())
      .then(d => (d.error ? setErr(d.error) : setData(d)))
      .catch(e => setErr(e.message));
  }, []);

  // Leaflet 로드 (CDN, 키 불필요)
  useEffect(() => {
    if (!data || lmap.current) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => {
      lmap.current = window.L.map(mapEl.current).setView([37.6195, 126.716], 15);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(lmap.current);
      layer.current = window.L.layerGroup().addTo(lmap.current);
      draw();
    };
    document.head.appendChild(s);
  }, [data]);

  useEffect(() => { if (lmap.current) draw(); }, [f]);

  const visible = it => {
    if (!it.geocoded) return false;
    if (f.deal !== 'all' && it.deal !== f.deal) return false;
    if (f.kind !== 'all' && it.kind !== f.kind) return false;
    if (!f.done && it.status === '계약 완료') return false;
    return true;
  };

  function draw() {
    const L = window.L;
    layer.current.clearLayers();
    const pts = [];
    const seen = {};

    data.items.filter(visible).forEach(it => {
      // 같은 좌표 겹침 방지: 미세하게 흩뿌림
      const k = `${it.lat.toFixed(5)},${it.lng.toFixed(5)}`;
      seen[k] = (seen[k] || 0) + 1;
      const n = seen[k] - 1;
      const ang = (n * 2.4);
      const r = n === 0 ? 0 : 0.00012 * Math.sqrt(n);
      const lat = it.lat + r * Math.cos(ang);
      const lng = it.lng + r * Math.sin(ang);

      const c = colorOf(it);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -18],
      });
      const m = L.marker([lat, lng], { icon }).addTo(layer.current);
      m.bindPopup(
        `<div style="font-weight:700;color:#1b2a4a;margin-bottom:3px">${it.name}</div>
         <div style="color:${c};font-weight:700">${it.deal}${it.status === '계약 완료' ? ' · 완료' : ''} · ${it.kind}</div>
         <div>${it.price || ''}</div>
         <div style="color:#6b7280">${it.address || ''}</div>`
      );
      m.on('click', () => setSel(it));
      pts.push([lat, lng]);
    });

    if (pts.length) lmap.current.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  }

  function select(it) {
    setSel(it);
    lmap.current.flyTo([it.lat, it.lng], 17, { duration: 0.6 });
    layer.current.eachLayer(m => {
      const p = m.getLatLng();
      if (Math.abs(p.lat - it.lat) < 0.0005 && Math.abs(p.lng - it.lng) < 0.0005) m.openPopup();
    });
  }

  if (err) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>오류: {err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>매물 불러오는 중…</div>;

  const shown = data.items.filter(visible);
  const kinds = [...new Set(data.items.map(i => i.kind).filter(Boolean))];
  const unmapped = data.items.filter(i => !i.geocoded);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif", color: '#1f2937' }}>
      <div style={{ width: 380, maxWidth: '42%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', background: '#fff' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1b2a4a' }}>진솔공인중개사사무소</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
            대표 이주형 공인중개사 · 등록번호 41570-2026-00003<br />
            경기도 김포시 사우동 관순로6 1층 · 010-2709-9781
          </div>
          {data.admin && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4, fontWeight: 700 }}>내부용 모드 · 연락처 표시</div>}
        </div>

        <div style={{ padding: 10, borderBottom: '1px solid #e5e7eb', background: '#f7f8fa' }}>
          <Row val={f.deal} set={v => setF({ ...f, deal: v })} opts={[['all', '전체'], ['매매', '매매'], ['월세', '월세'], ['전세', '전세']]} />
          <Row val={f.kind} set={v => setF({ ...f, kind: v })} opts={[['all', '전체종류'], ...kinds.map(k => [k, k])]} />
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
            <input type="checkbox" checked={f.done} onChange={e => setF({ ...f, done: e.target.checked })} />
            계약완료 매물 포함
          </label>
        </div>

        <div style={{ padding: '8px 16px', fontSize: 12, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
          표시 <b style={{ color: '#1b2a4a' }}>{shown.length}</b>건
          {unmapped.length > 0 && <span style={{ color: '#d97706' }}> · 좌표 없어 미표시 {unmapped.length}건</span>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {shown.map(it => (
            <div key={it.id} onClick={() => select(it)}
              style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', cursor: 'pointer', background: sel?.id === it.id ? '#eef2ff' : '#fff' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: colorOf(it), padding: '2px 7px', borderRadius: 4 }}>
                  {it.deal}{it.status === '계약 완료' ? '·완료' : ''}
                </span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{it.kind}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{it.name}</div>
              <div style={{ fontSize: 13, color: '#1b2a4a', fontWeight: 700 }}>{it.price}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                {[it.address, it.area, it.floor].filter(Boolean).join(' · ')}
              </div>
              {data.admin && (it.lessorPhone || it.tenantPhone) && (
                <div style={{ fontSize: 12, color: '#b45309', marginTop: 3 }}>
                  {it.lessorPhone && `임대인 ${it.lessorPhone}`}
                  {it.lessorPhone && it.tenantPhone && ' · '}
                  {it.tenantPhone && `임차인 ${it.tenantPhone}`}
                </div>
              )}
            </div>
          ))}
        </div>

        {!data.admin && (
          <div style={{ padding: '10px 16px', fontSize: 10, color: '#9ca3af', borderTop: '1px solid #e5e7eb', lineHeight: 1.5 }}>
            「공인중개사법」 제18조의2 및 시행령 제17조의2에 따른 표시·광고입니다. 게재 시점 기준 거래 가능한 매물이며, 확인 시점에 따라 거래가 완료되었을 수 있습니다. 문의 010-2709-9781.
          </div>
        )}
      </div>
      <div ref={mapEl} style={{ flex: 1 }} />
    </div>
  );
}

function Row({ val, set, opts }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
      {opts.map(([v, label]) => (
        <span key={v} onClick={() => set(v)}
          style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid ' + (val === v ? '#1b2a4a' : '#e5e7eb'),
            background: val === v ? '#1b2a4a' : '#fff',
            color: val === v ? '#fff' : '#1f2937',
          }}>{label}</span>
      ))}
    </div>
  );
}
