FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy built code
COPY dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S boatkite && \
    adduser -u 1001 -S boatkite -G boatkite
USER boatkite

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["run"]
