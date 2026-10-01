# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim

WORKDIR /app

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Keep dependency installation cacheable. The root lockfile contains every
# workspace, so their manifests are present even though only bridge runtime
# source is copied into the final image.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/bridge/package.json ./apps/bridge/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/provider-control/package.json ./packages/provider-control/package.json
COPY packages/tinyfish/package.json ./packages/tinyfish/package.json

RUN npm ci --include=dev

COPY apps/bridge ./apps/bridge
COPY packages/contracts ./packages/contracts
COPY packages/provider-control ./packages/provider-control
COPY packages/tinyfish ./packages/tinyfish

RUN mkdir -p /data && chown -R node:node /data

ENV NODE_ENV=production \
    COURSESIGNAL_HEALTH_HOST=0.0.0.0 \
    COURSESIGNAL_HEALTH_PORT=8787 \
    COURSESIGNAL_STATE_PATH=/data/bridge-state.json

EXPOSE 8787
VOLUME ["/data"]
STOPSIGNAL SIGTERM

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.COURSESIGNAL_HEALTH_PORT||process.env.PORT||'8787')+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "imessage", "--workspace", "@coursesignal/bridge"]
