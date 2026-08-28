import { describe, expect, it } from 'vitest';
import { currentDataset, demoBuild, demoGoals, previousDataset } from '../../src/fixtures/datasets';
import type { Build, VersionedDataset } from '../../src/domain/contracts';
import {
  applyCandidate,
  compareVersions,
  emptySkillPoints,
  emptyStats,
  recommendDeterministically,
  scoreBuild,
  validateBuild,
} from '../../src/engine';

const copyBuild = (build: Build): Build => structuredClone(build);
const copyDataset = (dataset: VersionedDataset): VersionedDataset => structuredClone(dataset);

describe('deterministic build engine', () => {
  it('returns fresh zero-valued stats and skill records', () => {
    expect(emptyStats()).toEqual({
      health: 0,
      damage: 0,
      healing: 0,
      defense: 0,
      mobility: 0,
      spellDamage: 0,
      meleeDamage: 0,
      manaRegen: 0,
    });
    expect(emptySkillPoints()).toEqual({
      strength: 0,
      dexterity: 0,
      intelligence: 0,
      defense: 0,
      agility: 0,
    });
  });

  it('validates the fixture demo and computes deterministic totals', () => {
    const result = validateBuild(demoBuild, currentDataset, demoGoals);
    expect(result.valid).toBe(true);
    expect(result.deterministic).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.totals).toEqual({
      health: 3090,
      damage: 110,
      healing: 30,
      defense: 10,
      mobility: 70,
      spellDamage: 75,
      meleeDamage: 0,
      manaRegen: 7,
    });
    expect(result.skillTotals).toEqual({
      strength: 0,
      dexterity: 0,
      intelligence: 98,
      defense: 66,
      agility: 50,
    });
    expect(result.cost).toBe(193);
    expect(result.abilityPoints).toBe(6);
  });

  it('allows rings in either ring slot but rejects the same ring twice', () => {
    const build = copyBuild(demoBuild);
    build.equipment.ring2 = build.equipment.ring1;
    const result = validateBuild(build, currentDataset);
    expect(result.issues.some((issue) => issue.code === 'duplicate-item')).toBe(true);
  });

  it('rejects an incomplete equipment set', () => {
    const build = copyBuild(demoBuild);
    delete build.equipment.weapon;
    const result = validateBuild(build, currentDataset);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'missing-item', path: 'equipment.weapon' }),
    );
  });

  it('rejects missing, unavailable, wrong-slot, level, class, and incompatible equipment', () => {
    const build = copyBuild(demoBuild);
    build.equipment.helmet = 'field-cap';
    build.equipment.chestplate = 'closed-beta-band';
    build.equipment.ring1 = 'runed-catalyst';
    build.equipment.weapon = 'shadow-knife';
    build.equipment.necklace = 'not-in-dataset';
    const dataset = copyDataset(currentDataset);
    dataset.items = dataset.items.map((item) =>
      item.id === 'field-cap' ? { ...item, incompatibleWith: ['wayfarer-weave'] } : item,
    );
    const invalid = validateBuild(build, dataset);
    const codes = new Set(invalid.issues.map((issue) => issue.code));
    expect(invalid.valid).toBe(false);
    expect(codes).toEqual(
      new Set([
        'missing-item',
        'unavailable-item',
        'wrong-slot',
        'class-requirement',
        'level-requirement',
        'incompatible-items',
        'skill-requirement',
      ]),
    );
  });

  it('uses stable equipment order when applying skill bonuses to requirements', () => {
    const build = copyBuild(demoBuild);
    build.skillPoints.intelligence = 0;
    build.equipment.helmet = 'chorus-visor';
    build.equipment.chestplate = 'relay-vestment';
    const result = validateBuild(build, currentDataset);
    expect(result.issues.some((issue) => issue.code === 'skill-requirement')).toBe(true);

    const reordered = copyDataset(currentDataset);
    reordered.items.reverse();
    expect(validateBuild(build, reordered)).toEqual(result);
  });

  it('allows an earlier-slot bonus to satisfy a later-slot requirement only', () => {
    const dataset = copyDataset(currentDataset);
    const bonusHelmet = {
      id: 'test-bonus-helmet',
      name: 'Test Bonus Helmet',
      slot: 'helmet' as const,
      level: 1,
      skillRequirements: {},
      skillBonuses: { intelligence: 40 },
      stats: {},
      cost: 1,
      available: true,
      sourceId: 'fixture-method',
    };
    const requiredChest = {
      id: 'test-required-chest',
      name: 'Test Required Chest',
      slot: 'chestplate' as const,
      level: 1,
      skillRequirements: { intelligence: 40 },
      skillBonuses: {},
      stats: {},
      cost: 1,
      available: true,
      sourceId: 'fixture-method',
    };
    dataset.items.push(bonusHelmet, requiredChest);
    const build = copyBuild(demoBuild);
    build.skillPoints.intelligence = 0;
    build.equipment.helmet = bonusHelmet.id;
    build.equipment.chestplate = requiredChest.id;
    expect(
      validateBuild(build, dataset).issues.some((issue) => issue.code === 'skill-requirement'),
    ).toBe(false);

    build.equipment.helmet = requiredChest.id;
    build.equipment.chestplate = bonusHelmet.id;
    expect(
      validateBuild(build, dataset).issues.some((issue) => issue.code === 'skill-requirement'),
    ).toBe(true);
  });

  it('rejects non-integral runtime levels, assigned skills, and ability IDs', () => {
    const level = copyBuild(demoBuild);
    level.level = 80.5;
    expect(
      validateBuild(level, currentDataset).issues.some((issue) => issue.path === 'level'),
    ).toBe(true);

    const skill = copyBuild(demoBuild);
    skill.skillPoints.intelligence = 1.5;
    expect(
      validateBuild(skill, currentDataset).issues.some(
        (issue) => issue.path === 'skillPoints.intelligence',
      ),
    ).toBe(true);

    const ability = copyBuild(demoBuild);
    ability.abilities = [''];
    expect(
      validateBuild(ability, currentDataset).issues.some(
        (issue) => issue.code === 'missing-ability-prerequisite',
      ),
    ).toBe(true);
  });

  it('abstains when the dataset retrieval timestamp is unknown', () => {
    const dataset = copyDataset(currentDataset);
    dataset.retrievedAt = 'not-a-timestamp';
    const result = recommendDeterministically(demoBuild, demoGoals, dataset);
    expect(result.status).toBe('abstained');
    expect(result.abstentionReasons).toContain('Dataset retrieval time is unknown.');
  });

  it('abstains when any candidate record lacks a citation source', () => {
    const dataset = copyDataset(currentDataset);
    dataset.items.push({
      id: 'uncited-candidate',
      name: 'Uncited Candidate',
      slot: 'helmet',
      level: 1,
      skillRequirements: {},
      skillBonuses: {},
      stats: { damage: 1 },
      cost: 1,
      available: true,
      sourceId: 'missing-source',
    });
    const result = recommendDeterministically(demoBuild, demoGoals, dataset);
    expect(result.status).toBe('abstained');
    expect(result.abstentionReasons).toContain(
      'Item uncited-candidate has no available evidence source.',
    );
  });

  it('counts assigned skill points against both level and dataset caps', () => {
    const build = copyBuild(demoBuild);
    build.level = 2;
    build.skillPoints = { strength: 1, dexterity: 1, intelligence: 1, defense: 1, agility: 1 };
    const result = validateBuild(build, currentDataset);
    expect(
      result.issues.filter((issue) => issue.code === 'skill-requirement').length,
    ).toBeGreaterThan(0);

    const capped = copyDataset(currentDataset);
    capped.rules.maxAssignedSkillPoints = 3;
    build.level = 106;
    const cappedResult = validateBuild(build, capped);
    expect(cappedResult.issues.some((issue) => issue.path === 'skillPoints')).toBe(true);
  });

  it('checks ability prerequisites, conflicts, and milestone point limits', () => {
    const build = copyBuild(demoBuild);
    build.abilities = ['ward-bloom', 'glass-focus'];
    build.level = 1;
    const result = validateBuild(build, currentDataset);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('missing-ability-prerequisite');
    expect(codes).toContain('ability-conflict');
    expect(codes).toContain('ability-point-limit');
  });

  it('reports stale data as a warning and uses explicit now for age checks', () => {
    const dataset = copyDataset(currentDataset);
    dataset.sources = dataset.sources.map((source) =>
      source.id === 'fixture-method' ? { ...source, freshness: 'stale' } : source,
    );
    const stale = validateBuild(demoBuild, dataset);
    expect(stale.valid).toBe(true);
    expect(stale.issues.some((issue) => issue.code === 'stale-dataset')).toBe(true);

    const aged = copyDataset(currentDataset);
    aged.rules.staleAfterDays = 1;
    const agedResult = validateBuild(
      demoBuild,
      aged,
      undefined,
      new Date('2026-09-01T19:32:28.000Z'),
    );
    expect(agedResult.issues.some((issue) => issue.path === 'dataset.retrievedAt')).toBe(true);
  });

  it('applies candidate changes without mutating the source build', () => {
    const build = copyBuild(demoBuild);
    const original = copyBuild(build);
    const changed = applyCandidate(build, {
      summary: 'test candidate',
      equipmentChanges: [
        {
          slot: 'helmet',
          fromItemId: 'field-cap',
          toItemId: 'chorus-visor',
          reasons: ['support'],
        },
      ],
      abilityChanges: { add: ['ward-bloom'], remove: ['phase-step'] },
      tradeoffs: ['less mobility'],
      citationIds: ['fixture-method'],
    });
    expect(build).toEqual(original);
    expect(changed.equipment.helmet).toBe('chorus-visor');
    expect(changed.abilities).toEqual(['arcane-bolt', 'mana-well', 'radiant-pulse', 'ward-bloom']);
  });

  it('scores goal dimensions and penalizes budget pressure', () => {
    const validation = validateBuild(demoBuild, currentDataset, demoGoals);
    const higherSupport = {
      ...validation,
      totals: { ...validation.totals, healing: validation.totals.healing + 100 },
    };
    const lowerCost = { ...validation, cost: validation.cost - 50 };
    expect(scoreBuild(higherSupport, { ...demoGoals, raidSupport: 100 })).toBeGreaterThan(
      scoreBuild(validation, { ...demoGoals, raidSupport: 100 }),
    );
    expect(scoreBuild(lowerCost, demoGoals)).toBeGreaterThan(scoreBuild(validation, demoGoals));
    expect(
      scoreBuild(
        {
          ...validation,
          issues: [
            {
              ...validation.issues[0]!,
              code: 'budget-exceeded',
              severity: 'error',
              path: 'equipment',
              message: 'bad',
            },
          ],
        },
        demoGoals,
      ),
    ).toBeLessThan(scoreBuild(validation, demoGoals));
  });

  it('returns a deterministic, bounded, cited recommendation', () => {
    const first = recommendDeterministically(demoBuild, demoGoals, currentDataset);
    const reordered = copyDataset(currentDataset);
    reordered.items.reverse();
    reordered.abilities.reverse();
    reordered.sources.reverse();
    const second = recommendDeterministically(demoBuild, demoGoals, reordered);
    expect(first).toEqual(second);
    expect(first.status).toBe('recommended');
    expect(first.origin).toBe('deterministic');
    expect(first.candidate).toBeDefined();
    expect(first.proposedBuild).toBeDefined();
    expect(first.validation.valid).toBe(true);
    expect(
      first.candidate!.equipmentChanges.length +
        first.candidate!.abilityChanges.add.length +
        first.candidate!.abilityChanges.remove.length,
    ).toBeLessThanOrEqual(demoGoals.maxChanges);
    expect(first.candidate!.citationIds.length).toBeGreaterThan(0);
    expect(validateBuild(first.proposedBuild!, currentDataset, demoGoals).valid).toBe(true);
  });

  it('abstains for invalid input, stale sources, exclusions, and zero change budget', () => {
    const invalid = copyBuild(demoBuild);
    invalid.equipment.weapon = 'not-in-dataset';
    expect(recommendDeterministically(invalid, demoGoals, currentDataset).status).toBe('abstained');

    const stale = copyDataset(currentDataset);
    stale.sources = stale.sources.map((source) => ({ ...source, freshness: 'stale' }));
    expect(recommendDeterministically(demoBuild, demoGoals, stale).status).toBe('abstained');
    expect(
      recommendDeterministically(demoBuild, { ...demoGoals, maxChanges: 0 }, currentDataset).status,
    ).toBe('abstained');

    const excluded = recommendDeterministically(
      demoBuild,
      { ...demoGoals, excludedItemIds: currentDataset.items.map((item) => item.id) },
      currentDataset,
    );
    expect(excluded.status).toBe('recommended');
    expect(
      excluded.candidate?.equipmentChanges.every(
        (change) =>
          !change.toItemId || !currentDataset.items.some((item) => item.id === change.toItemId),
      ),
    ).toBe(true);
  });

  it('compares versions with stable added, removed, and changed item IDs', () => {
    const comparison = compareVersions(demoBuild, previousDataset, currentDataset);
    expect(comparison.fromVersion).toBe(previousDataset.version);
    expect(comparison.toVersion).toBe(currentDataset.version);
    expect(comparison.addedItemIds).toEqual(['beacon-treads']);
    expect(comparison.removedItemIds).toEqual([]);
    expect(comparison.changedItemIds).toEqual(['chorus-staff']);
    expect(comparison.before.valid).toBe(true);
    expect(comparison.after.valid).toBe(true);

    const reordered = copyDataset(currentDataset);
    reordered.items.reverse();
    expect(compareVersions(demoBuild, previousDataset, reordered)).toEqual(comparison);
  });
});
