/** 운영자 id. 로그인 전에는 브라우저마다 한 번 만든 값을 쓴다(사용자 결정: 로그인은 나중). 저장소가 막혀 있으면 이번 탭만 */
export function operatorId(): string {
  const make = () => `op-${Math.random().toString(16).slice(2, 6)}`;
  try {
    const v = localStorage.getItem('welding-hitl.operator');
    if (v) return v;
    const id = make();
    localStorage.setItem('welding-hitl.operator', id);
    return id;
  } catch {
    return make();
  }
}
