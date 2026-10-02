import type {
  Scene,
  ShowData,
  SwitchConflict,
  SwitchPlan,
  SwitchPlanItem,
  UnderstudyEntry,
} from 'stage-cue-editor/models/show';

// 同一替补在不同角色之间换装所需的最短间隔（秒）
export const COSTUME_CHANGE_SECONDS = 120;

export interface CastEntry {
  raw: string;
  role: string;
  actor: string;
  hasRole: boolean;
}

/**
 * 提示表中的演员条目写作「角色／演员」。旧名单可能缺少角色归属，
 * 只剩一个名字，此时按原演员处理（hasRole = false）。
 */
export function parseCastEntry(raw: string): CastEntry {
  const text = raw.trim();
  const parts = text
    .split(/[／/]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      raw,
      role: parts[0]!,
      actor: parts.slice(1).join('／'),
      hasRole: true,
    };
  }
  return { raw, role: '', actor: text, hasRole: false };
}

export function formatCastEntry(role: string, actor: string): string {
  return `${role}／${actor}`;
}

export function splitRoles(rolesText: string): string[] {
  return rolesText
    .split(/[、,，/／]/)
    .map((role) => role.trim())
    .filter(Boolean);
}

export function startSeconds(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 3600 + Number(minute) * 60;
}

export function safeStartSeconds(value: string): number {
  const seconds = startSeconds(value);
  return Number.isFinite(seconds) ? seconds : 0;
}

