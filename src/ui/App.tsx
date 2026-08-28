import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CLASSES,
  EQUIPMENT_SLOTS,
  SKILLS,
  type Build,
  type BuildGoals,
  type BuildStats,
  type ClassId,
  type EquipmentSlot,
  type GameItem,
  type PatchComparison,
  type RecommendationResult,
  type SourceCard,
  type ToolTrace,
  type ValidationResult,
  type VersionedDataset,
} from '../domain/contracts';
import { buildSchema, naturalGoalSchema } from '../domain/schemas';
import { currentDataset, demoBuild, demoGoals, previousDataset } from '../fixtures/datasets';
import { compareVersions, recommendDeterministically, validateBuild } from '../engine/index';
import {
  evaluationScenarios,
  runEvaluationSuite,
  type EvaluationReport,
  type EvaluationScenario,
  type EvaluationScenarioResult,
} from '../evals/harness';

type Screen = 'workspace' | 'evaluation';

type SavedBuild = {
  id: string;
  savedAt: string;
  build: Build;
  goals: BuildGoals;
};

const STORAGE_KEY = 'loadout-atelier.saved-builds.v1';
const slots = EQUIPMENT_SLOTS;
const statKeys: (keyof BuildStats)[] = [
  'health',
  'damage',
  'healing',
  'defense',
  'mobility',
  'spellDamage',
  'meleeDamage',
  'manaRegen',
];

const slotLabels: Record<EquipmentSlot, string> = {
  helmet: 'Helmet',
  chestplate: 'Chestplate',
  leggings: 'Leggings',
  boots: 'Boots',
  ring1: 'Ring 1',
  ring2: 'Ring 2',
  bracelet: 'Bracelet',
  necklace: 'Necklace',
  weapon: 'Weapon',
};

const skillLabels: Record<(typeof SKILLS)[number], string> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  intelligence: 'Intelligence',
  defense: 'Defense',
  agility: 'Agility',
};

const statLabels: Record<keyof BuildStats, string> = {
  health: 'Health',
  damage: 'Damage',
  healing: 'Healing',
  defense: 'Defense',
  mobility: 'Mobility',
  spellDamage: 'Spell damage',
  meleeDamage: 'Melee damage',
  manaRegen: 'Mana regen',
};

const classLabels: Record<ClassId, string> = {
  warrior: 'Warrior',
  archer: 'Archer',
  assassin: 'Assassin',
  mage: 'Mage',
  shaman: 'Shaman',
};

const emptyStats = (): BuildStats => ({
  health: 0,
  damage: 0,
  healing: 0,
  defense: 0,
  mobility: 0,
  spellDamage: 0,
  meleeDamage: 0,
  manaRegen: 0,
});

const runValidation = (
  build: Build,
  dataset: VersionedDataset,
  goals?: BuildGoals,
): ValidationResult => validateBuild(build, dataset, goals);

const runRecommendation = (
  build: Build,
  goals: BuildGoals,
  dataset: VersionedDataset,
): RecommendationResult => recommendDeterministically(build, goals, dataset);

const runComparison = (build: Build): PatchComparison =>
  compareVersions(build, previousDataset, currentDataset);

const formatNumber = (value: number): string => new Intl.NumberFormat('en-US').format(value);

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const modeLabel = (mode: SourceCard['mode']): string => {
  if (mode === 'fixture') return 'Synthetic fixture';
  if (mode === 'cached') return 'Cached contract';
  return 'Live source';
};

const itemFor = (dataset: VersionedDataset, id?: string): GameItem | undefined =>
  id ? dataset.items.find((item) => item.id === id) : undefined;

