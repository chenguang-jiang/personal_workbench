/* eslint-disable */
// @ts-nocheck — Prisma 7 config 类型与运行时有差异，忽略类型检查
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma", "migrations"),
  },
  // Prisma 7: migrate CLI 从这里读取连接字符串
  datasource: {
    url: process.env.DATABASE_URL,
  },
  // Prisma 7: 运行时通过 adapter 连接（类型定义未跟进，运行时正常）
  adapter: async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    return new PrismaPg(pool);
  },
});
