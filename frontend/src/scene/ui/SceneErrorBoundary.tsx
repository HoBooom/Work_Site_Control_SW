import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onError?: (error: Error) => void;
}

/** RD-01: 에셋 로딩 실패를 화면에 이유와 함께 보여 준다. Canvas를 감싼다(R3F가 Canvas 안의 오류를 바깥으로 넘긴다). */
export class SceneErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" data-testid="scene-error" style={{ padding: 24, font: '14px/1.5 system-ui, sans-serif' }}>
          3D 장면을 불러오지 못했다: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
