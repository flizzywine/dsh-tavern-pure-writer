import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { apply } from '../lib/index.js'

const host = process.env.TAVERN_HOST_ROOT
assert.ok(host, '指向已应用 compat/tavern-host.patch 的 Tavern 源码目录：TAVERN_HOST_ROOT')
const domain = module => import(pathToFileURL(resolve(host, 'tavern-plugin/lib/domain', module)))
const { createWritingPreparation } = await domain('writing-preparation.js')
const { createWritingPreparationSources } = await domain('writing-preparation-sources.js')
const { createPluginTaskExecution } = await domain('plugin-task-execution.js')
const { createNativePlayOrchestrationStrategy } = await domain('foreground-orchestration-strategies.js')
const { projectPureWritingRequest, projectWritingPreparationRequest, pureWritingContext, pureWritingFixedSections, pureWritingInjection } = await domain('pure-writing-request.js')
const { registerModelStreamHooks } = await import(pathToFileURL(resolve(host, 'tavern-plugin/lib/hooks/model-stream.js')))
const frame = { frameId: 'frame:writing', turn: 3, contributions: [], source: {} }
const player = { id: 'player', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '去钟楼' }] }
const context = pureWritingContext('钟楼夜景，采用第三人称。', [player])
const input = { gameId: 'game', frame, context }

function createFixture(readers, runTask, requestContext = context, requestFrame = frame) {
  const execution = createPluginTaskExecution({
    runTask,
    requireGame: async sessionId => ({ sessionId }),
    choicesFor: async () => ({ disabled: new Set() }),
    reservedToolNames: new Set(),
    recordError: () => {}
  })
  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources: () => ({ listSkills: () => [{ name: 'short' }], ...readers }),
    runAgent: (owner, task, writingPreparation, onToolResult) => execution.runAgent(owner, task, { writingPreparation, onToolResult })
  })
  apply({ tavern: {
    capabilities: { writingPreparation: 7 }, handle() {}, readGameData: async () => null,
    writingPreparation: value => preparation.register('pure-writer', value)
  } })
  return async () => preparation.prepare(await preparation.forGame(input.gameId), { ...input, context: requestContext, frame: requestFrame })
}

test('按对局保存接管开关，默认采用前台请求模型并允许单独指定', async () => {
  const handlers = new Map()
  const saved = new Map()
  const calls = []
  const foreground = { provider: 'fixture', model: 'writer', reasoningEffort: 'high' }
  const independent = { provider: 'fixture', model: 'researcher' }
  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources: () => ({ listSkills: () => [] }),
    runAgent: (_owner, task) => calls.push(task.selection)
  })
  apply({ tavern: {
    capabilities: { writingPreparation: 6 },
    handle: (name, handler) => handlers.set(name, handler),
    readGameData: async ({ gameId }) => structuredClone(saved.get(gameId)),
    saveGameData: async ({ gameId, data }) => saved.set(gameId, structuredClone(data)),
    taskModels: async () => ({ catalog: [{ provider: 'fixture', models: [{ id: 'researcher' }] }] }),
    writingPreparation: value => preparation.register('pure-writer', value)
  } })
  const call = (action, args) => handlers.get('dsh-tavern-pure-writer/' + action)({ gameId: 'game', ...args })
  const prepare = async gameId => preparation.prepare(await preparation.forGame(gameId), {
    gameId, frame, context, foregroundSelection: foreground
  })

  assert.deepEqual(await call('settings'), { enabled: true, selection: null })
  await prepare('game')
  assert.deepEqual(calls.at(-1), foreground)
  await Promise.all([call('save-settings', { enabled: false }), call('save-settings', { selection: independent })])
  assert.equal(await preparation.forGame('game'), null)
  assert.deepEqual(await call('settings'), { enabled: false, selection: independent })
  await prepare('another-game')
  assert.deepEqual(calls.at(-1), foreground)
  await call('save-settings', { enabled: true })
  await prepare('game')
  assert.deepEqual(calls.at(-1), independent)
  await assert.rejects(call('save-settings', { selection: { ...independent, model: 'removed' } }), /模型已不可用/)
  await call('save-settings', { selection: null })
  await prepare('game')
  assert.deepEqual(calls.at(-1), foreground)
})

