import { module, test } from 'qunit';
import {
  applySwitch,
  buildUnderstudyPlan,
  parseRoster,
  principalOptions,
  revertSwitch,
  serializeRoster,
  splitCastToken,
} from 'stage-cue-editor/utils/understudy';
import type {
  Cue,
  ShowData,
  UnderstudyEntry,
  UnderstudySwitch,
} from 'stage-cue-editor/models/show';

function makeCue(
  id: string,
  cast: string[],
  startTimeOffset: number,
  duration: number,
): Cue {
  return {
    id,
    kind: '演员',
    title: `提示 ${id}`,
    duration,
    owner: '赵一帆',
    lighting: '',
    sound: '',
    props: [],
    cast,
    notes: '',
    dependsOn: [],
    offset: startTimeOffset,
  };
}

function makeShow(): ShowData {
  return {
    title: '测试演出',
    venue: '测试剧场',
    date: '2026-10-02',
    updatedAt: '2026-10-02T10:00:00.000Z',
    scenes: [
      {
        id: 's1',
        act: '第一幕',
        name: 'S1',
        title: '第一场',
        startTime: '19:30',
        locked: false,
        cues: [
          makeCue('c1', ['说书人／周启'], 0, 180),
          makeCue('c2', ['群舞／林越'], 180, 180),
        ],
      },
      {
        id: 's2',
        act: '第一幕',
        name: 'S2',
        title: '第二场',
        startTime: '19:40',
        locked: false,
        cues: [makeCue('c3', ['说书人／周启', '群臣／张山'], 0, 300)],
      },
    ],
  };
}

const roster: UnderstudyEntry[] = [
  {
    id: 'u1',
    name: '林越',
    role: '说书人',
    availableFrom: '19:00',
    changeSeconds: 120,
  },
  {
    id: 'u2',
    name: '苏晴',
    role: '说书人',
    availableFrom: '19:35',
    changeSeconds: 90,
  },
  // 旧名单：缺角色归属，按原演员处理
  {
    id: 'u3',
    name: '周启',
    role: '',
    availableFrom: '18:00',
    changeSeconds: 0,
  },
];

module('Unit | Utility | understudy | splitCastToken', function () {
  test('解析角色与演员归属', function (assert) {
    assert.deepEqual(splitCastToken('说书人／周启'), {
      role: '说书人',
      performer: '周启',
      hasRole: true,
    });
  });

  test('缺少角色归属时两端回填原始串（按原演员处理）', function (assert) {
    assert.deepEqual(splitCastToken('周启'), {
      role: '周启',
      performer: '周启',
      hasRole: false,
    });
  });
});

module('Unit | Utility | understudy | principalOptions', function () {
  test('按角色汇总且统计受影响提示数', function (assert) {
    const options = principalOptions(makeShow());
    const storyteller = options.find((item) => item.key === '说书人');
    assert.ok(storyteller);
    assert.strictEqual(storyteller?.performer, '周启');
    assert.strictEqual(storyteller?.cueCount, 2, '说书人出现在 c1 与 c3');
  });
});

