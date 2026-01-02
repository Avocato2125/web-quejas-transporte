FROM node:22-slim

# Instalar dependencias del sistema para Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxss1 \
    libgtk-3-0 \
    libxshmfence1 \
    libglu1-mesa \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libdrm2 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    xdg-utils \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Crear usuario no-root para seguridad
RUN groupadd -r appuser && useradd -r -m -g appuser appuser

WORKDIR /app

# Cambiar propiedad del directorio de trabajo
RUN chown -R appuser:appuser /app

# Configurar npm para usar cache en /tmp
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Copiar archivos de dependencias
COPY package*.json ./

# Cambiar a usuario no-root
USER appuser

# Instalar dependencias de producción
RUN npm ci --omit=dev --no-audit && npm cache clean --force

# Copiar el resto del código
COPY --chown=appuser:appuser . .

# Crear directorio para logs
RUN mkdir -p logs

# Puerto por defecto
EXPOSE 3000

# Variables de entorno optimizadas
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_ARGS='--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-accelerated-2d-canvas,--no-first-run,--no-zygote,--single-process,--disable-gpu'

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health-simple', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Comando de inicio
CMD ["npm", "start"]