const readSavedBuilds = (): { builds: SavedBuild[]; error: string | null } => {
  if (typeof window === 'undefined') return { builds: [], error: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { builds: [], error: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { builds: [], error: 'Saved builds could not be read.' };
    const builds = parsed.flatMap((entry): SavedBuild[] => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const parsedBuild = buildSchema.safeParse(record.build);
      const parsedGoals = naturalGoalSchema.safeParse(record.goals);
      if (
        !parsedBuild.success ||
        !parsedGoals.success ||
        typeof record.id !== 'string' ||
        record.id.trim().length === 0 ||
        typeof record.savedAt !== 'string' ||
        Number.isNaN(Date.parse(record.savedAt))
      ) {
        return [];
      }
      return [
        {
          id: record.id.slice(0, 160),
          savedAt: record.savedAt,
          build: parsedBuild.data as Build,
          goals: parsedGoals.data as BuildGoals,
        },
      ];
    });
    return {
      builds: builds.slice(0, 12),
      error: builds.length < parsed.length ? 'Some invalid local saves were ignored.' : null,
    };
  } catch {
    return { builds: [], error: 'Saved builds are unavailable in this browser session.' };
  }
};

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function SectionHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {detail ? <p className="section-detail">{detail}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

function Icon({ name }: { name: 'check' | 'alert' | 'spark' | 'download' | 'save' | 'refresh' }) {
  const paths: Record<string, string> = {
    check: 'M5 12.5 9.2 17 19 7',
    alert: 'M12 4.5 20 19H4L12 4.5Zm0 5v4m0 2.7v.2',
    spark: 'm12 3 1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7L12 3Z',
    download: 'M12 4v10m0 0 4-4m-4 4-4-4M5 19h14',
    save: 'M5 4h12l2 2v14H5V4Zm3 0v5h7V4m-5 11h4',
    refresh: 'M19 8a7 7 0 0 0-12.7-1.5L5 8m0 0V4m0 4h4M5 16a7 7 0 0 0 12.7 1.5L19 16m0 0v4m0-4h-4',
  };
  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none">
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatGrid({ stats, compact = false }: { stats: BuildStats; compact?: boolean }) {
  return (
    <div className={`stat-grid${compact ? ' stat-grid-compact' : ''}`}>
      {statKeys.map((key) => (
        <div className="stat-cell" key={key}>
          <span>{statLabels[key]}</span>
          <strong>{formatNumber(stats[key])}</strong>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>('workspace');
  const [build, setBuild] = useState<Build>(() => structuredClone(demoBuild));
  const [goals, setGoals] = useState<BuildGoals>(() => structuredClone(demoGoals));
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [patchComparison, setPatchComparison] = useState<PatchComparison | null>(() =>
    runComparison(demoBuild),
  );
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [initialSavedState] = useState(() => readSavedBuilds());
  const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>(initialSavedState.builds);
  const [storageMessage, setStorageMessage] = useState<string | null>(initialSavedState.error);
  const [exportError, setExportError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [nameDraft, setNameDraft] = useState(demoBuild.name);
  const [selectedScenario, setSelectedScenario] = useState(evaluationScenarios[0]?.id ?? '');
  const [evaluationOutcome, setEvaluationOutcome] = useState<EvaluationScenarioResult | null>(null);
  const [evaluationReport, setEvaluationReport] = useState<EvaluationReport | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);

  const validation = useMemo(() => runValidation(build, currentDataset, goals), [build, goals]);

  const itemsById = useMemo(() => new Map(currentDataset.items.map((item) => [item.id, item])), []);
  const sourcesById = useMemo(
    () => new Map(currentDataset.sources.map((source) => [source.id, source])),
    [],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const updateBuild = useCallback((patch: Partial<Build>) => {
    setBuild((current) => ({ ...current, ...patch }));
    setRecommendation(null);
  }, []);

  const updateClass = (classId: ClassId) => {
    setBuild((current) => ({
      ...current,
      classId,
      abilities: current.abilities.filter(
        (abilityId) =>
          currentDataset.abilities.find((ability) => ability.id === abilityId)?.classId === classId,
      ),
    }));
    setRecommendation(null);
  };

  const updateEquipment = (slot: EquipmentSlot, itemId: string) => {
    setBuild((current) => ({
      ...current,
      equipment: { ...current.equipment, [slot]: itemId || undefined },
    }));
    setRecommendation(null);
  };

  const updateSkill = (skill: (typeof SKILLS)[number], value: number) => {
    setBuild((current) => ({
      ...current,
      skillPoints: { ...current.skillPoints, [skill]: Math.max(0, Math.min(200, value || 0)) },
    }));
    setRecommendation(null);
  };

  const updateGoal = <K extends keyof BuildGoals>(key: K, value: BuildGoals[K]) => {
    setGoals((current) => ({ ...current, [key]: value }));
    setRecommendation(null);
  };

  const validateCurrent = (event?: FormEvent) => {
    event?.preventDefault();
    setRecommendation(null);
  };

  const generateRecommendation = () => {
    setRecommendationLoading(true);
    try {
      const nextRecommendation = runRecommendation(build, goals, currentDataset);
      setRecommendation(nextRecommendation);
      setEvaluationError(null);
    } catch {
      setRecommendation({
        status: 'abstained',
        origin: 'fixture-fallback',
        validation,
        explanation: 'The deterministic evaluator returned an error, so no candidate was applied.',
        citationIds: [],
        traces: [
          {
            id: 'ui-recommendation-error',
            tool: 'recommendDeterministically',
            status: 'error',
            mode: currentDataset.mode,
            startedAt: new Date().toISOString(),
            durationMs: 0,
            sourceIds: [],
            message: 'The local evaluator failed closed without using an unverified result.',
          },
        ],
        abstentionReasons: ['The local deterministic evaluator failed closed.'],
      });
    } finally {
      setRecommendationLoading(false);
    }
  };

  const reEvaluatePatch = () => {
    setPatchLoading(true);
    setPatchError(null);
    try {
      setPatchComparison(runComparison(build));
    } catch {
      setPatchComparison(null);
      setPatchError('Patch comparison could not be evaluated for this build.');
    } finally {
      setPatchLoading(false);
    }
  };

  const persistSavedBuilds = (next: SavedBuild[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedBuilds(next);
      setStorageMessage(null);
    } catch {
      setStorageMessage('Could not save this build. Browser storage may be full or blocked.');
    }
  };

  const saveBuild = () => {
    const candidateName = nameDraft.trim() || build.name.trim();
    const parsedBuild = buildSchema.safeParse({ ...build, name: candidateName });
    const parsedGoals = naturalGoalSchema.safeParse(goals);
    if (!parsedBuild.success || !parsedGoals.success) {
      setStorageMessage(
        'Could not save: complete the build and keep goal values within their limits.',
      );
      return;
    }
    const nextSaved: SavedBuild = {
      id: `${build.id}-${Date.now()}`,
      savedAt: new Date().toISOString(),
      build: structuredClone(parsedBuild.data) as Build,
      goals: structuredClone(parsedGoals.data) as BuildGoals,
    };
    persistSavedBuilds([nextSaved, ...savedBuilds].slice(0, 12));
  };

  const loadSavedBuild = (saved: SavedBuild) => {
    setBuild(structuredClone(saved.build));
    setGoals(structuredClone(saved.goals));
    setNameDraft(saved.build.name);
    setRecommendation(null);
  };

  const removeSavedBuild = (id: string) => {
    persistSavedBuilds(savedBuilds.filter((saved) => saved.id !== id));
  };

  const exportSummary = () => {
    const summary = {
      exportedAt: new Date().toISOString(),
      dataset: {
        version: currentDataset.version,
        label: currentDataset.label,
        retrievedAt: currentDataset.retrievedAt,
        mode: currentDataset.mode,
      },
      sources: currentDataset.sources.map(
        ({ id, label, publisher, retrievedAt, datasetVersion, mode, freshness }) => ({
          id,
          label,
          publisher,
          retrievedAt,
          datasetVersion,
          mode,
          freshness,
        }),
      ),
      build,
      goals,
      validation,
      recommendation,
    };
    let href: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    setExportError(null);
    try {
      if (typeof URL.createObjectURL !== 'function') throw new Error('missing-download-api');
      const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
      href = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `loadout-atelier-${build.id}.json`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
    } catch {
      setExportError('Export is unavailable in this browser session.');
    } finally {
      anchor?.remove();
      if (href) window.setTimeout(() => URL.revokeObjectURL(href!), 0);
    }
  };

  const selectScenario = (id: string) => {
    setSelectedScenario(id);
    setEvaluationOutcome(null);
    setEvaluationError(null);
  };

  const runScenario = async () => {
    const scenario = evaluationScenarios.find((candidate) => candidate.id === selectedScenario);
    if (!scenario) {
      setEvaluationError('Select a scenario before running a replay.');
      return;
    }
    setEvaluationLoading(true);
    setEvaluationError(null);
    try {
      const report = await runEvaluationSuite([scenario]);
      setEvaluationOutcome(report.scenarios[0] ?? null);
    } catch {
      setEvaluationOutcome(null);
      setEvaluationError(
        'The local scenario runner failed. No production or network result was used.',
      );
    } finally {
      setEvaluationLoading(false);
    }
  };

  const runFullSuite = async () => {
    setEvaluationLoading(true);
    setEvaluationError(null);
    try {
      const report = await runEvaluationSuite();
      setEvaluationReport(report);
      setEvaluationOutcome(
        report.scenarios.find((scenario) => scenario.id === selectedScenario) ??
          report.scenarios[0] ??
          null,
      );
    } catch {
      setEvaluationReport(null);
      setEvaluationOutcome(null);
      setEvaluationError(
        'The release suite could not be completed. No production accuracy claim is implied.',
      );
    } finally {
      setEvaluationLoading(false);
    }
  };

  const currentTraces: ToolTrace[] = recommendation?.traces ?? [
    {
      id: 'fixture-load',
      tool: 'fixture-loader',
      status: 'ok',
      mode: 'fixture',
      startedAt: currentDataset.retrievedAt,
      durationMs: 0,
      sourceIds: ['fixture-method'],
      message: 'Loaded the synthetic offline fixture; no network request was made.',
    },
  ];

  const recommendationValidation = recommendation?.proposedBuild
    ? runValidation(recommendation.proposedBuild, currentDataset, goals)
    : null;

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            LA
          </div>
          <div>
            <p className="brand-name">Loadout Atelier</p>
            <p className="brand-tagline">Evidence-backed build laboratory</p>
          </div>
        </div>
        <div className="header-meta">
          <Badge tone="fixture">FIXTURE · OFFLINE</Badge>
          <span className="dataset-chip">{currentDataset.version}</span>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Theme: ${theme}. Change theme`}
            onClick={() =>
              setTheme((value) =>
                value === 'system' ? 'dark' : value === 'dark' ? 'light' : 'system',
              )
            }
          >
            {theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      <nav className="view-nav" aria-label="Workspace views">
        <button
          className={screen === 'workspace' ? 'nav-tab active' : 'nav-tab'}
          type="button"
          aria-current={screen === 'workspace' ? 'page' : undefined}
          onClick={() => setScreen('workspace')}
        >
          <span className="nav-index">01</span> Build laboratory
        </button>
        <button
          className={screen === 'evaluation' ? 'nav-tab active' : 'nav-tab'}
          type="button"
          aria-current={screen === 'evaluation' ? 'page' : undefined}
          onClick={() => setScreen('evaluation')}
        >
          <span className="nav-index">02</span> Evaluation desk
        </button>
        <span className="nav-spacer" />
        <span className="dataset-note">Synthetic fixture aligned to API v3.7.2 contracts</span>
      </nav>

      {screen === 'workspace' ? (
        <main className="workspace-grid">
          <aside className="control-rail" aria-label="Build controls">
            <section className="rail-section">
              <SectionHeading
                eyebrow="01 / identity"
                title="Build setup"
                detail="Tune the candidate before it enters validation."
              />
              <form className="form-stack" onSubmit={validateCurrent}>
                <label className="field-label" htmlFor="build-name">
                  Build name
                </label>
                <input
                  id="build-name"
                  className="text-input"
                  value={nameDraft}
                  onChange={(event) => {
                    setNameDraft(event.target.value);
                    updateBuild({ name: event.target.value });
                  }}
                />
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="class-select">
                      Class
                    </label>
                    <select
                      id="class-select"
                      className="select-input"
                      value={build.classId}
                      onChange={(event) => updateClass(event.target.value as ClassId)}
                    >
                      {CLASSES.map((classId) => (
                        <option key={classId} value={classId}>
                          {classLabels[classId]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="level-input">
                      Level
                    </label>
                    <input
                      id="level-input"
                      className="number-input"
                      type="number"
                      min="1"
                      max={currentDataset.rules.maxLevel}
                      value={build.level}
                      onChange={(event) =>
                        updateBuild({
                          level: Math.max(
                            1,
                            Math.min(
                              currentDataset.rules.maxLevel,
                              Number(event.target.value) || 1,
                            ),
                          ),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="skill-block">
                  <div className="field-label-line">
                    <span className="field-label">Skill points</span>
                    <span className="field-hint">
                      {Object.values(build.skillPoints).reduce((sum, value) => sum + value, 0)}{' '}
                      assigned
                    </span>
                  </div>
                  <div className="skill-grid">
                    {SKILLS.map((skill) => (
                      <label className="skill-input" key={skill}>
                        <span>{skillLabels[skill].slice(0, 3)}</span>
                        <input
                          aria-label={`${skillLabels[skill]} points`}
                          type="number"
                          min="0"
                          max="200"
                          value={build.skillPoints[skill]}
                          onChange={(event) => updateSkill(skill, Number(event.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <button className="secondary-button full-width" type="submit">
                  <Icon name="check" /> Validate build
                </button>
              </form>
            </section>

            <section className="rail-section goals-section">
              <SectionHeading
                eyebrow="02 / intent"
                title="Goal controls"
                detail="Weights guide deterministic tradeoffs; they do not invent data."
              />
              <div className="goal-stack">
                {(
                  [
                    ['soloDamage', 'Solo damage'],
                    ['raidSupport', 'Raid support'],
                    ['survivability', 'Survivability'],
                    ['mobility', 'Mobility'],
                  ] as const
                ).map(([key, label]) => (
                  <div className="goal-row" key={key}>
                    <div className="goal-label">
                      <label htmlFor={`goal-${key}`}>{label}</label>
                      <output htmlFor={`goal-${key}`}>{goals[key]}%</output>
                    </div>
                    <input
                      id={`goal-${key}`}
                      type="range"
                      min="0"
                      max="100"
                      value={goals[key]}
                      onChange={(event) => updateGoal(key, Number(event.target.value))}
                    />
                  </div>
                ))}
                <div className="field-row goal-numbers">
                  <div>
                    <label className="field-label" htmlFor="budget-input">
                      Budget
                    </label>
                    <div className="input-suffix">
                      <input
                        id="budget-input"
                        className="number-input"
                        type="number"
                        min="0"
                        value={goals.budget}
                        onChange={(event) =>
                          updateGoal('budget', Math.max(0, Number(event.target.value) || 0))
                        }
                      />
                      <span>eb</span>
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="changes-input">
                      Max changes
                    </label>
                    <input
                      id="changes-input"
                      className="number-input"
                      type="number"
                      min="0"
                      max="9"
                      value={goals.maxChanges}
                      onChange={(event) =>
                        updateGoal(
                          'maxChanges',
                          Math.max(0, Math.min(9, Number(event.target.value) || 0)),
                        )
                      }
                    />
                  </div>
                </div>
                <details className="exclusions-details">
                  <summary>
                    Excluded items{' '}
                    <span>
                      {goals.excludedItemIds.length
                        ? `${goals.excludedItemIds.length} selected`
                        : 'None'}
                    </span>
                  </summary>
                  <div className="exclusion-list">
                    {currentDataset.items.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={goals.excludedItemIds.includes(item.id)}
                          onChange={(event) =>
                            updateGoal(
                              'excludedItemIds',
                              event.target.checked
                                ? [...goals.excludedItemIds, item.id]
                                : goals.excludedItemIds.filter((id) => id !== item.id),
                            )
                          }
                        />{' '}
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </section>

            <section className="rail-section saved-section">
              <SectionHeading
                eyebrow="03 / memory"
                title="Saved builds"
                detail="Stored locally on this device."
              />
              <div className="save-row">
                <button className="primary-button full-width" type="button" onClick={saveBuild}>
                  <Icon name="save" /> Save current
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Export build summary"
                  onClick={exportSummary}
                >
                  <Icon name="download" />
                </button>
              </div>
              {storageMessage ? (
                <p className="inline-error" role="alert">
                  {storageMessage}
                </p>
              ) : null}
              {exportError ? (
                <p className="inline-error" role="alert">
                  {exportError}
                </p>
              ) : null}
              <div className="saved-list">
                {savedBuilds.length === 0 ? (
                  <p className="empty-copy">No local snapshots yet.</p>
                ) : (
                  savedBuilds.map((saved) => (
                    <div className="saved-item" key={saved.id}>
                      <button type="button" onClick={() => loadSavedBuild(saved)}>
                        <strong>{saved.build.name}</strong>
                        <span>{formatDate(saved.savedAt)}</span>
                      </button>
                      <button
                        type="button"
                        className="delete-button"
                        aria-label={`Remove ${saved.build.name}`}
                        onClick={() => removeSavedBuild(saved.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className="workspace-canvas" aria-label="Build laboratory">
            <div className="canvas-intro">
              <div>
                <p className="eyebrow">Build laboratory / candidate {build.id}</p>
                <h1>{build.name || 'Untitled build'}</h1>
                <p className="intro-copy">
                  Construct, inspect, and compare a loadout with every claim tied to the current
                  fixture.
                </p>
              </div>
              <div className="intro-actions">
                <Badge tone="deterministic">DETERMINISTIC</Badge>
                <Badge tone={validation.valid ? 'valid' : 'invalid'}>
                  {validation.valid ? 'VALID STATE' : 'ATTENTION NEEDED'}
                </Badge>
              </div>
            </div>

            <section className="panel equipment-panel">
              <SectionHeading
                eyebrow="Equipment matrix"
                title="Manual construction"
                detail="Every slot is explicit. Ring 1 and Ring 2 may share the ring catalog."
                action={
                  <span className="panel-count">
                    {Object.values(build.equipment).filter(Boolean).length} / {slots.length} slots
                  </span>
                }
              />
              <div className="equipment-grid">
                {slots.map((slot) => {
                  const itemSlot = slot === 'ring1' || slot === 'ring2' ? 'ring' : slot;
                  const selected = itemFor(currentDataset, build.equipment[slot]);
                  const options = currentDataset.items.filter((item) => item.slot === itemSlot);
                  return (
                    <div
                      className={`equipment-card${selected ? '' : ' equipment-empty'}`}
                      key={slot}
                    >
                      <div className="equipment-card-top">
                        <span className="slot-label">{slotLabels[slot]}</span>
                        {selected ? (
                          <span className="item-level">L{selected.level}</span>
                        ) : (
                          <span className="item-level">OPEN</span>
                        )}
                      </div>
                      <select
                        aria-label={`${slotLabels[slot]} item`}
                        className="select-input equipment-select"
                        value={build.equipment[slot] ?? ''}
                        onChange={(event) => updateEquipment(slot, event.target.value)}
                      >
                        <option value="">No item selected</option>
                        {options.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                            {item.available ? '' : ' · unavailable'}
                          </option>
                        ))}
                      </select>
                      {selected ? (
                        <div className="equipment-meta">
                          <span>{selected.cost} eb</span>
                          <span>
                            {Object.entries(selected.stats)
                              .slice(0, 2)
                              .map(
                                ([key, value]) => `${statLabels[key as keyof BuildStats]} ${value}`,
                              )
                              .join(' · ')}
                          </span>
                        </div>
                      ) : (
                        <div className="equipment-meta muted">
                          Select an item to inspect its contract.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel ability-panel">
              <SectionHeading
                eyebrow="Ability path"
                title="Toggle nodes"
                detail="Prerequisites and conflicts are checked by the same validator."
                action={<span className="panel-count">{build.abilities.length} selected</span>}
              />
              <div className="ability-grid">
                {currentDataset.abilities
                  .filter((ability) => ability.classId === build.classId)
                  .map((ability) => (
                    <label
                      className={`ability-card${build.abilities.includes(ability.id) ? ' selected' : ''}`}
                      key={ability.id}
                    >
                      <input
                        type="checkbox"
                        checked={build.abilities.includes(ability.id)}
                        onChange={(event) =>
                          updateBuild({
                            abilities: event.target.checked
                              ? [...build.abilities, ability.id]
                              : build.abilities.filter((id) => id !== ability.id),
                          })
                        }
                      />
                      <span className="ability-check" aria-hidden="true">
                        {build.abilities.includes(ability.id) ? '✓' : ''}
                      </span>
                      <span className="ability-copy">
                        <strong>{ability.name}</strong>
                        <small>
                          {ability.cost} AP · {ability.description}
                        </small>
                      </span>
                    </label>
                  ))}
              </div>
            </section>

            <section className="panel stats-panel">
              <SectionHeading
                eyebrow="Computed readout"
                title="Current totals"
                detail="Totals are derived from selected equipment, skills, and abilities."
                action={
                  <span className="cost-readout">{formatNumber(validation.cost)} eb total</span>
                }
              />
              <StatGrid stats={validation.totals} />
              {validation.issues.length ? (
                <div className="issue-strip" role="alert">
                  <Icon name="alert" />
                  <span>
                    {validation.issues.filter((issue) => issue.severity === 'error').length}{' '}
                    error(s),{' '}
                    {validation.issues.filter((issue) => issue.severity === 'warning').length}{' '}
                    warning(s) in current state.
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('validation-panel')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                    }
                  >
                    Review issues
                  </button>
                </div>
              ) : (
                <div className="success-strip">
                  <Icon name="check" />
                  <span>All deterministic checks pass against {currentDataset.version}.</span>
                </div>
              )}
            </section>

            <section className="recommendation-zone">
              <div className="recommendation-header">
                <div>
                  <p className="eyebrow">Decision support</p>
                  <h2>Recommendation pass</h2>
                  <p>Candidate changes stay bounded by your goals and max-change constraint.</p>
                </div>
                <button
                  className="primary-button generate-button"
                  type="button"
                  onClick={generateRecommendation}
                  disabled={recommendationLoading}
                >
                  <Icon name="spark" />{' '}
                  {recommendationLoading ? 'Evaluating…' : 'Generate recommendation'}
                </button>
              </div>
              {!recommendation ? (
                <div className="recommendation-empty">
                  <span className="empty-orbit" aria-hidden="true">
                    ✦
                  </span>
                  <div>
                    <strong>Awaiting a recommendation pass</strong>
                    <p>
                      Run the deterministic evaluator to see changed slots, stat deltas, evidence,
                      and explicit tradeoffs.
                    </p>
                  </div>
                </div>
              ) : (
                <RecommendationPanel
                  recommendation={recommendation}
                  currentBuild={build}
                  goals={goals}
                  dataset={currentDataset}
                  recommendationValidation={recommendationValidation}
                  sourcesById={sourcesById}
                />
              )}
            </section>
          </section>

          <aside className="evidence-rail" aria-label="Evidence and validation">
            <section className="evidence-section validation-section" id="validation-panel">
              <SectionHeading
                eyebrow="Validation"
                title="Contract checks"
                detail="Deterministic · local evaluation"
              />
              <div
                className={`validation-banner ${validation.valid ? 'valid' : 'invalid'}`}
                aria-live="polite"
              >
                <span className="validation-icon">
                  <Icon name={validation.valid ? 'check' : 'alert'} />
                </span>
                <div>
                  <strong>{validation.valid ? 'Build is valid' : 'Build needs attention'}</strong>
                  <span>
                    {validation.valid
                      ? 'No blocking constraint violations.'
                      : `${validation.issues.filter((issue) => issue.severity === 'error').length} blocking issue(s) found.`}
                  </span>
                </div>
              </div>
              <div className="validation-facts">
                <div>
                  <span>Cost</span>
                  <strong>{formatNumber(validation.cost)} eb</strong>
                </div>
                <div>
                  <span>Ability points</span>
                  <strong>{validation.abilityPoints}</strong>
                </div>
                <div>
                  <span>Skill total</span>
                  <strong>
                    {Object.values(validation.skillTotals).reduce((sum, value) => sum + value, 0)}
                  </strong>
                </div>
              </div>
              {validation.issues.length ? (
                <div className="issue-list">
                  {validation.issues.map((issue, index) => (
                    <div
                      className={`issue-row ${issue.severity}`}
                      key={`${issue.path}-${issue.code}-${index}`}
                    >
                      <Icon name={issue.severity === 'error' ? 'alert' : 'refresh'} />
                      <div>
                        <strong>{issue.code.replaceAll('-', ' ')}</strong>
                        <span>{issue.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">
                  Validated against every selected item, class, level, skill, ability, and budget
                  rule.
                </p>
              )}
            </section>

            <section className="evidence-section">
              <SectionHeading
                eyebrow="Evidence ledger"
                title="Sources"
                detail={`${currentDataset.sources.length} records · retrieved ${formatDate(currentDataset.retrievedAt)}`}
              />
              <div className="source-list">
                {currentDataset.sources.map((source) => (
                  <a
                    className="source-card"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    key={source.id}
                  >
                    <div className="source-card-top">
                      <Badge
                        tone={
                          source.mode === 'fixture'
                            ? 'fixture'
                            : source.mode === 'live'
                              ? 'live'
                              : 'cached'
                        }
                      >
                        {modeLabel(source.mode)}
                      </Badge>
                      <span className={`freshness freshness-${source.freshness}`}>
                        {source.freshness}
                      </span>
                    </div>
                    <strong>{source.label}</strong>
                    <span>
                      {source.publisher} · {source.datasetVersion}
                    </span>
                    <small>Retrieved {formatDate(source.retrievedAt)}</small>
                  </a>
                ))}
              </div>
            </section>

            <section className="evidence-section traces-section">
              <SectionHeading
                eyebrow="Execution trace"
                title="Tool calls"
                detail="A transparent record of this pass."
              />
              <div className="trace-list">
                {currentTraces.map((trace) => (
                  <div className="trace-row" key={trace.id}>
                    <div className="trace-marker" />
                    <div className="trace-copy">
                      <div>
                        <strong>{trace.tool}</strong>
                        <Badge
                          tone={
                            trace.status === 'ok'
                              ? 'valid'
                              : trace.status === 'abstained'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {trace.status}
                        </Badge>
                      </div>
                      <span>{trace.message}</span>
                      <small>
                        {trace.mode} · {trace.durationMs} ms · {trace.sourceIds.length} source(s)
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="evidence-section patch-section">
              <SectionHeading
                eyebrow="Patch review"
                title="Version re-evaluation"
                detail="Local comparison, not a live patch feed."
                action={
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Re-evaluate patch"
                    onClick={reEvaluatePatch}
                    disabled={patchLoading}
                  >
                    <Icon name="refresh" />
                  </button>
                }
              />
              {patchComparison ? (
                <>
                  <div className="patch-version">
                    <span>{patchComparison.fromVersion}</span>
                    <span aria-hidden="true">→</span>
                    <strong>{patchComparison.toVersion}</strong>
                  </div>
                  <div className="patch-facts">
                    <div>
                      <strong>{patchComparison.addedItemIds.length}</strong>
                      <span>added</span>
                    </div>
                    <div>
                      <strong>{patchComparison.removedItemIds.length}</strong>
                      <span>removed</span>
                    </div>
                    <div>
                      <strong>{patchComparison.changedItemIds.length}</strong>
                      <span>changed</span>
                    </div>
                  </div>
                  <div className="patch-validity">
                    <div>
                      <span>Before</span>
                      <Badge tone={patchComparison.before.valid ? 'valid' : 'invalid'}>
                        {patchComparison.before.valid ? 'valid' : 'invalid'}
                      </Badge>
                    </div>
                    <div>
                      <span>After</span>
                      <Badge tone={patchComparison.after.valid ? 'valid' : 'invalid'}>
                        {patchComparison.after.valid ? 'valid' : 'invalid'}
                      </Badge>
                    </div>
                  </div>
                  <details className="patch-details">
                    <summary>Inspect item IDs</summary>
                    <dl>
                      {patchComparison.addedItemIds.length ? (
                        <>
                          <dt>Added</dt>
                          <dd>
                            {patchComparison.addedItemIds
                              .map((id) => itemsById.get(id)?.name ?? id)
                              .join(', ')}
                          </dd>
                        </>
                      ) : null}
                      {patchComparison.removedItemIds.length ? (
                        <>
                          <dt>Removed</dt>
                          <dd>
                            {patchComparison.removedItemIds
                              .map((id) => itemFor(previousDataset, id)?.name ?? id)
                              .join(', ')}
                          </dd>
                        </>
                      ) : null}
                      {patchComparison.changedItemIds.length ? (
                        <>
                          <dt>Changed</dt>
                          <dd>
                            {patchComparison.changedItemIds
                              .map((id) => itemsById.get(id)?.name ?? id)
                              .join(', ')}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </details>
                </>
              ) : (
                <p
                  className={patchError ? 'inline-error' : 'empty-copy'}
                  role={patchError ? 'alert' : undefined}
                >
                  {patchError ?? 'Run a re-evaluation to inspect the fixture patch.'}
                </p>
              )}
            </section>
          </aside>
        </main>
      ) : (
        <EvaluationDesk
          scenarios={evaluationScenarios}
          selectedScenario={selectedScenario}
          selectScenario={selectScenario}
          runScenario={runScenario}
          runFullSuite={runFullSuite}
          outcome={evaluationOutcome}
          report={evaluationReport}
          error={evaluationError}
          loading={evaluationLoading}
          dataset={currentDataset}
        />
      )}

      <footer className="app-footer">
        <span>Loadout Atelier · local-first analysis</span>
        <span>Fixture data is synthetic and not production accuracy.</span>
        <span>{currentDataset.retrievedAt.slice(0, 10)} retrieval</span>
      </footer>
    </div>
  );
}

function RecommendationPanel({
  recommendation,
  currentBuild,
  goals,
  dataset,
  recommendationValidation,
  sourcesById,
}: {
  recommendation: RecommendationResult;
  currentBuild: Build;
  goals: BuildGoals;
  dataset: VersionedDataset;
  recommendationValidation: ValidationResult | null;
  sourcesById: Map<string, SourceCard>;
}) {
  const candidate = recommendation.candidate;
  const currentValidation = runValidation(currentBuild, dataset, goals);
  return (
    <div
      className={`recommendation-card ${recommendation.status === 'abstained' ? 'abstained' : ''}`}
      aria-live="polite"
    >
      <div className="recommendation-state">
        <div className="recommendation-state-icon">
          <Icon name={recommendation.status === 'recommended' ? 'spark' : 'alert'} />
        </div>
        <div>
          <div className="state-line">
            <Badge tone={recommendation.status === 'recommended' ? 'recommended' : 'warning'}>
              {recommendation.status === 'recommended' ? 'RECOMMENDED' : 'ABSTAINED'}
            </Badge>
            <Badge tone="deterministic">{recommendation.origin}</Badge>
          </div>
          <h3>{candidate?.summary ?? 'No safe candidate returned'}</h3>
          <p>{recommendation.explanation}</p>
        </div>
      </div>
      {recommendation.status === 'abstained' ? (
        <div className="abstention-box">
          <strong>Why this pass abstained</strong>
          <ul>
            {recommendation.abstentionReasons.length ? (
              recommendation.abstentionReasons.map((reason) => <li key={reason}>{reason}</li>)
            ) : (
              <li>The current constraints do not support a defensible change.</li>
            )}
          </ul>
        </div>
      ) : (
        <>
          <div className="comparison-heading">
            <span>Current</span>
            <span>Recommended</span>
          </div>
          <div className="comparison-body">
            <div className="comparison-column">
              <div className="comparison-validity">
                <Badge tone={currentValidation.valid ? 'valid' : 'invalid'}>
                  {currentValidation.valid ? 'valid' : 'invalid'}
                </Badge>
                <span>{formatNumber(currentValidation.cost)} eb</span>
              </div>
              <StatGrid stats={currentValidation.totals} compact />
            </div>
            <div className="comparison-arrow" aria-hidden="true">
              →
            </div>
            <div className="comparison-column">
              <div className="comparison-validity">
                <Badge tone={recommendationValidation?.valid ? 'valid' : 'invalid'}>
                  {recommendationValidation?.valid ? 'valid' : 'invalid'}
                </Badge>
                <span>
                  {recommendationValidation
                    ? `${formatNumber(recommendationValidation.cost)} eb`
                    : '—'}
                </span>
              </div>
              <StatGrid stats={recommendationValidation?.totals ?? emptyStats()} compact />
            </div>
          </div>
          {candidate?.equipmentChanges.length ? (
            <div className="change-section">
              <h4>
                Changed slots <span>{candidate.equipmentChanges.length}</span>
              </h4>
              <div className="change-list">
                {candidate.equipmentChanges.map((change) => (
                  <div className="change-row" key={change.slot}>
                    <span className="change-slot">{slotLabels[change.slot]}</span>
                    <div>
                      <strong>{itemFor(dataset, change.fromItemId)?.name ?? 'Empty'}</strong>
                      <span>→ {itemFor(dataset, change.toItemId)?.name ?? 'Empty'}</span>
                    </div>
                    <small>{change.reasons.join(' · ')}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {candidate?.abilityChanges &&
          (candidate.abilityChanges.add.length || candidate.abilityChanges.remove.length) ? (
            <div className="change-section">
              <h4>Ability path changes</h4>
              <div className="ability-change-list">
                {candidate.abilityChanges.add.map((id) => (
                  <span className="ability-add" key={`add-${id}`}>
                    + {id}
                  </span>
                ))}
                {candidate.abilityChanges.remove.map((id) => (
                  <span className="ability-remove" key={`remove-${id}`}>
                    − {id}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {candidate?.tradeoffs.length ? (
            <div className="tradeoff-section">
              <h4>Tradeoffs</h4>
              <ul>
                {candidate.tradeoffs.map((tradeoff) => (
                  <li key={tradeoff}>{tradeoff}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {candidate?.citationIds.length ? (
            <div className="recommendation-citations">
              <span>Evidence</span>
              {candidate.citationIds.map((id) => (
                <span className="citation-pill" key={id}>
                  {sourcesById.get(id)?.label ?? id}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function EvaluationDesk({
  scenarios,
  selectedScenario,
  selectScenario,
  runScenario,
  runFullSuite,
  outcome,
  report,
  loading,
  error,
  dataset,
}: {
  scenarios: EvaluationScenario[];
  selectedScenario: string;
  selectScenario: (id: string) => void;
  runScenario: () => Promise<void>;
  runFullSuite: () => Promise<void>;
  outcome: EvaluationScenarioResult | null;
  report: EvaluationReport | null;
  loading: boolean;
  error: string | null;
  dataset: VersionedDataset;
}) {
  const scenario = scenarios.find((candidate) => candidate.id === selectedScenario);
  const scenarioLabel = (id: string): string =>
    id
      .split('-')
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  return (
    <main className="evaluation-shell">
      <div className="evaluation-intro">
        <p className="eyebrow">02 / local evaluation desk</p>
        <h1>Scenario replay</h1>
        <p>
          Replay all {scenarios.length} curated fixture cases that gate this release, including
          validation, source, provider, abstention, and stability paths.
        </p>
        <Badge tone="fixture">CURATED FIXTURES · NOT PRODUCTION ACCURACY</Badge>
      </div>
      <div className="evaluation-grid">
        <section className="panel scenario-panel">
          <SectionHeading
            eyebrow="Replay controls"
            title="Choose a scenario"
            detail={`${scenarios.length} versioned cases · no live network calls`}
          />
          <div className="scenario-list">
            {scenarios.map((candidate) => (
              <button
                className={`scenario-card${selectedScenario === candidate.id ? ' selected' : ''}`}
                type="button"
                key={candidate.id}
                aria-pressed={selectedScenario === candidate.id}
                onClick={() => selectScenario(candidate.id)}
              >
                <span className="scenario-radio" aria-hidden="true">
                  {selectedScenario === candidate.id ? '●' : '○'}
                </span>
                <span>
                  <strong>{scenarioLabel(candidate.id)}</strong>
                  <small>
                    {candidate.category} · {candidate.purpose}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <button
            className="primary-button full-width scenario-run"
            type="button"
            onClick={runScenario}
            disabled={loading}
          >
            <Icon name="refresh" /> {loading ? 'Running…' : 'Run selected scenario'}
          </button>
          <button
            className="secondary-button full-width"
            type="button"
            onClick={runFullSuite}
            disabled={loading}
          >
            Run all {scenarios.length} release cases
          </button>
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
        <section className="panel evaluation-result-panel">
          <SectionHeading
            eyebrow="Replay output"
            title="Local scenario outcome"
            detail={scenario ? scenario.purpose : undefined}
          />
          {!outcome ? (
            <div className="evaluation-empty">
              <span className="empty-orbit" aria-hidden="true">
                ◎
              </span>
              <strong>No scenario run yet</strong>
              <p>
                Select a case and run it to inspect the resulting validation and recommendation
                state.
              </p>
            </div>
          ) : (
            <div className="evaluation-output" aria-live="polite">
              <div className="outcome-banner">
                <Badge tone={outcome.passed ? 'valid' : 'invalid'}>
                  {outcome.passed ? 'PASSED' : 'FAILED'}
                </Badge>
                <Badge tone="deterministic">{outcome.category}</Badge>
                <span>fixture {dataset.version}</span>
              </div>
              <h3>{outcome.summary}</h3>
              <div className="evaluation-facts">
                <div>
                  <strong>{Object.values(outcome.checks).filter(Boolean).length}</strong>
                  <span>checks passed</span>
                </div>
                <div>
                  <strong>{Object.keys(outcome.checks).length}</strong>
                  <span>applicable checks</span>
                </div>
                <div>
                  <strong>{scenarioLabel(outcome.id)}</strong>
                  <span>scenario</span>
                </div>
              </div>
              <div className="evaluation-checks" aria-label="Applicable metric checks">
                {Object.entries(outcome.checks).map(([metric, passed]) => (
                  <div key={metric}>
                    <span>{metric.replace(/([A-Z])/g, ' $1')}</span>
                    <Badge tone={passed ? 'valid' : 'invalid'}>{passed ? 'pass' : 'fail'}</Badge>
                  </div>
                ))}
              </div>
              {report ? (
                <div className="suite-report">
                  <div className="suite-report-heading">
                    <div>
                      <span>Full release suite</span>
                      <strong>
                        {report.passedScenarios}/{report.scenarioCount} scenarios passed
                      </strong>
                    </div>
                    <Badge
                      tone={report.passedScenarios === report.scenarioCount ? 'valid' : 'invalid'}
                    >
                      {report.passedScenarios === report.scenarioCount ? 'stable' : 'review'}
                    </Badge>
                  </div>
                  <div className="suite-metrics">
                    {Object.entries(report.metrics).map(([metric, value]) => (
                      <div key={metric}>
                        <span>{metric.replace(/([A-Z])/g, ' $1')}</span>
                        <strong>
                          {value.numerator}/{value.denominator}
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="evaluation-disclaimer">
                Curated synthetic regression results describe only these scenarios. They are not a
                claim about production accuracy or live game data.
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export { App };