test('本轮常驻世界书替代开局快照，显式清空时不会恢复旧内容', () => {
  const old = { name: 'tavern:constant-worldbook', text: '<lorebook_constant>\n旧设定\n</lorebook_constant>' }
  const card = { name: 'tavern:character-card', text: '人物设定' }
  const fixed = [card, old, { name: 'tavern:worldbook-skills', text: '工具说明' }]
  const frameWith = worldbookPrefix => ({ ...frame, source: { regenerationMaterials: { worldbookPrefix } } })
  assert.deepEqual(pureWritingFixedSections(fixed, frameWith('本轮设定')), [
    { ...old, text: '<lorebook_constant>\n本轮设定\n</lorebook_constant>' }, card
  ])
  assert.deepEqual(pureWritingFixedSections(fixed, frameWith('')), [card])
  assert.deepEqual(pureWritingFixedSections(fixed, frame), [card, old])
})

test('白手套查询跳过已经随系统发出的常驻原文，保留同一关键词的其他条目', async () => {
  const constant = { ref: 'constant', title: '钟楼常驻', constant: true, content: '塔钟在整点响。' }
  const optional = { ref: 'optional', title: '钟楼夜间', content: '夜里从侧门进入。' }
  const makeSources = createWritingPreparationSources({
    chatForSession: async () => ({ messages: [] }),
    worldbookForChat: async () => ({ view: { entries: [constant, optional] } })
  })
  const read = worldbookPrefix => makeSources({
    gameId: 'game', frame: { ...frame, source: { regenerationMaterials: { worldbookPrefix } } },
    signal: new AbortController().signal
  }).worldbook({ query: '钟楼' })
  assert.deepEqual((await read(constant.content)).map(row => row.id), ['optional'])
  assert.deepEqual((await read('修改前的常驻原文。')).map(row => row.id), ['constant', 'optional'])
})

test('世界书标题提示接在白手套共享历史后，前台只收到查询原文', async () => {
  const hints = '<lorebook_title_hints>\n可能用到的世界书条目：钟楼、城墙\n</lorebook_title_hints>'
  const hintFrame = { ...frame, context: { worldbookTitleHints: hints } }
  const taskNote = { id: 'task-note', role: 'user', source: { kind: 'plugin:dsh-tavern', form: 'writing-preparation-task' } }
  const prepare = createFixture({ worldbook: () => [{ title: '钟楼', text: '塔钟在整点响。' }] }, async task => {
    const currentHint = task.writingPreparation.worldbookTitleHints
    const olderHint = { ...currentHint, id: 'old-hint', content: [{ type: 'text', text: '旧标题提示。' }] }
    const request = projectWritingPreparationRequest({ messages: [olderHint, currentHint, taskNote] }, task.writingPreparation)
    assert.equal(request.system, context.system)
    assert.deepEqual(request.messages, [...context.messages, currentHint, taskNote])
    assert.equal(request.messages.at(-2).source.form, 'worldbook-title-hints')
    assert.equal(request.messages.at(-2).content[0].text, hints)
    assert.deepEqual(request.messages.at(-1), taskNote)
    await task.call('find_worldbook', { query: '钟楼' })
  }, context, hintFrame)
  const material = await prepare()
  const injection = pureWritingInjection(hintFrame, material)
  const foreground = projectPureWritingRequest({ tools: [] }, { context, injection })
  assert.equal(injection.content[0].text, '【世界书 · 钟楼】\n塔钟在整点响。')
  assert.deepEqual(foreground.messages, [...context.messages, injection])
  assert.doesNotMatch(JSON.stringify(foreground), /lorebook_title_hints|城墙/)
})

