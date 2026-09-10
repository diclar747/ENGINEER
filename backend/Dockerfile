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
# `exec` reemplaza el shell por node → node queda como PID 1 y RECIBE el SIGTERM
# del redeploy (así cierra ya la sesión de WhatsApp y no se solapa con el nuevo
# contenedor). Sin `exec`, sh no le pasa la señal y node muere por SIGKILL a los 10s.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
