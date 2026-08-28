import { z } from 'zod';
import { CLASSES, EQUIPMENT_SLOTS } from './contracts';

export const equipmentChangeSchema = z
  .object({
    slot: z.enum(EQUIPMENT_SLOTS),
    fromItemId: z.string().min(1).optional(),
    toItemId: z.string().min(1).optional(),
    reasons: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const recommendationCandidateSchema = z
  .object({
    summary: z.string().min(1).max(600),
    equipmentChanges: z.array(equipmentChangeSchema).max(9),
    abilityChanges: z
      .object({ add: z.array(z.string().min(1)), remove: z.array(z.string().min(1)) })
      .strict(),
    tradeoffs: z.array(z.string().min(1)).min(1).max(8),
    citationIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

const skillPointsSchema = z
  .object({
    strength: z.number().int().min(0).max(200),
    dexterity: z.number().int().min(0).max(200),
    intelligence: z.number().int().min(0).max(200),
    defense: z.number().int().min(0).max(200),
    agility: z.number().int().min(0).max(200),
  })
  .strict();

export const buildSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    classId: z.enum(CLASSES),
    level: z.number().int().min(1).max(106),
    skillPoints: skillPointsSchema,
    equipment: z.partialRecord(z.enum(EQUIPMENT_SLOTS), z.string().min(1)),
    abilities: z.array(z.string().min(1)),
  })
  .strict();

export const naturalGoalSchema = z
  .object({
    soloDamage: z.number().min(0).max(100),
    raidSupport: z.number().min(0).max(100),
    survivability: z.number().min(0).max(100),
    mobility: z.number().min(0).max(100),
    budget: z.number().int().min(0),
    maxChanges: z.number().int().min(0).max(9),
    excludedItemIds: z.array(z.string().min(1)),
  })
  .strict();
