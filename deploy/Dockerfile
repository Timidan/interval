# Two images from one file: `api` runs the Node server (built-ins only, no runtime npm packages);
# `web` is Caddy serving the built site and proxying /api to it.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /app
COPY package.json ./
COPY server server
COPY seeds seeds
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4191
USER node
EXPOSE 4191
CMD ["node", "server/index.mjs"]

FROM caddy:2 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
