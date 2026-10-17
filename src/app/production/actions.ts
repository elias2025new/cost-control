'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/server-db';
import { requireTenant, requireUser } from '../../lib/queries';
import {
  calculateYieldTest,
  createYieldTestRecord,
  postButcherYieldBatch,
  createProductionBatch,
  postProductionBatch,
  type YieldCutInput,
  ProductionError,
} from '../../domain/production';

export type YieldActionState = {
  error: string | null;
  ok?: string;
};

export async function submitButcherYieldTest(
  _prev: YieldActionState,
  formData: FormData,
): Promise<YieldActionState> {
  const storeId = String(formData.get('storeId') ?? '').trim();
  const primalItemId = String(formData.get('primalItemId') ?? '').trim();
  const testNumber = String(formData.get('testNumber') ?? `BYT-${Date.now().toString().slice(-6)}`).trim();
  const grossWeight = String(formData.get('grossWeight') ?? '').trim();
  const grossCostPerKg = String(formData.get('grossCostPerKg') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const autoPost = formData.get('autoPost') === 'on' || formData.get('autoPost') === 'true';

  if (!storeId) return { error: 'Please select a butchery / prep store.' };
  if (!primalItemId) return { error: 'Please select a primal carcass item.' };
  if (!grossWeight || Number(grossWeight) <= 0) return { error: 'Gross weight must be greater than 0 kg.' };
  if (!grossCostPerKg || Number(grossCostPerKg) < 0) return { error: 'Gross cost per kg cannot be negative.' };

  const rawCutsJson = String(formData.get('cutsJson') ?? '[]');
  let cuts: YieldCutInput[] = [];
  try {
    cuts = JSON.parse(rawCutsJson);
  } catch {
    return { error: 'Invalid cut entries format.' };
  }

  if (cuts.length === 0) {
    return { error: 'At least one cut or byproduct must be recorded.' };
  }

  try {
    const d = await db();
    const user = await requireUser();
    const t = await requireTenant();

    const created = await createYieldTestRecord(d, {
      tenantId: t.id,
      storeId,
      primalItemId,
      testNumber,
      grossWeight,
      grossCostPerKg,
      cuts,
      notes: notes || undefined,
      createdBy: user.displayName,
    });

    if (autoPost) {
      await postButcherYieldBatch(d, t.id, created.yieldTestId, user.displayName);
    }

    revalidatePath('/production');
    revalidatePath('/ledger');
    revalidatePath('/reports/cost-control');

    return {
      error: null,
      ok: autoPost
        ? `Butcher yield test #${testNumber} recorded and posted into stock ledger. Usable yield: ${created.result.usableYieldPercent.toFixed(1)}%.`
        : `Butcher yield test #${testNumber} saved as draft. Usable yield: ${created.result.usableYieldPercent.toFixed(1)}%.`,
    };
  } catch (err) {
    if (err instanceof ProductionError) {
      return { error: err.message };
    }
    return { error: `Failed to record butcher yield: ${(err as Error).message}` };
  }
}

export type BatchActionState = {
  error: string | null;
  ok?: string;
};

export async function submitProductionBatch(
  _prev: BatchActionState,
  formData: FormData,
): Promise<BatchActionState> {
  const storeId = String(formData.get('storeId') ?? '').trim();
  const recipeId = String(formData.get('recipeId') ?? '').trim();
  const targetItemId = String(formData.get('targetItemId') ?? '').trim();
  const batchNumber = String(formData.get('batchNumber') ?? `PB-${Date.now().toString().slice(-6)}`).trim();
  const multiplier = String(formData.get('multiplier') ?? '1').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const autoPost = formData.get('autoPost') === 'on' || formData.get('autoPost') === 'true';

  if (!storeId) return { error: 'Please select a prep kitchen / station.' };
  if (!recipeId) return { error: 'Please select a sub-recipe to produce.' };
  if (!targetItemId) return { error: 'Please select target inventory item for finished prep good.' };
  if (!multiplier || Number(multiplier) <= 0) return { error: 'Batch multiplier must be at least 1.' };

  try {
    const d = await db();
    const user = await requireUser();
    const t = await requireTenant();

    const created = await createProductionBatch(d, {
      tenantId: t.id,
      storeId,
      recipeId,
      targetItemId,
      batchNumber,
      batchMultiplier: multiplier,
      notes: notes || undefined,
      createdBy: user.displayName,
    });

    if (autoPost) {
      const posted = await postProductionBatch(d, t.id, created.batchId, user.displayName);
      revalidatePath('/production');
      revalidatePath('/ledger');
      revalidatePath('/reports/cost-control');
      return {
        error: null,
        ok: `Production batch #${batchNumber} posted. Produced ${posted.producedQty.toString()} units at ${posted.unitCost.toFixed(2)} ETB/unit (Total: ${posted.totalCost.toFixed(2)} ETB).`,
      };
    }

    revalidatePath('/production');
    return {
      error: null,
      ok: `Production batch #${batchNumber} created in draft with ${created.lineCount} recipe components.`,
    };
  } catch (err) {
    if (err instanceof ProductionError) {
      return { error: err.message };
    }
    return { error: `Failed to execute production batch: ${(err as Error).message}` };
  }
}
