# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# API is same-origin (nginx proxies /api) in the container image
ENV VITE_API_BASE_URL=/api
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
# The nginx image renders /etc/nginx/templates/*.template with envsubst at startup,
# substituting only defined env vars (so nginx's own $host/$uri/... are left intact).
COPY nginx.conf /etc/nginx/templates/default.conf.template
# Default for `docker compose` (service is named "backend"); override on Dokploy with
# BACKEND_ORIGIN=http://engineer-biopassbackend-xxxxx:4000
ENV BACKEND_ORIGIN=http://backend:4000
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
