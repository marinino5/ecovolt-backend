FROM node:20-alpine
WORKDIR /app

# Instala deps sin exigir lockfile
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copia código
COPY . .

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm","run","start:prod"]
