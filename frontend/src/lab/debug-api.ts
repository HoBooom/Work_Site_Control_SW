import type { RootState } from '@react-three/fiber';
import { Box3, Color, Mesh, Vector3, type Material, type Object3D } from 'three';
import type { URDFRobot } from 'urdf-loader';
import type { SeamView } from '../scene/cell-view';
import { alarmName, labelTestId, objectName, staleTestId, type ScenePart } from '../scene/names';
import { useSelection, type Selection } from '../scene/selection';
import { useTwinStore, type CellState } from '../store/twin-store';
import type { VirtualClock } from './clock';
import type { FixturePlayer } from './fixture';
import type { QualityTier } from './params';
import type { StatsCollector, StatsSnapshot } from './stats';

type V3 = [number, number, number];

/**
 * window.__twin. 테스트는 화면 픽셀이 아니라 이 API로 상태를 확인한다(harness.md "디버그 API").
 * 좌표는 모두 사이트 좌표계(Z-up, m)로 돌려준다. site-config·plateToSite와 바로 비교할 수 있다.
 */
export interface TwinDebugApi {
  /** 에셋 로딩과 첫 프레임들이 끝나면 풀린다. 로딩 실패면 거부된다. */
  ready(): Promise<void>;
  state(): TwinLabState;
  stats(): StatsSnapshot;
  resetStats(): void;
  /** 시나리오 시각을 옮기고 store에 즉시 반영한다. 씬은 다음 프레임에 따라온다(frames로 기다린다). */
  setClock(t: number): void;
  /** n프레임 뒤에 풀린다 */
  frames(n?: number): Promise<void>;
  object(site: string, cell: string, part: ScenePart): ObjectInfo;
  /** 그려진 용접선(사이트 좌표). 선이 없으면 null */
  seam(site: string, cell: string): SeamInfo | null;
  /** 셀의 화면 표현: 상태 램프, 라벨, 알람 마커, 로봇 회색 여부, 멈춤 표시 */
  view(site: string, cell: string): CellViewInfo;
  /** 객체(또는 알람 마커) 중심의 화면 좌표(px, 페이지 기준). 화면 밖이면 null */
  screen(site: string, cell: string, part: ScenePart | { alarm: string }): [number, number] | null;
  selection(): Selection | null;
  /** 이름이 name인 객체 수. type을 주면 그 객체 아래에서 그 타입(three type 문자열, 예: Line2) 수 */
  count(name: string, type?: string): number;
  setPreset(id: string): void;
  /** 사이트를 다시 띄우고(Canvas 재생성) 첫 프레임들이 끝나면 풀린다 */
  setSite(site: string): Promise<void>;
  setQuality(tier: QualityTier): Promise<void>;
  /** 씬의 로봇 관절각(deg). 로봇이 없으면 null */
  joints(site: string, cell: string): Record<string, number> | null;
  /** 로봇 링크 하나(자식 링크 제외)의 월드 AABB. 링크가 없으면 null */
  link(site: string, cell: string, link: string): { min: V3; max: V3 } | null;
  camera(): CameraInfo;
  /** 렌더 설정(RD-02~05): 품질 등급, 환경광, 키 라이트 그림자, 켜진 후처리 */
  render(): RenderInfo;
}

export interface TwinLabState {
  site: string | null;
  fixture: string | null;
  t: number;
  frozen: boolean;
  cells: Record<string, CellState>;
}

export interface ObjectInfo {
  exists: boolean;
  /** 객체와 조상이 모두 보이는가 */
  visible: boolean;
  /** 객체 원점 */
  position: V3 | null;
  /** 월드 AABB 크기 */
  size: V3 | null;
}

export interface SeamInfo {
  points: V3[];
  done: V3[];
  todo: V3[];
  dashed: boolean;
  doneColor: string;
  todoColor: string;
}

export interface CellViewInfo {
  lamp: { state: string; color: string } | null;
  label: { text: string; state: string } | null;
  /** 아래에서 위로 쌓인 순서 */
  alarms: { id: string; severity: string; color: string }[];
  /** 로봇 재질이 모두 회색인가(DY-08) */
  robotGray: boolean;
  /** "멈춤" 표시가 보이는가(DY-09) */
  stale: boolean;
  /** DY-12 발 접촉 표시: 발 링크 → 표시된 상태(true = 자석 붙음). 표시가 없으면 빈 객체 */
  contacts: Record<string, boolean>;
  /** 발 접촉 표시의 중심(사이트 좌표) */
  contactRings: Record<string, V3>;
}

