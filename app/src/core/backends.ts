/**
 * The thin interface from PLAN.md §11 — deliberately small: a provider
 * framework is the thing this is meant to avoid.
 *
 * Every implementation must be arm's-length. Nothing here may import Immich or
 * Nextcloud code; these are HTTP clients and nothing more.
 *
 * The method list has grown past the six the plan sketched, because a control
 * that cannot act is not a control. Each addition is a thing the UI already
 * draws a button for — favourite, delete, share, add to album, download — and
 * the alternative to declaring it here was a button that lied.
 */

import type { Album, FileEntry, Photo, PhotoId, ServerStatus, TreeNode } from './types'

export interface PhotoBackend {
  list(opts: { page: number; from?: Date; to?: Date }): Promise<Photo[]>
  get(id: PhotoId): Promise<Photo>
  /**
   * The rendered thumbnail, or `null` when none is available.
   *
   * This was a synchronous URL in the first draft, which was wrong: Immich
   * authenticates with an `x-api-key` header and there is no query-parameter
   * equivalent, so an `<img src>` can never load an authenticated thumbnail.
   * Returning bytes and letting the caller make an object URL is the only
   * shape that works. Thumbnails are pre-generated server-side and never
   * resized on request (PLAN.md §11).
   */
  thumb(id: PhotoId, size: 'small' | 'large'): Promise<Blob | null>
  search(query: string): Promise<Photo[]>
  albums(): Promise<Album[]>
  albumAssets(albumId: string): Promise<Photo[]>
  /** The original file, for download — not a rendered derivative. */
  original(id: PhotoId): Promise<Blob>
  setFavourite(id: PhotoId, favourite: boolean): Promise<void>
  /** Moves to the server's trash where it has one; otherwise deletes outright. */
  remove(ids: PhotoId[]): Promise<void>
  addToAlbum(albumId: string, ids: PhotoId[]): Promise<void>
  /** A server-issued share link. Throws where the server has no such concept. */
  share(ids: PhotoId[]): Promise<string>
}

export interface FileBackend {
  list(path: string): Promise<FileEntry[]>
  tree(): Promise<TreeNode[]>
  download(path: string): Promise<Blob>
  /** Also used to rename: a move within the same collection is a rename. */
  move(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

/**
 * Status is the desktop app's primary API — restic's last run, disk space and
 * container health are not exposed by Immich or Nextcloud, so this talks to a
 * small agent on the host instead.
 */
export interface ServerBackend {
  status(): Promise<ServerStatus>
  runBackup(): Promise<void>
  restartService(name: string): Promise<void>
}

export interface Backends {
  photos: PhotoBackend
  files: FileBackend
  server: ServerBackend
}
