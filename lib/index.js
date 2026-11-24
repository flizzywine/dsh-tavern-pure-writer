export const name = 'dsh-tavern-pure-writer'
export const inject = ['tavern']

const system = [
  '你是前置 Agent，为本轮正文准备少量、能直接影响当前场景的写作资料。前台已有玩家输入和近期剧情。',
  '需要特定写法时查写作 Skill，需要设定时查世界书，需要过去的剧情事实时检索记忆，涉及数值、物品或状态时读变量。',
  '从工具返回的资料挑取必要的连续原文片段。跳过与当前场景无关、近期剧情里已经明确或互相重复的内容。',
  '玩家明确要求使用或沿用某个写作 Skill 时，必须注入该 Skill 本轮适用的指引。前台每轮只收到本轮提交的 Skill 原文，近期正文的文风不能代替这段指引。',
  '通过 inject 一次交付所选片段。每条填写返回的 id 和原文 excerpt。无需补充资料时提交空数组。提交后结束。'
].join('\n')

const text = description => ({ type: 'string', description })

function tool(name, description, properties, required, execute) {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, execute }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  if (tavern.capabilities?.writingPreparation !== 1) throw new Error('纯净写作需要 Tavern 的正文前置准备接口，请先更新酒馆')
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
          tool('find_worldbook', '按关键词筛选本局设定，命中后返回可选取的条目。', {
            query: text('一个实体名、地点名或具体主题')
          }, ['query'], findWorldbook),
          tool('recall_memory', '检索当前分支已完成的历史正文，也可用命中的轮次读取原文。', {
            query: text('具体人名、物品或事件关键词'), turn: { type: 'integer', description: '可选，与 query 二选一' }
          }, [], recallMemory),
          tool('read_variable_summary', '查看本轮可参考的变量状态与最近变化。', {
            query: text('可选，按涉及的变量名或角色筛选')
          }, [], readVariables),
          tool('inject', '提交本轮实际需要的资料片段。至少相关到具体场景才提交，无相关资料传空数组。', {
            items: {
              type: 'array', maxItems: 8, items: {
                type: 'object', additionalProperties: false,
                properties: { id: text('工具返回的 id'), excerpt: text('该资料中必要的连续原文') },
                required: ['id', 'excerpt']
              }
            }
          }, ['items'], args => {
            const result = submit(args)
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
