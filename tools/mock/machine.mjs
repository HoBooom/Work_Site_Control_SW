// Mock 서버의 작업 상태 머신(셀 하나 = 로봇 하나). 순수 모듈: 시각(now)과 입력을 받아 보낼 메시지를 돌려준다.
// 규칙은 frontend/docs/spec.md 3절 표다. 서버 단계에서 server/docs/state-machine.md로 옮겨 같은 표를 따른다.
//
// 메시지는 { suffix, payload } (payload에 v·ts는 붙이지 않는다. 보내는 쪽이 붙인다).
import { snapToSeam, toMm } from './geometry.mjs';

export const RUN_MS = 8000; // Mock 용접 시간
export const PROGRESS_EVERY_MS = 500;

/**
 * @param {{ cell: string, frame: { surface: string, seam_px: number[][], size: number[], H: number[] }, runMs?: number }} opts
 */
export function createUnit({ cell, frame, runMs = RUN_MS }) {
  return {
    cell,
    frame,
    runMs,
    state: 'idle',
    taskId: null,
    taskSeq: 0,
    frameSeq: 0,
    frameId: null,
    proposal: null, // { path, path_px, confidence }
    startedAt: 0,
    progress: 0,
    lastProgressAt: 0,
    resumeTo: null, // 정지 전에 하던 작업이 있으면 proposed
    alarmSeq: 0,
  };
}

const stateMsg = (u) => ({ suffix: 'task/state', payload: { state: u.state, task_id: u.taskId } });
const proposalMsg = (u) => ({
  suffix: 'task/proposal',
  payload: {
    task_id: u.taskId,
    surface: u.frame.surface,
    path: u.proposal.path,
    confidence: u.proposal.confidence,
    frame_id: u.frameId,
    frame_size: u.frame.size,
    path_px: u.proposal.path_px,
  },
});
const alarm = (u, severity, code, message, active = true, extra = {}) => ({
  suffix: 'alarm',
  payload: { alarm_id: extra.alarm_id ?? `${u.cell}-${code.toLowerCase()}-${++u.alarmSeq}`, severity, code, message, active, ...(extra.cmd_id ? { cmd_id: extra.cmd_id } : {}) },
});

function newFrame(u) {
  u.frameId = `f-${u.cell}-${String(++u.frameSeq).padStart(5, '0')}`;
}

/** Mock 비전: 대기 중인 로봇에 용접선 전체를 제안한다(같은 자리 재작업도 같은 길) */
export function propose(u, now, confidence = 0.88) {
  if (u.state !== 'idle') return [];
  u.taskId = `t-${u.cell}-${String(++u.taskSeq).padStart(4, '0')}`;
  newFrame(u);
  const path_px = u.frame.seam_px.map((p) => [...p]);
  u.proposal = { path_px, path: toMm(u.frame.H, path_px), confidence };
  u.state = 'proposed';
  return [stateMsg(u), proposalMsg(u)];
}

const reject = (u, cmd, payload, why) => ({
  accepted: false,
  out: [alarm(u, 'warning', 'CMD_REJECTED', `${cmd} 거부: ${why}`, true, { cmd_id: payload.cmd_id })],
});

