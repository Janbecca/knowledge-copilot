FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY apps ./apps
COPY mcp-server ./mcp-server
COPY packages ./packages
COPY scripts ./scripts
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    KNOWLEDGE_COPILOT_HOST=0.0.0.0 \
    KNOWLEDGE_COPILOT_PORT=3210 \
    KNOWLEDGE_COPILOT_DB=/app/data/knowledge-copilot.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps/knowledge-panel/dist ./apps/knowledge-panel/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3210/ready || exit 1
CMD ["node", "dist/mcp-server/index.js"]
