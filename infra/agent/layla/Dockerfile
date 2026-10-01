# Laya — the decision model behind the optional pipeline's scoring and routing.
#
# UNVERIFIED: never built or run. See filesynapsetodo.md §8.
#
# This image is large — `laya` pulls torch, and the multilingual checkpoint is
# another couple of gigabytes on first use — which is the whole reason it is
# behind the `decisions` profile and not part of a normal install.
FROM python:3.11-slim

# CPU wheels only. This box has no GPU, and the default torch wheel would drag in
# several gigabytes of CUDA runtime it can never use.
ENV PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models

RUN pip install --no-cache-dir laya fastapi "uvicorn[standard]"

WORKDIR /app
COPY server.py .

# Where the checkpoints land. A named volume in compose, so a rebuild does not
# re-download them.
VOLUME ["/models"]

EXPOSE 8080

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
