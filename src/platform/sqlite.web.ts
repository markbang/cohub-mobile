/**
 * The browser keeps no local cache: expo-sqlite's web build needs cross-origin isolation, which an App page
 * cannot ask for. Every read misses and every write is dropped, so the app loads from the server as on a
 * first launch.
 */
type Row = Record<string, unknown>;

const statement = { executeAsync: async () => ({ changes: 0, lastInsertRowId: 0 }), finalizeAsync: async () => undefined };

const database = {
  execAsync: async () => undefined,
  runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
  getAllAsync: async <T = Row>(): Promise<T[]> => [],
  getFirstAsync: async <T = Row>(): Promise<T | null> => null,
  prepareAsync: async () => statement,
  withTransactionAsync: async (task: () => Promise<void>) => task(),
};

export type SQLiteDatabase = typeof database;

export async function openDatabaseAsync(_name: string): Promise<SQLiteDatabase> {
  return database;
}