module('Unit | Utility | understudy | buildUnderstudyPlan', function () {
  test('切换前列出全部受影响提示（跨场，顺序与时间来自提示表）', function (assert) {
    const plan = buildUnderstudyPlan(makeShow(), roster, '说书人');
    assert.strictEqual(plan.cues.length, 2);
    assert.deepEqual(
      plan.cues.map((cue) => cue.cueId),
      ['c1', 'c3'],
    );
    assert.strictEqual(plan.cues[0]?.startLabel, '19:30:00');
    assert.strictEqual(plan.cues[1]?.sceneId, 's2');
  });

  test('默认选最早可到场者，无冲突时计划可执行', function (assert) {
    // 林越自己在 c2 也有同台演出；换装给足 0 秒（首尾相接也能上）时无冲突
    const okRoster = roster.map((entry) =>
      entry.id === 'u1' ? { ...entry, changeSeconds: 0 } : entry,
    );
    const plan = buildUnderstudyPlan(makeShow(), okRoster, '说书人');
    assert.strictEqual(plan.understudyName, '林越');
    assert.true(plan.ok);
    assert.deepEqual(plan.conflicts, []);
  });

  test('可到场晚于提示时标 changeover 并阻止切换', function (assert) {
    // 只保留 19:35 才能到场的苏晴
    const lateRoster = roster.filter((entry) => entry.name === '苏晴');
    const plan = buildUnderstudyPlan(makeShow(), lateRoster, '说书人');
    assert.false(plan.ok);
    assert.true(plan.conflicts.includes('changeover'));
    assert.strictEqual(
      plan.cues.find((cue) => cue.cueId === 'c1')?.conflicts[0],
      'changeover',
    );
  });

  test('同一替演已被别的角色占用且换装时间不足时标 changeover', function (assert) {
    // 林越在 c2（19:33–19:36）原本以「群舞」身份上场；
    // 让他顶说书人后，c1（19:30–19:33）结束到 c2 开始 0 秒，换装 120 秒来不及。
    const plan = buildUnderstudyPlan(makeShow(), roster, '说书人', '林越');
    const first = plan.cues.find((cue) => cue.cueId === 'c1');
    assert.ok(
      first?.conflicts.includes('changeover'),
      'c1 结束到 c2 开始 0 秒 < 换装 120 秒',
    );
    assert.false(plan.ok);
  });

  test('跨场同一时刻分身上场标 doublebooked', function (assert) {
    const show = makeShow();
    // 第三场与第一场时间重叠，周启同时需要在两场上场
    show.scenes.push({
      id: 's3',
      act: '第二幕',
      name: 'S3',
      title: '第三场',
      startTime: '19:31',
      locked: false,
      cues: [makeCue('c4', ['说书人／周启'], 0, 120)],
    });
    const plan = buildUnderstudyPlan(show, roster, '说书人', '林越');
    assert.false(plan.ok);
    const overlapping = plan.cues.filter((cue) =>
      cue.conflicts.includes('doublebooked'),
    );
    assert.strictEqual(overlapping.length, 2, 'c1 与 c4 互相标记分身');
  });

  test('已被其他角色的替补切换占用时标 occupied', function (assert) {
    // 先前已让林越顶「群臣」（c3 与说书人 c3 同时同条提示，必然撞）
    const { show: switchedShow, switchRecord } = applySwitch(
      makeShow(),
      '群臣',
      '林越',
      '2026-10-02T10:00:00.000Z',
    );
    const active: UnderstudySwitch[] = [switchRecord];
    const plan = buildUnderstudyPlan(
      switchedShow,
      roster,
      '说书人',
      '林越',
      active,
    );
    assert.false(plan.ok);
    assert.ok(
      plan.cues
        .find((cue) => cue.cueId === 'c3')
        ?.conflicts.includes('occupied'),
    );
  });

  test('没有可用替演时不可切换并给出说明', function (assert) {
    const plan = buildUnderstudyPlan(makeShow(), roster, '不存在的角色');
    assert.false(plan.ok);
    assert.strictEqual(plan.cues.length, 0);
    assert.ok(plan.conflictSummary[0]?.includes('没有角色'));
  });

  test('角色存在但名单无人可顶时给出提示', function (assert) {
    const plan = buildUnderstudyPlan(makeShow(), [], '说书人');
    assert.false(plan.ok);
    assert.strictEqual(plan.understudyName, '');
    assert.ok(plan.conflictSummary[0]?.includes('没有能顶'));
  });

  test('旧名单缺角色归属时按原演员处理', function (assert) {
    // 提示表里的旧条目没有「角色／演员」归属，只有原演员名「周启」
    const legacyShow = makeShow();
    legacyShow.scenes[0]!.cues[0]!.cast = ['周启'];
    legacyShow.scenes[1]!.cues[0]!.cast = ['群臣／张山'];
    const oldRoster: UnderstudyEntry[] = [
      {
        id: 'u3',
        name: '韩松',
        role: '周启',
        availableFrom: '18:00',
        changeSeconds: 0,
      },
    ];
    const plan = buildUnderstudyPlan(legacyShow, oldRoster, '周启');
    assert.strictEqual(plan.understudyName, '韩松');
    assert.true(plan.ok);
    assert.strictEqual(plan.cues[0]?.cueId, 'c1');
  });

  test('失声主演本人不会被当作自己的替演', function (assert) {
    const selfRoster: UnderstudyEntry[] = [
      {
        id: 'u3',
        name: '周启',
        role: '',
        availableFrom: '18:00',
        changeSeconds: 0,
      },
    ];
    const plan = buildUnderstudyPlan(makeShow(), selfRoster, '说书人');
    assert.false(plan.ok);
    assert.strictEqual(plan.understudyName, '');
  });
});

