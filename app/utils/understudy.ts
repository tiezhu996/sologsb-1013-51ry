import type {
  AffectedCue,
  ConflictDetail,
  Cue,
  Scene,
  ShowData,
  UnderstudyConflictKind,
  UnderstudyEntry,
  UnderstudyPlan,
  UnderstudySwitch,
} from 'stage-cue-editor/models/show';

/**
 * 应急替演切换的核心规则（纯函数，不依赖 DOM / Ember 运行时，便于单测）。
 *
 * 职责边界：选角经理的替演名单只回答“谁能顶哪个角色、几点能到场、换装要多久”；
 * 场次顺序、提示时长、同台关系一律以提示表（ShowData）为准。
 */

export const ROLE_SEPARATOR = '／';

export function timeToSeconds(value: string): number {
  const [hour = '0', minute = '0'] = String(value ?? '').split(':');
  const h = Number(hour) || 0;
  const m = Number(minute) || 0;
  return h * 3600 + m * 60;
}

export function secondsToTime(total: number): string {
  const wrapped = ((total % 86400) + 86400) % 86400;
  const hour = Math.floor(wrapped / 3600);
  const minute = Math.floor((wrapped % 3600) / 60);
  const second = wrapped % 60;
  return [hour, minute, second]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** 「角色／演员」拆分为 [角色, 演员]；旧数据无归属时两端均回填原始串。 */
export function splitCastToken(token: string): {
  role: string;
  performer: string;
  hasRole: boolean;
} {
  const trimmed = token.trim();
  const at = trimmed.indexOf(ROLE_SEPARATOR);
  if (at < 0) {
    return { role: trimmed, performer: trimmed, hasRole: false };
  }
  return {
    role: trimmed.slice(0, at).trim(),
    performer: trimmed.slice(at + ROLE_SEPARATOR.length).trim(),
    hasRole: true,
  };
}

interface CueOccurrence {
  cue: Cue;
  scene: Scene;
  start: number;
  end: number;
}

/** 按提示表顺序展开所有提示的绝对时间区间（顺序、时长、开场时间都来自提示表）。 */
export function timelineOf(show: ShowData): CueOccurrence[] {
  return show.scenes.flatMap((scene) =>
    scene.cues.map((cue) => {
      const start = timeToSeconds(scene.startTime) + (Number(cue.offset) || 0);
      return { cue, scene, start, end: start + (Number(cue.duration) || 0) };
    }),
  );
}

export interface PrincipalOption {
  key: string;
  label: string;
  role: string;
  performer: string;
  hasRole: boolean;
  cueCount: number;
}

/** 提示表里的某个演员条目是否属于该主演；无角色归属时按原演员名匹配。 */
export function matchesPrincipal(
  token: string,
  principal: Pick<PrincipalOption, 'role' | 'performer' | 'hasRole'>,
): boolean {
  const parsed = splitCastToken(token);
  if (principal.hasRole)
    return (
      parsed.role === principal.role && parsed.performer === principal.performer
    );
  return parsed.performer === principal.performer;
}

/** 从提示表演员字段汇总可选的“失声主演”（以角色为键；无归属时以演员名为键）。 */
export function principalOptions(show: ShowData): PrincipalOption[] {
  const map = new Map<string, PrincipalOption>();
  timelineOf(show).forEach(({ cue }) => {
    cue.cast.forEach((token) => {
      const { role, performer, hasRole } = splitCastToken(token);
      const key = hasRole ? role : performer;
      const existing = map.get(key);
      if (existing) {
        existing.cueCount += 1;
      } else {
        map.set(key, {
          key,
          label: hasRole ? `${role}（${performer}）` : key,
          role,
          performer,
          hasRole,
          cueCount: 1,
        });
      }
    });
  });
  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, 'zh'),
  );
}

/**
 * 选角经理名单条目是否能顶该角色。
 * 旧名单缺少角色归属（只有演员名）时，按原演员处理：与原演员同名即可顶替。
 */
export function entryCoversRole(
  entry: UnderstudyEntry,
  principal: PrincipalOption,
): boolean {
  const claimed = String(entry.role ?? '').trim();
  if (!claimed) return entry.name.trim() === principal.performer.trim();
  return (
    claimed === principal.key ||
    claimed === principal.role ||
    claimed === principal.performer
  );
}

/**
 * 构造切换计划：列出全部受影响提示，并逐条标注冲突。
 * 有任何冲突（含没有可用替演）时 plan.ok === false，调用方必须保留原提示表。
 */
