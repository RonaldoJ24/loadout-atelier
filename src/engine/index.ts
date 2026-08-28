import {
  EQUIPMENT_SLOTS,
  SKILLS,
  type AbilityNode,
  type Build,
  type BuildGoals,
  type BuildStats,
  type EquipmentChange,
  type EquipmentSlot,
  type GameItem,
  type PatchComparison,
  type RecommendationCandidate,
  type RecommendationResult,
  type Skill,
  type SkillPoints,
  type ValidationIssue,
  type ValidationResult,
  type VersionedDataset,
} from '../domain/contracts';

const STAT_KEYS: Array<keyof BuildStats> = [
  'health',
  'damage',
  'healing',
  'defense',
  'mobility',
  'spellDamage',
  'meleeDamage',
  'manaRegen',
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Equipment is evaluated in the order declared by EQUIPMENT_SLOTS.  An item's
 * own bonuses are applied only after that item's requirements are checked, and
 * are then available to later slots.  This makes bonus-dependent requirements
 * deterministic and avoids circular/self-referential requirements.
 */
const slotOrder = new Map<EquipmentSlot, number>(
  EQUIPMENT_SLOTS.map((slot, index) => [slot, index]),
);

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const nonNegativeNumber = (value: unknown, fallback = 0): number =>
  Math.max(0, finiteNumber(value, fallback));

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function emptyStats(): BuildStats {
  return {
    health: 0,
    damage: 0,
    healing: 0,
    defense: 0,
    mobility: 0,
    spellDamage: 0,
    meleeDamage: 0,
    manaRegen: 0,
  };
}

export function emptySkillPoints(): SkillPoints {
  return {
    strength: 0,
    dexterity: 0,
    intelligence: 0,
    defense: 0,
    agility: 0,
  };
}

function addStats(target: BuildStats, source: Partial<BuildStats> | undefined): void {
  if (!source || typeof source !== 'object') return;
  for (const key of STAT_KEYS) {
    target[key] += finiteNumber(source[key]);
  }
}

function addSkills(target: SkillPoints, source: Partial<SkillPoints> | undefined): void {
  if (!source || typeof source !== 'object') return;
  for (const key of SKILLS) {
    target[key] += finiteNumber(source[key]);
  }
}

function copySkills(source: SkillPoints): SkillPoints {
  return { ...source };
}

function normalisedBuildSkills(build: Build): SkillPoints {
  const skills = emptySkillPoints();
  for (const key of SKILLS) skills[key] = finiteNumber(build.skillPoints?.[key]);
  return skills;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const values = value.map(canonicalValue);
    return values.sort((left, right) =>
      compareStrings(JSON.stringify(left), JSON.stringify(right)),
    );
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareStrings)) {
      result[key] = canonicalValue(record[key]);
    }
    return result;
  }
  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sortedItems(items: GameItem[]): GameItem[] {
  return [...items].sort(
    (left, right) =>
      compareStrings(String(left.id), String(right.id)) ||
      compareStrings(stableSerialize(left), stableSerialize(right)),
  );
}

function sortedAbilities(abilities: AbilityNode[]): AbilityNode[] {
  return [...abilities].sort(
    (left, right) =>
      compareStrings(String(left.id), String(right.id)) ||
      compareStrings(stableSerialize(left), stableSerialize(right)),
  );
}

function itemIndex(dataset: VersionedDataset): Map<string, GameItem> {
  const result = new Map<string, GameItem>();
  for (const item of sortedItems(Array.isArray(dataset.items) ? dataset.items : [])) {
    if (typeof item.id === 'string' && item.id.length > 0 && !result.has(item.id)) {
      result.set(item.id, item);
    }
  }
  return result;
}

function abilityIndex(dataset: VersionedDataset): Map<string, AbilityNode> {
  const result = new Map<string, AbilityNode>();
  for (const ability of sortedAbilities(
    Array.isArray(dataset.abilities) ? dataset.abilities : [],
  )) {
    if (typeof ability.id === 'string' && ability.id.length > 0 && !result.has(ability.id)) {
      result.set(ability.id, ability);
    }
  }
  return result;
}

function sourceIndex(dataset: VersionedDataset): Map<string, VersionedDataset['sources'][number]> {
  const result = new Map<string, VersionedDataset['sources'][number]>();
  const sources = Array.isArray(dataset.sources) ? [...dataset.sources] : [];
  sources.sort(
    (left, right) =>
      compareStrings(String(left.id), String(right.id)) ||
      compareStrings(stableSerialize(left), stableSerialize(right)),
  );
  for (const source of sources) {
    if (typeof source.id === 'string' && source.id.length > 0 && !result.has(source.id)) {
      result.set(source.id, source);
    }
  }
  return result;
}

