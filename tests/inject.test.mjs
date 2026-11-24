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
const { projectPureWritingRequest, projectWritingPreparationRequest, pureWritingContext } = await domain('pure-writing-request.js')
const frame = { frameId: 'frame:writing', turn: 3, contributions: [], source: {} }
const player = { id: 'player', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '去钟楼' }] }
const context = pureWritingContext('钟楼夜景，采用第三人称。', [player])
const input = { gameId: 'game', frame, context }

function createFixture(readers, runTask) {
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
  apply({ tavern: { capabilities: { writingPreparation: 5 }, writingPreparation: value => preparation.register('pure-writer', value) } })
  return async () => preparation.prepare(await preparation.forGame(input.gameId), input)
}

test('inject 按调用顺序交付原样回执，保留完整段落与重复结果', async () => {
  const skill = Promise.withResolvers()
  const fragment = '第二段也会交给前台。'.repeat(120)
  const readers = {
    skill: ({ reference }) => reference ? [{ title: reference, text: '参考文件全文。\n\n```sh\nnode /tmp/start.js\n```' }] : skill.promise,
    worldbook: () => [{ title: '钟楼', text: '塔钟在整点响。' }],
    memory: ({ turn }) => {
      if (turn) throw new Error('读取失败')
      return [{ title: '第 1 轮', text: '钥匙藏在墙缝。' }]
    },
    variables: () => Array.from({ length: 6 }, (_, i) => ({ title: `变量 ${i}`, text: i + '甲'.repeat(4999) }))
  }
  let outputs
  const prepare = createFixture(readers, async task => {
    assert.match(task.prompt, /你是白手套 Agent/)
    assert.match(task.prompt, /可用写作指引\nshort$/)
    assert.deepEqual(task.writingPreparation, context)
    const tools = Object.fromEntries(task.tools.map(tool => [tool.name, args => task.call(tool.name, args)]))
    const schema = task.tools.find(tool => tool.name === 'inject').parameters
    assert.deepEqual(schema, { type: 'object', properties: {}, required: [], additionalProperties: false })
    assert.match(await tools.inject({ items: [] }), /不接收参数/)
    const base = tools.load_writing_skill({ name: 'short' })
    const reference = await tools.load_writing_skill({ name: 'short', reference: 'references/tower.md' })
    const book = await tools.find_worldbook({ query: '钟楼' })
    const memory = await tools.recall_memory({ query: '钥匙' })
    const duplicate = await tools.recall_memory({ query: '钥匙' })
    const variables = await tools.read_variable_summary({ query: '变量' })
    assert.equal(variables.length, 20000)
    const error = await tools.recall_memory({ turn: 999 })
    assert.deepEqual(JSON.parse(error), { ok: false, error: '读取失败' })
    const done = tools.inject({})
    assert.equal(task.stopToolsWhen(), false)
    assert.match(await tools.find_worldbook({ query: '迟到的查询' }), /已提交/)
    skill.resolve([{ title: 'short', text: [
      '---', 'entry: scripts/launch.sh', '---', '正文第一段。', '路径：/tmp/book.json',
      '"C:\\Users\\Public\\My Documents\\settings.json"',
      '├── config/', 'npm install', '{', '  "secret": [{"path":"./data"}]', '}',
      '从`林婉`的视角描写。', '钟楼藏在北岸。{"script":"story.py"}钥匙留在桌上。', '', fragment
    ].join('\n') }])
    assert.deepEqual(JSON.parse(await done), { accepted: true })
    assert.equal(task.stopToolsWhen(), true)
    assert.equal(task.acceptWithoutText(), true)
    assert.match(await tools.inject({}), /已提交/)
    outputs = [await base, reference, book, memory, duplicate, variables]
  })
  const material = await prepare()
  assert.ok(outputs[0].endsWith(fragment))
  assert.equal(material, outputs.join('\n\n'))
  assert.match(material, /从林婉的视角描写。/)
  assert.match(material, /钟楼藏在北岸。钥匙留在桌上。/)
  assert.doesNotMatch(material, /launch\.sh|npm install|\/tmp\/|references\/|[{}]|story\.py|读取失败|config\/|My Documents|" "/)

  const request = projectPureWritingRequest({
    system: '旧 Skill 目录', messages: [], toolChoice: 'any',
    tools: [{ name: 'skill' }, { name: 'grep_lorebook' }, { name: 'submit_story' }]
  }, { context, material, frame })
  assert.deepEqual(request.tools, [{ name: 'submit_story' }])
  assert.equal(request.toolChoice, undefined)
  assert.equal(request.system, context.system)
  assert.deepEqual(request.messages[0], player)
  assert.equal(request.messages.at(-1).content[0].text, material)
})

