# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache curl dumb-init

# Copy dependency files first for caching
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source and build the application
COPY . .
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS production-runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Only install production dependencies
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi.yaml ./

# Create and switch to a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
CMD ["node", "dist/server.js"]

# Stage 3: Local Development & Testing Runner
# This stage inherits from builder, so it has devDependencies like Vitest
FROM builder AS development-runner

WORKDIR /app

# Set development environment
ENV NODE_ENV=development

# The builder stage already has all dependencies installed
# and the source code copied, so we just need to specify the CMD.

EXPOSE 3000
CMD ["npm", "run", "dev"]
