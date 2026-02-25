# --- Build stage ---
FROM node:22-alpine AS builder

# Dependencias nativas para compilar better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Production stage ---
FROM node:22-alpine

# mysqldump + pg_dump para backups MySQL/PostgreSQL + build tools para better-sqlite3
RUN apk add --no-cache mysql-client postgresql-client python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY --from=builder /app/dist ./dist

RUN mkdir -p data backups

ENV NODE_ENV=production
ENV API_KEY=
ENV PORT=3777
ENV BACKUP_DIR=/app/backups
ENV DATA_DIR=/app/data

EXPOSE 3777

CMD ["node", "--enable-source-maps", "dist/server.js"]
