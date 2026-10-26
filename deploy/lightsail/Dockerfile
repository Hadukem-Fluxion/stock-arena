FROM node:24.19.0-bookworm-slim

WORKDIR /app
ENV PNPM_HOME=/usr/local/share/pnpm
ENV COREPACK_HOME=/usr/local/share/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# The context excludes local env files, private question banks and credentials.
COPY . .
ARG TYPECHECK_HEAP_MB=512
RUN pnpm install --frozen-lockfile \
    && pnpm verify:node \
    && NODE_OPTIONS="--max-old-space-size=${TYPECHECK_HEAP_MB} --max-semi-space-size=4" pnpm --filter @stock-arena/api typecheck:production \
    && NODE_OPTIONS="--max-old-space-size=${TYPECHECK_HEAP_MB} --max-semi-space-size=4" pnpm --filter @stock-arena/worker typecheck:production

# Tests may mount an isolated local database; production requires DATABASE_URL.
RUN mkdir -p packages/db/.local && chown node:node packages/db/.local
USER node
ENV NODE_ENV=production
ENV TSX_DISABLE_CACHE=1
ENTRYPOINT ["sh", "/app/deploy/lightsail/entrypoint.sh"]
CMD ["api"]