module('Unit | Utility | understudy | applySwitch / revertSwitch', function () {
  test('applySwitch 只改受影响提示的演员归属，顺序时长不变', function (assert) {
    const show = makeShow();
    const { show: next, switchRecord } = applySwitch(
      show,
      '说书人',
      '林越',
      '2026-10-02T11:00:00.000Z',
    );
    assert.strictEqual(next.scenes[0]!.cues[0]!.cast[0], '说书人／林越');
    assert.strictEqual(next.scenes[1]!.cues[0]!.cast[0], '说书人／林越');
    assert.strictEqual(
      next.scenes[1]!.cues[0]!.cast[1],
      '群臣／张山',
      '同台其他演员不动',
    );
    assert.deepEqual(switchRecord.cueIds, ['c1', 'c3']);
    assert.strictEqual(
      next.scenes[0]!.cues[0]!.duration,
      show.scenes[0]!.cues[0]!.duration,
    );
    assert.strictEqual(
      show.scenes[0]!.cues[0]!.cast[0],
      '说书人／周启',
      '不修改原对象',
    );
  });

  test('revertSwitch 幂等：重复恢复不会叠加变更', function (assert) {
    const show = makeShow();
    const { show: switched, switchRecord } = applySwitch(
      show,
      '说书人',
      '林越',
      '2026-10-02T11:00:00.000Z',
    );
    const restored = revertSwitch(switched, switchRecord);
    const restoredAgain = revertSwitch(restored, switchRecord);
    assert.strictEqual(restored.scenes[0]!.cues[0]!.cast[0], '说书人／周启');
    assert.deepEqual(
      restoredAgain.scenes[0]!.cues[0]!.cast,
      restored.scenes[0]!.cues[0]!.cast,
    );
  });

  test('无归属演员切换直接换名，恢复时还原原名', function (assert) {
    const show = makeShow();
    show.scenes[0]!.cues[0]!.cast = ['周启'];
    const { show: switched, switchRecord } = applySwitch(
      show,
      '周启',
      '韩松',
      '2026-10-02T11:00:00.000Z',
    );
    assert.deepEqual(switched.scenes[0]!.cues[0]!.cast, ['韩松']);
    const restored = revertSwitch(switched, switchRecord);
    assert.deepEqual(restored.scenes[0]!.cues[0]!.cast, ['周启']);
  });
});

module('Unit | Utility | understudy | roster text', function () {
  test('名单文本往返解析', function (assert) {
    const text = serializeRoster(roster);
    const parsed = parseRoster(text);
    assert.strictEqual(parsed.length, roster.length);
    assert.strictEqual(parsed[0]?.name, '林越');
    assert.strictEqual(parsed[0]?.changeSeconds, 120);
    assert.strictEqual(parsed[2]?.role, '', '旧名单空角色保留');
  });
});
