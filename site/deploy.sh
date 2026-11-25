#!/bin/sh
# Builds the landing page and deploys it to Vercel (production). Needs the Vercel CLI, logged in.
# First time: cd site && vercel link --project flaglens   (writes site/.vercel/project.json, git-ignored)
set -e
cd "$(dirname "$0")"
npm run build
[ -f .vercel/project.json ] || { echo "Link the project first: vercel link --project flaglens"; exit 1; }
# Deploy dist/ to the linked project without linking dist/ itself (no .env files are written into the upload).
VERCEL_ORG_ID=$(node -p "require('./.vercel/project.json').orgId")
VERCEL_PROJECT_ID=$(node -p "require('./.vercel/project.json').projectId")
export VERCEL_ORG_ID VERCEL_PROJECT_ID
vercel deploy dist --prod --yes