export interface RenderInfo {
  quality: string | null;
  environment: boolean;
  shadows: { enabled: boolean; type: number; mapSize: number; radius: number; keyLightCasts: boolean } | null;
  effects: string[];
  /** 키 라이트 그림자 범위(사이트 좌표 AABB). 모든 셀이 들어와야 그림자가 잘리지 않는다 */
  shadowBox: { min: V3; max: V3 } | null;
  /** 로봇 메시가 모두 그림자를 드리우는가 */
  robotsCastShadow: boolean;
  /** 배경 메시가 모두 그림자를 받는가 */
  backgroundReceivesShadow: boolean;
}

export interface CameraInfo {
  position: V3;
  target: V3;
  distance: number;
  /** IX-07 카메라가 따라가는 로봇. 없으면 null */
  follow: { site: string; cell: string } | null;
}

interface Bound {
  site: string;
  fixture: string;
  clock: VirtualClock;
  player: FixturePlayer;
  stats: StatsCollector;
}

declare global {
  interface Window {
    __twin?: TwinDebugApi;
  }
}

interface LabControls {
  setPreset(id: string): void;
  setSite(site: string): Promise<void>;
  setQuality(tier: QualityTier): void;
}

let bound: Bound | null = null;
let controls: LabControls | null = null;
let lastMount = -1;
const mountWaiters: { mount: number; resolve: () => void }[] = [];
let getThree: (() => RootState) | null = null;
let frameCount = 0;
const frameWaiters: { at: number; resolve: () => void }[] = [];
let resolveReady!: () => void;
let rejectReady!: (e: unknown) => void;
const readyPromise = new Promise<void>((res, rej) => {
  resolveReady = res;
  rejectReady = rej;
});
readyPromise.catch(() => {}); // 아무도 기다리지 않을 때 unhandledrejection을 내지 않는다

function need(): Bound {
  if (!bound) throw new Error('트윈 랩이 아직 로딩되지 않았다. ready()를 먼저 기다린다.');
  return bound;
}

function three(): RootState {
  if (!getThree) throw new Error('씬이 아직 없다. ready()를 먼저 기다린다.');
  return getThree();
}

export function bindDebugApi(b: Bound) {
  bound = b;
}

export function bindThree(get: () => RootState) {
  getThree = get;
}

/** LabProbe가 매 프레임 부른다 */
export function onFrame() {
  frameCount++;
  for (let i = frameWaiters.length - 1; i >= 0; i--) {
    if (frameWaiters[i].at <= frameCount) frameWaiters.splice(i, 1)[0].resolve();
  }
}

export function bindLabControls(c: LabControls) {
  controls = c;
}

/** Canvas가 새로 만들어지고 첫 프레임들이 끝났다. mount 0은 ready() */
export function markMounted(mount: number) {
  lastMount = Math.max(lastMount, mount);
  if (mount === 0) resolveReady();
  for (let i = mountWaiters.length - 1; i >= 0; i--) {
    if (mountWaiters[i].mount <= lastMount) mountWaiters.splice(i, 1)[0].resolve();
  }
}

function waitMount(mount: number): Promise<void> {
  return new Promise((resolve) => mountWaiters.push({ mount, resolve }));
}

function needControls(): LabControls {
  if (!controls) throw new Error('트윈 랩이 아직 로딩되지 않았다. ready()를 먼저 기다린다.');
  return controls;
}

function colorHex(m: Material | Material[]): string {
  const c = (Array.isArray(m) ? m[0] : m) as Material & { color?: Color };
  return c.color ? `#${c.color.getHexString()}` : '';
}
export const markFailed = (e: unknown) => rejectReady(e);

const sceneToSite = (v: Vector3): V3 => [v.x, -v.z, v.y];

function find(site: string, cell: string, part: ScenePart): Object3D | undefined {
  return three().scene.getObjectByName(objectName(part, site, cell));
}

function urdfOf(o: Object3D | undefined): URDFRobot | undefined {
  let r: URDFRobot | undefined;
  o?.traverse((c) => {
    if (!r && (c as URDFRobot).isURDFRobot) r = c as URDFRobot;
  });
  return r;
}