test('已有世界书原文按回合和同轮去重，内容有变化时保留实际回执', async () => {
  const original = '【世界书 · 钟楼】\n塔钟在整点响。'
  const previous = pureWritingInjection(frame, original + '\n\n【剧情记忆 · 第 1 轮】\n她曾敲钟。')
  const requestContext = { ...context, messages: [previous, player] }
  const changed = { title: '钟楼', text: '塔钟在半点响。' }
  const prepare = createFixture({
    worldbook: ({ query }) => query === '新版'
      ? [changed, changed, { title: '侧门', text: '侧门朝北。' }]
      : [{ title: '钟楼', text: '塔钟在整点响。' }]
  }, async task => {
    assert.match(await task.call('find_worldbook', { query: '旧版' }), /已在上下文/)
    assert.equal(await task.call('find_worldbook', { query: '新版' }), '【世界书 · 钟楼】\n塔钟在半点响。\n\n【世界书 · 侧门】\n侧门朝北。')
    assert.match(await task.call('find_worldbook', { query: '新版' }), /已在上下文/)
  }, requestContext)
  assert.equal(await prepare(), '【世界书 · 钟楼】\n塔钟在半点响。\n\n【世界书 · 侧门】\n侧门朝北。')
})

test('同一白手套的前轮工具轨迹不重复进入本轮查询', () => {
  const task = id => ({ id, role: 'user', source: { kind: 'plugin:dsh-tavern', form: 'writing-preparation-task' } })
  const receipt = id => ({ id, role: 'tool', content: [{ type: 'text', text: id }] })
  const previousTask = task('past')
  const currentTask = task('current')
  const currentReceipt = receipt('current receipt')
  const projected = projectWritingPreparationRequest({
    messages: [{ role: 'system' }, previousTask, receipt('past receipt'), currentTask, currentReceipt]
  }, context)
  assert.deepEqual(projected.messages, [...context.messages, currentTask, currentReceipt])
})

