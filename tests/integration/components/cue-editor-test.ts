import { module, test } from 'qunit';
import { setupRenderingTest } from 'stage-cue-editor/tests/helpers';
import { click, render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import type { ShowData } from 'stage-cue-editor/models/show';
import type { SwitchRecord } from 'stage-cue-editor/models/show';

const STORAGE_KEY = 'sologsb-1013-stage-cue-editor-v1';
const SWITCH_LOG_KEY = 'sologsb-1013-stage-cue-editor-switch-log-v1';
const originalSetItem = Storage.prototype.setItem;

function storedCastEntries(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY) ?? '{}';
  const stored = JSON.parse(raw) as { show?: ShowData };
  return (stored.show?.scenes ?? []).flatMap((scene) =>
    scene.cues.flatMap((cue) => cue.cast),
  );
}

function storedSwitchLog(): SwitchRecord[] {
  return JSON.parse(
    localStorage.getItem(SWITCH_LOG_KEY) ?? '[]',
  ) as SwitchRecord[];
}

module('Integration | Component | cue-editor', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    localStorage.clear();
  });

  hooks.afterEach(function () {
    Storage.prototype.setItem = originalSetItem;
    localStorage.clear();
  });

  test('执行切换前列出受影响提示，执行后替换演员并写入两处保存', async function (assert) {
    await render(hbs`<CueEditor />`);

    assert
      .dom('.switch-preview .switch-item')
      .exists({ count: 1 }, '切换前列出 1 条受影响提示');
    assert
      .dom('.switch-preview .switch-item')
      .includesText('说书人：周启 → 钱进');

    await click('.switch-actions button');

    const casts = storedCastEntries();
    assert.ok(casts.includes('说书人／钱进'), '提示表已替换为替补演员');
    assert.notOk(casts.includes('说书人／周启'), '原演员条目被移除');
    assert.strictEqual(storedSwitchLog().length, 1, '切换记录已写入第二处保存');
    assert.strictEqual(storedSwitchLog()[0]?.actor, '周启');
    assert.dom('.switch-log-row').exists({ count: 1 });
  });

  test('存在冲突时保留原提示表并指明冲突', async function (assert) {
    // 让替补 19:35 才能到场，赶不上 19:30:45 的提示
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        understudies: [
          {
            id: 'u-1',
            actor: '钱进',
            rolesText: '说书人',
            availableAt: '19:35',
          },
        ],
      }),
    );
    await render(hbs`<CueEditor />`);

    assert.dom('.switch-conflict').exists('冲突被指明');
    assert.dom('.switch-conflict').includesText('到场');

    await click('.switch-actions button');
    assert.dom('.cue-list').includesText('说书人／周启', '冲突时保留原提示表');
    assert.dom('.cue-list').doesNotIncludeText('说书人／钱进');
    assert.strictEqual(storedSwitchLog().length, 0, '未写入切换记录');
  });

  test('两处保存任一失败都恢复切换前状态，重试不重复追加变更', async function (assert) {
    await render(hbs`<CueEditor />`);

    let failLogSave = true;
    Storage.prototype.setItem = function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (failLogSave && key === SWITCH_LOG_KEY)
        throw new Error('QuotaExceededError');
      originalSetItem.call(this, key, value);
    };

    await click('.switch-actions button');

    assert.ok(
      storedCastEntries().includes('说书人／周启'),
      '第二处保存失败后提示表恢复为切换前状态',
    );
    assert.strictEqual(storedSwitchLog().length, 0, '未留下切换记录');
    assert.dom('.cue-list').includesText('说书人／周启');
    assert.dom('.toast-message').includesText('保存失败');

    failLogSave = false;
    await click('.switch-actions button');

    const casts = storedCastEntries();
    assert.ok(casts.includes('说书人／钱进'), '重试后切换生效');
    assert.strictEqual(
      storedCastEntries().filter((entry) => entry === '说书人／钱进').length,
      1,
      '变更没有重复追加',
    );
    assert.strictEqual(storedSwitchLog().length, 1, '重试后切换记录仍只有一条');
  });
});