function isVisible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export function installDebugApi() {
  window.__twin = {
    ready: () => readyPromise,
    state: () => ({
      site: bound?.site ?? null,
      fixture: bound?.fixture ?? null,
      t: bound?.clock.t ?? 0,
      frozen: bound?.clock.frozen ?? false,
      cells: structuredClone(useTwinStore.getState().cells),
    }),
    stats: () => need().stats.snapshot(),
    resetStats: () => need().stats.reset(),
    setClock: (t: number) => {
      const b = need();
      b.clock.set(t);
      b.player.seek(t);
    },
    frames: (n = 2) => new Promise<void>((resolve) => frameWaiters.push({ at: frameCount + n, resolve })),
    object: (site, cell, part) => {
      const o = find(site, cell, part);
      if (!o) return { exists: false, visible: false, position: null, size: null };
      o.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(o);
      const size = box.isEmpty() ? null : box.getSize(new Vector3());
      return {
        exists: true,
        visible: isVisible(o),
        position: sceneToSite(o.getWorldPosition(new Vector3())),
        // 크기는 축만 바꾼다(부호 없음)
        size: size ? [size.x, size.z, size.y] : null,
      };
    },
    seam: (site, cell) => {
      const o = find(site, cell, 'seam');
      const pts = o?.userData.platePoints as V3[] | undefined;
      const view = o?.userData.view as SeamView | undefined;
      if (!o || !pts || !view) return null;
      o.updateWorldMatrix(true, false);
      const toSite = (list: V3[]) => list.map((p) => sceneToSite(new Vector3(...p).applyMatrix4(o.matrixWorld)));
      return {
        points: toSite(pts),
        done: toSite(view.done),
        todo: toSite(view.todo),
        dashed: view.dashed,
        doneColor: view.doneColor,
        todoColor: view.todoColor,
      };
    },
    view: (site, cell) => {
      const lamp = find(site, cell, 'lamp') as Mesh | undefined;
      const labelEl = document.querySelector<HTMLElement>(`[data-testid="${labelTestId(site, cell)}"]`);
      const prefix = alarmName(site, cell, '');
      const alarms: { id: string; severity: string; color: string; z: number }[] = [];
      three().scene.traverse((o) => {
        if (o instanceof Mesh && o.name.startsWith(prefix)) {
          alarms.push({
            id: o.userData.alarmId,
            severity: o.userData.severity,
            color: colorHex(o.material),
            z: o.position.z,
          });
        }
      });
      alarms.sort((a, b) => a.z - b.z);
      let robotGray = true;
      let robotMeshes = 0;
      const contacts: Record<string, boolean> = {};
      const contactRings: Record<string, V3> = {};
      find(site, cell, 'robot')?.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        if (o.userData.contact) {
          if (isVisible(o)) {
            contacts[o.userData.contact] = o.userData.on;
            contactRings[o.userData.contact] = sceneToSite(o.getWorldPosition(new Vector3()));
          }
          return; // 표시물은 로봇 색 판정에서 뺀다
        }
        robotMeshes++;
        const m = (Array.isArray(o.material) ? o.material[0] : o.material) as Material & { color?: Color };
        // 로봇은 팔레트 텍스처로 색을 낸다(Robot.tsx). 지금 팔레트의 색을 모두 본다
        const colors = (m.userData.palette as Color[] | undefined) ?? (m.color ? [m.color] : []);
        if (colors.some((c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 0.12)) robotGray = false;
      });
      return {
        lamp: lamp ? { state: lamp.userData.state, color: colorHex(lamp.material) } : null,
        label: labelEl ? { text: labelEl.textContent ?? '', state: labelEl.dataset.state ?? '' } : null,
        alarms: alarms.map(({ id, severity, color }) => ({ id, severity, color })),
        robotGray: robotMeshes > 0 && robotGray,
        stale: !!document.querySelector(`[data-testid="${staleTestId(site, cell)}"]`),
        contacts,
        contactRings,
      };
    },
    screen: (site, cell, part) => {
      const { camera, gl, scene } = three();
      const name = typeof part === 'string' ? objectName(part, site, cell) : alarmName(site, cell, part.alarm);
      const found = scene.getObjectByName(name);
      if (!found) return null;
      // 로봇은 팔 모양에 따라 상자 중심이 빈 공간일 수 있어 베이스 링크(첫 링크의 형상)를 겨눈다
      const robot = part === 'robot' ? urdfOf(found) : undefined;
      const o = robot?.children.find((c) => (c as { isURDFVisual?: boolean }).isURDFVisual) ?? found;
      o.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(o);
      const p = (box.isEmpty() ? o.getWorldPosition(new Vector3()) : box.getCenter(new Vector3())).project(camera);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return null;
      const r = gl.domElement.getBoundingClientRect();
      return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
    },
    selection: () => useSelection.getState().selected,
    count: (name, type) => {
      const roots: Object3D[] = [];
      three().scene.traverse((o) => o.name === name && roots.push(o));
      if (!type) return roots.length;
      let n = 0;
      roots.forEach((r) => r.traverse((o) => (o.type === type || o.constructor.name === type) && n++));
      return n;
    },
    setPreset: (id) => needControls().setPreset(id),
    setSite: async (site) => {
      const next = lastMount + 1;
      await needControls().setSite(site);
      await waitMount(next);
    },
    setQuality: async (tier) => {
      const next = lastMount + 1;
      needControls().setQuality(tier);
      await waitMount(next);
    },
    link: (site, cell, name) => {
      const robot = urdfOf(find(site, cell, 'robot'));
      const l = robot?.links[name];
      if (!l) return null;
      l.updateWorldMatrix(true, true);
      const b = new Box3();
      for (const c of l.children) if ((c as { isURDFVisual?: boolean }).isURDFVisual) b.expandByObject(c);
      if (b.isEmpty()) return null;
      const a = sceneToSite(b.min);
      const z = sceneToSite(b.max);
      return {
        min: [Math.min(a[0], z[0]), Math.min(a[1], z[1]), Math.min(a[2], z[2])],
        max: [Math.max(a[0], z[0]), Math.max(a[1], z[1]), Math.max(a[2], z[2])],
      };
    },
    joints: (site, cell) => {
      const robot = urdfOf(find(site, cell, 'robot'));
      if (!robot?.joints) return null;
      return Object.fromEntries(
        Object.entries(robot.joints)
          .filter(([, j]) => j.jointType === 'revolute' || j.jointType === 'continuous')
          .map(([name, j]) => [name, (j.angle * 180) / Math.PI]),
      );
    },
    render: () => {
      const { gl, scene } = three();
      const light = scene.getObjectByName('key-light') as (Object3D & { isDirectionalLight?: boolean; castShadow: boolean; shadow: import('three').DirectionalLightShadow }) | undefined;
      let shadowBox: RenderInfo['shadowBox'] = null;
      if (light?.shadow) {
        const cam = light.shadow.camera;
        light.updateMatrixWorld();
        cam.updateMatrixWorld();
        const box = new Box3();
        for (const x of [cam.left, cam.right]) for (const y of [cam.bottom, cam.top]) for (const z of [-cam.near, -cam.far]) {
          box.expandByPoint(new Vector3(x, y, z).applyMatrix4(cam.matrixWorld));
        }
        const a = sceneToSite(box.min);
        const b = sceneToSite(box.max);
        shadowBox = { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
      }
      let robotsCastShadow = true;
      let backgroundReceivesShadow = true;
      let robots = 0;
      let bg = 0;
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        let p: Object3D | null = o;
        while (p && !p.name.startsWith('robot:')) p = p.parent;
        if (p) {
          robots++;
          if (!o.castShadow) robotsCastShadow = false;
        }
      });
      scene.getObjectByName(`background:${bound?.site}`)?.traverse((o) => {
        if (o instanceof Mesh) {
          bg++;
          if (!o.receiveShadow) backgroundReceivesShadow = false;
        }
      });
      return {
        quality: (scene.userData.quality as string) ?? null,
        environment: !!scene.environment,
        shadows: light
          ? { enabled: gl.shadowMap.enabled, type: gl.shadowMap.type, mapSize: light.shadow.mapSize.x, radius: light.shadow.radius, keyLightCasts: light.castShadow }
          : null,
        effects: (scene.userData.effects as string[]) ?? [],
        shadowBox,
        robotsCastShadow: robots > 0 && robotsCastShadow,
        backgroundReceivesShadow: bg > 0 && backgroundReceivesShadow,
      };
    },
    camera: () => {
      const { camera, controls } = three();
      const target = (controls as unknown as { target?: Vector3 } | null)?.target ?? new Vector3();
      return {
        position: sceneToSite(camera.position),
        target: sceneToSite(target),
        distance: camera.position.distanceTo(target),
        follow: (three().scene.userData.follow as { site: string; cell: string } | undefined) ?? null,
      };
    },
  };
}
