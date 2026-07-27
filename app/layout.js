export const metadata = {
  title: '진솔공인중개사사무소 · 매물 지도',
  description: '김포 사우동 진솔공인중개사사무소 매물 지도',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
