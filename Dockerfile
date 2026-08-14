FROM node:18-slim

# Install Chromium and dependencies needed for puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium binary
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /usr/src/app

# Copy package.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose port (if needed, Koyeb requires a port binding)
EXPOSE 8080

# Start script
CMD [ "npm", "start" ]