test('白手套沿用前台实际发出的设定、原文历史和本轮输入，工具过程排在后面', async () => {
  const longStory = '风从钟楼窗下吹过。'.repeat(200)
  const history = Array.from({ length: 10 }, (_, index) => ({
    id: `story-${index}`, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'writer' },
    content: [{ type: 'text', text: index === 1 ? longStory : `第 ${index} 段正文。` }]
  }))
  const task = { id: 'task', role: 'user', content: [{ type: 'text', text: '查写作资料。' }] }
  const result = { id: 'result', role: 'tool', content: [{ type: 'text', text: '钟楼侧门开着。' }] }
  let shared, passes = 0
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'story',
    resolvePreset: async () => null,
    prepareTurn: async () => ({ frame: { ...frame, userInput: { sourceText: '去钟楼' }, source: { card: { systemPromptText: '用第三人称写钟楼故事。' } } } }),
    recordFrame: () => {},
    writingPreparation: {
      forGame: async () => ({}),
      prepare: async (_entry, { context }) => {
        shared = context
        passes++
        return result.content[0].text
      }
    }
  })
  const decision = await strategy.prepareStep({
    sessionId: 'game',
    payload: { agent: { session: {} }, turn: 3, step: 1, messages: [player] },
    decision: { messages: [player] }
  })
  assert.equal(passes, 0)
  const nativeRequest = { sessionId: 'game', messages: [...history, ...decision.messages], tools: [{ name: 'submit_story' }] }
  const foreground = await strategy.prepareWritingRequest(nativeRequest)
  assert.deepEqual(await strategy.prepareWritingRequest(nativeRequest), foreground)
  assert.equal(passes, 1)
  const preparation = projectWritingPreparationRequest({
    system: '背景任务系统提示', messages: [{ role: 'system' }, task, result], tools: [{ name: 'find_worldbook' }]
  }, shared)
  assert.match(preparation.system, /用第三人称写钟楼故事/)
  assert.equal(preparation.system, foreground.system)
  assert.deepEqual(preparation.messages.slice(0, -2), [...history, player])
  assert.deepEqual(foreground.messages.slice(0, -2), preparation.messages.slice(0, -2))
  assert.deepEqual(preparation.messages.slice(-2), [task, result])
  assert.equal(foreground.messages.at(-1).content[0].text, result.content[0].text)
})

test('空查询回执留在白手套的工具记录中，前台直接开始写作', async () => {
  let titles = [{ title: '上一轮', text: '上一轮资料。' }]
  let queried = true
  const prepare = createFixture({ worldbook: () => titles }, async task => {
    if (queried) {
      const result = await task.call('find_worldbook', { query: '钟楼' })
      if (!titles.length) assert.equal(result, '没有查到资料。')
    }
    await task.call('inject', {})
  })
  assert.match(await prepare(), /上一轮资料/)
  titles = []
  assert.equal(await prepare(), '')
  queried = false
  assert.equal(await prepare(), '')
})

test('查询将嵌套的变量状态和最近变化表达成自然句子', async () => {
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
  const rows = await sources.variables({})
  const text = rows.map(row => row.text).join('\n')
  assert.match(text, /金币为 3。/)
  assert.match(text, /钟楼的状态为 开放。/)
  assert.match(text, /钟楼的道具的第 1 项为 钥匙。/)
  assert.match(rows.find(row => row.title === '上轮变量变化').text, /金币为 3。/)
  assert.doesNotMatch(text, /[{}\[\]]|__internal|\/tmp| = |<variable_changes>/)
})
