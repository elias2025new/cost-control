'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireTenant, requireAdmin } from '../../lib/queries';
import { importCnetUpload, ImportError } from '../../domain/importCnet';
import { postSalesImport, PostImportError } from '../../domain/postSalesImport';

export type UploadState = { error: string | null };

export async function uploadSalesFile(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CNET sales export first.' };
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return { error: `${file.name} is not an Excel file. The CNET export is an .xlsx.` };
  }

  let importId: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    const result = await importCnetUpload(d, t.id, buf, file.name);
    importId = result.importId;
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    return { error: `Import failed: ${(err as Error).message}` };
  }

  revalidatePath('/import');
  redirect(`/import/${importId}`);
}

export type PostState = { error: string | null; ok?: string };

export async function postImport(_prev: PostState, formData: FormData): Promise<PostState> {
  const id = String(formData.get('importId') ?? '');
  if (!id) return { error: 'No import to post.' };

  try {
    const d = await db();
    const result = await postSalesImport(d, id);
    revalidatePath(`/import/${id}`);
    revalidatePath('/import');
    revalidatePath('/ledger');

    if (result.alreadyPosted) {
      return {
        error: null,
        ok: 'This import was already posted. Nothing changed - posting twice never double-depletes.',
      };
    }
    return {
      error: null,
      ok:
        `Posted. ${result.movementsWritten} stock movements written across ` +
        `${result.linesDepleted} costed lines.`,
    };
  } catch (err) {
    if (err instanceof PostImportError) return { error: err.message };
    return { error: `Posting failed: ${(err as Error).message}` };
  }
}
