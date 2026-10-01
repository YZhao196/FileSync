/**
 * Turning the bytes the backends hand back into something react-native can draw.
 *
 * The backend contract returns `Blob` — deliberately, because it is what the
 * desktop has and what the shared tests assert. The desktop turns one into an
 * object URL with `URL.createObjectURL`, and **React Native has no such
 * function**. What it has is `Image` sources accepting a `data:` URI, so the
 * bytes are base64-encoded and prefixed with their content type.
 *
 * This is a real cost, not a translation: base64 inflates by about a third and
 * the whole thing lives in memory as a string. It is fine for a thumbnail and
 * it is the reason `original()` should not be routed through here for a
 * download — a full-resolution photo should be streamed to the filesystem with
 * `expo-file-system` instead. That path arrives with the thumbnail cache.
 *
 * UNVERIFIED: `FileReader` on a Blob in Hermes. React Native ships a Blob
 * implementation, but it is partial, and this is the first thing to check on a
 * device. A failure here is a blank image rather than an exception, which is
 * why the viewer falls back to the gradient instead of rendering nothing.
 */

/** `data:image/jpeg;base64,…`, or null if the bytes could not be read. */
export async function blobToDataUri(blob: Blob | null): Promise<string | null> {
  if (!blob || blob.size === 0) return null

  const type = blob.type || 'application/octet-stream'
  return `data:${type};base64,${await readAsBase64(blob)}`
}

/**
 * The raw bytes, for writing to a file.
 *
 * Preferred over the base64 path wherever the bytes are going to disk rather
 * than into an `<Image>`. Base64 inflates by a third and holds a second full
 * copy of the photo as a string, which for an original-resolution image is the
 * difference between working and running out of memory on a mid-range phone.
 */
export function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('could not read the blob'))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('could not read the blob'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      // `readAsDataURL` gives `data:<type>;base64,<payload>`; the caller already
      // has the type from the Blob, so only the payload is wanted back.
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.readAsDataURL(blob)
  })
}
