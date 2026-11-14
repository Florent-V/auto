# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# NEON APEX — image de production en deux étapes.
#   1. build : installe les dépendances, exécute les tests de simulation,
#              compile l'application Nuxt (sortie autonome dans .output/).
#   2. exécution : image minimale ne contenant que le serveur Nitro compilé.
# -----------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Les tests du cœur de simulation servent de garde-fou : build refusé s'ils échouent.
RUN npm test && npm run build

FROM node:22-slim AS execution
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
