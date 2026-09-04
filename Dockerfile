# Root Dockerfile — builds the backend/ service.
# Use this when the platform (Dokploy, etc.) builds with the repo root as context
# and Build Path cannot be changed. Context = repo root; all paths are backend/*.
#
#   docker build -t biopass-backend .
#   docker run -p 4000:4000 --env-file backend/.env biopass-backend

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Writable dirs: Baileys session, local uploads, Tesseract language cache
RUN mkdir -p /app/auth_info_baileys /app/uploads /app/.tess-cache
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm i prisma@6.19.3 --no-save
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY backend/prisma ./prisma
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
