import { module, test } from 'qunit';
import { setupTest } from 'stage-cue-editor/tests/helpers';
import {
  applySwitchPlan,
  COSTUME_CHANGE_SECONDS,
  parseCastEntry,
  planUnderstudySwitch,
} from 'stage-cue-editor/utils/understudy';
import type {
  Cue,
  ShowData,
  UnderstudyEntry,
} from 'stage-cue-editor/models/show';

function makeCue(
  id: string,
  cast: string[],
  offset: number,
  duration = 60,
): Cue {
  return {
    id,
    kind: '演员',
    title: `提示-${id}`,
    duration,
    owner: '',
    lighting: '',
    sound: '',
    props: [],
    cast,
    notes: '',
    dependsOn: [],
    offset,
  };
}

function makeShow(cues: Cue[], startTime = '19:30'): ShowData {
  return {
    title: '测试剧目',
    venue: '测试剧场',
    date: '2026-10-02',
    updatedAt: '',
    scenes: [
      {
        id: 's1',
        act: '第一幕',
        name: 'S1',
        title: '开场',
        startTime,
        locked: false,
        cues,
      },
    ],
  };
}

function understudy(
  actor: string,
  rolesText: string,
  availableAt = '19:00',
): UnderstudyEntry {
  return { id: `u-${actor}`, actor, rolesText, availableAt };
}

module('Unit | Utility | understudy', function (hooks) {
  setupTest(hooks);

  test('parseCastEntry 识别「角色／演员」与缺少角色归属的旧条目', function (assert) {
    const attributed = parseCastEntry('说书人／周启');
    assert.true(attributed.hasRole);
    assert.strictEqual(attributed.role, '说书人');
    assert.strictEqual(attributed.actor, '周启');

    const bare = parseCastEntry('周启');
    assert.false(bare.hasRole, '旧名单缺少角色归属时按原演员处理');
    assert.strictEqual(bare.actor, '周启');
  });

  test('切换前列出所有受影响的提示', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0),
      makeCue('c2', ['说书人／周启', '群演 6 人'], 60),
      makeCue('c3', ['侍女／赵一帆'], 120),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人'),
    ]);
    assert.strictEqual(plan.items.length, 2, '两条说书人提示受影响');
    assert.deepEqual(
      plan.items.map((item) => item.cueId),
      ['c1', 'c2'],
    );
    assert.strictEqual(plan.items[0]?.toActor, '钱进');
    assert.strictEqual(
      plan.items[0]?.start,
      '19:30:00',
      '时间由场次开场与提示时长决定',
    );
    assert.strictEqual(plan.items[1]?.start, '19:31:00');
    assert.strictEqual(plan.conflicts.length, 0);
  });

  test('旧名单缺少角色归属时按原演员处理', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0),
      makeCue('c2', ['旁白／周启'], 60),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [understudy('钱进', '')]);
    assert.deepEqual(
      plan.items.map((item) => item.role),
      ['说书人', '旁白'],
      '替演名单缺角色归属时承接原演员的全部角色',
    );
  });

  test('提示表中缺少角色归属的条目保留原演员', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0),
      makeCue('c2', ['周启'], 60),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人'),
    ]);
    assert.strictEqual(plan.items.length, 1);
    assert.strictEqual(plan.kept.length, 1, '未标注角色的条目按原演员保留');
    assert.strictEqual(plan.kept[0]?.cueId, 'c2');
    applySwitchPlan(show, plan);
    assert.deepEqual(
      show.scenes[0]?.cues[1]?.cast,
      ['周启'],
      '保留条目不被改写',
    );
  });

  test('同一替补被多个角色占用时报冲突', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0),
      makeCue('c2', ['旁白／周启'], 300),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人、旁白'),
    ]);
    const conflict = plan.conflicts.find(
      (entry) => entry.type === 'double-role',
    );
    assert.ok(conflict, '存在角色占用冲突');
    assert.ok(conflict?.detail.includes('钱进'));
  });

  test('提示开场早于替补可到场时间时报冲突', function (assert) {
    const show = makeShow([makeCue('c1', ['说书人／周启'], 0)]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人', '19:35'),
    ]);
    const conflict = plan.conflicts.find((entry) => entry.type === 'arrival');
    assert.ok(conflict, '19:30 开场的提示赶不上 19:35 到场的替补');
  });

  test('替补已在同一段时间的别的提示中登场时报分身上场冲突', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0, 120),
      makeCue('c2', ['侍从／钱进'], 60, 120),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人'),
    ]);
    const conflict = plan.conflicts.find((entry) => entry.type === 'overlap');
    assert.ok(conflict, '钱进无法在同一时刻分身上场');
  });

  test('不同角色间隔不足换装时间时报冲突', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0, 60),
      makeCue('c2', ['侍从／钱进'], 60 + 30, 60),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人'),
    ]);
    const conflict = plan.conflicts.find((entry) => entry.type === 'costume');
    assert.ok(conflict, `间隔 30 秒小于 ${COSTUME_CHANGE_SECONDS} 秒换装时间`);
  });

  test('同角色相邻登台不触发换装冲突', function (assert) {
    const show = makeShow([
      makeCue('c1', ['说书人／周启'], 0, 60),
      makeCue('c2', ['说书人／周启'], 60, 60),
    ]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人'),
    ]);
    assert.strictEqual(plan.conflicts.length, 0, '同一角色连续上场无需换装');
  });

  test('applySwitchPlan 幂等：重复执行不会重复追加变更', function (assert) {
    const show = makeShow([makeCue('c1', ['说书人／周启', '群演 6 人'], 0)]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '说书人'),
    ]);
    assert.true(applySwitchPlan(show, plan));
    assert.deepEqual(show.scenes[0]?.cues[0]?.cast, [
      '说书人／钱进',
      '群演 6 人',
    ]);
    assert.false(applySwitchPlan(show, plan), '第二次执行没有可改写的条目');
    assert.deepEqual(
      show.scenes[0]?.cues[0]?.cast,
      ['说书人／钱进', '群演 6 人'],
      '结果保持一次切换后的状态',
    );
  });

  test('没有可顶角色的替补时不产生受影响提示', function (assert) {
    const show = makeShow([makeCue('c1', ['说书人／周启'], 0)]);
    const plan = planUnderstudySwitch(show, '周启', [
      understudy('钱进', '旁白'),
    ]);
    assert.strictEqual(plan.items.length, 0);
    assert.strictEqual(plan.conflicts.length, 0);
  });
});