/** 명령 하나. 받아들이면 상태를 바꾸고 보낼 메시지를, 아니면 거부 알람을 돌려준다 */
export function command(u, name, payload, now) {
  const needTask = ['edit_start', 'drag', 'approve', 'confirm'].includes(name);
  if (needTask && payload.task_id !== u.taskId) return reject(u, name, payload, `지금 작업(${u.taskId ?? '없음'})이 아니다`);
  switch (name) {
    case 'edit_start': {
      if (u.state !== 'proposed') return reject(u, name, payload, `${u.state} 상태`);
      u.state = 'editing';
      newFrame(u); // 지금 프레임을 멈춘다
      return { accepted: true, out: [stateMsg(u), proposalMsg(u)] };
    }
    case 'drag': {
      if (u.state !== 'editing') return reject(u, name, payload, `${u.state} 상태`);
      if (payload.frame_id !== u.frameId) return reject(u, name, payload, `멈춘 프레임(${u.frameId})이 아니다`);
      const s = snapToSeam(u.frame.seam_px, payload.path_px);
      const snap = { suffix: 'task/snap', payload: { task_id: u.taskId, ok: s.ok, surface: u.frame.surface, path: toMm(u.frame.H, s.path_px), frame_id: u.frameId, frame_size: u.frame.size, path_px: s.path_px } };
      if (!s.ok) return { accepted: true, out: [snap, alarm(u, 'info', 'SNAP_FAILED', '그린 선이 용접선에서 멀다. 다시 그린다')] };
      u.proposal = { path_px: s.path_px, path: snap.payload.path, confidence: 0.97 };
      u.state = 'proposed';
      return { accepted: true, out: [snap, stateMsg(u), proposalMsg(u)] };
    }
    case 'approve': {
      if (u.state !== 'proposed') return reject(u, name, payload, `${u.state} 상태`);
      u.state = 'running';
      u.startedAt = now;
      u.progress = 0;
      u.lastProgressAt = now;
      return { accepted: true, out: [stateMsg(u), { suffix: 'task/progress', payload: { task_id: u.taskId, progress: 0 } }] };
    }
    case 'confirm': {
      if (u.state !== 'completed') return reject(u, name, payload, `${u.state} 상태`);
      const rework = payload.result === 'rework';
      u.state = 'idle';
      u.taskId = null;
      u.proposal = null;
      const out = [stateMsg(u)];
      if (rework) out.push(...propose(u, now, 0.8)); // 같은 자리를 다시 제안
      return { accepted: true, out };
    }
    case 'estop': {
      if (u.state === 'estopped') return { accepted: true, out: [] };
      u.resumeTo = u.taskId ? 'proposed' : 'idle';
      u.state = 'estopped';
      return { accepted: true, out: [stateMsg(u), alarm(u, 'critical', 'ESTOP', payload.reason ? `긴급정지: ${payload.reason}` : '긴급정지', true, { alarm_id: `${u.cell}-estop` })] };
    }
    case 'resume': {
      if (u.state !== 'estopped' && u.state !== 'paused') return reject(u, name, payload, `${u.state} 상태`);
      const wasEstop = u.state === 'estopped';
      u.state = u.resumeTo ?? 'idle';
      if (u.state === 'idle') u.taskId = null;
      u.resumeTo = null;
      const out = [stateMsg(u)];
      if (u.state === 'proposed') out.push(proposalMsg(u));
      if (wasEstop) out.push(alarm(u, 'critical', 'ESTOP', '긴급정지 해제', false, { alarm_id: `${u.cell}-estop` }));
      else out.push(alarm(u, 'warning', 'HEARTBEAT_LOST', '일시정지 해제', false, { alarm_id: `${u.cell}-heartbeat` }));
      return { accepted: true, out };
    }
    default:
      return reject(u, name, payload, '모르는 명령');
  }
}

/** 웹 heartbeat가 끊기면 실행 중인 로봇을 일시정지한다 */
export function pause(u, why) {
  if (u.state !== 'running') return [];
  u.state = 'paused';
  u.resumeTo = 'proposed';
  return [stateMsg(u), alarm(u, 'warning', 'HEARTBEAT_LOST', why, true, { alarm_id: `${u.cell}-heartbeat` })];
}

/** 시간 진행: 실행 중이면 진행률을 올리고 끝나면 completed */
export function tick(u, now) {
  if (u.state !== 'running') return [];
  u.progress = Math.min(1, (now - u.startedAt) / u.runMs);
  const out = [];
  if (now - u.lastProgressAt >= PROGRESS_EVERY_MS || u.progress >= 1) {
    u.lastProgressAt = now;
    out.push({ suffix: 'task/progress', payload: { task_id: u.taskId, progress: Math.round(u.progress * 10000) / 10000 } });
  }
  if (u.progress >= 1) {
    u.state = 'completed';
    out.push(stateMsg(u));
  }
  return out;
}

/** 처음 붙었을 때 보낼 retained 상태 */
export function snapshot(u) {
  const out = [stateMsg(u)];
  if (u.proposal) out.push(proposalMsg(u));
  return out;
}
