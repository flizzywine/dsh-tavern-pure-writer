export const name = 'dsh-tavern-pure-writer'
export const inject = ['tavern']

const system = [
  '你是前置 Agent，为本轮正文查找能直接影响当前场景的写作资料。前台已有玩家输入和近期剧情。',
  '需要特定写法时查写作 Skill，需要设定时查世界书，需要过去的剧情事实时检索记忆，涉及数值、物品或状态时读变量。',
  '本轮查到的文本会全部交给前台。请按当前场景发起具体查询，避免重复查询。',
  '玩家明确要求使用或沿用某个写作 Skill 时，本轮要读取该 Skill 及实际需要的参考文件。',
  '查完后只调用一次 inject({})，程序会直接交付本轮工具返回的文本。没有资料要查时直接调用 inject({})。提交后结束。'
].join('\n')

const text = description => ({ type: 'string', description })

function tool(name, description, properties, required, execute) {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, execute }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  if (tavern.capabilities?.writingPreparation !== 2) throw new Error('纯净写作需要 Tavern 正文前置准备接口 v2，请应用本插件的宿主兼容补丁')
  tavern.writingPreparation({
    async prepare({ input, recent, listSkills, readSkill, findWorldbook, recallMemory, readVariables, runAgent, inject: submit }) {
      let accepted = false
      await runAgent({
        system,
        prompt: JSON.stringify({ playerInput: input, recentStory: recent, writingSkills: await listSkills() }),
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
          tool('inject', '结束前置准备，将本轮工具查到的文本交给正文 Agent。参数为 {}。', {}, [], async args => {
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
