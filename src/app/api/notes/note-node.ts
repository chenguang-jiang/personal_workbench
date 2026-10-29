// 读者笔记 ↔ 知识节点的对应规则：创建与删除共用，保证删除笔记时能精确找到同步生成的节点
export const NOTE_NODE_TYPE = "note";
const NOTE_TITLE_LENGTH = 50;

export function noteNodeTitle(content: string) {
  return content.substring(0, NOTE_TITLE_LENGTH) + (content.length > NOTE_TITLE_LENGTH ? "..." : "");
}
