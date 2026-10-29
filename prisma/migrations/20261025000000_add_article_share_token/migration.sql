-- 公开分享：Article.shareToken 非空即开启分享，/s/<token> 免登录只读访问最新版。
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Article_shareToken_key" ON "Article"("shareToken");
