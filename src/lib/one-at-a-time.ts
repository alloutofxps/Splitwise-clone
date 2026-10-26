import type { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

type Adapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;
type Transaction = Awaited<ReturnType<Adapter["startTransaction"]>>;

/**
 * Makes the SQLite driver take one thing at a time: a query, or a whole
 * transaction from BEGIN to COMMIT.
 *
 * The driver has a single connection and queues transactions behind each
 * other, but not plain queries. A save from one request could therefore run
 * on the connection while another request's transaction was open, inside that
 * transaction: if it then rolled back, the save was silently lost. Prisma 6
 * never did this, because its pool of one connection made everything wait its
 * turn. This restores that.
 *
 * Queries inside a transaction go straight through; they already hold the turn.
 */
export function oneAtATime(adapter: Adapter): Adapter {
  let last: Promise<void> = Promise.resolve();

  /** Waits for the turn, and resolves with the function that gives it back. */
  function turn(): Promise<() => void> {
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const ready = last.then(() => release);
    last = last.then(() => done);
    return ready;
  }

  async function alone<T>(work: () => Promise<T>): Promise<T> {
    const release = await turn();
    try {
      return await work();
    } finally {
      release();
    }
  }

  return {
    provider: adapter.provider,
    adapterName: adapter.adapterName,
    queryRaw: (query) => alone(() => adapter.queryRaw(query)),
    executeRaw: (query) => alone(() => adapter.executeRaw(query)),
    executeScript: (script) => alone(() => adapter.executeScript(script)),
    getConnectionInfo: adapter.getConnectionInfo?.bind(adapter),
    dispose: () => adapter.dispose(),

    async startTransaction(isolationLevel) {
      const release = await turn();
      let tx: Transaction;
      try {
        tx = await adapter.startTransaction(isolationLevel);
      } catch (error) {
        release();
        throw error;
      }
      // Given back once, whichever way the transaction ends.
      let ended = false;
      const end = async (finish: () => Promise<void>) => {
        try {
          await finish();
        } finally {
          if (!ended) {
            ended = true;
            release();
          }
        }
      };
      return {
        provider: tx.provider,
        adapterName: tx.adapterName,
        options: tx.options,
        queryRaw: (query) => tx.queryRaw(query),
        executeRaw: (query) => tx.executeRaw(query),
        commit: () => end(() => tx.commit()),
        rollback: () => end(() => tx.rollback()),
        createSavepoint: tx.createSavepoint?.bind(tx),
        rollbackToSavepoint: tx.rollbackToSavepoint?.bind(tx),
        releaseSavepoint: tx.releaseSavepoint?.bind(tx),
      };
    },
  };
}