function sourceAgeIsStale(
  retrievedAt: unknown,
  staleAfterDays: unknown,
  now: Date | undefined,
): boolean {
  if (!now || !(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  const retrieved = typeof retrievedAt === 'string' ? Date.parse(retrievedAt) : Number.NaN;
  const threshold = nonNegativeNumber(staleAfterDays);
  if (!Number.isFinite(retrieved) || retrieved > now.getTime()) return false;
  return now.getTime() - retrieved > threshold * DAY_MS;
}

function sourceIsStale(
  source: VersionedDataset['sources'][number] | undefined,
  dataset: VersionedDataset,
  now: Date | undefined,
): boolean {
  if (!source) return false;
  return (
    source.freshness === 'stale' ||
    sourceAgeIsStale(source.retrievedAt, dataset.rules?.staleAfterDays, now)
  );
}

function sourceIsUnknown(source: VersionedDataset['sources'][number] | undefined): boolean {
  if (!source) return true;
  if (source.freshness === 'unknown') return true;
  // A source claiming to be fresh but carrying an invalid timestamp cannot be
  // used as evidence, even when no clock was supplied for age comparison.
  if (source.freshness === 'fresh' && Number.isNaN(Date.parse(source.retrievedAt))) return true;
  return false;
}

function addIssue(
  issues: ValidationIssue[],
  issue: Omit<ValidationIssue, 'severity'> & { severity?: ValidationIssue['severity'] },
): void {
  issues.push({ severity: 'error', ...issue });
}

function addWarning(issues: ValidationIssue[], issue: Omit<ValidationIssue, 'severity'>): void {
  issues.push({ severity: 'warning', ...issue });
}

function slotAcceptsItem(slot: EquipmentSlot, item: GameItem): boolean {
  return slot === 'ring1' || slot === 'ring2' ? item.slot === 'ring' : item.slot === slot;
}

function itemCost(item: GameItem): number {
  return nonNegativeNumber(item.cost);
}

function abilityBudget(build: Build, dataset: VersionedDataset): number {
  const level = finiteNumber(build.level);
  const milestones = Array.isArray(dataset.rules?.abilityPointMilestones)
    ? dataset.rules.abilityPointMilestones
    : [];
  return milestones.reduce(
    (count, milestone) =>
      count + (finiteNumber(milestone, Number.POSITIVE_INFINITY) <= level ? 1 : 0),
    0,
  );
}

function buildLevelError(build: Build, dataset: VersionedDataset): boolean {
  const level = finiteNumber(build.level, Number.NaN);
  const maxLevel = finiteNumber(dataset.rules?.maxLevel, Number.POSITIVE_INFINITY);
  return !Number.isInteger(level) || level < 1 || level > maxLevel;
}

function validateSourceFreshness(
  dataset: VersionedDataset,
  now: Date | undefined,
  issues: ValidationIssue[],
): void {
  const index = sourceIndex(dataset);
  const sourceIds = [...index.keys()].sort(compareStrings);
  for (const sourceId of sourceIds) {
    const source = index.get(sourceId);
    if (sourceIsStale(source, dataset, now)) {
      addWarning(issues, {
        code: 'stale-dataset',
        path: `sources.${sourceId}`,
        message: `Source ${sourceId} is stale for this dataset.`,
        sourceId,
      });
    } else if (sourceIsUnknown(source)) {
      addWarning(issues, {
        code: 'stale-dataset',
        path: `sources.${sourceId}`,
        message: `Source ${sourceId} has unknown freshness.`,
        sourceId,
      });
    }
  }

  if (sourceAgeIsStale(dataset.retrievedAt, dataset.rules?.staleAfterDays, now)) {
    addWarning(issues, {
      code: 'stale-dataset',
      path: 'dataset.retrievedAt',
      message: `Dataset ${dataset.version} is older than the configured freshness window.`,
    });
  } else if (
    typeof dataset.retrievedAt !== 'string' ||
    Number.isNaN(Date.parse(dataset.retrievedAt))
  ) {
    addWarning(issues, {
      code: 'stale-dataset',
      path: 'dataset.retrievedAt',
      message: 'Dataset retrieval time is unknown.',
    });
  }
}

function addMissingSourceWarning(issues: ValidationIssue[], sourceId: unknown, path: string): void {
  addWarning(issues, {
    code: 'stale-dataset',
    path,
    message:
      typeof sourceId === 'string'
        ? `Source ${sourceId} is missing from the dataset.`
        : 'The selected record has no source citation.',
    ...(typeof sourceId === 'string' ? { sourceId } : {}),
  });
}

function requirementsMet(
  item: GameItem,
  availableSkills: SkillPoints,
): { met: boolean; unmet: Array<{ skill: Skill; required: number; available: number }> } {
  const unmet: Array<{ skill: Skill; required: number; available: number }> = [];
  for (const skill of SKILLS) {
    const required = finiteNumber(item.skillRequirements?.[skill]);
    if (required > availableSkills[skill]) {
      unmet.push({ skill, required, available: availableSkills[skill] });
    }
  }
  return { met: unmet.length === 0, unmet };
}

function selectedAbilityIds(build: Build): { ids: string[]; duplicates: string[] } {
  const ids = (Array.isArray(build.abilities) ? build.abilities : []).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const unique = [...counts.keys()].sort(compareStrings);
  const duplicates = unique.filter((id) => (counts.get(id) ?? 0) > 1);
  return { ids: unique, duplicates };
}

export function validateBuild(
  build: Build,
  dataset: VersionedDataset,
  goals?: BuildGoals,
  now?: Date,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const totals = emptyStats();
  const skillTotals = normalisedBuildSkills(build);
  const requirementSkills = copySkills(skillTotals);
  const items = itemIndex(dataset);
  const abilities = abilityIndex(dataset);
  const sources = sourceIndex(dataset);
  let cost = 0;

  if (buildLevelError(build, dataset)) {
    addIssue(issues, {
      code: 'level-requirement',
      path: 'level',
      message: `Build level must be between 1 and ${finiteNumber(dataset.rules?.maxLevel)}.`,
    });
  }

  const maximumAssigned = Math.min(
    nonNegativeNumber(dataset.rules?.maxAssignedSkillPoints),
    Math.max(
      0,
      (finiteNumber(build.level) - 1) * nonNegativeNumber(dataset.rules?.skillPointsPerLevel),
    ),
  );
  let assigned = 0;
  for (const skill of SKILLS) {
    const value = finiteNumber(build.skillPoints?.[skill], Number.NaN);
    if (!Number.isInteger(value) || value < 0) {
      addIssue(issues, {
        code: 'skill-requirement',
        path: `skillPoints.${skill}`,
        message: `Assigned ${skill} points must be a non-negative finite number.`,
      });
    } else {
      assigned += value;
    }
  }
  if (assigned > maximumAssigned) {
    addIssue(issues, {
      code: 'skill-requirement',
      path: 'skillPoints',
      message: `Assigned skill points (${assigned}) exceed the level budget (${maximumAssigned}).`,
    });
  }

  if (!Array.isArray(build.abilities)) {
    addIssue(issues, {
      code: 'missing-ability-prerequisite',
      path: 'abilities',
      message: 'Abilities must be a list of known ability IDs.',
    });
  } else {
    build.abilities.forEach((abilityId, index) => {
      if (typeof abilityId !== 'string' || abilityId.length === 0) {
        addIssue(issues, {
          code: 'missing-ability-prerequisite',
          path: `abilities.${index}`,
          message: 'Ability selection references no ability ID.',
        });
      }
    });
  }

  const seenItems = new Map<string, EquipmentSlot>();
  const equipped: Array<{ slot: EquipmentSlot; itemId: string; item: GameItem }> = [];

  // Do all equipment work in the contract's stable slot order.  Dataset item
  // order is never used to determine a result.
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = build.equipment?.[slot];
    const path = `equipment.${slot}`;
    if (typeof itemId !== 'string' || itemId.length === 0) {
      addIssue(issues, {
        code: 'missing-item',
        path,
        message: `${slot} has no item selected.`,
      });
      continue;
    }
    const item = items.get(itemId);
    if (!item) {
      addIssue(issues, {
        code: 'missing-item',
        path,
        message: `Item ${itemId} is not present in dataset ${dataset.version}.`,
      });
      continue;
    }

    equipped.push({ slot, itemId, item });
    cost += itemCost(item);
    addStats(totals, item.stats);
    addSkills(skillTotals, item.skillBonuses);

    const firstSlot = seenItems.get(itemId);
    const duplicate = firstSlot !== undefined;
    if (duplicate) {
      addIssue(issues, {
        code: 'duplicate-item',
        path,
        message: `Item ${itemId} is already equipped in ${firstSlot}.`,
        sourceId: item.sourceId,
      });
    } else {
      seenItems.set(itemId, slot);
    }

    const available = item.available === true;
    const rightSlot = slotAcceptsItem(slot, item);
    const levelOkay =
      finiteNumber(item.level, Number.POSITIVE_INFINITY) <= finiteNumber(build.level);
    const classOkay = !item.classRequirement || item.classRequirement === build.classId;

    if (!available) {
      addIssue(issues, {
        code: 'unavailable-item',
        path,
        message: `Item ${itemId} is not currently available.`,
        sourceId: item.sourceId,
      });
    }
    if (!rightSlot) {
      addIssue(issues, {
        code: 'wrong-slot',
        path,
        message: `Item ${itemId} cannot occupy ${slot}.`,
        sourceId: item.sourceId,
      });
    }
    if (!levelOkay) {
      addIssue(issues, {
        code: 'level-requirement',
        path,
        message: `Item ${itemId} requires level ${finiteNumber(item.level)}.`,
        sourceId: item.sourceId,
      });
    }
    if (!classOkay) {
      addIssue(issues, {
        code: 'class-requirement',
        path,
        message: `Item ${itemId} is restricted to ${item.classRequirement}.`,
        sourceId: item.sourceId,
      });
    }

    const requirementResult = requirementsMet(item, requirementSkills);
    for (const unmet of requirementResult.unmet) {
      addIssue(issues, {
        code: 'skill-requirement',
        path,
        message: `Item ${itemId} requires ${unmet.required} ${unmet.skill} points; ${unmet.available} are available at this slot.`,
        sourceId: item.sourceId,
      });
    }

    if (!sources.has(item.sourceId)) addMissingSourceWarning(issues, item.sourceId, path);

    // Invalid/duplicate items do not grant requirement bonuses.  In
    // particular, an item cannot bootstrap its own requirement, and a failed
    // item cannot make a later item appear equipable.
    if (available && rightSlot && levelOkay && classOkay && !duplicate && requirementResult.met) {
      addSkills(requirementSkills, item.skillBonuses);
    }
  }

  const equippedBySlot = new Map<EquipmentSlot, { itemId: string; item: GameItem }>();
  for (const entry of equipped)
    equippedBySlot.set(entry.slot, { itemId: entry.itemId, item: entry.item });
  const equippedEntries = [...equippedBySlot.entries()].sort((left, right) =>
    compareStrings(String(slotOrder.get(left[0])), String(slotOrder.get(right[0]))),
  );
  for (let leftIndex = 0; leftIndex < equippedEntries.length; leftIndex += 1) {
    const leftEntry = equippedEntries[leftIndex];
    if (!leftEntry) continue;
    const [leftSlot, left] = leftEntry;
    for (let rightIndex = leftIndex + 1; rightIndex < equippedEntries.length; rightIndex += 1) {
      const rightEntry = equippedEntries[rightIndex];
      if (!rightEntry) continue;
      const [rightSlot, right] = rightEntry;
      const leftExcludes = Array.isArray(left.item.incompatibleWith)
        ? left.item.incompatibleWith.includes(right.itemId)
        : false;
      const rightExcludes = Array.isArray(right.item.incompatibleWith)
        ? right.item.incompatibleWith.includes(left.itemId)
        : false;
      if (leftExcludes || rightExcludes) {
        addIssue(issues, {
          code: 'incompatible-items',
          path: `equipment.${rightSlot}`,
          message: `Items ${left.itemId} (${leftSlot}) and ${right.itemId} (${rightSlot}) cannot be equipped together.`,
          sourceId: right.item.sourceId,
        });
      }
    }
  }

  const selected = selectedAbilityIds(build);
  for (const duplicate of selected.duplicates) {
    addIssue(issues, {
      code: 'ability-conflict',
      path: 'abilities',
      message: `Ability ${duplicate} is selected more than once.`,
    });
  }

  const selectedAbilities: AbilityNode[] = [];
  for (const abilityId of selected.ids) {
    const ability = abilities.get(abilityId);
    if (!ability) {
      addIssue(issues, {
        code: 'missing-ability-prerequisite',
        path: `abilities.${abilityId}`,
        message: `Ability ${abilityId} is not present in dataset ${dataset.version}.`,
      });
      continue;
    }
    selectedAbilities.push(ability);
    addStats(totals, ability.stats);
    if (ability.classId !== build.classId) {
      addIssue(issues, {
        code: 'class-requirement',
        path: `abilities.${abilityId}`,
        message: `Ability ${abilityId} is restricted to ${ability.classId}.`,
        sourceId: ability.sourceId,
      });
    }
    if (!sources.has(ability.sourceId))
      addMissingSourceWarning(issues, ability.sourceId, `abilities.${abilityId}`);
  }

  const selectedSet = new Set(selected.ids);
  for (const ability of selectedAbilities) {
    const requirements = Array.isArray(ability.requires)
      ? [...ability.requires]
          .filter((id): id is string => typeof id === 'string')
          .sort(compareStrings)
      : [];
    for (const requiredId of requirements) {
      if (!selectedSet.has(requiredId)) {
        addIssue(issues, {
          code: 'missing-ability-prerequisite',
          path: `abilities.${ability.id}`,
          message: `Ability ${ability.id} requires ${requiredId}.`,
          sourceId: ability.sourceId,
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < selectedAbilities.length; leftIndex += 1) {
    const left = selectedAbilities[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < selectedAbilities.length; rightIndex += 1) {
      const right = selectedAbilities[rightIndex];
      if (!right) continue;
      const leftExcludes = Array.isArray(left.excludes) ? left.excludes.includes(right.id) : false;
      const rightExcludes = Array.isArray(right.excludes)
        ? right.excludes.includes(left.id)
        : false;
      if (leftExcludes || rightExcludes) {
        addIssue(issues, {
          code: 'ability-conflict',
          path: `abilities.${right.id}`,
          message: `Abilities ${left.id} and ${right.id} cannot be selected together.`,
          sourceId: right.sourceId,
        });
      }
    }
  }

  const abilityPoints = selectedAbilities.reduce(
    (sum, ability) => sum + nonNegativeNumber(ability.cost),
    0,
  );
  const availableAbilityPoints = abilityBudget(build, dataset);
  if (abilityPoints > availableAbilityPoints) {
    addIssue(issues, {
      code: 'ability-point-limit',
      path: 'abilities',
      message: `Selected abilities cost ${abilityPoints} points; ${availableAbilityPoints} are available at level ${finiteNumber(build.level)}.`,
    });
  }

  if (goals && cost > nonNegativeNumber(goals.budget)) {
    addIssue(issues, {
      code: 'budget-exceeded',
      path: 'equipment',
      message: `Equipment cost ${cost} exceeds the budget ${nonNegativeNumber(goals.budget)}.`,
    });
  }

  validateSourceFreshness(dataset, now, issues);

  const valid = issues.every((issue) => issue.severity !== 'error');
  return {
    valid,
    deterministic: true,
    issues,
    totals,
    skillTotals,
    cost,
    abilityPoints,
  };
}

function cloneBuild(build: Build): Build {
  return {
    ...build,
    skillPoints: { ...build.skillPoints },
    equipment: { ...build.equipment },
    abilities: [...build.abilities],
  };
}

export function applyCandidate(build: Build, candidate: RecommendationCandidate): Build {
  const next = cloneBuild(build);
  const changes = Array.isArray(candidate.equipmentChanges) ? candidate.equipmentChanges : [];
  for (const change of changes) {
    if (!change || !EQUIPMENT_SLOTS.includes(change.slot)) continue;
    if (typeof change.toItemId === 'string' && change.toItemId.length > 0) {
      next.equipment[change.slot] = change.toItemId;
    } else {
      delete next.equipment[change.slot];
    }
  }

  const removals = new Set(
    candidate.abilityChanges && Array.isArray(candidate.abilityChanges.remove)
      ? candidate.abilityChanges.remove.filter((id): id is string => typeof id === 'string')
      : [],
  );
  const additions =
    candidate.abilityChanges && Array.isArray(candidate.abilityChanges.add)
      ? candidate.abilityChanges.add.filter((id): id is string => typeof id === 'string')
      : [];
  const abilities: string[] = [];
  for (const abilityId of next.abilities) {
    if (!removals.has(abilityId)) abilities.push(abilityId);
  }
  for (const abilityId of additions) {
    if (!abilities.includes(abilityId)) abilities.push(abilityId);
  }
  next.abilities = abilities;
  return next;
}

function goalWeight(value: unknown): number {
  return clamp(nonNegativeNumber(value), 0, 100);
}

export function scoreBuild(validation: ValidationResult, goals: BuildGoals): number {
  const totals = validation.totals ?? emptyStats();
  const soloDamage = clamp(
    ((finiteNumber(totals.damage) +
      finiteNumber(totals.spellDamage) +
      finiteNumber(totals.meleeDamage)) /
      250) *
      100,
    -100,
    100,
  );
  const raidSupport = clamp(
    ((finiteNumber(totals.healing) * 2 + finiteNumber(totals.manaRegen) * 10) / 200) * 100,
    -100,
    100,
  );
  const survivability = clamp(
    ((finiteNumber(totals.health) / 20 + finiteNumber(totals.defense) * 2) / 300) * 100,
    -100,
    100,
  );
  const mobility = clamp((finiteNumber(totals.mobility) / 100) * 100, -100, 100);
  const budget = nonNegativeNumber(goals.budget);
  const costFit =
    budget > 0
      ? clamp((1 - finiteNumber(validation.cost) / budget) * 100, -100, 100)
      : finiteNumber(validation.cost) === 0
        ? 100
        : -clamp(finiteNumber(validation.cost), 0, 100);

  const weights = {
    soloDamage: goalWeight(goals.soloDamage),
    raidSupport: goalWeight(goals.raidSupport),
    survivability: goalWeight(goals.survivability),
    mobility: goalWeight(goals.mobility),
    budget: 20,
  };
  const denominator =
    weights.soloDamage +
    weights.raidSupport +
    weights.survivability +
    weights.mobility +
    weights.budget;
  let score =
    (weights.soloDamage * soloDamage +
      weights.raidSupport * raidSupport +
      weights.survivability * survivability +
      weights.mobility * mobility +
      weights.budget * costFit) /
    (denominator || 1);

  const errorCount = Array.isArray(validation.issues)
    ? validation.issues.filter((issue) => issue.severity === 'error').length
    : 0;
  if (errorCount > 0) score -= errorCount * 1000;
  return Number.isFinite(score) ? score : -Infinity;
}

type Operation =
  | { kind: 'equipment'; slot: EquipmentSlot; fromItemId?: string; toItemId: string }
  | { kind: 'ability-add'; abilityId: string }
  | { kind: 'ability-remove'; abilityId: string };

type SearchState = {
  build: Build;
  operations: Operation[];
  validation: ValidationResult;
  ranking: number;
  key: string;
};

function operationKey(operation: Operation): string {
  if (operation.kind === 'equipment') {
    return `equipment:${slotOrder.get(operation.slot)}:${operation.toItemId}`;
  }
  return `${operation.kind}:${operation.abilityId}`;
}

function operationCompare(left: Operation, right: Operation): number {
  return compareStrings(operationKey(left), operationKey(right));
}

function stateKey(build: Build): string {
  const equipment = EQUIPMENT_SLOTS.map((slot) => `${slot}=${build.equipment?.[slot] ?? ''}`).join(
    '|',
  );
  const abilities = [...new Set(build.abilities)].sort(compareStrings).join('|');
  return `${equipment}||${abilities}`;
}

function makeOperations(build: Build, goals: BuildGoals, dataset: VersionedDataset): Operation[] {
  const operations: Operation[] = [];
  const excluded = new Set(
    (Array.isArray(goals.excludedItemIds) ? goals.excludedItemIds : []).filter(
      (id): id is string => typeof id === 'string',
    ),
  );
  const currentIds = new Set(
    Object.values(build.equipment ?? {}).filter((id): id is string => typeof id === 'string'),
  );
  const sources = sourceIndex(dataset);
  const candidates = sortedItems(Array.isArray(dataset.items) ? dataset.items : []);
  for (const slot of EQUIPMENT_SLOTS) {
    const fromItemId = build.equipment?.[slot];
    for (const item of candidates) {
      if (typeof item.id !== 'string' || item.id === fromItemId) continue;
      if (excluded.has(item.id) || currentIds.has(item.id)) continue;
      if (item.available !== true || !slotAcceptsItem(slot, item)) continue;
      if (finiteNumber(item.level, Number.POSITIVE_INFINITY) > finiteNumber(build.level)) continue;
      if (item.classRequirement && item.classRequirement !== build.classId) continue;
      if (!sources.has(item.sourceId)) continue;
      operations.push({ kind: 'equipment', slot, fromItemId, toItemId: item.id });
    }
  }

  const selected = new Set(selectedAbilityIds(build).ids);
  for (const ability of sortedAbilities(dataset.abilities ?? [])) {
    if (!sources.has(ability.sourceId)) continue;
    if (selected.has(ability.id)) {
      operations.push({ kind: 'ability-remove', abilityId: ability.id });
    } else if (ability.classId === build.classId) {
      operations.push({ kind: 'ability-add', abilityId: ability.id });
    }
  }
  return operations.sort(operationCompare);
}

function applyOperation(build: Build, operation: Operation): Build {
  if (operation.kind === 'equipment') {
    const next = cloneBuild(build);
    next.equipment[operation.slot] = operation.toItemId;
    return next;
  }
  const next = cloneBuild(build);
  if (operation.kind === 'ability-add') {
    if (!next.abilities.includes(operation.abilityId)) next.abilities.push(operation.abilityId);
  } else {
    next.abilities = next.abilities.filter((id) => id !== operation.abilityId);
  }
  return next;
}

function stateOperationsCompatible(state: SearchState, operation: Operation): boolean {
  if (state.operations.some((existing) => operationKey(existing) === operationKey(operation)))
    return false;
  if (operation.kind === 'equipment') {
    return !state.operations.some(
      (existing) => existing.kind === 'equipment' && existing.slot === operation.slot,
    );
  }
  return !state.operations.some(
    (existing) =>
      (existing.kind === 'ability-add' || existing.kind === 'ability-remove') &&
      existing.abilityId === operation.abilityId,
  );
}

function collectSourceIds(
  build: Build,
  operations: Operation[],
  dataset: VersionedDataset,
): string[] {
  const items = itemIndex(dataset);
  const abilities = abilityIndex(dataset);
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === 'equipment') {
      const from = operation.fromItemId ? items.get(operation.fromItemId) : undefined;
      const to = items.get(operation.toItemId);
      if (from && typeof from.sourceId === 'string') ids.add(from.sourceId);
      if (to && typeof to.sourceId === 'string') ids.add(to.sourceId);
    } else {
      const ability = abilities.get(operation.abilityId);
      if (ability && typeof ability.sourceId === 'string') ids.add(ability.sourceId);
    }
  }
  // A candidate with no operations is never emitted, but retain this access so
  // callers can safely pass a build with an empty equipment object.
  void build;
  return [...ids].sort(compareStrings);
}

function candidateChanges(
  build: Build,
  operations: Operation[],
  dataset: VersionedDataset,
  validation: ValidationResult,
): RecommendationCandidate | undefined {
  const items = itemIndex(dataset);
  const equipmentChanges: EquipmentChange[] = [];
  const add: string[] = [];
  const remove: string[] = [];
  for (const operation of operations) {
    if (operation.kind === 'equipment') {
      const item = items.get(operation.toItemId);
      if (!item) return undefined;
      const reasons = [`Improves deterministic alignment with the requested goals.`];
      equipmentChanges.push({
        slot: operation.slot,
        ...(operation.fromItemId ? { fromItemId: operation.fromItemId } : {}),
        toItemId: operation.toItemId,
        reasons,
      });
    } else if (operation.kind === 'ability-add') {
      add.push(operation.abilityId);
    } else {
      remove.push(operation.abilityId);
    }
  }
  equipmentChanges.sort(
    (left, right) => (slotOrder.get(left.slot) ?? 0) - (slotOrder.get(right.slot) ?? 0),
  );
  add.sort(compareStrings);
  remove.sort(compareStrings);
  const citationIds = collectSourceIds(build, operations, dataset);
  if (citationIds.length === 0) return undefined;

  const costDelta = validation.cost - finiteNumber(validateBuild(build, dataset).cost);
  const tradeoffs = [
    costDelta > 0
      ? `Equipment cost increases by ${costDelta}.`
      : costDelta < 0
        ? `Equipment cost decreases by ${Math.abs(costDelta)}.`
        : 'Equipment cost is unchanged.',
  ];
  if (add.length > 0) tradeoffs.push(`Adds ${add.length} ability${add.length === 1 ? '' : 'ies'}.`);
  if (remove.length > 0)
    tradeoffs.push(`Removes ${remove.length} ability${remove.length === 1 ? '' : 'ies'}.`);
  return {
    summary: `Deterministic candidate using ${operations.length} constrained change${
      operations.length === 1 ? '' : 's'
    }.`,
    equipmentChanges,
    abilityChanges: { add, remove },
    tradeoffs,
    citationIds,
  };
}

function sourceAbstentionReasons(dataset: VersionedDataset): string[] {
  const reasons: string[] = [];
  const sources = sourceIndex(dataset);
  if (sources.size === 0) reasons.push('No evidence sources are available.');
  if (typeof dataset.retrievedAt !== 'string' || Number.isNaN(Date.parse(dataset.retrievedAt))) {
    reasons.push('Dataset retrieval time is unknown.');
  }
  for (const sourceId of [...sources.keys()].sort(compareStrings)) {
    const source = sources.get(sourceId);
    if (sourceIsStale(source, dataset, undefined)) reasons.push(`Source ${sourceId} is stale.`);
    else if (sourceIsUnknown(source)) reasons.push(`Source ${sourceId} has unknown freshness.`);
  }

  for (const item of sortedItems(Array.isArray(dataset.items) ? dataset.items : [])) {
    if (typeof item.id === 'string' && !sources.has(item.sourceId)) {
      reasons.push(`Item ${item.id} has no available evidence source.`);
    }
  }
  for (const ability of sortedAbilities(
    Array.isArray(dataset.abilities) ? dataset.abilities : [],
  )) {
    if (typeof ability.id === 'string' && !sources.has(ability.sourceId)) {
      reasons.push(`Ability ${ability.id} has no available evidence source.`);
    }
  }
  return reasons;
}

function buildAbstainedResult(
  validation: ValidationResult,
  dataset: VersionedDataset,
  reasons: string[],
): RecommendationResult {
  const uniqueReasons = [...new Set(reasons)].filter((reason) => reason.length > 0);
  return {
    status: 'abstained',
    origin: 'deterministic',
    validation,
    explanation: uniqueReasons.join(' ') || 'No safe deterministic recommendation is available.',
    citationIds: [],
    traces: [
      {
        id: 'deterministic-engine',
        tool: 'deterministic-engine',
        status: 'abstained',
        mode: dataset.mode,
        startedAt: dataset.retrievedAt,
        durationMs: 0,
        sourceIds: [],
        message: uniqueReasons.join(' ') || 'No safe deterministic recommendation is available.',
      },
    ],
    abstentionReasons: uniqueReasons,
  };
}

export function recommendDeterministically(
  build: Build,
  goals: BuildGoals,
  dataset: VersionedDataset,
): RecommendationResult {
  const validation = validateBuild(build, dataset, goals);
  const inputReasons = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.code}: ${issue.message}`);
  if (!validation.valid) {
    return buildAbstainedResult(validation, dataset, [
      'The input build is invalid; deterministic recommendations require a valid starting build.',
      ...inputReasons,
    ]);
  }

  const sourceReasons = sourceAbstentionReasons(dataset);
  if (sourceReasons.length > 0) {
    return buildAbstainedResult(validation, dataset, sourceReasons);
  }

  const maxChanges = Math.floor(clamp(nonNegativeNumber(goals.maxChanges), 0, 9));
  if (maxChanges < 1) {
    return buildAbstainedResult(validation, dataset, [
      'The configured change limit does not allow a recommendation.',
    ]);
  }

  const baseScore = scoreBuild(validation, goals);
  const operations = makeOperations(build, goals, dataset);
  if (operations.length === 0) {
    return buildAbstainedResult(validation, dataset, [
      'No eligible deterministic changes are available.',
    ]);
  }

  const initial: SearchState = {
    build: cloneBuild(build),
    operations: [],
    validation,
    ranking: baseScore,
    key: stateKey(build),
  };
  let frontier: SearchState[] = [initial];
  const seen = new Set<string>([initial.key]);
  const validStates: SearchState[] = [];
  const width = 160;

  for (let depth = 1; depth <= maxChanges; depth += 1) {
    const next: SearchState[] = [];
    for (const state of frontier) {
      for (const operation of operations) {
        if (!stateOperationsCompatible(state, operation)) continue;
        const candidateBuild = applyOperation(state.build, operation);
        const key = stateKey(candidateBuild);
        if (seen.has(key)) continue;
        seen.add(key);
        const candidateValidation = validateBuild(candidateBuild, dataset, goals);
        const score = scoreBuild(candidateValidation, goals);
        const candidateState: SearchState = {
          build: candidateBuild,
          operations: [...state.operations, operation],
          validation: candidateValidation,
          ranking:
            score - (candidateValidation.valid ? 0 : candidateValidation.issues.length * 0.001),
          key,
        };
        next.push(candidateState);
        if (candidateValidation.valid && score > baseScore) validStates.push(candidateState);
      }
    }
    next.sort(
      (left, right) =>
        right.ranking - left.ranking ||
        left.operations.length - right.operations.length ||
        compareStrings(left.key, right.key),
    );
    frontier = next.slice(0, width);
    if (frontier.length === 0) break;
  }

  validStates.sort(
    (left, right) =>
      right.ranking - left.ranking ||
      left.operations.length - right.operations.length ||
      compareStrings(left.key, right.key),
  );
  const chosen = validStates[0];
  if (!chosen) {
    return buildAbstainedResult(validation, dataset, [
      'No valid candidate improves the requested goals within the configured constraints.',
    ]);
  }

  const candidate = candidateChanges(build, chosen.operations, dataset, chosen.validation);
  if (!candidate) {
    return buildAbstainedResult(validation, dataset, [
      'The best candidate has no complete evidence citations.',
    ]);
  }
  const proposedBuild = applyCandidate(build, candidate);
  const proposedValidation = validateBuild(proposedBuild, dataset, goals);
  if (!proposedValidation.valid) {
    return buildAbstainedResult(validation, dataset, [
      'The proposed deterministic candidate failed its final trust-boundary validation.',
    ]);
  }
  const proposedScore = scoreBuild(proposedValidation, goals);
  if (!(proposedScore > baseScore)) {
    return buildAbstainedResult(validation, dataset, [
      'Every valid candidate failed to improve the requested goals.',
    ]);
  }

  const explanation = `${candidate.summary} Score improves from ${baseScore.toFixed(3)} to ${proposedScore.toFixed(3)}.`;
  return {
    status: 'recommended',
    origin: 'deterministic',
    candidate,
    proposedBuild,
    validation: proposedValidation,
    explanation,
    citationIds: [...candidate.citationIds],
    traces: [
      {
        id: 'deterministic-engine',
        tool: 'deterministic-engine',
        status: 'ok',
        mode: dataset.mode,
        startedAt: dataset.retrievedAt,
        durationMs: 0,
        sourceIds: [...candidate.citationIds],
        message: explanation,
      },
    ],
    abstentionReasons: [],
  };
}

function canonicalItemMap(dataset: VersionedDataset): Map<string, GameItem> {
  return itemIndex(dataset);
}

export function compareVersions(
  build: Build,
  from: VersionedDataset,
  to: VersionedDataset,
): PatchComparison {
  const before = validateBuild(build, from);
  const after = validateBuild(build, to);
  const beforeItems = canonicalItemMap(from);
  const afterItems = canonicalItemMap(to);
  const beforeIds = new Set(beforeItems.keys());
  const afterIds = new Set(afterItems.keys());
  const addedItemIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort(compareStrings);
  const removedItemIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort(compareStrings);
  const changedItemIds = [...beforeIds]
    .filter((id) => afterIds.has(id))
    .filter((id) => stableSerialize(beforeItems.get(id)) !== stableSerialize(afterItems.get(id)))
    .sort(compareStrings);

  return {
    fromVersion: from.version,
    toVersion: to.version,
    changedItemIds,
    removedItemIds,
    addedItemIds,
    before,
    after,
  };
}
