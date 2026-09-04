# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Writable dirs: Baileys session, local uploads, Tesseract language cache
RUN mkdir -p /app/auth_info_baileys /app/uploads /app/.tess-cache
COPY package*.json ./
# keep prisma (for `migrate deploy` at container start) + prod deps
RUN npm ci --omit=dev && npm i prisma@6.19.3 --no-save
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
