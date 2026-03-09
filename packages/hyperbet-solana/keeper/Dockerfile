FROM oven/bun:1.3.8

WORKDIR /app

# ── Keeper deps ──
COPY keeper/package.json ./keeper/package.json
COPY keeper/bun.lock ./keeper/bun.lock
RUN cd keeper && bun install --frozen-lockfile --production

# ── Market maker bot deps ──
COPY market-maker-bot/package.json ./market-maker-bot/package.json
RUN cd market-maker-bot && bun install --production

# ── Application source ──
COPY deployments ./deployments
COPY keeper/tsconfig.json ./keeper/tsconfig.json
COPY keeper/src ./keeper/src
COPY keeper/start.sh ./keeper/start.sh
RUN chmod +x ./keeper/start.sh

COPY market-maker-bot/src ./market-maker-bot/src

WORKDIR /app/keeper

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bash", "start.sh"]
