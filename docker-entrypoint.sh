#!/bin/sh
set -e

# Fail here, loudly, rather than at the first request.
#
# `identity.ts` throws when DIVVY_SECRET is missing in production, which means
# a container started without one boots fine, serves a page, and 500s the
# moment anybody signs in. Checking at startup turns that into a message the
# person deploying will actually read.
if [ -z "$DIVVY_SECRET" ] || [ ${#DIVVY_SECRET} -lt 16 ]; then
  echo "DIVVY_SECRET is missing or shorter than 16 characters." >&2
  echo "It signs identity cookies; losing or changing it signs everybody out." >&2
  echo "Generate one with:  openssl rand -hex 32" >&2
  exit 1
fi

# Applied on every boot, not just the first. `migrate deploy` is a no-op when
# there is nothing pending, so a redeploy that adds a migration picks it up
# without anybody remembering to run a release step.
echo "Applying migrations to $DATABASE_URL"
./node_modules/.bin/prisma migrate deploy

exec ./node_modules/.bin/next start --port "${PORT:-3000}" --hostname 0.0.0.0
