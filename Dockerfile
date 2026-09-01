# Divvy in one container.
#
# The app is a Next.js server plus a single SQLite file, so the image needs to
# do exactly two things a plain `next start` does not: generate a Prisma client
# for *this* platform, and apply migrations at boot rather than at build time.
#
# Boot, not build, because the database lives on a mounted volume that does not
# exist while the image is being made. Running `migrate deploy` in the build
# would write a schema into a layer and then throw it away, and the volume the
# container actually opens would be empty.

# --- dependencies ----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma's engines are linked against OpenSSL; without it `prisma generate`
# picks the wrong binary target and the failure only shows up at query time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- build -----------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The service worker names its caches after this and registers itself as
# `/sw.js?v=<id>`. A build without it falls back to the package version, which
# never changes — so every deploy would look identical to a phone that already
# has the app installed, and it would go on serving last week's shell. Hosts
# that know their own commit should pass it: Railway sets RAILWAY_GIT_COMMIT_SHA,
# Fly sets FLY_MACHINE_VERSION, GitHub Actions sets GITHUB_SHA.
ARG BUILD_ID
ENV NEXT_PUBLIC_BUILD_ID=${BUILD_ID}
RUN npm run build:app

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATABASE_URL=file:/data/divvy.db
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
# `--omit=dev` and then the postinstall regenerates the client here, so the
# engine matches this image rather than whatever built it.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY next.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# The volume goes here rather than over `prisma/`, which would hide the
# migrations the entrypoint needs to read.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
