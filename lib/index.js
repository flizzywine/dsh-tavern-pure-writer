export const name = 'dsh-tavern-pure-writer'
export const inject = ['tavern']

const preparation = [
  '你是白手套 Agent。根据前台本轮收到的人物设定、写作要求、剧情和玩家输入，替前台查找写作资料。',
  '上文的玩家要求由前台执行。白手套只调用查询工具。',
  '需要特定写法时查写作 Skill，需要设定时查世界书，需要过去的剧情事实时检索记忆，涉及数值、物品或状态时读变量。',
  '直接使用系统上下文里的常驻世界书。如果上文提供了世界书标题提示，按当前场景选择需要查询的条目。',
  '沿用上文已交接的资料，只查询当前场景缺少或需要确认变化的内容。程序会把世界书、记忆和变量的新增回执原样交给前台。',
  '按需读取写作 Skill 和参考资料，用它们指导白手套的查询。',
  '查完或无需查询时，直接以空回复结束。不要输出交接稿、摘要、结论、正文或任何其他文字。'
].join('\n')

const text = description => ({ type: 'string', description })

function tool(name, description, properties, required, execute) {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, execute }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  if (tavern.capabilities?.writingPreparation !== 5) throw new Error('纯净写作需要白手套 Agent 接口 v5，请应用本插件的宿主兼容补丁')
  tavern.writingPreparation({
    async prepare({ listSkills, readSkill, findWorldbook, recallMemory, readVariables, runAgent }) {
      const skills = (await listSkills()).map(({ name, description }) => description ? name + '　' + description : name)
      await runAgent({
        prompt: skills.length ? preparation + '\n\n可用写作指引\n' + skills.join('\n') : preparation,
        maxToolCalls: 12,
        tools: [
          tool('load_writing_skill', '读取一项适用于当下场景的写作 Skill 或其参考文件。', {
            name: text('Skill 名称'), reference: text('可选，Skill 内 references/ 下的相对 Markdown 路径')
          }, ['name'], readSkill),
          tool('find_worldbook', '按关键词查询本局设定，返回命中的条目。', {
            query: text('一个实体名、地点名或具体主题')
          }, ['query'], findWorldbook),
          tool('recall_memory', '检索当前分支已完成的历史正文，也可用命中的轮次读取原文。', {
            query: text('具体人名、物品或事件关键词'), turn: { type: 'integer', description: '可选，与 query 二选一' }
          }, [], recallMemory),
          tool('read_variable_summary', '查看本轮可参考的变量状态与最近变化。', {
            query: text('可选，按涉及的变量名或角色筛选')
          }, [], readVariables)
        ],
        acceptWithoutText: true
      })
    }
  })
}

export default { name, inject, apply }