export function buildUnderstudyPlan(
  show: ShowData,
  roster: UnderstudyEntry[],
  roleKey: string,
  chosenName?: string,
  activeSwitches: UnderstudySwitch[] = [],
): UnderstudyPlan {
  const principal = principalOptions(show).find((item) => item.key === roleKey);
  // 失声主演本人不能顶替自己；其余按选角名单的角色/到场/换装判定。
  const eligible = (roster ?? []).filter(
    (entry) =>
      entry.name.trim() &&
      entry.name.trim() !== principal?.performer.trim() &&
      principal &&
      entryCoversRole(entry, principal),
  );
  // 默认取最早可到场者；也可由舞台监督指定。
  const chosen =
    eligible.find((entry) => entry.name === chosenName) ??
    eligible
      .slice()
      .sort(
        (a, b) =>
          timeToSeconds(a.availableFrom) - timeToSeconds(b.availableFrom),
      )[0];

  const empty: UnderstudyPlan = {
    role: roleKey,
    understudyName: chosen?.name ?? '',
    cues: [],
    conflicts: [],
    ok: false,
    conflictSummary: [],
    eligibleNames: eligible.map((entry) => entry.name),
  };
  if (!principal) {
    empty.conflictSummary = [`提示表中没有角色「${roleKey}」。`];
    return empty;
  }
  if (!chosen) {
    empty.conflictSummary = [
      `替演名单中没有能顶「${principal.label}」的演员。`,
    ];
    return empty;
  }

  const availableFrom = timeToSeconds(chosen.availableFrom);
  const changeSeconds = Math.max(0, Number(chosen.changeSeconds) || 0);
  const timeline = timelineOf(show);

  // 切换后该替演新增的全部演出承诺（同一角色的所有受影响提示）。
  const affected: CueOccurrence[] = timeline.filter(({ cue }) =>
    cue.cast.some((token) => principal && matchesPrincipal(token, principal)),
  );

  // 该替演此前已经在顶的别的角色（先到先得的占用）。
  // 采用已生效切换记录；再补上其本人在原提示表里已有的同台演出（名单之外、原本就要上的场）。
  interface Commitment {
    occurrence: CueOccurrence;
    role: string;
  }
  const priorCommitments: Commitment[] = [];
  const seenCommitments = new Set<string>();
  const addCommitment = (occurrence: CueOccurrence, role: string) => {
    const key = `${occurrence.cue.id}@${role}`;
    if (!seenCommitments.has(key)) {
      seenCommitments.add(key);
      priorCommitments.push({ occurrence, role });
    }
  };
  activeSwitches
    .filter(
      (item) =>
        item.understudyName === chosen.name && item.role !== principal.role,
    )
    .forEach((item) => {
      item.cueIds.forEach((cueId) => {
        const found = timeline.find((entry) => entry.cue.id === cueId);
        if (found) addCommitment(found, item.role);
      });
    });
  timeline.forEach((entry) => {
    entry.cue.cast.forEach((token) => {
      const parsed = splitCastToken(token);
      if (parsed.performer === chosen.name) addCommitment(entry, parsed.role);
    });
  });

  const cues: AffectedCue[] = affected.map((entry) => {
    const conflicts = new Set<UnderstudyConflictKind>();
    const details: ConflictDetail[] = [];
    const addDetail = (kind: UnderstudyConflictKind, text: string) => {
      if (!details.some((item) => item.text === text))
        details.push({ kind, text });
    };

    if (entry.start < availableFrom) {
      conflicts.add('changeover');
      addDetail(
        'changeover',
        `${chosen.name} 最早 ${chosen.availableFrom || '—'} 到场，晚于该提示 ${secondsToTime(entry.start)}，来不及上场。`,
      );
    }

    priorCommitments
      // 自己在本角色上的同一提示不算占用；同提示里的别的角色才算。
      .filter(
        ({ occurrence, role }) =>
          !(occurrence.cue.id === entry.cue.id && role === principal.role),
      )
      .forEach(({ occurrence: commitment, role }) => {
        const overlap =
          entry.start < commitment.end && commitment.start < entry.end;
        const gap = commitment.start - entry.end;
        if (commitment.cue.id === entry.cue.id || overlap) {
          conflicts.add('occupied');
          addDetail(
            'occupied',
            `${chosen.name} 已被角色「${role}」占用：${secondsToTime(commitment.start)}「${commitment.cue.title}」与此提示同时进行。`,
          );
        } else if (gap >= 0 && gap < changeSeconds) {
          // 该提示结束后才轮到下一场（含首尾相接）：换装时间不够。
          conflicts.add('changeover');
          addDetail(
            'changeover',
            `距「${role}」的下一场「${commitment.cue.title}」（${secondsToTime(commitment.start)} 开始）仅 ${gap} 秒，换装至少需要 ${changeSeconds} 秒。`,
          );
        } else if (gap < 0 && entry.start - commitment.end < changeSeconds) {
          // 该提示开始前刚结束上一场：换装时间不够。
          conflicts.add('changeover');
          addDetail(
            'changeover',
            `距「${role}」的上一场「${commitment.cue.title}」（${secondsToTime(commitment.end)} 结束）仅 ${entry.start - commitment.end} 秒，换装至少需要 ${changeSeconds} 秒。`,
          );
        }
      });

    return {
      cueId: entry.cue.id,
      sceneId: entry.scene.id,
      sceneLabel: `${entry.scene.act} ${entry.scene.name}`,
      title: entry.cue.title,
      start: entry.start,
      end: entry.end,
      startLabel: secondsToTime(entry.start),
      duration: entry.cue.duration,
      understudyName: chosen.name,
      availableFrom,
      changeSeconds,
      conflicts: Array.from(conflicts),
      conflictDetails: details,
    };
  });

  // 同一时刻分身：两条受影响提示跨场重叠时，替演要在同一时刻分身上场。
  // 同场提示按顺序执行不会重叠；跨场（各自开场时间独立）才需要标分身。
  for (let i = 0; i < cues.length; i += 1) {
    for (let j = i + 1; j < cues.length; j += 1) {
      const left = cues[i]!;
      const right = cues[j]!;
      if (left.sceneId === right.sceneId) continue;
      const overlap = left.start < right.end && right.start < left.end;
      if (overlap) {
        for (const target of [left, right]) {
          if (!target.conflicts.includes('doublebooked'))
            target.conflicts.push('doublebooked');
          const other = target === left ? right : left;
          const text = `${chosen.name} 需在 ${secondsToTime(Math.max(left.start, right.start))} 同时上场于「${target.title}」与「${other.title}」。`;
          if (!target.conflictDetails.some((item) => item.text === text))
            target.conflictDetails.push({ kind: 'doublebooked', text });
        }
      }
    }
  }

  const conflicts = new Set<UnderstudyConflictKind>();
  const summary = new Set<string>();
  cues.forEach((item) => {
    item.conflicts.forEach((kind) => {
      conflicts.add(kind);
      if (kind === 'occupied') summary.add('存在替演已被其他角色占用的提示。');
      if (kind === 'changeover') summary.add('存在到场或换装来不及的提示。');
      if (kind === 'doublebooked')
        summary.add('存在同一时刻需要分身上场的提示。');
    });
  });

  return {
    ...empty,
    cues: cues.sort((a, b) => a.start - b.start),
    conflicts: Array.from(conflicts),
    ok: conflicts.size === 0,
    conflictSummary: Array.from(summary),
  };
}

