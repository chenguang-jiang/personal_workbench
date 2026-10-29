import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

// import-assets 间接依赖 prisma（经 obsidian-sync）；测试只校验文件名规则，
// 给一个占位连接串避免模块加载期抛错，不会真正连接数据库。
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

let isAttachedImageName: (name: string) => boolean;

before(async () => {
  ({ isAttachedImageName } = await import("./import-assets"));
});

describe("import asset names", () => {
  test("accepts names produced by the attach flow", () => {
    assert.equal(isAttachedImageName("导入附图-2026-10-26-b631c1ef.png"), true);
    assert.equal(isAttachedImageName("导入附图-2026-10-26-a78e2d3d.jpg"), true);
    assert.equal(isAttachedImageName("导入附图-2026-10-26-0cc6d034.webp"), true);
  });

  test("rejects traversal, wrong shapes and unknown extensions", () => {
    assert.equal(isAttachedImageName("../etc/passwd"), false);
    assert.equal(isAttachedImageName("导入附图-2026-10-26-b631c1ef.png/../../x.md"), false);
    assert.equal(isAttachedImageName("导入附图-26-10-26-b631c1ef.png"), false);
    assert.equal(isAttachedImageName("导入附图-2026-10-26-b631c1ef.svg"), false);
    assert.equal(isAttachedImageName("notes.md"), false);
    assert.equal(isAttachedImageName(""), false);
  });
});
