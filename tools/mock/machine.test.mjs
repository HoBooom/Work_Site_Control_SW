// L2: Mock 상태 머신(frontend/docs/spec.md 3절 표). node --test tools/
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import Ajv from 'ajv';
import { apply, homography, snapToSeam } from './geometry.mjs';
import { RUN_MS, command, createUnit, pause, propose, tick } from './machine.mjs';

const root = new URL('../../', import.meta.url);
const ajv = new Ajv({ strict: true });
for (const f of readdirSync(new URL('contracts/schemas/', root))) ajv.addSchema(JSON.parse(readFileSync(new URL(`contracts/schemas/${f}`, root), 'utf8')));
const topics = JSON.parse(readFileSync(new URL('contracts/topics.json', root), 'utf8'));
const schemaOf = new Map(topics.cell_topics.map((t) => [t.suffix, t.schema]));

/** 머신이 낸 메시지가 계약을 통과한다(v·ts는 보내는 쪽이 붙인다) */
function assertContract(out) {
  for (const m of out) {
    const v = ajv.getSchema(schemaOf.get(m.suffix));
    assert.ok(v, `스키마 없음: ${m.suffix}`);
    assert.ok(v({ v: 1, ts: 1, ...m.payload }), `${m.suffix}: ${JSON.stringify(v.errors)}`);
  }
}

const H = homography([
  { px: [0, 0], mm: [1000, 2000] },
  { px: [1000, 0], mm: [2000, 2000] },
  { px: [1000, 500], mm: [2000, 1500] },
  { px: [0, 500], mm: [1000, 1500] },
]);
const frame = { surface: 'bottom-shell', size: [1000, 500], seam_px: [[100, 250], [500, 240], [900, 230]], H };
const op = { cmd_id: 'c0ffee00-0001', operator: 'op-test' };
const states = (out) => out.filter((m) => m.suffix === 'task/state').map((m) => m.payload.state);
const rejected = (r) => r.accepted === false && r.out.some((m) => m.payload.code === 'CMD_REJECTED' && m.payload.cmd_id === op.cmd_id);

function proposed() {
  const u = createUnit({ cell: 'spider-1', frame });
  const out = propose(u, 0);
  assertContract(out);
  return u;
}

describe('기하', () => {
  it('호모그래피가 대응점을 그대로 옮긴다', () => {
    assert.deepEqual(apply(H, [1000, 500]).map(Math.round), [2000, 1500]);
    assert.deepEqual(apply(H, [500, 250]).map(Math.round), [1500, 1750]);
  });
  it('수렴: 용접선 근처면 용접선 위로, 멀면 실패', () => {
    const near = snapToSeam(frame.seam_px, [[150, 262], [480, 255], [850, 246]]);
    assert.equal(near.ok, true);
    near.path_px.forEach(([x, y]) => assert.ok(Math.abs(y - (250 - (x - 100) * 0.025)) < 0.2, `${x},${y}`));
    assert.equal(snapToSeam(frame.seam_px, [[100, 450], [900, 450]]).ok, false);
  });
});