/**
 * 执行切换：只改受影响提示的演员归属，顺序/时长/同台关系不动。
 * 「角色／原演员」→「角色／替演」；无归属条目按原演员处理，直接换名为替演。
 */
export function applySwitch(
  show: ShowData,
  roleKey: string,
  understudyName: string,
  nowIso: string,
): { show: ShowData; switchRecord: UnderstudySwitch } {
  const next: ShowData = JSON.parse(JSON.stringify(show)) as ShowData;
  const principal = principalOptions(show).find((item) => item.key === roleKey);
  const cueIds: string[] = [];
  if (principal) {
    next.scenes.forEach((scene) => {
      scene.cues.forEach((item) => {
        let touched = false;
        item.cast = item.cast.map((token) => {
          if (!principal || !matchesPrincipal(token, principal)) return token;
          touched = true;
          const parsed = splitCastToken(token);
          return parsed.hasRole
            ? `${parsed.role}${ROLE_SEPARATOR}${understudyName}`
            : understudyName;
        });
        if (touched) cueIds.push(item.id);
      });
    });
  }
  next.updatedAt = nowIso;
  return {
    show: next,
    switchRecord: {
      id: `switch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: roleKey,
      originalPerformer: principal?.performer ?? roleKey,
      understudyName,
      cueIds,
      createdAt: nowIso,
    },
  };
}

/** 撤销切换：把记录涉及的演员归属原样换回（幂等，重复调用不会叠加变更）。 */
export function revertSwitch(
  show: ShowData,
  record: UnderstudySwitch,
): ShowData {
  const next: ShowData = JSON.parse(JSON.stringify(show)) as ShowData;
  next.scenes.forEach((scene) => {
    scene.cues.forEach((item) => {
      item.cast = item.cast.map((token) => {
        const parsed = splitCastToken(token);
        if (
          parsed.performer === record.understudyName &&
          (parsed.role === record.role || !parsed.hasRole)
        ) {
          return parsed.hasRole
            ? `${parsed.role}${ROLE_SEPARATOR}${record.originalPerformer}`
            : record.originalPerformer;
        }
        return token;
      });
    });
  });
  return next;
}

/** 名单文本行格式：姓名 | 角色 | 可到场 HH:mm | 换装秒数；空角色即旧名单（按原演员处理）。 */
export function serializeRoster(roster: UnderstudyEntry[]): string {
  return roster
    .map((entry) =>
      [
        entry.name,
        entry.role,
        entry.availableFrom,
        String(entry.changeSeconds),
      ].join(' | '),
    )
    .join('\n');
}

export function parseRoster(text: string): UnderstudyEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name = '', role = '', availableFrom = '', changeSeconds = '0'] =
        line.split('|').map((part) => part.trim());
      return {
        id: `understudy-${index + 1}`,
        name,
        role,
        availableFrom: availableFrom || '00:00',
        changeSeconds: Math.max(0, Number(changeSeconds) || 0),
      };
    })
    .filter((entry) => entry.name);
}
