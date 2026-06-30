import type { Resource, Snapshot, Capability, SnapshotContext } from './types'

export class ResourceRegistry {
  private resources = new Map<string, Resource>()

  register(resource: Resource): void {
    this.resources.set(resource.id(), resource)
  }

  unregister(id: string): void {
    this.resources.delete(id)
  }

  get(id: string): Resource | undefined {
    return this.resources.get(id)
  }

  find(capability: Capability): Resource[] {
    return Array.from(this.resources.values()).filter(r =>
      r.capabilities().includes(capability)
    )
  }

  list(): Resource[] {
    return Array.from(this.resources.values())
  }

  async snapshot(
    capabilities?: Capability[],
    ctx?: SnapshotContext
  ): Promise<Snapshot[]> {
    const targets = capabilities
      ? this.list().filter(r =>
          r.capabilities().some(c => capabilities.includes(c))
        )
      : this.list()

    const snapshots = await Promise.allSettled(
      targets.map(r => r.snapshot(ctx))
    )

    const results: Snapshot[] = []
    for (const result of snapshots) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
      }
    }
    return results
  }

  clear(): void {
    this.resources.clear()
  }
}