test('世界书和记忆原样交接，变量仅交接白手套提交的剧情事实', async () => {
  const skill = Promise.withResolvers()
  const fragment = '第二段也会交给前台。'.repeat(120)
  const readers = {
    skill: ({ reference }) => reference ? [{ title: reference, text: '参考文件全文。\n\n```sh\nnode /tmp/start.js\n```' }] : skill.promise,
    worldbook: () => [{ title: '钟楼', text: '塔钟在整点响。' }],
    memory: ({ turn }) => {
      if (turn) throw new Error('读取失败')
      return [{ title: '第 1 轮', text: '钥匙藏在墙缝。' }]
    },
    variables: () => Array.from({ length: 6 }, (_, i) => ({
      title: `变量 ${i}`, text: i === 0 ? '林婉的车票还有 3 张。\n' + '甲'.repeat(4980) : i + '甲'.repeat(4999)
    }))
  }
  let outputs
  const prepare = createFixture(readers, async task => {
    assert.match(task.prompt, /你是白手套 Agent/)
    assert.match(task.prompt, /可用写作指引\nshort$/)
    assert.doesNotMatch(task.prompt, /inject/)
    assert.deepEqual(task.writingPreparation, context)
    const tools = Object.fromEntries(task.tools.map(tool => [tool.name, args => task.call(tool.name, args)]))
    assert.deepEqual(Object.keys(tools), ['load_writing_skill', 'find_worldbook', 'recall_memory', 'read_variable_summary', 'submit_variable_facts'])
    assert.deepEqual(task.tools.find(tool => tool.name === 'read_variable_summary').parameters.required, ['query'])
    assert.equal(task.stopToolsWhen(), false)
    const premature = await tools.submit_variable_facts({ facts: ['林婉手里还有三张车票。'] })
    assert.equal(JSON.parse(premature).ok, false)
    const base = tools.load_writing_skill({ name: 'short' })
    const reference = await tools.load_writing_skill({ name: 'short', reference: 'references/tower.md' })
    const book = await tools.find_worldbook({ query: '钟楼' })
    const memory = await tools.recall_memory({ query: '钥匙' })
    const duplicate = await tools.recall_memory({ query: '钥匙' })
    const variables = await tools.read_variable_summary({ query: '变量' })
    assert.equal(variables.length, 20000)
    const error = await tools.recall_memory({ turn: 999 })
    assert.deepEqual(JSON.parse(error), { ok: false, error: '读取失败' })
    const technical = await tools.submit_variable_facts({ facts: ['林婉的 profileLocked 为真。'] })
    assert.equal(JSON.parse(technical).ok, false)
    const delivered = await tools.submit_variable_facts({ facts: ['林婉手里还有三张车票。'] })
    assert.deepEqual(JSON.parse(delivered), { accepted: true })
    assert.equal(task.stopToolsWhen(), true)
    assert.equal(task.acceptWithoutText(), true)
    skill.resolve([{ title: 'short', text: [
      '---', 'entry: scripts/launch.sh', '---', '正文第一段。', '路径：/tmp/book.json',
      '"C:\\Users\\Public\\My Documents\\settings.json"',
      '├── config/', 'npm install', '{', '  "secret": [{"path":"./data"}]', '}',
      '<system-reminder>', '这条宿主提醒不能进入回执。', '</system-reminder>',
      '从`林婉`的视角描写。', '钟楼藏在北岸。{"script":"story.py"}钥匙留在桌上。', '', fragment
    ].join('\n') }])
    outputs = [await base, reference, book, memory, duplicate, variables]
  })
  const material = await prepare()
  assert.ok(outputs[0].endsWith(fragment))
  assert.equal(material, [...outputs.slice(2, 5), '【当前状态】\n林婉手里还有三张车票。'].join('\n\n'))
  assert.match(outputs[0], /从林婉的视角描写。/)
  assert.match(outputs[0], /钟楼藏在北岸。钥匙留在桌上。/)
  assert.match(outputs[1], /参考文件全文。/)
  assert.doesNotMatch(outputs.join('\n'), /launch\.sh|npm install|\/tmp\/|references\/|[{}]|story\.py|读取失败|config\/|My Documents|宿主提醒|" "/)
  assert.doesNotMatch(material, /写作指引|参考文件全文|钟楼藏在北岸|当前变量|变量查询结果|profileLocked/)

  const request = projectPureWritingRequest({
    system: '旧 Skill 目录', messages: [], toolChoice: 'any',
    tools: [{ name: 'skill' }, { name: 'grep_lorebook' }, { name: 'submit_story' }]
  }, { context, injection: pureWritingInjection(frame, material) })
  assert.deepEqual(request.tools, [{ name: 'submit_story' }])
  assert.equal(request.toolChoice, undefined)
  assert.equal(request.system, context.system)
  assert.deepEqual(request.messages, [player, pureWritingInjection(frame, material)])
})

test('历史注入保留世界书和剧情事实，去掉 Skill 和旧变量原文', () => {
  const skill = '【写作指引】\n只用于查询的规则。'
  const reference = '【写作 Skill · 参考】\n旧版参考内容。'
  const book = '【世界书 · 钟楼】\n第一段。\n\n第二段。'
  const memory = '【剧情记忆 · 第 1 轮】\n她曾敲钟。'
  const raw = '【当前变量 · game】\ngame的player的balance为 42。'
  const facts = '【当前状态】\n林婉手里还有三张车票。'
  const previous = pureWritingInjection(frame, [skill, book, reference, memory, raw, facts].join('\n\n'))
  const rawOnly = pureWritingInjection({ ...frame, frameId: 'only-raw' }, raw)
  const shared = pureWritingContext(context.system, [previous, rawOnly, player])
  const expected = { ...previous, content: [{ type: 'text', text: [book, memory, facts].join('\n\n') }] }
  assert.deepEqual(shared.messages, [expected, player])
  assert.deepEqual(projectPureWritingRequest({ tools: [] }, { context: shared }).messages, [expected, player])
  assert.ok(previous.content[0].text.startsWith(skill))
})

