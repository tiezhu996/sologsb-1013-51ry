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

export interface VersionDiff {
  id: string;
  changed: boolean;
  label: string;
  before: string;
  after: string;
}

export interface UnderstudyEntry {
  id: string;
  actor: string;
  rolesText: string;
  availableAt: string;
}

export interface SwitchPlanItem {
  sceneId: string;
  sceneLabel: string;
  cueId: string;
  cueTitle: string;
  role: string;
  fromActor: string;
  toActor: string;
  start: string;
  startSeconds: number;
  endSeconds: number;
}

export type SwitchConflictType =
  'double-role' | 'arrival' | 'costume' | 'overlap';

export interface SwitchConflict {
  id: string;
  type: SwitchConflictType;
  title: string;
  detail: string;
}

export interface SwitchPlan {
  actor: string;
  planId: string;
  items: SwitchPlanItem[];
  kept: SwitchPlanItem[];
  conflicts: SwitchConflict[];
}

export interface SwitchRecord {
  id: string;
  actor: string;
  appliedAt: string;
  itemCount: number;
  summary: string;
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
