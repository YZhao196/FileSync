/**
 * The optional decision pipeline: describe a photo, then answer typed questions
 * about the description.
 *
 * Two external services, both reached over HTTP and both optional. Nothing is
 * vendored or linked in either direction, so the arm's-length boundary holds
 * (PLAN.md §13.4) exactly as it does with Immich and Nextcloud.
 *
 * The rule from `agent.mjs` carries over unchanged: every step degrades on its
 * own. A model that is missing, stopped or still downloading reads as
 * "unavailable" and the caller gets an honest sentence — never a 500.
 *
 * UNVERIFIED: none of this has run against a real Ollama or a real Laya. See
 * README.md for what to check and `callLaya`'s contract for the one seam that
 * has to change if Laya's serving story turns out to differ.
 */

const CAPTION_TIMEOUT_MS = 90000
const DECISION_TIMEOUT_MS = 20000
const PROBE_TIMEOUT_MS = 4000

/**
 * What the vision model is asked for. Deliberately a description and not an
 * opinion: the model says what is in the frame, the decision model judges it.
 * Asking one model for both would make a bad result unattributable, and the
 * cull queue's whole honesty problem is that those are different questions.
 */
const CAPTION_PROMPT =
  'Describe this photograph factually in one sentence: the subject, the setting, ' +
  'the lighting, and whether it is sharp or blurry. Do not speculate about people.'

const SCORE_QUESTION = {
  id: 'quality',
  primitive: 'score',
  prompt:
    'How good a photograph is this description? 0 is unusable — blurry, dark or ' +
    'badly framed. 1 is a clear, well-framed photograph.',
}

const ALBUM_QUESTION = (options) => ({
  id: 'album',
  primitive: 'choice',
  prompt: 'Which of these albums does this photograph belong in?',
  options,
})

async function getJson(url, timeoutMs, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, body: await res.json().catch(() => null) }
  } catch {
    return { ok: false, status: 0 }
  }
}

async function postJson(url, payload, timeoutMs) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, body: await res.json().catch(() => null) }
  } catch {
    return { ok: false, status: 0 }
  }
}

function describeError(err) {
  return err?.name === 'TimeoutError' ? 'the vision model timed out' : 'could not be scored'
}

/**
 * UNVERIFIED: the scale Laya's `score` primitive answers on is not stated in
 * units anywhere in its documentation. The contract assumed here is 0..1, and a
 * larger answer is rescaled on the assumption it is a 0..10 ordinal or a
 * percentage. Correcting this is a one-line change once a real server exists.
 */
function normalizeScore(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n <= 1) return Math.max(0, n)
  if (n <= 10) return Math.min(1, n / 10)
  return Math.min(1, n / 100)
}

/**
 * UNVERIFIED: the same appetite for Laya's `choice` answer shape. A conforming
 * server replies with a bare label; the object forms are accepted because much
 * of Laya's own documentation wraps a label with a confidence. Guessing wrong
 * matters: dropping every suggestion is visible, whereas a thrown error here
 * would read as the whole feature being broken.
 */
function readChoice(answer) {
  if (typeof answer === 'string') return { value: answer, confidence: 1 }
  if (answer && typeof answer === 'object') {
    const value = answer.value ?? answer.choice ?? answer.label ?? answer.option
    if (typeof value !== 'string') return null
    const confidence = Number(answer.confidence ?? answer.probability ?? 1)
    return { value, confidence: Number.isFinite(confidence) ? confidence : 1 }
  }
  return null
}

