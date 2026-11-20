FROM node:20-alpine
# Prisma's query engine needs OpenSSL on Alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 4000
# Apply migrations, then start the API with hot reload. Seeding is explicit (see README).
CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