describe('작업 상태 머신 @L2', () => {
  it('제안 → 승인 → 실행(진행률) → 완료 → 확인(합격) → 대기', () => {
    const u = proposed();
    assert.equal(u.state, 'proposed');
    let r = command(u, 'approve', { ...op, task_id: u.taskId }, 1000);
    assert.equal(r.accepted, true);
    assertContract(r.out);
    assert.deepEqual(states(r.out), ['running']);
    const mid = tick(u, 1000 + RUN_MS / 2);
    assertContract(mid);
    assert.ok(Math.abs(u.progress - 0.5) < 1e-9);
    const end = tick(u, 1000 + RUN_MS);
    assert.deepEqual(states(end), ['completed']);
    r = command(u, 'confirm', { ...op, task_id: u.taskId, result: 'ok' }, 20000);
    assertContract(r.out);
    assert.deepEqual([u.state, u.taskId], ['idle', null]);
  });

  it('확인(재작업)은 같은 자리를 새 작업으로 다시 제안한다', () => {
    const u = proposed();
    const first = u.taskId;
    command(u, 'approve', { ...op, task_id: u.taskId }, 0);
    tick(u, RUN_MS);
    const r = command(u, 'confirm', { ...op, task_id: u.taskId, result: 'rework' }, RUN_MS);
    assertContract(r.out);
    assert.equal(u.state, 'proposed');
    assert.notEqual(u.taskId, first);
    assert.deepEqual(u.proposal.path_px, frame.seam_px);
  });

  it('수정: 프레임을 멈추고, 그린 선을 수렴시켜 다시 제안한다. 실패하면 수정 중 그대로', () => {
    const u = proposed();
    const before = u.frameId;
    let r = command(u, 'edit_start', { ...op, task_id: u.taskId }, 0);
    assertContract(r.out);
    assert.equal(u.state, 'editing');
    assert.notEqual(u.frameId, before, '멈춘 프레임은 새 frame_id');
    r = command(u, 'drag', { ...op, task_id: u.taskId, frame_id: u.frameId, path_px: [[100, 450], [900, 450]] }, 1);
    assertContract(r.out);
    assert.equal(u.state, 'editing');
    assert.equal(r.out.find((m) => m.suffix === 'task/snap').payload.ok, false);
    r = command(u, 'drag', { ...op, task_id: u.taskId, frame_id: u.frameId, path_px: [[300, 252], [700, 240]] }, 2);
    assertContract(r.out);
    assert.equal(u.state, 'proposed');
    const p = r.out.find((m) => m.suffix === 'task/proposal').payload;
    assert.equal(p.path_px.length, 9);
    assert.ok(p.path_px[0][0] > 290 && p.path_px[8][0] < 710, '그린 구간만');
  });

  it('수정 취소: 그린 선을 버리고 수정 전 제안으로 돌아간다. 수렴 실패 알람도 풀린다', () => {
    const u = proposed();
    const before = structuredClone(u.proposal);
    command(u, 'edit_start', { ...op, task_id: u.taskId }, 0);
    let r = command(u, 'drag', { ...op, task_id: u.taskId, frame_id: u.frameId, path_px: [[100, 450], [900, 450]] }, 1);
    const failed = r.out.find((m) => m.suffix === 'alarm');
    assert.equal(failed.payload.alarm_id, `${u.cell}-snap`);
    r = command(u, 'edit_cancel', { ...op, task_id: u.taskId }, 2);
    assertContract(r.out);
    assert.equal(u.state, 'proposed');
    assert.deepEqual(r.out.find((m) => m.suffix === 'task/proposal').payload.path_px, before.path_px, '수정 전 경로 그대로');
    assert.ok(r.out.some((m) => m.suffix === 'alarm' && m.payload.alarm_id === `${u.cell}-snap` && m.payload.active === false));
    assert.ok(rejected(command(u, 'edit_cancel', { ...op, task_id: u.taskId }, 3)), '수정 중이 아니면 거부');
    assert.ok(rejected(command(u, 'edit_cancel', { ...op, task_id: 't-old' }, 3)), '지난 작업은 거부');
  });

  it('긴급정지는 아무 상태에서나, 재개하면 하던 작업은 승인 대기로·없으면 대기로', () => {
    for (const setup of ['idle', 'proposed', 'editing', 'running', 'completed']) {
      const u = createUnit({ cell: 'spider-1', frame });
      if (setup !== 'idle') propose(u, 0);
      if (setup === 'editing') command(u, 'edit_start', { ...op, task_id: u.taskId }, 0);
      if (setup === 'running' || setup === 'completed') command(u, 'approve', { ...op, task_id: u.taskId }, 0);
      if (setup === 'completed') tick(u, RUN_MS);
      assert.equal(u.state, setup);
      let r = command(u, 'estop', { ...op, reason: '시험' }, 1);
      assertContract(r.out);
      assert.equal(u.state, 'estopped', setup);
      assert.ok(r.out.some((m) => m.payload.code === 'ESTOP' && m.payload.active));
      r = command(u, 'resume', { ...op }, 2);
      assertContract(r.out);
      assert.equal(u.state, setup === 'idle' ? 'idle' : 'proposed', `${setup} → 재개`);
      assert.ok(r.out.some((m) => m.payload.code === 'ESTOP' && m.payload.active === false), '정지 알람 해제');
    }
  });

  it('heartbeat가 끊기면 실행 중만 일시정지, 재개하면 승인 대기', () => {
    const u = proposed();
    assert.deepEqual(pause(u, '끊김'), []);
    command(u, 'approve', { ...op, task_id: u.taskId }, 0);
    const out = pause(u, '운영자 화면 응답 없음');
    assertContract(out);
    assert.equal(u.state, 'paused');
    assert.ok(out.some((m) => m.suffix === 'alarm' && m.payload.code === 'HEARTBEAT_LOST' && m.payload.active && m.payload.alarm_id === `${u.cell}-heartbeat`));
    const r = command(u, 'resume', { ...op }, 1);
    assert.equal(u.state, 'proposed');
    assertContract(r.out);
    assert.ok(r.out.some((m) => m.suffix === 'alarm' && m.payload.alarm_id === `${u.cell}-heartbeat` && m.payload.active === false), '재개하면 heartbeat 알람을 해제한다');
  });

  it('허용되지 않은 명령은 거부 알람(cmd_id)을 내고 상태를 바꾸지 않는다', () => {
    const cases = [
      ['idle', 'approve'], ['idle', 'edit_start'], ['idle', 'confirm'], ['idle', 'resume'],
      ['proposed', 'drag'], ['proposed', 'confirm'], ['proposed', 'resume'], ['proposed', 'edit_cancel'],
      ['editing', 'approve'], ['editing', 'confirm'],
      ['running', 'approve'], ['running', 'edit_start'], ['running', 'confirm'], ['running', 'edit_cancel'],
      ['completed', 'approve'], ['completed', 'edit_start'],
    ];
    for (const [setup, cmd] of cases) {
      const u = createUnit({ cell: 'spider-1', frame });
      if (setup !== 'idle') propose(u, 0);
      if (setup === 'editing') command(u, 'edit_start', { ...op, task_id: u.taskId }, 0);
      if (setup === 'running' || setup === 'completed') command(u, 'approve', { ...op, task_id: u.taskId }, 0);
      if (setup === 'completed') tick(u, RUN_MS);
      const r = command(u, cmd, { ...op, task_id: u.taskId ?? 't-none', frame_id: u.frameId ?? 'f', path_px: [[0, 0], [1, 1]], result: 'ok' }, 1);
      assertContract(r.out);
      assert.ok(rejected(r), `${setup}에서 ${cmd}`);
      assert.equal(u.state, setup, `${setup}에서 ${cmd} 뒤 상태`);
    }
  });

  it('지난 작업·지난 프레임에 대한 명령은 거부한다', () => {
    const u = proposed();
    assert.ok(rejected(command(u, 'approve', { ...op, task_id: 't-old' }, 0)));
    command(u, 'edit_start', { ...op, task_id: u.taskId }, 0);
    assert.ok(rejected(command(u, 'drag', { ...op, task_id: u.taskId, frame_id: 'f-old', path_px: [[0, 0], [1, 1]] }, 1)));
  });
});
