export const CLASSES = ['warrior', 'archer', 'assassin', 'mage', 'shaman'] as const;
export type ClassId = (typeof CLASSES)[number];

export const SKILLS = ['strength', 'dexterity', 'intelligence', 'defense', 'agility'] as const;
export type Skill = (typeof SKILLS)[number];
export type SkillPoints = Record<Skill, number>;

export const EQUIPMENT_SLOTS = [
  'helmet',
  'chestplate',
  'leggings',
  'boots',
  'ring1',
  'ring2',
  'bracelet',
  'necklace',
  'weapon',
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];
export type ItemSlot = Exclude<EquipmentSlot, 'ring1' | 'ring2'> | 'ring';

export type BuildStats = {
  health: number;
  damage: number;
  healing: number;
  defense: number;
  mobility: number;
  spellDamage: number;
  meleeDamage: number;
  manaRegen: number;
};

export type SourceMode = 'live' | 'cached' | 'fixture';

export type SourceCard = {
  id: string;
  label: string;
  url: string;
  publisher: string;
  retrievedAt: string;
  datasetVersion: string;
  mode: SourceMode;
  freshness: 'fresh' | 'stale' | 'unknown';
};

export type GameItem = {
  id: string;
  name: string;
  slot: ItemSlot;
  level: number;
  classRequirement?: ClassId;
  skillRequirements: Partial<SkillPoints>;
  skillBonuses: Partial<SkillPoints>;
  stats: Partial<BuildStats>;
  cost: number;
  setId?: string;
  incompatibleWith?: string[];
  available: boolean;
  sourceId: string;
};

export type AbilityNode = {
  id: string;
  name: string;
  classId: ClassId;
  cost: number;
  requires: string[];
  excludes: string[];
  stats: Partial<BuildStats>;
  description: string;
  sourceId: string;
};

export type VersionedDataset = {
  version: string;
  label: string;
  retrievedAt: string;
  mode: SourceMode;
  items: GameItem[];
  abilities: AbilityNode[];
  sources: SourceCard[];
};

export type Build = {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  skillPoints: SkillPoints;
  equipment: Partial<Record<EquipmentSlot, string>>;
  abilities: string[];
};

export type BuildGoals = {
  soloDamage: number;
  raidSupport: number;
  survivability: number;
  mobility: number;
  budget: number;
  maxChanges: number;
  excludedItemIds: string[];
};

export type ValidationIssue = {
  code:
    | 'missing-item'
    | 'unavailable-item'
    | 'wrong-slot'
    | 'duplicate-item'
    | 'level-requirement'
    | 'skill-requirement'
    | 'class-requirement'
    | 'incompatible-items'
    | 'missing-ability-prerequisite'
    | 'ability-conflict'
    | 'ability-point-limit'
    | 'budget-exceeded'
    | 'stale-dataset';
  severity: 'error' | 'warning';
  path: string;
  message: string;
  sourceId?: string;
};

export type ValidationResult = {
  valid: boolean;
  deterministic: true;
  issues: ValidationIssue[];
  totals: BuildStats;
  skillTotals: SkillPoints;
  cost: number;
  abilityPoints: number;
};

export type EquipmentChange = {
  slot: EquipmentSlot;
  fromItemId?: string;
  toItemId?: string;
  reasons: string[];
};

export type RecommendationCandidate = {
  summary: string;
  equipmentChanges: EquipmentChange[];
  abilityChanges: { add: string[]; remove: string[] };
  tradeoffs: string[];
  citationIds: string[];
};

export type ToolTrace = {
  id: string;
  tool: string;
  status: 'ok' | 'fallback' | 'error' | 'abstained';
  mode: SourceMode | 'provider';
  startedAt: string;
  durationMs: number;
  sourceIds: string[];
  message: string;
};

export type RecommendationResult = {
  status: 'recommended' | 'abstained';
  origin: 'deterministic' | 'ai-assisted' | 'fixture-fallback';
  candidate?: RecommendationCandidate;
  proposedBuild?: Build;
  validation: ValidationResult;
  explanation: string;
  citationIds: string[];
  traces: ToolTrace[];
  abstentionReasons: string[];
};

export type PatchComparison = {
  fromVersion: string;
  toVersion: string;
  changedItemIds: string[];
  removedItemIds: string[];
  addedItemIds: string[];
  before: ValidationResult;
  after: ValidationResult;
};
