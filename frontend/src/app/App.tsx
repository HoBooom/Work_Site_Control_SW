/** 관제 웹앱 자리. 디지털 트윈 우선 개발 중에는 트윈 랩만 쓴다(digital-twin/docs/spec.md). */
export function App() {
  return (
    <main style={{ padding: 24, font: '14px/1.6 system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20 }}>welding-hitl</h1>
      <p>관제 화면은 디지털 트윈 다음에 만든다.</p>
      <p>
        <a href="/lab">트윈 랩 열기</a>
      </p>
    </main>
  );
}
