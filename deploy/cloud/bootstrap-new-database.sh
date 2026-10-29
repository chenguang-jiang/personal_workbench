#!/bin/sh
# 仅首次部署到全新、没有任何业务数据的 dawnkb 数据库时运行。
# 历史迁移缺失部分建表步骤，使用当前 schema 建立基线；日常升级使用 start.sh。
set -eu
compose=/srv/dawnkb/deploy/compose.yaml
docker compose -f "$compose" run --rm --no-deps web node -e '
const {Client}=require("pg");
(async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try {
    const name=(await db.query("select current_database() as name")).rows[0].name;
    if(name!=="dawnkb")throw Error("只能初始化 dawnkb 数据库");
    const tables=(await db.query("select tablename from pg_tables where schemaname=$1",["public"])).rows;
    for(const {tablename} of tables){
      if(tablename==="_prisma_migrations")continue;
      const quoted="\""+tablename.replaceAll("\"","\"\"")+"\"";
      if((await db.query("select 1 from public."+quoted+" limit 1")).rows.length)throw Error("数据库已有业务数据，拒绝初始化");
    }
    console.log("已确认 dawnkb 没有业务数据");
  } finally {await db.end();}
})().catch(e=>{console.error(e.message);process.exit(1)});
'
docker compose -f "$compose" run --rm --no-deps web npx prisma db push --accept-data-loss
# 以完整 schema 为历史迁移建立基线，也兼容第一个迁移已成功的情况。
log=$(mktemp)
trap 'rm -f "$log"' EXIT
for migration in \
  20260804100528_init \
  20260811093000_dawn_agent_knowledge_modes \
  20260811143000_dawn_agent_context_loop \
  20260811170000_dawn_agent_permission_mode \
  20260816103000_brainstorm_session_title
do
  if docker compose -f "$compose" run --rm --no-deps web npx prisma migrate resolve --applied "$migration" > "$log" 2>&1; then
    cat "$log"
  elif grep -q 'P3008' "$log"; then
    printf '%s 已建立基线\n' "$migration"
  else
    cat "$log"
    exit 1
  fi
done
docker compose -f "$compose" run --rm --no-deps web npx prisma migrate diff --from-config-datasource --to-schema /app/prisma/schema.prisma --exit-code
