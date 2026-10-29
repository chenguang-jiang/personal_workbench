import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// 回收站全部行为都在真实文件系统上验证：临时目录充当 Vault
async function withTempVault(run: (vault: string) => Promise<void>) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "dawnkb-trash-test-"));
  const previous = process.env.OBSIDIAN_VAULT_PATH;
  process.env.OBSIDIAN_VAULT_PATH = vault;
  try {
    await run(vault);
  } finally {
    if (previous === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
    else process.env.OBSIDIAN_VAULT_PATH = previous;
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

// 动态 import：确保模块在 env 指向临时 Vault 后才首次加载（getVaultConfig 每次调用都读 env，无缓存问题）
async function loadTrash() {
  return await import("./vault-trash");
}

test("moveToTrash moves the file into a dated hidden dir and records the original path", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG", "技术"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "技术", "旧文档.md"), "# 旧文档\n内容");
    const trash = await loadTrash();

    const trashPath = trash.moveToTrash("JCG/技术/旧文档.md");
    assert.ok(!fs.existsSync(path.join(vault, "JCG", "技术", "旧文档.md")), "原位置文件应被移走");
    const [stamp, ...rest] = trashPath.split("/");
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(rest.join("/"), "JCG/技术/旧文档.md");
    assert.ok(fs.existsSync(path.join(vault, ".dawnkb-trash", trashPath)));

    const entries = trash.listTrash();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].originalPath, "JCG/技术/旧文档.md");
    assert.equal(entries[0].name, "旧文档.md");
  });
});

test("restoreFromTrash puts the file back at its original path", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "笔记.md"), "# 笔记");
    const trash = await loadTrash();

    const trashPath = trash.moveToTrash("JCG/笔记.md");
    const restored = trash.restoreFromTrash(trashPath);
    assert.equal(restored, "JCG/笔记.md");
    assert.equal(fs.readFileSync(path.join(vault, "JCG", "笔记.md"), "utf-8"), "# 笔记");
    assert.equal(trash.listTrash().length, 0);
  });
});

test("restoring over an occupied path does not overwrite the existing file", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "同名.md"), "# 旧版本");
    const trash = await loadTrash();

    const trashPath = trash.moveToTrash("JCG/同名.md");
    fs.writeFileSync(path.join(vault, "JCG", "同名.md"), "# 新占位");
    const restored = trash.restoreFromTrash(trashPath);
    assert.notEqual(restored, "JCG/同名.md");
    assert.equal(fs.readFileSync(path.join(vault, "JCG", "同名.md"), "utf-8"), "# 新占位");
    assert.equal(fs.readFileSync(path.join(vault, restored), "utf-8"), "# 旧版本");
  });
});

test("traversal, non-markdown and outside-vault targets are all rejected", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "文档.md"), "# x");
    fs.writeFileSync(path.join(vault, "JCG", "图片.png"), "binary");
    const trash = await loadTrash();

    assert.throws(() => trash.moveToTrash("../outside.md"), /无效的路径|超出/);
    assert.throws(() => trash.moveToTrash("JCG/../JCG/文档.md"), /无效的路径/);
    assert.throws(() => trash.moveToTrash("JCG/图片.png"), /Markdown/);
    assert.throws(() => trash.moveToTrash("JCG/不存在.md"), /不存在/);
    assert.throws(() => trash.restoreFromTrash("../etc/passwd"), /无效的路径|不存在/);
    // 原文件未被误删
    assert.ok(fs.existsSync(path.join(vault, "JCG", "文档.md")));
  });
});

test("moveFolderToTrash trashes the whole directory and restores it intact", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG", "旧项目", "子目录"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "旧项目", "文档.md"), "# 文档");
    fs.writeFileSync(path.join(vault, "JCG", "旧项目", "子目录", "图.png"), "binary");
    const trash = await loadTrash();

    const trashPath = trash.moveFolderToTrash("JCG/旧项目");
    assert.ok(!fs.existsSync(path.join(vault, "JCG", "旧项目")), "原目录应被移走");

    const entries = trash.listTrash();
    // 整目录只列一条文件夹条目，不把里面的 md 展开成单独条目
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, "folder");
    assert.equal(entries[0].name, "旧项目");
    assert.equal(entries[0].originalPath, "JCG/旧项目");

    const restored = trash.restoreFromTrash(trashPath);
    assert.equal(restored, "JCG/旧项目");
    assert.equal(fs.readFileSync(path.join(vault, "JCG", "旧项目", "文档.md"), "utf-8"), "# 文档");
    assert.ok(fs.existsSync(path.join(vault, "JCG", "旧项目", "子目录", "图.png")));
    // 标记文件恢复后摘掉，不污染用户目录
    assert.ok(!fs.existsSync(path.join(vault, "JCG", "旧项目", ".dawnkb-folder")));
    assert.equal(trash.listTrash().length, 0);
  });
});

test("restoring a folder over an occupied path is refused instead of merging", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG", "旧项目"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "旧项目", "文档.md"), "# 旧版本");
    const trash = await loadTrash();

    const trashPath = trash.moveFolderToTrash("JCG/旧项目");
    fs.mkdirSync(path.join(vault, "JCG", "旧项目"));
    assert.throws(() => trash.restoreFromTrash(trashPath), /同名文件夹/);
    // 拒绝恢复时回收站条目与原占位目录都保持原样
    assert.equal(trash.listTrash().length, 1);
    assert.ok(!fs.existsSync(path.join(vault, "JCG", "旧项目", "文档.md")));
  });
});

test("emptyTrash removes everything and reports the count", async () => {
  await withTempVault(async (vault) => {
    fs.mkdirSync(path.join(vault, "JCG"), { recursive: true });
    fs.writeFileSync(path.join(vault, "JCG", "a.md"), "# a");
    fs.writeFileSync(path.join(vault, "JCG", "b.md"), "# b");
    const trash = await loadTrash();

    trash.moveToTrash("JCG/a.md");
    trash.moveToTrash("JCG/b.md");
    assert.equal(trash.listTrash().length, 2);
    assert.equal(trash.emptyTrash(), 2);
    assert.equal(trash.listTrash().length, 0);
    assert.ok(!fs.existsSync(path.join(vault, ".dawnkb-trash")));
  });
});
