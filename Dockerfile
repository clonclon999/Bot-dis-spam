FROM node:20-alpine

WORKDIR /app

# Cài đặt dependencies sản xuất gọn nhẹ
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Sao chép mã nguồn
COPY src ./src
COPY data ./data

# Tạo thư mục dữ liệu và phân quyền cho user không phải root để bảo mật trên Cloud
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
