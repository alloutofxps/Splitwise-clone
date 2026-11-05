# Divvy in one container.
#
# The app is a Next.js server plus a single SQLite file, so the image needs to
# do exactly two things a plain `next start` does not: install the SQLite
# driver built for *this* platform, and apply migrations at boot rather than
# at build time.
#
# Boot, not build, because the database lives on a mounted volume that does not
# exist while the image is being made. Running `migrate deploy` in the build
# would write a schema into a layer and then throw it away, and the volume the
# container actually opens would be empty.

# --- dependencies ----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma 7's migration engine is still a native program linked against
# OpenSSL, and Prisma's system requirements list it. Python, make and g++ let
# the SQLite driver build itself when its ready-made copy can't be fetched:
# that copy comes from GitHub, and GitHub's outage on 4 November failed a
# deploy ("Could not find any Python installation to use", findings item 56).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
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

# --- backup program ---------------------------------------------------------
# Litestream 0.5.17, pinned by digest, so a changed or tampered image fails
# the build instead of shipping. The digest covers both amd64 and arm64.
FROM litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a AS litestream

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATABASE_URL=file:/data/divvy.db
# gosu: steps down from root to the `node` user after fixing the volume's
# ownership (see the entrypoint).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates gosu \
 && rm -rf /var/lib/apt/lists/*
# Litestream: streams every database change to object storage when
# LITESTREAM_REPLICA_URL is set - the off-site backup a single SQLite file on
# one disk otherwise lacks. Copied from Litestream's own image on Docker Hub,
# where the Node.js base image also comes from, rather than downloaded from
# GitHub: GitHub's outage on 4 November failed a deploy (findings item 56),
# and this was the other download that could. The program is self-contained
# (statically linked), so it runs on this Debian as it does on its own.
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

# `prisma.config.ts` says where the schema and migrations are; the CLI reads it
# both here and when the entrypoint runs `migrate deploy`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `--omit=dev`, installed here rather than copied from the build stage, so
# better-sqlite3's built-in program and the migration engine match this image.
# The build tools are there only for the driver's fallback (see the first
# stage) and leave in the same step, so the image doesn't grow.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev && npm cache clean --force \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

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
RUN mkdir -p /data && chown node:node /data

# The container starts as root only long enough for the entrypoint to give
# `/data` to the `node` user - a managed volume is mounted root-owned, so an
# unprivileged process could not create the database in it - and then runs the
# app as `node` via gosu. It used to run as root throughout, so any code
# execution bug would have had the whole container.
EXPOSE 3000

# No Dockerfile HEALTHCHECK: Railway's builder has refused unfamiliar
# instructions before. The app serves `/api/health` (which also checks the
# database), and `.railway/railway.ts` points Railway's own health check at it.
ENTRYPOINT ["./docker-entrypoint.sh"]