test('白手套沿用前台的设定与原文历史，前轮的注入随原位置保存且重试不重复写入', async () => {
  const longStory = '风从钟楼窗下吹过。'.repeat(200)
  const checkpoint = {
    id: 'compacted-history', role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'earlier-chapters' },
    content: [
      { type: 'text', text: '前情：她来到镇上。' },
      { type: 'text', text: '<recent_transcript>\n从镇口经过时，小贩递给她一盏灯。\n</recent_transcript>' }
    ]
  }
  const history = Array.from({ length: 8 }, (_, index) => [
    { ...player, id: `player-${index}`, content: [{ type: 'text', text: `第 ${index} 次走进钟楼。` }] },
    { id: `story-${index}`, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'writer' },
      content: index === 0 ? [{ type: 'text', text: longStory }, { type: 'text', text: '\n\n' }, { type: 'text', text: '门关了。' }]
        : [{ type: 'text', text: `第 ${index} 段正文。` }] }
  ]).flat()
  const task = { id: 'task', role: 'user', content: [{ type: 'text', text: '查写作资料。' }] }
  const result = { id: 'result', role: 'tool', content: [{ type: 'text', text: '钟楼侧门开着。' }] }
  const persisted = []
  const session = {
    append(type, data, intent) {
      assert.equal(type, 'user/message')
      assert.deepEqual(intent, { surfaceOp: 'append' })
      persisted.push(data)
    }
  }
  let shared, passes = 0
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'story',
    resolvePreset: async () => null,
    prepareTurn: async ({ turn }) => ({ frame: { ...frame, turn, frameId: frame.frameId + ':' + turn,
      userInput: { sourceText: turn === 3 ? '去钟楼' : '离开钟楼' }, source: {
        card: { systemPromptText: '用第三人称写钟楼故事。' },
        regenerationMaterials: { worldbookPrefix: '钟楼每晚向村民开放。' }
      } } }),
    recordFrame: () => {},
    writingPreparation: {
      forGame: async () => ({}),
      prepare: async (_entry, { context, frame, foregroundSelection }) => {
        assert.deepEqual(foregroundSelection, { provider: 'fixture', model: 'writer', reasoningEffort: 'high' })
        shared = context
        passes++
        return frame.turn === 3 ? result.content[0].text : ''
      }
    }
  })
  const decision = await strategy.prepareStep({
    sessionId: 'game',
    payload: { agent: { session }, turn: 3, step: 1, messages: [player] },
    decision: { messages: [player] }
  })
  assert.equal(passes, 0)
  const nativeRequest = { sessionId: 'game', provider: 'fixture', model: 'writer', reasoningEffort: 'high',
    messages: [checkpoint, ...history, ...decision.messages], tools: [{ name: 'submit_story' }] }
  const foreground = await strategy.prepareWritingRequest(nativeRequest)
  assert.deepEqual(await strategy.prepareWritingRequest({ ...nativeRequest, messages: [...nativeRequest.messages, ...persisted] }), foreground)
  assert.equal(passes, 1)
  const preparation = projectWritingPreparationRequest({
    system: '背景任务系统提示', messages: [{ role: 'system' }, task, result], tools: [{ name: 'find_worldbook' }]
  }, shared)
  assert.match(preparation.system, /用第三人称写钟楼故事/)
  assert.equal(preparation.system, foreground.system)
  assert.match(foreground.system, /<lorebook_constant>\n钟楼每晚向村民开放。\n<\/lorebook_constant>/)
  assert.doesNotMatch(JSON.stringify(foreground.messages), /钟楼每晚向村民开放/)
  assert.deepEqual(preparation.messages.slice(0, -2), [checkpoint, ...history, player])
  assert.doesNotMatch(JSON.stringify({ preparation, foreground }), /交付本轮完整正文/)
  assert.deepEqual(foreground.messages.slice(0, -1), preparation.messages.slice(0, -2))
  assert.deepEqual(preparation.messages.slice(-2), [task, result])
  const injection = foreground.messages.at(-1)
  assert.equal(injection.content[0].text, result.content[0].text)
  assert.deepEqual(persisted, [injection])

  const body = { id: 'reply-3', role: 'assistant', content: [{ type: 'text', text: '她从钟楼侧门走进去。' }] }
  const nextInput = { ...player, id: 'player-4', content: [{ type: 'text', text: '离开钟楼' }] }
  const next = await strategy.prepareStep({
    sessionId: 'game',
    payload: { agent: { session }, turn: 4, step: 1, messages: [nextInput] },
    decision: { messages: [nextInput] }
  })
  const nextHistory = [...nativeRequest.messages, ...persisted, body, ...next.messages]
  const nextForeground = await strategy.prepareWritingRequest({ ...nativeRequest, messages: nextHistory })
  assert.equal(passes, 2)
  assert.deepEqual(shared.messages, nextHistory)
  assert.deepEqual(nextForeground.messages, nextHistory)
  assert.deepEqual(nextForeground.messages.slice(0, foreground.messages.length), foreground.messages)
  assert.deepEqual(nextForeground.messages.filter(message => message.source?.form === 'inject'), [injection])
  assert.deepEqual(persisted, [injection])
})

