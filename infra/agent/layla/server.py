"""
Laya over HTTP.

Deliberately a pass-through: `POST /decide` takes exactly what `laya`'s own
`predict` takes and returns exactly what it returns. There is no translation
layer here to get wrong, and nothing to keep in step when Laya's API moves.

    POST /decide
    { "state": "<text to decide about>",
      "questions": { "<id>": { "type": "choice" | "score" | "noul",
                               "instructions": "...",
                               "criteria": ... } } }
    -> { "answers": { "<id>": { "choice" | "score" | "noul": ... } } }

UNVERIFIED: written from Laya's documented Python interface. It has never been
run — see for-human.md. If it is wrong about the interface, this file and
`callLaya` in decisions.mjs are the only two places that need to change.
"""

import os
from contextlib import asynccontextmanager

import laya
from fastapi import FastAPI
from pydantic import BaseModel

CHECKPOINT = os.environ.get("LAYLA_CHECKPOINT", "convaiinnovations/laya-multilingual")

# Loaded once, on first use, and kept for the process's life. Lazily because the
# checkpoints are gigabytes and a service that refuses to start until they are
# resident cannot report why it is unhappy.
_agent = None


def get_agent():
    global _agent
    if _agent is None:
        _agent = laya.load(CHECKPOINT)
    return _agent


@asynccontextmanager
async def lifespan(_app):
    # Loading up front rather than on the first request: the healthcheck then
    # means "able to answer", not merely "the process is up". A container that
    # accepts a decision request it cannot serve is worse than one that is not
    # yet ready.
    get_agent()
    yield


app = FastAPI(title="FileSynapse Laya service", lifespan=lifespan)


class DecideRequest(BaseModel):
    state: dict | str
    questions: dict


@app.get("/health")
def health():
    return {"ok": _agent is not None, "checkpoint": CHECKPOINT}


@app.post("/decide")
def decide(req: DecideRequest):
    result = get_agent().predict(req.state, req.questions)
    return {"answers": result["answers"]}
