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

/**
 * The cull queue's question, in Laya's own shape: an ordered scale.
 *
 * `criteria` is the scale, best last. UNVERIFIED: Laya answers a `score`
 * question on that scale, but its documentation does not say whether the answer
 * is the level's index or an already-normalised value. This assumes the index,
 * which is what an ordered list implies. `normalizeScore` is the one place to
 * correct if the first real run produces scores that do not match the captions.
 */
const SCORE_SCALE = ['unusable', 'poor', 'fair', 'good', 'excellent']
const SCORE_ID = 'quality'

const SCORE_QUESTION = {
  [SCORE_ID]: {
    type: 'score',
    instructions:
      'How good a photograph is this description? "unusable" is blurry, dark or ' +
      'badly framed; "excellent" is clear and well composed.',
    criteria: SCORE_SCALE,
  },
}

/** One choice over the user's own album names — they are the entire criteria. */
const albumQuestion = (albums) => ({
  album: {
    type: 'choice',
    instructions: 'Which of these albums does this photograph belong in?',
    criteria: albums,
  },
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
 * An index on the criteria scale, as 0..1 so the client can render a percentage.
 *
 * UNVERIFIED, and the one genuinely uncertain line in this file: it treats the
 * answer as a scale index. A value outside the scale returns `null` rather than
 * being squeezed into range, so a units mistake shows up as photos failing to
 * score — visible — instead of a queue full of confident nonsense.
 */
function normalizeScore(raw, scaleLength) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const span = Math.max(1, scaleLength - 1)
  if (n < 0 || n > span) return null
  return n / span
}

/** The chosen label, which Laya returns under `choice`. */
function readChoice(answer) {
  if (!answer || typeof answer !== 'object') return null
  const value = answer.choice ?? answer.label ?? answer.value
  if (typeof value !== 'string') return null
  const confidence = Number(answer.confidence ?? answer.probability ?? 1)
  return { value, confidence: Number.isFinite(confidence) ? confidence : 1 }
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

  /**
   * The seam in front of Laya. The service is a pass-through over Laya's own
   * `predict`, so this sends its two arguments and reads its `answers` — there is
   * no translation here to drift out of step with the model's API.
   */
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
        const answers = await callLaya(text, SCORE_QUESTION)
        const score = answers
          ? normalizeScore(answers[SCORE_ID]?.score, SCORE_SCALE.length)
          : null
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
      const answers = await callLaya(text, albumQuestion(albums))
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
