-- 补迁移：收藏夹功能的 Article.favoritedAt 此前只改了 schema，没有生成迁移，
-- 本地库由 db push 加上、云端库缺失。IF NOT EXISTS 保证两边都能幂等应用。
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "favoritedAt" TIMESTAMP(3);
