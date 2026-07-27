# ────────────────────────────────────────────────────────────────────
# Build stage: instala TODAS las deps, compila TypeScript → dist/
# ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build


# ────────────────────────────────────────────────────────────────────
# Runtime stage: solo prod deps + dist compilado
# ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
