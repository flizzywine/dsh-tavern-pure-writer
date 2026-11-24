export const name = 'dsh-tavern-pure-writer'
export const inject = ['tavern']

const preparation = [
  '你是白手套 Agent。根据前台本轮收到的人物设定、写作要求、剧情和玩家输入，替前台查找写作资料。',
  '需要特定写法时查写作 Skill，需要设定时查世界书，需要过去的剧情事实时检索记忆，涉及数值、物品或状态时读变量。',
  '本轮查到的写作资料会按调用顺序原样交给前台 Agent。请按当前场景发起具体查询。',
  '玩家明确要求使用或沿用某个写作 Skill 时，本轮要读取该 Skill 及实际需要的参考文件。',
  '查完后调用一次 inject({}) 交接资料，随后结束本轮。无需查询时直接调用 inject({})。'
].join('\n')

const text = description => ({ type: 'string', description })

function tool(name, description, properties, required, execute) {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, execute }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  if (tavern.capabilities?.writingPreparation !== 5) throw new Error('纯净写作需要白手套 Agent 接口 v5，请应用本插件的宿主兼容补丁')
  tavern.writingPreparation({
    async prepare({ listSkills, readSkill, findWorldbook, recallMemory, readVariables, runAgent, inject: submit }) {
      let accepted = false
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
          }, [], readVariables),
          tool('inject', '将本轮查到的写作资料交给前台 Agent，结束本轮准备。参数为 {}。', {}, [], async args => {
            const result = await submit(args)
            accepted = true
            return result
          })
        ],
        stopToolsWhen: () => accepted,
        acceptWithoutText: () => accepted
      })
    }
  })
}

export default { name, inject, apply }
