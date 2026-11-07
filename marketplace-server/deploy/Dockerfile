# One image for both roles. The command picks the role:
#   master:  node master/server.ts   (default)
#   mirror:  node mirror/server.ts
# Build from marketplace-server/:  docker build -f deploy/Dockerfile -t aipg-marketplace .
FROM node:24.11.1-slim

WORKDIR /app
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    MASTER_DATA_DIR=/data \
    MIRROR_DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY shared ./shared
COPY lib ./lib
COPY master ./master
COPY mirror ./mirror
COPY cli ./cli

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MIRROR_ID?process.env.MIRROR_PORT||8090:process.env.MASTER_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "master/server.ts"]
