FROM node:20-alpine

# restic for backup state, docker CLI to read container health over the host socket
RUN apk add --no-cache restic docker-cli

WORKDIR /app
# Every module, not just the entry point — the agent grew a caption store and a
# decision client, and a COPY of one file would fail at import time.
COPY *.mjs ./

EXPOSE 8787

# Runs as root deliberately. The mounted docker socket is already equivalent to
# root on the host, so dropping to an unprivileged user buys nothing without a
# socket proxy in front of it. Add one if this ever faces an untrusted network.
CMD ["node", "agent.mjs"]