test('白手套沿用前台历史，流式输出只留下思考、工具调用和完成信号', async () => {
  const hooks = []
  const thinking = { type: 'reasoning-delta', index: 0, text: '查钟楼设定。' }
  const toolStart = { type: 'block-start', index: 5, blockType: 'tool-call' }
  const toolEnd = { type: 'block-end', index: 5, block: { type: 'tool-call', id: 'query', name: 'find_worldbook', arguments: '{"query":"钟楼"}' } }
  const finish = { type: 'finish', reason: { kind: 'tool-calls' },
    replayState: { response: { provider: 'fixture' }, blocks: [{ hint: 'reasoning' }, { hint: 'text' }, { hint: 'tool' }, { hint: 'more-text' }] } }
  const ctx = {
    on(event, hook) { if (event === 'llm/stream') hooks.push(hook) },
    llm: { stream(request) {
      const downstream = async function * () {
        yield request
        yield thinking
        yield { type: 'block-start', index: 3, blockType: 'text' }
        yield toolStart
        yield { type: 'text-delta', index: 3, text: '【本轮资料交接】' }
        yield toolEnd
        yield { type: 'block-end', index: 3, block: { type: 'text', text: '【本轮资料交接】' } }
        yield { type: 'block-end', index: 8, block: { type: 'text', text: '结束。' } }
        yield finish
      }
      const dispatch = index => hooks[index]?.(request, () => dispatch(index + 1)) ?? downstream()
      return dispatch(0)
    } }
  }
  const context = pureWritingContext('钟楼设定。', [
    { id: 'old', role: 'assistant', content: [{ type: 'text', text: '她走到钟楼。' }] }, player
  ])
  registerModelStreamHooks({
    ctx, requestCoordinates: new Map(), str: value => String(value ?? ''),
    chatHeaderForSession: async () => undefined, sessionStore: new Map(), agentRegistry: new Map(),
    backgroundAgentRunner: { owns: () => true, requestContext: () => ({ parentSessionId: 'game', writingPreparation: context }) },
    foregroundStrategies: { projectRequest: () => assert.fail('共享历史不进入通用请求改写'), completeRequest() {} }
  })
  const task = { id: 'task', role: 'user', content: [{ type: 'text', text: '查资料。' }] }
  const [request, ...chunks] = await Array.fromAsync(ctx.llm.stream({ sessionId: 'white-glove', provider: 'deepseek-official', messages: [task] }))
  assert.equal(request.system, context.system)
  assert.deepEqual(request.messages, [...context.messages, task])
  assert.deepEqual(chunks, [thinking, toolStart, toolEnd, {
    ...finish, replayState: { ...finish.replayState, blocks: [{ hint: 'reasoning' }, { hint: 'tool' }] }
  }])
})

