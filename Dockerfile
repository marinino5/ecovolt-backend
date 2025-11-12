# Etapa base
FROM node:20-alpine
WORKDIR /app

# Instala deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copia código
COPY . .

# Puerto interno
ENV PORT=3000
EXPOSE 3000

# Salud (Coolify puede usar /health)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm","run","start:prod"]
