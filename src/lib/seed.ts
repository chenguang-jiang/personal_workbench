import { prisma } from "@/lib/prisma";

async function main() {
  // 创建默认用户
  const user = await prisma.user.upsert({
    where: { email: "creator@workbench.local" },
    update: {},
    create: {
      email: "creator@workbench.local",
      name: "创作者",
    },
  });

  // 清除旧数据
  await prisma.knowledgeNode.deleteMany({ where: { userId: user.id } });
  await prisma.highlight.deleteMany();
  await prisma.note.deleteMany({ where: { userId: user.id } });
  await prisma.article.deleteMany({ where: { userId: user.id } });

  // 创建示例文章
  const article1 = await prisma.article.create({
    data: {
      title: "深度学习入门",
      content: `# 深度学习入门

深度学习是机器学习的一个分支，它使用多层神经网络来学习数据的表示和特征。

## 什么是深度学习

深度学习的核心在于通过多层的非线性变换，将原始数据转化为更高层次的抽象表示。

## 神经网络

神经网络由多个层组成，每层包含若干神经元。常见类型：
- 全连接网络
- 卷积神经网络（CNN）
- 循环神经网络（RNN）

> 深度学习在图像识别、自然语言处理等领域取得了突破性进展。`,
      tags: ["AI", "学习", "深度学习"],
      source: "manual",
      userId: user.id,
    },
  });

  const article2 = await prisma.article.create({
    data: {
      title: "注意力机制详解",
      content: `# 注意力机制详解

注意力机制（Attention Mechanism）是深度学习中的重要概念，广泛应用于自然语言处理领域。

## 核心思想

注意力机制让模型能够"关注"输入序列中最重要的部分，而不是平均对待所有信息。

## Transformer

Transformer 架构完全基于注意力机制，摒弃了循环结构，实现了并行计算。`,
      tags: ["AI", "NLP", "Transformer"],
      source: "manual",
      userId: user.id,
    },
  });

  // 创建知识节点（素材库）
  const nodes = [
    {
      title: "深度学习入门",
      description: "深度学习基础概念和神经网络介绍",
      content: "深度学习是机器学习的一个分支...",
      type: "article",
      tags: ["AI", "学习", "深度学习"],
    },
    {
      title: "注意力机制",
      description: "Attention Mechanism 核心思想",
      content: "让模型关注输入序列中最重要的部分",
      type: "concept",
      tags: ["AI", "NLP", "注意力"],
    },
    {
      title: "Transformer 架构",
      description: "基于注意力的并行序列模型",
      content: "摒弃循环结构，实现并行计算",
      type: "concept",
      tags: ["AI", "NLP", "Transformer"],
    },
    {
      title: "AI 绘画工具集",
      description: "Midjourney / Stable Diffusion / DALL-E 等工具",
      content: "AI 生成图片的工具合集",
      type: "material",
      tags: ["AI", "设计", "绘画"],
    },
    {
      title: "内容创作方法论",
      description: "如何持续产出高质量内容",
      content: "选题、调研、写作、复盘的全流程",
      type: "note",
      tags: ["创作", "方法论"],
    },
    {
      title: "推荐算法原理",
      description: "B站、抖音推荐算法的工作机制",
      content: "协同过滤、内容理解、用户画像",
      type: "article",
      tags: ["算法", "推荐"],
    },
  ];

  for (const node of nodes) {
    await prisma.knowledgeNode.create({
      data: { ...node, userId: user.id },
    });
  }

  // 为文章1创建高亮
  await prisma.highlight.create({
    data: {
      text: "深度学习是机器学习的一个分支",
      color: "yellow",
      note: "重要定义",
      prefix: "# 深度学习入门\n\n",
      suffix: "，它使用多层神经网络",
      startOffset: 8,
      endOffset: 20,
      articleId: article1.id,
    },
  });

  console.log("Seed 完成:");
  console.log(`  用户: ${user.id}`);
  console.log(`  文章: ${article1.id}, ${article2.id}`);
  console.log(`  知识节点: ${nodes.length} 个`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
