import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applySearchReplaceBlocks } from "./patch-edit";

describe("applySearchReplaceBlocks", () => {
  it("replaces exact block in article", () => {
    const original = "# 标题\n\n## 旧模块\n一些描述内容\n\n## 第二节\n继续";
    const patch = `<<<<<<< SEARCH
## 旧模块
一些描述内容
=======
## 新模块
修改后的详细描述
>>>>>>> REPLACE`;

    const res = applySearchReplaceBlocks(original, patch);
    assert.equal(res.count, 1);
    assert.equal(
      res.content,
      "# 标题\n\n## 新模块\n修改后的详细描述\n\n## 第二节\n继续",
    );
  });

  it("handles deletion when REPLACE block is empty", () => {
    const original = "开头\n## 待删除标题\n内容待删除\n结尾";
    const patch = `<<<<<<< SEARCH
## 待删除标题
内容待删除
=======
>>>>>>> REPLACE`;

    const res = applySearchReplaceBlocks(original, patch);
    assert.equal(res.count, 1);
    assert.equal(res.content, "开头\n\n结尾");
  });

  it("handles multiple search replace blocks sequentially", () => {
    const original = "A1\nB1\nC1";
    const patch = `<<<<<<< SEARCH
A1
=======
A2
>>>>>>> REPLACE

一些说明文字

<<<<<<< SEARCH
C1
=======
C2
>>>>>>> REPLACE`;

    const res = applySearchReplaceBlocks(original, patch);
    assert.equal(res.count, 2);
    assert.equal(res.content, "A2\nB1\nC2");
  });

  it("handles replacement strings with dollar signs without regex mangling", () => {
    const original = "价格：$100，变量：$HOME";
    const patch = `<<<<<<< SEARCH
价格：$100
=======
价格：$200 / $&
>>>>>>> REPLACE`;

    const res = applySearchReplaceBlocks(original, patch);
    assert.equal(res.count, 1);
    assert.equal(res.content, "价格：$200 / $&，变量：$HOME");
  });

  it("normalizes CRLF newlines if needed", () => {
    const original = "Line 1\r\nLine 2\r\nLine 3";
    const patch = `<<<<<<< SEARCH\nLine 2\n=======\nLine 2 Modified\n>>>>>>> REPLACE`;

    const res = applySearchReplaceBlocks(original, patch);
    assert.equal(res.count, 1);
    assert.match(res.content, /Line 2 Modified/);
  });
});
