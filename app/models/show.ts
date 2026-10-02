export type CueKind = '灯光' | '音响' | '道具' | '演员' | '舞台' | '字幕';

export interface Cue {
  id: string;
  kind: CueKind;
  title: string;
  duration: number;
  owner: string;
  lighting: string;
  sound: string;
  props: string[];
  cast: string[];
  notes: string;
  dependsOn: string[];
  offset: number;
}

export interface Scene {
  id: string;
  act: string;
  name: string;
  title: string;
  startTime: string;
  locked: boolean;
  cues: Cue[];
}

export interface ShowData {
  title: string;
  venue: string;
  date: string;
  scenes: Scene[];
  updatedAt: string;
}

export interface VersionSnapshot {
  id: string;
  name: string;
  createdAt: string;
  data: ShowData;
}

export interface CueDraft {
  id?: string;
  kind: CueKind;
  title: string;
  duration: number;
  owner: string;
  lighting: string;
  sound: string;
  props: string;
  cast: string;
  notes: string;
  dependsOn: string;
}

export interface CueIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  icon?: string;
  sceneId?: string;
  cueId?: string;
}

/** 选角经理确认的替演名单条目：某位替演能顶哪个角色、何时可到场、需要多久换装。 */
export interface UnderstudyEntry {
  id: string;
  name: string;
  role: string;
  /** 可到场时间，HH:mm；为空表示演出全程可到场。 */
  availableFrom: string;
  /** 上场前所需换装秒数。 */
  changeSeconds: number;
}

/** 受影响提示的冲突类型。 */
export type UnderstudyConflictKind = 'occupied' | 'changeover' | 'doublebooked';

export interface ConflictDetail {
  kind: UnderstudyConflictKind;
  text: string;
}

export interface AffectedCue {
  cueId: string;
  sceneId: string;
  sceneLabel: string;
  title: string;
  start: number;
  end: number;
  startLabel: string;
  duration: number;
  understudyName: string;
  availableFrom: number;
  changeSeconds: number;
  conflicts: UnderstudyConflictKind[];
  conflictDetails: ConflictDetail[];
}

export interface UnderstudyPlan {
  role: string;
  understudyName: string;
  /** 选角名单中能顶该角色的全部替演姓名（按名单顺序）。 */
  eligibleNames: string[];
  cues: AffectedCue[];
  conflicts: UnderstudyConflictKind[];
  ok: boolean;
  conflictSummary: string[];
}

/** 已执行的替演切换，用于回滚。 */
export interface UnderstudySwitch {
  id: string;
  role: string;
  originalPerformer: string;
  understudyName: string;
  cueIds: string[];
  createdAt: string;
}

export interface VersionDiff {
  id: string;
  changed: boolean;
  label: string;
  before: string;
  after: string;
}

export const CUE_KINDS: CueKind[] = [
  '灯光',
  '音响',
  '道具',
  '演员',
  '舞台',
  '字幕',
];
export const OWNERS = ['李岚', '周启', '陈默', '赵一帆', '孙禾', '待指定'];
