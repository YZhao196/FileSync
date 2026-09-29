/** Domain types shared by every backend and screen. */

/**
 * A photo's identity is its backend's own id, opaque and carried through
 * unchanged. Immich uses UUIDs and Nextcloud uses paths, so this is a string.
 *
 * It was an `int` in the first draft, which hashed Immich's UUID to a number.
 * That made the UI's keys tidy and every mutation impossible: favouriting,
 * downloading or deleting needs the real id, and a hash cannot be turned back
 * into one. The hash is gone; the id travels verbatim.
 */
export type PhotoId = string

/** Placeholder gradient, used until real thumbnails arrive. */
export type Gradient = [string, string]

export interface Photo {
  id: PhotoId
  name: string
  /** Sticky-header bucket, e.g. "Today" or "September 2026". */
  dateGroup: string
  takenAt: string | null
  isVideo: boolean
  isFavourite: boolean
  gradient: Gradient
}

export interface Album {
  id: string
  name: string
  count: number
  gradient: Gradient
}

/**
 * One page of the timeline.
 *
 * `hasMore` is here because neither backend will tell the client how large the
 * library is in a way worth trusting, and the client should not guess: a full
 * page means there may be more, a short one means there is not. The obvious
 * alternative — trusting Immich's `nextPage` field — is a wire-format guess,
 * whereas "the page came back full" holds for any paging scheme.
 *
 * Without this the timeline could only ever show the first page, which is
 * exactly what it used to do.
 */
export interface PhotoPage {
  photos: Photo[]
  hasMore: boolean
}

export interface TreeNode {
  id: string
  name: string
  path: string
  isFolder: boolean
  children?: TreeNode[]
}

export interface FileEntry {
  name: string
  path: string
  isFolder: boolean
  sizeLabel: string
  sizeBytes: number
  typeLabel: string
  modifiedLabel: string
  /** MIME type as reported by the server; drives which preview to offer. */
  mime?: string
  /** True for formats the app can render inline (images and plain text). */
  previewable?: boolean
}

export type ServiceState = 'running' | 'stopped' | 'starting'

export interface ServiceStatus {
  name: string
  state: ServiceState
}

export interface DriveUsage {
  label: string
  usedBytes: number
  totalBytes: number
}

export interface BackupStatus {
  lastRunAt: string | null
  lastRunOk: boolean
  nextRunAt: string
  snapshotCount: number
  cloudTotalBytes: number
}

export interface NetworkStatus {
  tailscaleConnected: boolean
  deviceName: string
  tailscaleIp: string
}

export interface ServerStatus {
  reachable: boolean
  services: ServiceStatus[]
  drives: DriveUsage[]
  backup: BackupStatus
  network: NetworkStatus
  uptimeSeconds: number
  lastBootAt: string
}

/** How the user reaches the server. Persisted to disk, so it holds no secrets. */
export interface Connection {
  address: string
  immichUrl: string | null
  nextcloudUrl: string | null
  /** The host agent that reports restic/disk/container state. See for-human.md. */
  agentUrl: string | null
}

/** Secrets live in the OS keychain, never in the persisted connection. */
export interface Credentials {
  immichApiKey: string
  nextcloudUser: string
  nextcloudAppPassword: string
  agentToken: string
}

export type BackendName = 'photos' | 'files' | 'agent'

export interface TestResult {
  photos: ProbeResult
  files: ProbeResult
  agent: ProbeResult
  overall: ConnectionState
  message: string
}

export type ProbeResult = 'ok' | 'unreachable' | 'auth-failed' | 'skipped'

export type ConnectionState = 'unconfigured' | 'testing' | 'healthy' | 'unreachable' | 'auth-failed'

/** Which surface renders a module: the app's own UI, or the OS. */
export type ModuleMode = 'choose' | 'inapp' | 'native'

/* ── Provisioning ───────────────────────────────────────────────────────── */

/**
 * A machine's fitness to become the server, checked before anything is written.
 *
 * This is a spectrum rather than a wall (PLAN.md §11): the hard requirement is
 * a Linux environment running Docker, because Immich and Nextcloud are Linux
 * containers. `blockers` holds the reasons it cannot host at all; `warnings`
 * holds the things worth knowing that do not stop it.
 */
export interface Preflight {
  ok: boolean
  platform: string
  isLinux: boolean
  hasDocker: boolean
  hasCompose: boolean
  isRoot: boolean
  dockerVersion: string | null
  composeVersion: string | null
  /** Free space per candidate drive, so folder choices can be sanity-checked. */
  volumes: Array<{ mount: string; freeBytes: number; totalBytes: number }>
  blockers: string[]
  warnings: string[]
}

/** One line of provisioning progress, streamed from the runner. */
export interface ProvisionEvent {
  step: string
  state: 'start' | 'ok' | 'skipped' | 'failed'
  detail?: string
}

/* ── Decision pipeline ─────────────────────────────────────────────────── */

/**
 * The optional local caption-and-decide pipeline, served by the host agent.
 *
 * It is an option rather than a capability everything depends on, so it is off
 * until the user turns it on: Immich's own ML container already covers semantic
 * search, and a second model doing the same work on the same machine is the
 * duplication the project cuts. See for-human.md.
 */
export type VisionState = 'ok' | 'model-missing' | 'unavailable'

export interface DecisionStatus {
  /** False when the agent has no Immich credentials, so it cannot fetch pixels. */
  available: boolean
  vision: VisionState
  decision: 'ok' | 'unavailable'
  /** The vision model in use, so the UI can name it rather than say "the model". */
  model: string
  /** Captions already on disk, so the cost of a re-run is visible. */
  captioned: number
  reason?: string
}

export interface PhotoScore {
  id: PhotoId
  /** 0..1; lower is weaker, so a cull queue orders ascending. */
  score: number
  caption: string
}

export interface ScoreResult {
  /** False when the pipeline is unavailable at all — not a per-photo failure. */
  ok: boolean
  scores: PhotoScore[]
  /** Requested ids still unscored after this call, excluding those in `failed`. */
  pending: number
  /** Per-photo failures. One slow image must not sink a whole batch. */
  failed: Array<{ id: PhotoId; reason: string }>
  reason?: string
}

export interface AlbumSuggestion {
  id: PhotoId
  album: string
  confidence: number
}
