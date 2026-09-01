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
#
# The timestamp fallback is deliberate. Forgetting the argument is the easy
# mistake and its symptom is invisible — the app deploys, looks fine, and every
# installed phone quietly keeps the old shell. A rebuild of identical code
# getting a fresh id at worst shows one unnecessary "update available" prompt,
# which is the failure worth having.
# `RAILWAY_GIT_COMMIT_SHA` is injected into the build environment, but only
# reaches the build if the ARG is declared — an undeclared one is silently
# absent, which is how a deploy ends up stamped "build-20260901…" with no way
# to tell which commit it is. Declared here so no dashboard configuration is
# needed for the common case.
ARG BUILD_ID
ARG RAILWAY_GIT_COMMIT_SHA
RUN NEXT_PUBLIC_BUILD_ID="${BUILD_ID:-${RAILWAY_GIT_COMMIT_SHA:-build-$(date -u +%Y%m%d%H%M%S)}}" \
    npm run build:app

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

# The database directory. `/data` rather than over `prisma/`, which would hide
# the migrations the entrypoint needs to read.
#
# Deliberately *not* declared with `VOLUME`. Railway's builder rejects the
# instruction outright — "docker VOLUME is not supported, use Railway Volumes"
# — and refuses to build rather than ignoring it. The declaration was never
# load-bearing anyway: it only controls whether Docker invents an anonymous
# volume when you forget `-v`, and every host worth deploying to attaches a
# named one. `docker run -v divvy-data:/data` behaves identically without it.
RUN mkdir -p /data

# Runs as root, which is a concession and worth naming as one.
#
# A managed volume is mounted root-owned, so a container that drops to an
# unprivileged user cannot create the SQLite file inside it and dies on first
# boot with a permission error that looks like a database problem. Doing this
# properly means chowning the mount at runtime and stepping down with gosu —
# more moving parts in the one place that must not fail. On a host where you
# control the mount's ownership, add `USER node` back and chown `/data` to it.
EXPOSE 3000

# No HEALTHCHECK either. Railway's builder reports only the first instruction
# it dislikes, so with VOLUME removed this would be the next candidate, and a
# platform that does its own health checking gains nothing from it.
ENTRYPOINT ["./docker-entrypoint.sh"]
