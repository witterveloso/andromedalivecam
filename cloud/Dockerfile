FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
COPY camera-hub.cjs cloud-server.cjs ./
COPY public/cam ./public/cam
USER node
EXPOSE 8080
CMD ["node", "cloud-server.cjs"]