export function createDecisions({
  ollamaUrl,
  laylaUrl,
  immichUrl,
  immichApiKey,
  model,
  captions,
  batch = 8,
}) {
  const immichConfigured = Boolean(immichUrl && immichApiKey)

  async function visionState() {
    if (!ollamaUrl) return 'unavailable'
    const res = await getJson(`${ollamaUrl}/api/tags`, PROBE_TIMEOUT_MS)
    if (!res.ok) return 'unavailable'
    const names = (res.body?.models ?? []).map((m) => String(m?.name ?? ''))
    // Ollama reports `moondream:latest`, so a bare equality check would call a
    // pulled model missing and send the user to install it twice.
    return names.some((n) => n === model || n.startsWith(`${model}:`)) ? 'ok' : 'model-missing'
  }

  async function decisionState() {
    if (!laylaUrl) return 'unavailable'
    return (await getJson(`${laylaUrl}/health`, PROBE_TIMEOUT_MS)).ok ? 'ok' : 'unavailable'
  }

  async function fetchOriginalBase64(id) {
    try {
      const res = await fetch(`${immichUrl}/api/assets/${encodeURIComponent(id)}/original`, {
        headers: { 'x-api-key': immichApiKey },
        signal: AbortSignal.timeout(CAPTION_TIMEOUT_MS),
      })
      if (!res.ok) return null
      return Buffer.from(await res.arrayBuffer()).toString('base64')
    } catch {
      return null
    }
  }

  async function describe(image) {
    const res = await postJson(
      `${ollamaUrl}/api/generate`,
      { model, prompt: CAPTION_PROMPT, images: [image], stream: false, options: { temperature: 0 } },
      CAPTION_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const text = String(res.body?.response ?? '').trim()
    return text || null
  }

  /**
   * A cached caption, or a fresh one. `null` means the photo could not be read
   * at all — distinct from a caption the decision model then failed to score.
   */
  async function captionFor(id) {
    const cached = await captions.get(id)
    if (cached) return cached
    const image = await fetchOriginalBase64(id)
    if (!image) return null
    const text = await describe(image)
    if (!text) return null
    await captions.set(id, text)
    return text
  }

  /** The one seam in front of however Laya is served. Everything else is ours. */
  async function callLaya(state, questions) {
    if (!laylaUrl) return null
    const res = await postJson(`${laylaUrl}/decide`, { state, questions }, DECISION_TIMEOUT_MS)
    if (!res.ok) return null
    const answers = res.body?.answers
    return answers && typeof answers === 'object' ? answers : null
  }

  async function status() {
    const captioned = await captions.size()
    if (!immichConfigured) {
      return {
        available: false,
        vision: 'unavailable',
        decision: 'unavailable',
        model,
        captioned,
        reason: 'Immich is not configured for the agent',
      }
    }
    const [vision, decision] = await Promise.all([visionState(), decisionState()])
    return { available: true, vision, decision, model, captioned }
  }

  async function scoreIds(ids) {
    if (!immichConfigured) {
      return { ok: false, reason: 'Immich is not configured for the agent' }
    }
    if (!ollamaUrl) {
      return { ok: false, reason: 'the vision model is not configured' }
    }

    const slice = ids.slice(0, Math.max(1, batch))
    const scores = []
    const failed = []

    // Sequential on purpose. This machine already runs Immich's own ML
    // container, and parallel captioning is how a second model takes it down.
    // One at a time, scored as an idle-time batch rather than a big-bang scan.
    for (const id of slice) {
      try {
        const text = await captionFor(id)
        if (!text) {
          failed.push({ id, reason: 'the photo could not be read' })
          continue
        }
        const answers = await callLaya(text, [SCORE_QUESTION])
        const score = answers ? normalizeScore(answers[SCORE_QUESTION.id]) : null
        if (score === null) {
          // The caption is kept regardless: a retry once the decision model is
          // up then costs nothing for the half that was expensive.
          failed.push({ id, reason: 'the decision model gave no answer' })
          continue
        }
        scores.push({ id, score, caption: text })
      } catch (err) {
        failed.push({ id, reason: describeError(err) })
      }
    }

    return { ok: true, scores, pending: Math.max(0, ids.length - slice.length), failed }
  }

  async function suggestAlbums(ids, albums) {
    if (!albums.length) return { ok: true, suggestions: [] }
    if (!immichConfigured) return { ok: false, reason: 'Immich is not configured for the agent' }
    if (!ollamaUrl) return { ok: false, reason: 'the vision model is not configured' }

    const slice = ids.slice(0, Math.max(1, batch))
    const suggestions = []

    for (const id of slice) {
      const text = await captionFor(id)
      if (!text) continue
      const answers = await callLaya(text, [ALBUM_QUESTION(albums)])
      const picked = answers ? readChoice(answers.album) : null
      // A label the user has no album for is not a suggestion, whatever the
      // model thought — the picker has nothing to render for it.
      if (picked && albums.includes(picked.value)) {
        suggestions.push({ id, album: picked.value, confidence: picked.confidence })
      }
    }

    return { ok: true, suggestions }
  }

  return {
    status,
    scoreIds,
    suggestAlbums,
    clearCache: () => captions.clear(),
    /** Exposed for the status route so a probe can be forced. */
    visionState,
    decisionState,
  }
}
