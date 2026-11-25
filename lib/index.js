export const name = 'dsh-tavern-pure-writer'
export const inject = ['tavern']

const preparation = [
  '你是白手套 Agent。根据前台本轮收到的人物设定、写作要求、剧情和玩家输入，替前台查找写作资料。',
  '上文的玩家要求由前台执行。白手套只负责查资料和交接本轮所需的事实。',
  '需要特定写法时查写作 Skill，需要设定时查世界书，需要过去的剧情事实时检索记忆，涉及数值、物品或状态时读变量。',
  '直接使用系统上下文里的常驻世界书。如果上文提供了世界书标题提示，按当前场景选择需要查询的条目。',
  '沿用上文已交接的资料，只查询当前场景缺少或需要确认变化的内容。程序会自动交接世界书和记忆的新增回执。',
  '按需读取写作 Skill 和参考资料，用它们指导白手套的查询。'
].join('\n')

const legacyEnding = '查完后用相应工具交接剧情事实，无需交接时以空回复结束。不要在回复里输出交接稿、摘要或正文。'
const toolHandoff = '变量查询结果只供你核对。查询结束后，如有本轮写作确实需要的变量事实，用 submit_variable_facts 一次交接一至四条。'
const automaticHandoff = '查询结束后，在最终回复里只输出 JSON，例如 {"facts":["林婉手里还剩三张车票。"]}。填写一至四条本轮写作需要的变量事实，没有需要交接的变量事实时输出 {"facts":[]}。世界书和记忆由程序交接。'
const factStyle = '每条说明具体人物、物品或处境，用对局语言写一句话。准确沿用已核对的事实、数值和单位，合并同一人物的相关内容。省略字段名、内部编号、锁定和初始化标志、空值、重复内容和与本轮无关的资料。'

const text = description => ({ type: 'string', description })

function tool(name, description, properties, required, execute) {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, execute }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  const preparationVersion = tavern.capabilities?.writingPreparation ?? 0
  if (preparationVersion < 6) {
    throw new Error('dsh-tavern-white-glove 需要白手套 Agent 接口 v6，请应用本插件的宿主兼容补丁')
  }
  const pending = new Map()
  async function settingsForGame(gameId) {
    const saved = await tavern.readGameData({ gameId })
    return { enabled: saved?.enabled !== false, selection: saved?.selection ?? null }
  }

  tavern.handle(name + '/settings', ({ gameId }) => settingsForGame(gameId))
  tavern.handle(name + '/models', async ({ gameId }) => (await tavern.taskModels({ gameId })).catalog)
  tavern.handle(name + '/save-settings', async ({ gameId, enabled, selection }) => {
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new TypeError('接管开关无效')
    if (selection !== undefined && selection !== null) {
      const { catalog } = await tavern.taskModels({ gameId })
      const { provider, model } = selection
      if (!catalog.some(group => group.provider === provider && group.models.some(entry => entry.id === model))) {
        throw new Error('这个模型已不可用，请重新选择')
      }
      selection = { provider, model }
    }
    const save = (pending.get(gameId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const settings = await settingsForGame(gameId)
      if (enabled !== undefined) settings.enabled = enabled
      if (selection !== undefined) settings.selection = selection
      await tavern.saveGameData({ gameId, data: settings })
      return settings
    })
    pending.set(gameId, save)
    try { return await save }
    finally { if (pending.get(gameId) === save) pending.delete(gameId) }
  })

  tavern.writingPreparation({
    settingsForGame,
    async prepare({ listSkills, readSkill, findWorldbook, recallMemory, readVariables, submitVariableFacts, runAgent }) {
      const skills = (await listSkills()).map(({ name, description }) => description ? name + '　' + description : name)
      const fromReply = preparationVersion >= 8
      const usesSubmitTool = !fromReply && typeof submitVariableFacts === 'function'
      const handoff = fromReply ? [automaticHandoff, factStyle] : [legacyEnding]
      if (usesSubmitTool) handoff.push(toolHandoff, factStyle)
      const prompt = [preparation, ...handoff].join('\n')
      let delivered = false
      await runAgent({
        prompt: skills.length ? prompt + '\n\n可用写作指引\n' + skills.join('\n') : prompt,
        maxToolCalls: fromReply || usesSubmitTool ? 13 : 12,
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
          tool('read_variable_summary', '按关键词查找本轮需要核对的变量值或最近变化。', {
            query: text('具体变量名，或用空格连接角色名与所需字段，例如「林婉 好感度」')
          }, ['query'], readVariables),
          ...(usesSubmitTool ? [tool('submit_variable_facts', '作为最后一个工具调用，交接本轮真正需要的变量事实。', {
            facts: { type: 'array', items: text('面向正文的一句剧情事实，沿用查询到的数值与单位'), minItems: 1, maxItems: 4 }
          }, ['facts'], async args => {
            const result = await submitVariableFacts(args)
            delivered = true
            return result
          })] : [])
        ],
        ...(fromReply ? { variableFactsFromReply: true } : {}),
        ...(usesSubmitTool ? { stopToolsWhen: () => delivered } : {}),
        acceptWithoutText: true
      })
    }
  })
}

export default { name, inject, apply }