export function formatSeconds(total: number): string {
  const wrapped = ((total % 86400) + 86400) % 86400;
  const hour = Math.floor(wrapped / 3600);
  const minute = Math.floor((wrapped % 3600) / 60);
  const second = wrapped % 60;
  return [hour, minute, second]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function cueStartSeconds(scene: Scene, cue: { offset: number }): number {
  return safeStartSeconds(scene.startTime) + cue.offset;
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 替演名单只说明某位演员能顶哪些角色、何时可到场。
 * 旧名单缺少角色归属（rolesText 为空）时按原演员处理：可顶原演员的全部角色。
 */
export function understudyCovers(
  entry: UnderstudyEntry,
  role: string,
): boolean {
  const roles = splitRoles(entry.rolesText ?? '');
  if (!roles.length) return true;
  return roles.includes(role);
}

interface Engagement {
  role: string;
  start: number;
  end: number;
  label: string;
  fromPlan: boolean;
}

/**
 * 根据当前提示表与替演名单计算切换方案：
 * 列出所有受影响的提示，并检测冲突（同一替补多角色占用、到场来不及、
 * 换装来不及、同一时刻分身上场）。场次顺序、提示时长与同台关系均由提示表决定。
 */
export function planUnderstudySwitch(
  show: ShowData,
  originalActor: string,
  list: UnderstudyEntry[],
): SwitchPlan {
  const actor = originalActor.trim();
  const items: SwitchPlanItem[] = [];
  const kept: SwitchPlanItem[] = [];
  const conflicts: SwitchConflict[] = [];
  const understudies = list
    .map((entry) => ({ ...entry, actor: entry.actor.trim() }))
    .filter((entry) => entry.actor);

  if (actor) {
    show.scenes.forEach((scene) => {
      scene.cues.forEach((cue) => {
        const start = cueStartSeconds(scene, cue);
        cue.cast.forEach((raw) => {
          const entry = parseCastEntry(raw);
          if (entry.actor !== actor) return;
          const base: SwitchPlanItem = {
            sceneId: scene.id,
            sceneLabel: `${scene.act} ${scene.name}`,
            cueId: cue.id,
            cueTitle: cue.title,
            role: entry.role,
            fromActor: actor,
            toActor: actor,
            start: formatSeconds(start),
            startSeconds: start,
            endSeconds: start + cue.duration,
          };
          if (!entry.hasRole) {
            // 旧名单缺少角色归属：按原演员处理，保留原条目
            kept.push(base);
            return;
          }
          const understudy = understudies.find((candidate) =>
            understudyCovers(candidate, entry.role),
          );
          if (!understudy) return;
          items.push({ ...base, toActor: understudy.actor });
        });
      });
    });
  }

  // 冲突一：同一替补在本方案中被多个角色占用
  const rolesByUnderstudy = new Map<string, Set<string>>();
  items.forEach((item) => {
    const roles = rolesByUnderstudy.get(item.toActor) ?? new Set<string>();
    roles.add(item.role);
    rolesByUnderstudy.set(item.toActor, roles);
  });
  rolesByUnderstudy.forEach((roles, name) => {
    if (roles.size > 1) {
      conflicts.push({
        id: `double-role-${name}`,
        type: 'double-role',
        title: '同一替补已被别的角色占用',
        detail: `${name} 同时被安排顶替 ${[...roles].join('、')}，一名替补在同一场演出中只能承接一个角色。`,
      });
    }
  });

  // 冲突二：提示开场早于替补可到场时间
  items.forEach((item) => {
    const understudy = understudies.find(
      (entry) => entry.actor === item.toActor,
    );
    if (!understudy) return;
    const available = safeStartSeconds(understudy.availableAt || '0:00');
    if (item.startSeconds < available) {
      conflicts.push({
        id: `arrival-${item.cueId}-${item.role}`,
        type: 'arrival',
        title: '替补到场来不及',
        detail: `${item.toActor} ${understudy.availableAt} 才能到场，赶不上 ${item.start} 的「${item.cueTitle}」（${item.sceneLabel}）。`,
      });
    }
  });

  // 汇总每位替补切换后的全部登台（方案内新角色 + 名单上已有的同台关系）
  const engagements = new Map<string, Engagement[]>();
  const addEngagement = (name: string, engagement: Engagement): void => {
    engagements.set(name, [...(engagements.get(name) ?? []), engagement]);
  };
  items.forEach((item) => {
    addEngagement(item.toActor, {
      role: item.role,
      start: item.startSeconds,
      end: item.endSeconds,
      label: `${item.sceneLabel}「${item.cueTitle}」`,
      fromPlan: true,
    });
  });
  show.scenes.forEach((scene) => {
    scene.cues.forEach((cue) => {
      const start = cueStartSeconds(scene, cue);
      cue.cast.forEach((raw) => {
        const entry = parseCastEntry(raw);
        if (!understudies.some((candidate) => candidate.actor === entry.actor))
          return;
        addEngagement(entry.actor, {
          role: entry.role,
          start,
          end: start + cue.duration,
          label: `${scene.act} ${scene.name}「${cue.title}」`,
          fromPlan: false,
        });
      });
    });
  });

  engagements.forEach((list, name) => {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 0; index < sorted.length; index += 1) {
      for (let next = index + 1; next < sorted.length; next += 1) {
        const left = sorted[index]!;
        const right = sorted[next]!;
        if (!left.fromPlan && !right.fromPlan) continue; // 只检查切换引入的同台关系
        if (overlaps(left.start, left.end, right.start, right.end)) {
          // 冲突三：同一时刻分身上场
          conflicts.push({
            id: `overlap-${name}-${index}-${next}`,
            type: 'overlap',
            title: '同一时刻分身上场',
            detail: `${name} 在 ${left.label} 与 ${right.label} 时间重叠，无法同时出现在两处。`,
          });
        } else if (left.role !== right.role) {
          // 冲突四：不同角色之间换装来不及（同角色无需换装）
          const gap = right.start - left.end;
          if (gap < COSTUME_CHANGE_SECONDS) {
            conflicts.push({
              id: `costume-${name}-${index}-${next}`,
              type: 'costume',
              title: '换装来不及',
              detail: `${name} 在 ${left.label} 结束后仅 ${gap} 秒就要以另一角色登上 ${right.label}，不足 ${COSTUME_CHANGE_SECONDS} 秒换装时间。`,
            });
          }
        }
      }
    }
  });

  const planId = `switch-${actor || 'none'}-${items
    .map((item) => `${item.cueId}:${item.role}>${item.toActor}`)
    .join('+')}`;
  return { actor, planId, items, kept, conflicts };
}

/**
 * 把方案写回提示表：仅替换「角色／原演员」条目中的演员部分。
 * 幂等——重复执行不会重复追加或再次改写已替换的条目。
 */
export function applySwitchPlan(show: ShowData, plan: SwitchPlan): boolean {
  let changed = false;
  plan.items.forEach((item) => {
    const scene = show.scenes.find((entry) => entry.id === item.sceneId);
    const cue = scene?.cues.find((entry) => entry.id === item.cueId);
    if (!cue) return;
    const nextCast = cue.cast.map((raw) => {
      const entry = parseCastEntry(raw);
      return entry.hasRole &&
        entry.role === item.role &&
        entry.actor === item.fromActor
        ? formatCastEntry(item.role, item.toActor)
        : raw;
    });
    if (nextCast.some((value, index) => value !== cue.cast[index])) {
      cue.cast = nextCast;
      changed = true;
    }
  });
  return changed;
}