test('两边的实际写作请求过滤宿主提醒及其内容，保留相邻正文和资料', () => {
  const reminder = '<system-reminder>\nCurrent working directory: /some/private/folder\n</system-reminder>'
  const typed = (kind, text) => ({ role: 'user', source: { kind }, content: [{ type: 'text', text }] })
  const body = { role: 'assistant', content: [{ type: 'text', text: '她走到钟楼。' }] }
  const context = pureWritingContext('前台写作设定。' + reminder, [
    typed('runtime-context', reminder), body, player, typed('skill-catalog', 'A skill is a reusable set')
  ])
  const task = typed('plugin:prepare', '查世界书。')
  const preparation = projectWritingPreparationRequest({ system: reminder, messages: [
    typed('runtime-context', reminder), typed('skill-invocation', 'skill instructions'), task
  ] }, context)
  const foreground = projectPureWritingRequest({ tools: [] }, { context, injection: pureWritingInjection(frame, reminder + '钟楼侧门开着。') })
  assert.equal(preparation.system, '前台写作设定。')
  assert.deepEqual(preparation.messages, [...context.messages, task])
  assert.deepEqual(context.messages.slice(0, 2), [{ ...body, id: undefined }, player])
  assert.equal(foreground.messages.at(-1).content[0].text, '钟楼侧门开着。')
  assert.doesNotMatch(JSON.stringify({ preparation, foreground }), /system-reminder|working directory|reusable set|skill instructions/)
})

test('空查询回执留在白手套的工具记录中，前台直接开始写作', async () => {
  let titles = [{ title: '上一轮', text: '上一轮资料。' }]
  let queried = true
  const prepare = createFixture({ worldbook: () => titles }, async task => {
    if (queried) {
      const result = await task.call('find_worldbook', { query: '钟楼' })
      if (!titles.length) assert.equal(result, '没有查到资料。')
    }
  })
  assert.match(await prepare(), /上一轮资料/)
  titles = []
  assert.equal(await prepare(), '')
  queried = false
  assert.equal(await prepare(), '')
})

test('白手套写出的回复不进入自动交接', async () => {
  let receipt
  const prepare = createFixture({
    worldbook: () => [{ title: '钟楼', text: '塔钟在整点响。' }]
  }, async task => {
    receipt = await task.call('find_worldbook', { query: '钟楼' })
    return { text: '她走进钟楼。这段是白手套误写的正文。' }
  })
  assert.equal(await prepare(), receipt)
})

test('定向查询将命中的变量和最近变化表达成自然句子', async () => {
  const previous = { 金币: 2, 钟楼: { 状态: '关闭' } }
  const current = { 金币: 3, 钟楼: { 状态: '开放', 道具: ['钥匙', '地图'], '__internal': '/tmp/internal' } }
  const chat = {
    mode: 'story', mvu: { enabled: true }, messages: [previous, current].map(stat_data =>
      ({ role: 'assistant', text: '剧情。', variables: [{ stat_data }] }))
  }
  const sources = createWritingPreparationSources({ chatForSession: async () => chat })({
    gameId: 'game', signal: new AbortController().signal,
    frame: { source: { regenerationMaterials: { generationState: { variables: { stat_data: current } } } } }
  })
  assert.deepEqual(await sources.variables({}), [])
  assert.deepEqual(await sources.variables({ query: '金币' }), [{ title: '上轮变量变化', text: '金币为 3。' }])
  assert.deepEqual(await sources.variables({ query: '钟楼 状态' }), [{ title: '上轮变量变化', text: '钟楼的状态为 开放。' }])
  const items = await sources.variables({ query: '钟楼 道具' })
  assert.deepEqual(items.map(row => row.text), ['钟楼的道具的第 1 项为 钥匙。\n钟楼的道具的第 2 项为 地图。'])
})
