FROM oven/bun:1.1-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.1-slim
WORKDIR /app

# Copy app dependencies and source
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Install vendor/bird dependencies
RUN cd /app/vendor/bird && bun install

# Create bird wrapper
RUN mkdir -p /app/bin && echo '#!/bin/sh\nbun run /app/vendor/bird/src/cli.ts "$@"' > /app/bin/bird && chmod +x /app/bin/bird

RUN mkdir -p /app/data

ENV BIRD_CMD="/app/bin/bird"

CMD ["bun", "run", "src/index.ts"]
