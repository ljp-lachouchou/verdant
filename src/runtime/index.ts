export { GoalManager } from './goal/manager'
export type { Goal, GoalStatus, GoalUpdate } from './goal/types'

export { ResourceRegistry } from './resource/registry'
export type {
  Resource,
  Snapshot,
  SnapshotArtifact,
  SnapshotContext,
  Capability,
  ArtifactType,
  ResourceInitOptions
} from './resource/types'

export { FilesystemResource } from './resource/filesystem'
export { TerminalResource } from './resource/terminal'
export type { TerminalSession } from './resource/terminal'
export { MemoryResource } from './resource/memory'
export type { MemoryEntry } from './resource/memory'
export { ToolsResource } from './resource/tools'
export { VisionResource } from './resource/vision'
export type { ImageEvaluation } from './resource/vision'
export { VisionDescriber } from './resource/vision/describer'
export type { ImageDescription } from './resource/vision/describer'
export { OllamaVisionProvider } from './resource/vision/ollama-provider'
export type { OllamaConfig } from './resource/vision/ollama-provider'
export { RemoteVisionProvider } from './resource/vision/remote-provider'
export type { RemoteVisionConfig } from './resource/vision/remote-provider'
export type { VisionProvider } from './resource/vision/provider'

export { ObservationBuilder } from './observation/builder'
export type { Observation, ResourceChange } from './observation/types'
export { formatObservation } from './observation/types'

export { NormalizerRegistry } from './normalizer/registry'
export { VisionNormalizer } from './normalizer/vision-normalizer'
export { CompileNormalizer } from './normalizer/compile-normalizer'
export type { Normalizer, NormalizedResult } from './normalizer/types'
export { formatNormalized } from './normalizer/types'

export { StateProjector } from './projector/projector'
export type { ProjectorOptions } from './projector/projector'
export { CapabilitySelector } from './projector/selector'
export { ExecutionHistory } from './projector/context'
export type { RuntimeContext, ExecutionRecord, ExecutionToolCall } from './projector/context'
export { ContextFormatter } from './projector/formatter'
export type { UserInputImage } from './projector/formatter'

export { ExecutorManager } from './executor/manager'
export type { ExecutorResult, ExecutorHooks } from './executor/manager'

export { RuntimeLoop } from './loop/runtime-loop'
export type { RuntimeLoopCallbacks, RuntimeLoopConfig } from './loop/runtime-loop'
