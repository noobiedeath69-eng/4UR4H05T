import { db } from "@workspace/db";
import { loreDocumentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const INITIAL_DOCS = [
  {
    name: "Lambda-13 Restricted Lore Document",
    url: "https://docs.google.com/document/d/1GwFkLzcEsmPJ4fBebb33Lpd4iHnSchZW9NKsSOObJ_c/export?format=txt",
  },
];

let cachedLore: string | null = null;

export function extractDocId(input: string): string | null {
  const match = input.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return match ? match[1]! : null;
}

export function toExportUrl(rawUrl: string): string {
  const docId = extractDocId(rawUrl);
  if (docId) {
    return `https://docs.google.com/document/d/${docId}/export?format=txt`;
  }
  if (rawUrl.includes("export?format=txt")) return rawUrl;
  return rawUrl;
}

async function fetchDocContent(exportUrl: string): Promise<string> {
  const res = await fetch(exportUrl);
  if (!res.ok) throw new Error(`Failed to fetch lore doc: HTTP ${res.status}`);
  const text = await res.text();
  return text.trim().replace(/\n{4,}/g, "\n\n");
}

export async function seedInitialLore(): Promise<void> {
  for (const doc of INITIAL_DOCS) {
    const existing = await db
      .select()
      .from(loreDocumentsTable)
      .where(eq(loreDocumentsTable.url, doc.url))
      .limit(1);

    if (existing.length === 0) {
      console.log(`[LORE] Seeding initial document: ${doc.name}`);
      try {
        const content = await fetchDocContent(doc.url);
        await db.insert(loreDocumentsTable).values({
          name: doc.name,
          url: doc.url,
          content,
          lastFetched: new Date(),
        });
        console.log(`[LORE] Seeded: ${doc.name}`);
      } catch (err) {
        console.error(`[LORE] Failed to seed ${doc.name}:`, err);
      }
    }
  }
  await reloadLoreCache();
}

export async function reloadLoreCache(): Promise<void> {
  const docs = await db.select().from(loreDocumentsTable);
  if (docs.length === 0) {
    cachedLore = null;
    return;
  }
  cachedLore = docs
    .map((d) => `=== CLASSIFIED DOCUMENT: ${d.name.toUpperCase()} ===\n${d.content}`)
    .join("\n\n---\n\n");
}

export function getLoreContext(): string | null {
  return cachedLore;
}

export async function upsertLoreDocument(name: string, rawUrl: string): Promise<string> {
  const exportUrl = toExportUrl(rawUrl);
  const content = await fetchDocContent(exportUrl);

  await db
    .insert(loreDocumentsTable)
    .values({ name, url: exportUrl, content, lastFetched: new Date() })
    .onConflictDoUpdate({
      target: loreDocumentsTable.url,
      set: { name, content, lastFetched: new Date() },
    });

  await reloadLoreCache();
  return content;
}

export async function refreshAllLore(): Promise<{ name: string; ok: boolean; error?: string }[]> {
  const docs = await db.select().from(loreDocumentsTable);
  const results: { name: string; ok: boolean; error?: string }[] = [];

  for (const doc of docs) {
    try {
      const content = await fetchDocContent(doc.url);
      await db
        .update(loreDocumentsTable)
        .set({ content, lastFetched: new Date() })
        .where(eq(loreDocumentsTable.id, doc.id));
      results.push({ name: doc.name, ok: true });
    } catch (err) {
      results.push({ name: doc.name, ok: false, error: String(err) });
    }
  }

  await reloadLoreCache();
  return results;
}

export async function listLoreDocs(): Promise<{ id: number; name: string; url: string; lastFetched: Date }[]> {
  const docs = await db.select().from(loreDocumentsTable);
  return docs.map((d) => ({ id: d.id, name: d.name, url: d.url, lastFetched: d.lastFetched }));
}

export async function deleteLoreDocumentById(id: number): Promise<boolean> {
  const result = await db
    .delete(loreDocumentsTable)
    .where(eq(loreDocumentsTable.id, id))
    .returning();

  await reloadLoreCache();
  return result.length > 0;
}

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function startAutoRefresh(): void {
  setInterval(async () => {
    console.log("[LORE] Auto-refreshing lore documents...");
    const results = await refreshAllLore().catch((err) => {
      console.error("[LORE] Auto-refresh failed:", err);
      return [];
    });
    for (const r of results) {
      if (r.ok) {
        console.log(`[LORE] Auto-refreshed: ${r.name}`);
      } else {
        console.error(`[LORE] Auto-refresh failed for ${r.name}: ${r.error}`);
      }
    }
  }, AUTO_REFRESH_INTERVAL_MS);
  console.log(`[LORE] Auto-refresh scheduled every ${AUTO_REFRESH_INTERVAL_MS / 60000} minutes.`);
}
