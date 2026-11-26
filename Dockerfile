FROM node:22-alpine
WORKDIR /app
COPY package.json server.cjs mcp-server.cjs config.example.json ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=4329 WEDDING_DATA=/app/data WEDDING_CONFIG=/app/config.json
VOLUME ["/app/data"]
EXPOSE 4329
CMD ["node", "server.cjs"]
