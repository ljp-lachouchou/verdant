interface MockStatement {
  run: (...args: unknown[]) => { changes: number }
  get: (...args: unknown[]) => unknown
  all: (...args: unknown[]) => unknown[]
}

export class MockDatabase {
  private data: Map<string, unknown[]> = new Map()

  prepare(_sql: string): MockStatement {
    return {
      run: (..._args: unknown[]) => ({ changes: 1 }),
      get: (..._args: unknown[]) => undefined,
      all: (..._args: unknown[]) => []
    }
  }

  exec() {}
  pragma() {}
  transaction<T>(fn: () => T): T { return fn() }
  backup() { return Promise.resolve() }
  close() {}
}

export default MockDatabase
